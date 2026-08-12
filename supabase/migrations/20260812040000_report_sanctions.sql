-- Operator-reviewed reports are the only source of account strikes. Three
-- upheld reports permanently block new matchmaking and user-authored match
-- mutations. Raw report count alone never bans a user.

alter table public.reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text
    check (review_note is null or char_length(review_note) <= 1000);

create table if not exists public.account_sanctions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  upheld_report_count integer not null default 0 check (upheld_report_count >= 0),
  permanently_banned_at timestamptz,
  last_reviewed_report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (permanently_banned_at is null or upheld_report_count >= 3)
);

drop trigger if exists set_updated_at on public.account_sanctions;
create trigger set_updated_at
  before update on public.account_sanctions
  for each row execute function public.set_updated_at();

create or replace function public.is_profile_permanently_banned(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_sanctions sanctions
    where sanctions.profile_id = p_profile_id
      and sanctions.permanently_banned_at is not null
  );
$$;

create or replace function public.enforce_unbanned_authored_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  actor_id := case tg_table_name
    when 'queue_entries' then nullif(to_jsonb(new) ->> 'user_id', '')::uuid
    when 'slot_votes' then nullif(to_jsonb(new) ->> 'user_id', '')::uuid
    when 'result_votes' then nullif(to_jsonb(new) ->> 'user_id', '')::uuid
    when 'chat_messages' then nullif(to_jsonb(new) ->> 'sender_id', '')::uuid
    when 'reports' then nullif(to_jsonb(new) ->> 'reporter_id', '')::uuid
    when 'match_honors' then nullif(to_jsonb(new) ->> 'giver_id', '')::uuid
    else auth.uid()
  end;

  if actor_id is not null and public.is_profile_permanently_banned(actor_id) then
    raise exception using
      errcode = '42501',
      message = '영구 정지된 계정은 이 기능을 사용할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_unbanned_queue_insert on public.queue_entries;
create trigger enforce_unbanned_queue_insert
  before insert on public.queue_entries
  for each row execute function public.enforce_unbanned_authored_row();

drop trigger if exists enforce_unbanned_slot_vote on public.slot_votes;
create trigger enforce_unbanned_slot_vote
  before insert or update on public.slot_votes
  for each row execute function public.enforce_unbanned_authored_row();

drop trigger if exists enforce_unbanned_result_vote on public.result_votes;
create trigger enforce_unbanned_result_vote
  before insert or update on public.result_votes
  for each row execute function public.enforce_unbanned_authored_row();

drop trigger if exists enforce_unbanned_chat on public.chat_messages;
create trigger enforce_unbanned_chat
  before insert on public.chat_messages
  for each row execute function public.enforce_unbanned_authored_row();

drop trigger if exists enforce_unbanned_report on public.reports;
create trigger enforce_unbanned_report
  before insert on public.reports
  for each row execute function public.enforce_unbanned_authored_row();

drop trigger if exists enforce_unbanned_honor on public.match_honors;
create trigger enforce_unbanned_honor
  before insert on public.match_honors
  for each row execute function public.enforce_unbanned_authored_row();

create or replace function public.enforce_unbanned_member_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = new.user_id
    and (
      new.accepted_at is distinct from old.accepted_at
      or new.ready is distinct from old.ready
      or new.paid is distinct from old.paid
    )
    and public.is_profile_permanently_banned(new.user_id)
  then
    raise exception using
      errcode = '42501',
      message = '영구 정지된 계정은 이 기능을 사용할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_unbanned_member_action on public.match_members;
create trigger enforce_unbanned_member_action
  before update on public.match_members
  for each row execute function public.enforce_unbanned_member_action();

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

  if target_report.status in ('resolved', 'dismissed') then
    if target_report.status <> next_status then
      raise exception using errcode = '55000', message = 'A completed review cannot be reversed';
    end if;
  else
    update public.reports
    set status = next_status,
        reviewed_at = now(),
        review_note = nullif(btrim(p_review_note), '')
    where id = p_report_id;
  end if;

  select count(*)::integer into strike_count
  from public.reports report
  where report.reported_id = target_report.reported_id
    and report.status = 'resolved';

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
    update public.queue_entries
    set status = 'canceled', canceled_at = coalesce(canceled_at, now())
    where user_id = target_report.reported_id and status = 'waiting';
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
    'permanently_banned_at', banned_at
  );
end;
$$;

alter table public.account_sanctions enable row level security;

drop policy if exists sanctions_read_own on public.account_sanctions;
create policy sanctions_read_own on public.account_sanctions
  for select to authenticated
  using (profile_id = auth.uid());

revoke all on table public.account_sanctions from public, anon, authenticated;
grant select (profile_id, upheld_report_count, permanently_banned_at, updated_at)
  on table public.account_sanctions to authenticated;
grant all on table public.account_sanctions to service_role;

revoke all on function public.is_profile_permanently_banned(uuid)
  from public, anon, authenticated;
revoke all on function public.enforce_unbanned_authored_row()
  from public, anon, authenticated;
revoke all on function public.enforce_unbanned_member_action()
  from public, anon, authenticated;
revoke all on function public.review_match_report(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_match_report(uuid, boolean, text)
  to service_role;

comment on table public.account_sanctions is
  'Operator-reviewed report strikes; three upheld reports permanently block match actions.';
