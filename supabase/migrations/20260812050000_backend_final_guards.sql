-- Close the last lifecycle gaps around acceptance expiry and operator sanctions.

create or replace function public.expire_my_overdue_acceptances()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match_id uuid;
  expired_match_ids uuid[] := '{}'::uuid[];
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  for target_match_id in
    select match.id
    from public.matches match
    join public.match_members member on member.match_id = match.id
    where member.user_id = actor_id
      and match.phase = 'queue'
      and match.acceptance_deadline is not null
      and match.acceptance_deadline <= now()
    order by match.acceptance_deadline, match.id
    for update of match
  loop
    update public.matches
    set phase = 'canceled'
    where id = target_match_id and phase = 'queue';

    if found then
      update public.queue_entries
      set status = 'canceled', canceled_at = coalesce(canceled_at, now())
      where match_id = target_match_id and status = 'matched';

      insert into public.notifications (user_id, title, body, link)
      select member.user_id,
        '매칭 수락 시간이 끝났습니다',
        '전원이 5분 안에 수락하지 않아 매칭이 취소되었습니다.',
        '/'
      from public.match_members member
      where member.match_id = target_match_id;

      expired_match_ids := array_append(expired_match_ids, target_match_id);
    end if;
  end loop;

  return jsonb_build_object(
    'expired_count', cardinality(expired_match_ids),
    'match_ids', to_jsonb(expired_match_ids)
  );
end;
$$;

-- Keep the tested matcher as an inaccessible core and put lazy acceptance
-- cleanup in front of every new queue attempt. This avoids copying the large
-- matching transaction and keeps its advisory-lock behavior unchanged.
alter function public.join_match_queue(
  public.sport_code, public.match_mode, text, double precision, double precision
) rename to join_match_queue_core;

revoke all on function public.join_match_queue_core(
  public.sport_code, public.match_mode, text, double precision, double precision
) from public, anon, authenticated;

