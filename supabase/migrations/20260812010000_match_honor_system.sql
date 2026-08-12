-- Server-authoritative post-match honor system.
-- Each participant may honor exactly one opponent after the result is final.

do $$
begin
  create type public.honor_type as enum ('manner', 'skill', 'punctual', 'fun');
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists honor_total integer not null default 0,
  add column if not exists honor_manner integer not null default 0,
  add column if not exists honor_skill integer not null default 0,
  add column if not exists honor_punctual integer not null default 0,
  add column if not exists honor_fun integer not null default 0;

alter table public.profiles drop constraint if exists profiles_honor_counts_nonnegative;
alter table public.profiles
  add constraint profiles_honor_counts_nonnegative check (
    honor_total >= 0
    and honor_manner >= 0
    and honor_skill >= 0
    and honor_punctual >= 0
    and honor_fun >= 0
    and honor_total = honor_manner + honor_skill + honor_punctual + honor_fun
  );

create table if not exists public.match_honors (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null,
  giver_id uuid not null,
  receiver_id uuid not null,
  honor_type public.honor_type not null,
  created_at timestamptz not null default now(),
  foreign key (match_id, giver_id)
    references public.match_members(match_id, user_id) on delete cascade,
  foreign key (match_id, receiver_id)
    references public.match_members(match_id, user_id) on delete cascade,
  unique (match_id, giver_id),
  check (giver_id <> receiver_id)
);

create index if not exists match_honors_receiver_created_idx
  on public.match_honors (receiver_id, created_at desc);
create index if not exists match_honors_match_idx
  on public.match_honors (match_id, created_at);

create or replace function public.validate_match_honor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_finalized_at timestamptz;
  result_phase public.match_phase;
  giver_team public.team_side;
  receiver_team public.team_side;
  giver_completed_at timestamptz;
begin
  select
    match.finalized_at,
    match.phase,
    (select member.team from public.match_members member
      where member.match_id = match.id and member.user_id = new.giver_id),
    (select member.team from public.match_members member
      where member.match_id = match.id and member.user_id = new.receiver_id),
    (select member.completed_at from public.match_members member
      where member.match_id = match.id and member.user_id = new.giver_id)
  into result_finalized_at, result_phase, giver_team, receiver_team, giver_completed_at
  from public.matches match
  where match.id = new.match_id;

  if not found then
    raise exception using errcode = 'P0002', message = '경기를 찾을 수 없습니다.';
  end if;
  if result_finalized_at is null then
    raise exception using errcode = '55000', message = '경기 결과가 확정된 뒤에 명예를 보낼 수 있습니다.';
  end if;
  if result_phase not in ('reporting', 'done') then
    raise exception using errcode = '55000', message = '현재 경기 단계에서는 명예를 보낼 수 없습니다.';
  end if;
  if giver_team is null or receiver_team is null then
    raise exception using errcode = '42501', message = '경기 참가자에게만 명예를 보낼 수 있습니다.';
  end if;
  if giver_team = receiver_team then
    raise exception using errcode = '22023', message = '상대 팀 선수에게만 명예를 보낼 수 있습니다.';
  end if;
  if giver_completed_at is not null then
    raise exception using errcode = '55000', message = '경기 화면을 완료한 뒤에는 명예를 보낼 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_match_honor on public.match_honors;
create trigger validate_match_honor
  before insert on public.match_honors
  for each row execute function public.validate_match_honor();

create or replace function public.apply_match_honor_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delta integer := case when tg_op = 'INSERT' then 1 else -1 end;
  target_id uuid := case when tg_op = 'INSERT' then new.receiver_id else old.receiver_id end;
  target_type public.honor_type := case when tg_op = 'INSERT' then new.honor_type else old.honor_type end;
  honor_label text;
