-- Keep each participant's result acknowledgement independent and require a
-- structured score before result consensus. This prevents the first person who
-- closes the result screen from hiding it for every other participant.

alter table public.match_members
  add column if not exists completed_at timestamptz;

-- Old terminal matches predate per-member acknowledgement. Mark them handled so
-- they do not reappear as current matches after this migration.
update public.match_members member
set completed_at = coalesce(match.finalized_at, match.updated_at, now())
from public.matches match
where match.id = member.match_id
  and match.phase in ('done', 'canceled')
  and member.completed_at is null;

create index if not exists match_members_current_for_user_idx
  on public.match_members (user_id, joined_at desc)
  where completed_at is null;

create or replace function public.normalize_result_vote_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_score text := regexp_replace(coalesce(new.score, ''), '[[:space:]]+', '', 'g');
  score_part text;
  score_pair text[];
begin
  if normalized_score !~ '^([0-9]{1,3}[-:][0-9]{1,3})(,[0-9]{1,3}[-:][0-9]{1,3}){0,4}$' then
    raise exception using
      errcode = '22023',
      message = '점수는 21-18 또는 6-4,3-6,10-8 형식으로 입력해 주세요.';
  end if;

  foreach score_part in array regexp_split_to_array(normalized_score, ',')
  loop
    score_pair := regexp_split_to_array(score_part, '[-:]');
    if score_pair[1]::integer = score_pair[2]::integer then
      raise exception using errcode = '22023', message = '동점 세트는 결과 점수로 입력할 수 없습니다.';
    end if;
    if score_pair[1]::integer > 100 or score_pair[2]::integer > 100 then
      raise exception using errcode = '22023', message = '세트 점수는 0~100 범위로 입력해 주세요.';
    end if;
  end loop;

  -- Keep the exact inner spacing used for consensus; the browser normalizes it
  -- before sending, while direct callers that submit the same spaced score can
  -- still reach consensus. The normalized copy above is validation-only.
  new.score := btrim(new.score);
  return new;
end;
$$;

drop trigger if exists normalize_result_vote_score on public.result_votes;
create trigger normalize_result_vote_score
  before insert or update of score on public.result_votes
  for each row execute function public.normalize_result_vote_score();

create or replace function public.complete_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  incomplete_members integer;
  next_phase public.match_phase;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can complete a match';
  end if;

  select * into target_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if target_match.finalized_at is null then
    raise exception using errcode = '55000', message = 'The result must be finalized first';
  end if;
  if target_match.phase not in ('reporting', 'done') then
    raise exception using errcode = '55000', message = 'This match cannot be completed';
  end if;

  update public.match_members
  set completed_at = coalesce(completed_at, now())
  where match_id = p_match_id and user_id = actor_id;

  select count(*)::integer into incomplete_members
  from public.match_members
  where match_id = p_match_id and completed_at is null;

  -- The shared match may be marked done immediately because each client now
  -- finds result screens through its own completed_at value. This also lets a
  -- participant who already acknowledged the result enter a new queue without
  -- waiting indefinitely for every other member.
  update public.matches set phase = 'done' where id = p_match_id;
  next_phase := 'done';

  return jsonb_build_object(
    'match_id', p_match_id,
    'phase', next_phase,
    'acknowledged', true,
    'remaining_members', incomplete_members
  );
end;
$$;

revoke all on function public.normalize_result_vote_score()
  from public, anon, authenticated;
revoke all on function public.complete_match(uuid)
  from public, anon;
grant execute on function public.complete_match(uuid) to authenticated;

comment on column public.match_members.completed_at is
  'Per-member result-screen acknowledgement; incomplete members may still reopen a shared done match.';