create function public.join_match_queue(
  p_sport public.sport_code,
  p_mode public.match_mode,
  p_venue_id text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.expire_my_overdue_acceptances();
  return public.join_match_queue_core(p_sport, p_mode, p_venue_id, p_lat, p_lng);
end;
$$;

-- Security-definer RPCs still carry the request JWT. Guard the rows they
-- mutate so a banned caller cannot cancel a match, re-form teams, acknowledge
-- completion, or alter another lifecycle field through an older RPC.
create or replace function public.enforce_unbanned_member_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is not null
    and public.is_profile_permanently_banned(actor_id)
    and (
      new.accepted_at is distinct from old.accepted_at
      or new.ready is distinct from old.ready
      or new.paid is distinct from old.paid
      or new.team is distinct from old.team
      or new.completed_at is distinct from old.completed_at
    )
  then
    raise exception using
      errcode = '42501',
      message = '영구 정지된 계정은 이 기능을 사용할 수 없습니다.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_unbanned_match_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is not null
    and public.is_profile_permanently_banned(actor_id)
    and (
      new.phase is distinct from old.phase
      or new.confirmed_slot_id is distinct from old.confirmed_slot_id
      or new.winner_team is distinct from old.winner_team
      or new.score is distinct from old.score
      or new.finalized_at is distinct from old.finalized_at
    )
  then
    raise exception using
      errcode = '42501',
      message = '영구 정지된 계정은 이 기능을 사용할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_unbanned_match_action on public.matches;
create trigger enforce_unbanned_match_action
  before update on public.matches
  for each row execute function public.enforce_unbanned_match_action();

create or replace function public.review_match_report(
  p_report_id uuid,
  p_upheld boolean,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
  strike_count integer;
  banned_at timestamptz;
  next_status public.report_status;
  affected_match_ids uuid[] := '{}'::uuid[];
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only an operator can review reports';
  end if;
  if p_review_note is not null and char_length(p_review_note) > 1000 then
    raise exception using errcode = '22023', message = 'Review note is too long';
  end if;

  select * into target_report
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Report not found';
  end if;

  next_status := case
    when p_upheld then 'resolved'::public.report_status
    else 'dismissed'::public.report_status
  end;

  if target_report.status in ('resolved', 'dismissed')
    and target_report.status <> next_status
  then
    raise exception using errcode = '55000', message = 'A completed review cannot be reversed';
  end if;

  -- A legacy terminal status is not a strike until an operator explicitly
  -- calls this RPC. That call stamps reviewed_at; untouched legacy rows remain
  -- excluded from the count below.
  if target_report.status not in ('resolved', 'dismissed')
    or target_report.reviewed_at is null
  then
    update public.reports
    set status = next_status,
        reviewed_at = now(),
        review_note = nullif(btrim(p_review_note), '')
    where id = p_report_id;
  end if;

  select count(*)::integer into strike_count
  from public.reports report
  where report.reported_id = target_report.reported_id
    and report.status = 'resolved'
    and report.reviewed_at is not null;

  insert into public.account_sanctions (
    profile_id, upheld_report_count, permanently_banned_at, last_reviewed_report_id
  ) values (
    target_report.reported_id,
    strike_count,
    case when strike_count >= 3 then now() else null end,
    p_report_id
  )
  on conflict (profile_id) do update
  set upheld_report_count = excluded.upheld_report_count,
      permanently_banned_at = case
        when excluded.upheld_report_count >= 3
          then coalesce(public.account_sanctions.permanently_banned_at, now())
        else public.account_sanctions.permanently_banned_at
      end,
      last_reviewed_report_id = excluded.last_reviewed_report_id;

  select sanctions.permanently_banned_at into banned_at
  from public.account_sanctions sanctions
  where sanctions.profile_id = target_report.reported_id;

  if banned_at is not null then
    select coalesce(array_agg(match.id order by match.id), '{}'::uuid[])
    into affected_match_ids
    from public.matches match
    join public.match_members member on member.match_id = match.id
    where member.user_id = target_report.reported_id
      and match.finalized_at is null
      and match.phase in ('queue', 'scheduling', 'teaming', 'payment', 'confirmed', 'reporting');

    update public.venue_slots
    set status = 'open', reserved_match_id = null
    where reserved_match_id = any(affected_match_ids)
      and status = 'held';

    update public.matches
    set phase = 'canceled'
    where id = any(affected_match_ids)
      and finalized_at is null;

    update public.queue_entries
    set status = 'canceled', canceled_at = coalesce(canceled_at, now())
    where (
      user_id = target_report.reported_id and status = 'waiting'
    ) or (
      match_id = any(affected_match_ids) and status = 'matched'
    );

    insert into public.notifications (user_id, title, body, link)
    select member.user_id,
      '참가자 제재로 매칭이 종료되었습니다',
      '운영자 판정으로 해당 매칭이 취소되었습니다. 다시 매칭을 시작할 수 있습니다.',
      '/'
    from public.match_members member
    where member.match_id = any(affected_match_ids)
      and member.user_id <> target_report.reported_id;
  end if;

  if banned_at is not null and not exists (
    select 1
    from public.notifications notification
    where notification.user_id = target_report.reported_id
      and notification.title = '계정이 영구 정지되었습니다'
  ) then
    insert into public.notifications (user_id, title, body, link)
    values (
      target_report.reported_id,
      '계정이 영구 정지되었습니다',
      '운영자가 실제 방해 행위로 인정한 신고가 3회 누적되었습니다.',
      '/profile'
    );
  end if;

  return jsonb_build_object(
    'report_id', p_report_id,
    'status', next_status,
    'reported_id', target_report.reported_id,
    'upheld_report_count', strike_count,
    'permanently_banned_at', banned_at,
    'canceled_match_ids', to_jsonb(affected_match_ids)
  );
end;
$$;

revoke all on function public.expire_my_overdue_acceptances()
  from public, anon, authenticated;
grant execute on function public.expire_my_overdue_acceptances()
  to authenticated;

revoke all on function public.join_match_queue(
  public.sport_code, public.match_mode, text, double precision, double precision
) from public, anon;
grant execute on function public.join_match_queue(
  public.sport_code, public.match_mode, text, double precision, double precision
) to authenticated;

revoke all on function public.enforce_unbanned_member_action()
  from public, anon, authenticated;
revoke all on function public.enforce_unbanned_match_action()
  from public, anon, authenticated;
revoke all on function public.review_match_report(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_match_report(uuid, boolean, text)
  to service_role;

comment on function public.expire_my_overdue_acceptances() is
  'Lazily expires every overdue acceptance match for the authenticated user.';
comment on function public.join_match_queue_core(
  public.sport_code, public.match_mode, text, double precision, double precision
) is 'Private matcher core; call join_match_queue instead.';