begin
  update public.profiles
  set
    honor_total = greatest(0, honor_total + delta),
    honor_manner = greatest(0, honor_manner + case when target_type = 'manner' then delta else 0 end),
    honor_skill = greatest(0, honor_skill + case when target_type = 'skill' then delta else 0 end),
    honor_punctual = greatest(0, honor_punctual + case when target_type = 'punctual' then delta else 0 end),
    honor_fun = greatest(0, honor_fun + case when target_type = 'fun' then delta else 0 end)
  where id = target_id;

  if tg_op = 'INSERT' then
    honor_label := case new.honor_type
      when 'manner' then '매너가 좋아요'
      when 'skill' then '실력이 대단해요'
      when 'punctual' then '시간 약속을 잘 지켜요'
      when 'fun' then '분위기 메이커예요'
    end;

    insert into public.notifications (user_id, title, body, link)
    values (
      new.receiver_id,
      '새로운 명예를 받았어요! ✨',
      '경기 상대가 “' || honor_label || '” 명예를 보냈습니다.',
      '/profile'
    );

    return new;
  end if;

  return old;
end;
$$;

drop trigger if exists apply_match_honor_totals on public.match_honors;
create trigger apply_match_honor_totals
  after insert or delete on public.match_honors
  for each row execute function public.apply_match_honor_totals();

create or replace function public.give_match_honor(
  p_match_id uuid,
  p_receiver_id uuid,
  p_honor_type public.honor_type
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_honor public.match_honors%rowtype;
  created_honor public.match_honors%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if actor_id = p_receiver_id then
    raise exception using errcode = '22023', message = '본인에게는 명예를 보낼 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('matchpoint:honor:' || p_match_id::text || ':' || actor_id::text, 0)
  );

  select * into existing_honor
  from public.match_honors honor
  where honor.match_id = p_match_id and honor.giver_id = actor_id
  for update;

  if found then
    if existing_honor.receiver_id = p_receiver_id
      and existing_honor.honor_type = p_honor_type then
      return jsonb_build_object(
        'created', false,
        'match_id', existing_honor.match_id,
        'receiver_id', existing_honor.receiver_id,
        'honor_type', existing_honor.honor_type
      );
    end if;

    raise exception using errcode = '23505', message = '이번 경기의 명예는 이미 전달했습니다.';
  end if;

  insert into public.match_honors (match_id, giver_id, receiver_id, honor_type)
  values (p_match_id, actor_id, p_receiver_id, p_honor_type)
  returning * into created_honor;

  return jsonb_build_object(
    'created', true,
    'match_id', created_honor.match_id,
    'receiver_id', created_honor.receiver_id,
    'honor_type', created_honor.honor_type
  );
end;
$$;

alter table public.match_honors enable row level security;

drop policy if exists match_honors_read_involved on public.match_honors;
drop policy if exists match_honors_read_given on public.match_honors;
create policy match_honors_read_given
  on public.match_honors for select to authenticated
  using (giver_id = auth.uid());

revoke all privileges on table public.match_honors from anon, authenticated;
grant all privileges on table public.match_honors to service_role;
grant select on table public.match_honors to authenticated;

-- Honor counters and rows are immutable from the browser. The RPC and triggers
-- are the only write path.
revoke update (honor_total, honor_manner, honor_skill, honor_punctual, honor_fun)
  on public.profiles from anon, authenticated;

revoke all on function public.validate_match_honor()
  from public, anon, authenticated;
revoke all on function public.apply_match_honor_totals()
  from public, anon, authenticated;
revoke all on function public.give_match_honor(uuid, uuid, public.honor_type)
  from public, anon;

grant execute on function public.give_match_honor(uuid, uuid, public.honor_type)
  to authenticated;

alter table public.match_honors replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'match_honors'
    ) then
    alter publication supabase_realtime add table public.match_honors;
  end if;
end $$;

comment on table public.match_honors is
  'One immutable post-match honor vote per participant, restricted to an opponent.';
comment on function public.give_match_honor(uuid, uuid, public.honor_type) is
  'Idempotently gives one post-match honor to an opposing participant.';
