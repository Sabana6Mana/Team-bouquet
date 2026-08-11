-- Require every matched participant to accept within five minutes before
-- scheduling starts. The existing `queue` phase becomes a real acceptance
-- phase instead of being used only by the client-side waiting placeholder.

alter table public.matches
  add column if not exists acceptance_deadline timestamptz;

alter table public.match_members
  add column if not exists accepted_at timestamptz;

create index if not exists matches_pending_acceptance_deadline_idx
  on public.matches (acceptance_deadline)
  where phase = 'queue';

create or replace function public.prepare_match_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- join_match_queue historically inserts `scheduling`. Convert only newly
  -- formed, non-finalized matches; imported terminal fixtures stay untouched.
  if new.phase = 'scheduling' and new.finalized_at is null then
    new.phase := 'queue';
    new.acceptance_deadline := coalesce(new.acceptance_deadline, now() + interval '5 minutes');
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_match_acceptance on public.matches;
create trigger prepare_match_acceptance
  before insert on public.matches
  for each row execute function public.prepare_match_acceptance();

create or replace function public.route_match_acceptance_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.title = '매칭 완료!' and new.link = '/room' then
    new.title := '매칭 성사!';
    new.body := '5분 안에 수락해 주세요. 전원이 수락하면 일정 조율을 시작합니다.';
    new.link := '/queue';
  end if;
  return new;
end;
$$;

drop trigger if exists route_match_acceptance_notification on public.notifications;
create trigger route_match_acceptance_notification
  before insert on public.notifications
  for each row execute function public.route_match_acceptance_notification();

create or replace function public.expire_match_acceptance(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can expire acceptance';
  end if;

  select * into target_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if target_match.phase <> 'queue' then
    return jsonb_build_object(
      'match_id', p_match_id,
      'expired', false,
      'phase', target_match.phase
    );
  end if;
  if target_match.acceptance_deadline is null or target_match.acceptance_deadline > now() then
    return jsonb_build_object(
      'match_id', p_match_id,
      'expired', false,
      'phase', target_match.phase,
      'deadline', target_match.acceptance_deadline
    );
  end if;

  update public.matches
  set phase = 'canceled'
  where id = p_match_id and phase = 'queue';

  update public.queue_entries
  set status = 'canceled', canceled_at = coalesce(canceled_at, now())
  where match_id = p_match_id and status = 'matched';

  insert into public.notifications (user_id, title, body, link)
  select mm.user_id,
    '매칭 수락 시간이 끝났습니다',
    '전원이 5분 안에 수락하지 않아 매칭이 취소되었습니다.',
    '/'
  from public.match_members mm
  where mm.match_id = p_match_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'expired', true,
    'phase', 'canceled'
  );
end;
$$;

create or replace function public.accept_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  member_count integer;
  accepted_count integer;
  all_accepted boolean;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can accept a match';
  end if;

  select * into target_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;

  -- A network retry after everybody accepted is a successful no-op.
  if target_match.phase = 'scheduling' and exists (
    select 1
    from public.match_members mm
    where mm.match_id = p_match_id
      and mm.user_id = actor_id
      and mm.accepted_at is not null
  ) then
    return jsonb_build_object(
      'match_id', p_match_id,
      'accepted', true,
      'all_accepted', true,
      'phase', 'scheduling'
    );
  end if;

  if target_match.phase <> 'queue' then
    raise exception using errcode = '55000', message = 'This match is not awaiting acceptance';
  end if;

  if target_match.acceptance_deadline is null or target_match.acceptance_deadline <= now() then
    update public.matches set phase = 'canceled' where id = p_match_id and phase = 'queue';
    update public.queue_entries
    set status = 'canceled', canceled_at = coalesce(canceled_at, now())
    where match_id = p_match_id and status = 'matched';
    insert into public.notifications (user_id, title, body, link)
    select mm.user_id,
      '매칭 수락 시간이 끝났습니다',
      '전원이 5분 안에 수락하지 않아 매칭이 취소되었습니다.',
      '/'
    from public.match_members mm
    where mm.match_id = p_match_id;
    return jsonb_build_object(
      'match_id', p_match_id,
      'accepted', false,
      'expired', true,
      'all_accepted', false,
      'phase', 'canceled'
    );
  end if;

  update public.match_members
  set accepted_at = coalesce(accepted_at, now())
  where match_id = p_match_id and user_id = actor_id;

  select count(*)::integer, (count(*) filter (where accepted_at is not null))::integer
  into member_count, accepted_count
  from public.match_members
  where match_id = p_match_id;

  all_accepted := member_count = target_match.capacity and accepted_count = member_count;

  if all_accepted then
    update public.matches
    set phase = 'scheduling'
    where id = p_match_id and phase = 'queue';

    insert into public.chat_messages (match_id, sender_id, body, system)
    values (p_match_id, null, '전원이 매칭을 수락했습니다. 예약 가능한 시간을 골라 투표해 주세요.', true);

    insert into public.notifications (user_id, title, body, link)
    select mm.user_id,
      '전원 수락 완료!',
      '이제 경기 시간을 함께 정해 주세요.',
      '/room'
    from public.match_members mm
    where mm.match_id = p_match_id;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id,
    'accepted', true,
    'accepted_count', accepted_count,
    'members', member_count,
    'all_accepted', all_accepted,
    'deadline', target_match.acceptance_deadline,
    'phase', case when all_accepted then 'scheduling' else 'queue' end
  );
end;
$$;

revoke all on function public.prepare_match_acceptance()
  from public, anon, authenticated;
revoke all on function public.route_match_acceptance_notification()
  from public, anon, authenticated;
revoke all on function public.accept_match(uuid)
  from public, anon;
revoke all on function public.expire_match_acceptance(uuid)
  from public, anon;
grant execute on function public.accept_match(uuid) to authenticated;
grant execute on function public.expire_match_acceptance(uuid) to authenticated;

comment on column public.matches.acceptance_deadline is
  'Five-minute deadline for every matched participant to accept before scheduling.';
comment on column public.match_members.accepted_at is
  'Timestamp of this participant accepting the newly formed match.';
