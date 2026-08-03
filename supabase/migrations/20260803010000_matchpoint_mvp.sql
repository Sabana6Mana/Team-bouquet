-- MATCHPOINT backend MVP
-- All state-changing match operations are exposed through authenticated RPCs.

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.sport_code as enum ('tennis', 'badminton', 'tabletennis', 'basketball');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.match_mode as enum ('1v1', '2v2', '3v3');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.match_phase as enum (
    'queue', 'scheduling', 'teaming', 'payment', 'confirmed', 'reporting', 'done', 'canceled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.queue_status as enum ('waiting', 'matched', 'canceled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.slot_status as enum ('open', 'held', 'booked', 'canceled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.team_side as enum ('a', 'b');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique check (char_length(nickname) between 2 and 30),
  avatar_url text,
  interests public.sport_code[] not null default '{}'::public.sport_code[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_ratings (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sport public.sport_code not null,
  rating integer not null default 1200 check (rating >= 100),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  played integer not null default 0 check (played >= 0 and played = wins + losses),
  updated_at timestamptz not null default now(),
  primary key (profile_id, sport)
);

create table if not exists public.venues (
  id text primary key,
  name text not null,
  sports public.sport_code[] not null check (cardinality(sports) > 0),
  address text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  price_per_hour integer not null check (price_per_hour >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venue_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  venue_id text not null references public.venues(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.slot_status not null default 'open',
  price integer check (price is null or price >= 0),
  reserved_match_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, starts_at),
  check (ends_at > starts_at)
);

create table if not exists public.matches (
  id uuid primary key default extensions.gen_random_uuid(),
  venue_id text not null references public.venues(id),
  sport public.sport_code not null,
  mode public.match_mode not null,
  capacity smallint not null check (capacity in (2, 4, 6)),
  host_id uuid not null references public.profiles(id),
  phase public.match_phase not null default 'scheduling',
  quick boolean not null default false,
  confirmed_slot_id uuid references public.venue_slots(id),
  winner_team public.team_side,
  score text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode = '1v1' and capacity = 2) or
    (mode = '2v2' and capacity = 4) or
    (mode = '3v3' and capacity = 6)
  ),
  check ((winner_team is null and finalized_at is null) or (winner_team is not null and finalized_at is not null))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_slots_reserved_match_id_fkey'
      and conrelid = 'public.venue_slots'::regclass
  ) then
    alter table public.venue_slots
      add constraint venue_slots_reserved_match_id_fkey
      foreign key (reserved_match_id) references public.matches(id) on delete set null;
  end if;
end $$;

create table if not exists public.queue_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sport public.sport_code not null,
  mode public.match_mode not null,
  capacity smallint not null check (capacity in (2, 4, 6)),
  venue_id text references public.venues(id),
  quick boolean not null,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  status public.queue_status not null default 'waiting',
  match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  matched_at timestamptz,
  canceled_at timestamptz,
  check (quick = (venue_id is null)),
  check (
    (mode = '1v1' and capacity = 2) or
    (mode = '2v2' and capacity = 4) or
    (mode = '3v3' and capacity = 6)
  )
);

create unique index if not exists queue_entries_one_waiting_per_user
  on public.queue_entries (user_id) where status = 'waiting';
create index if not exists queue_entries_match_pool
  on public.queue_entries (sport, mode, quick, venue_id, created_at) where status = 'waiting';

create table if not exists public.match_members (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team public.team_side not null,
  is_host boolean not null default false,
  ready boolean not null default false,
  paid boolean not null default false,
  rating_before integer,
  rating_delta integer,
  rating_after integer,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create unique index if not exists match_members_one_host
  on public.match_members (match_id) where is_host;
create index if not exists match_members_user_id_idx on public.match_members (user_id, joined_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  system boolean not null default false,
  created_at timestamptz not null default now(),
  check ((system and sender_id is null) or (not system and sender_id is not null))
);
create index if not exists chat_messages_match_created_idx
  on public.chat_messages (match_id, created_at);

create table if not exists public.slot_votes (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  venue_slot_id uuid not null references public.venue_slots(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table if not exists public.result_votes (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  winner_team public.team_side not null,
  score text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table if not exists public.rating_events (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sport public.sport_code not null,
  rating_before integer not null,
  delta integer not null,
  rating_after integer not null,
  created_at timestamptz not null default now(),
  unique (match_id, profile_id, sport),
  check (rating_after = greatest(100, rating_before + delta))
);

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create table if not exists public.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 80),
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, reported_id, match_id),
  check (reporter_id <> reported_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'player_ratings', 'venues', 'venue_slots', 'matches',
    'queue_entries', 'match_members', 'slot_votes', 'result_votes', 'reports'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_nickname text;
begin
  base_nickname := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'nickname'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'player'
  );

  insert into public.profiles (id, nickname, avatar_url)
  values (
    new.id,
    left(base_nickname, 20) || '_' || left(replace(new.id::text, '-', ''), 6),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.player_ratings (profile_id, sport)
  select new.id, sport
  from unnest(enum_range(null::public.sport_code)) as sport
  on conflict (profile_id, sport) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles/ratings when applying this migration to a project that already has users.
insert into public.profiles (id, nickname, avatar_url)
select
  u.id,
  left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'nickname'), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'player'), 20)
    || '_' || left(replace(u.id::text, '-', ''), 6),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

insert into public.player_ratings (profile_id, sport)
select p.id, sport
from public.profiles p
cross join unnest(enum_range(null::public.sport_code)) as sport
on conflict (profile_id, sport) do nothing;

create or replace function public.is_match_member(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.match_members mm
    where mm.match_id = p_match_id and mm.user_id = auth.uid()
  );
$$;

create or replace function public.match_capacity(p_mode public.match_mode)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_mode when '1v1' then 2 when '2v2' then 4 else 6 end::smallint;
$$;

create or replace function public.join_match_queue(
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
declare
  actor_id uuid := auth.uid();
  entry_id uuid;
  existing_entry public.queue_entries%rowtype;
  chosen_queue_ids uuid[];
  chosen_user_ids uuid[];
  chosen_venue_id text;
  new_match_id uuid;
  host_user_id uuid;
  actor_rating integer;
  required_capacity smallint := public.match_capacity(p_mode);
  entry_json jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('matchpoint:user:' || actor_id::text, 0));

  -- A retry must wait for any matcher currently claiming this row. After that
  -- transaction commits, READ COMMITTED re-checks the waiting predicate: the
  -- row is either still waiting (return it) or matched (the active-match check
  -- below rejects creating another entry).
  select q.* into existing_entry
  from public.queue_entries q
  where q.user_id = actor_id and q.status = 'waiting'
  order by q.created_at desc, q.id desc
  limit 1
  for update;
  if found then
    return jsonb_build_object(
      'queue_entry', to_jsonb(existing_entry),
      'status', 'waiting',
      'match_id', null
    );
  end if;

  if (p_lat is null) <> (p_lng is null) then
    raise exception using errcode = '22023', message = 'Latitude and longitude must be supplied together';
  end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception using errcode = '22023', message = 'Invalid coordinates';
  end if;
  if p_venue_id is not null and not exists (
    select 1 from public.venues v
    where v.id = p_venue_id and v.active and p_sport = any(v.sports)
  ) then
    raise exception using errcode = '22023', message = 'Venue is inactive or does not support this sport';
  end if;
  if p_venue_id is null and p_lat is null then
    raise exception using errcode = '22023', message = 'Coordinates are required for quick matching';
  end if;
  if exists (
    select 1
    from public.match_members mm
    join public.matches m on m.id = mm.match_id
    where mm.user_id = actor_id and m.phase not in ('done', 'canceled')
  ) then
    raise exception using errcode = '55000', message = 'You already have an active match';
  end if;

  -- A transaction-scoped pool lock prevents two concurrent callers from forming
  -- overlapping matches from the same queue.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(':', 'matchpoint', p_sport::text, p_mode::text, coalesce(p_venue_id, 'quick')),
      0
    )
  );

  -- The user lock protects same-user calls; this second check under the pool
  -- lock closes the gap between the first check and creating a new queue row.
  if exists (
    select 1
    from public.match_members mm
    join public.matches m on m.id = mm.match_id
    where mm.user_id = actor_id and m.phase not in ('done', 'canceled')
  ) then
    raise exception using errcode = '55000', message = 'You already have an active match';
  end if;

  insert into public.player_ratings (profile_id, sport)
  values (actor_id, p_sport)
  on conflict (profile_id, sport) do nothing;

  select r.rating into actor_rating
  from public.player_ratings r
  where r.profile_id = actor_id and r.sport = p_sport;

  insert into public.queue_entries (
    user_id, sport, mode, capacity, venue_id, quick, lat, lng
  ) values (
    actor_id, p_sport, p_mode, required_capacity, p_venue_id, p_venue_id is null, p_lat, p_lng
  )
  returning id into entry_id;

  select
    array_agg(pool.id order by pool.is_actor desc, pool.rating_diff, pool.created_at, pool.id),
    array_agg(pool.user_id order by pool.is_actor desc, pool.rating_diff, pool.created_at, pool.id)
  into chosen_queue_ids, chosen_user_ids
  from (
    select
      q.id,
      q.user_id,
      q.created_at,
      q.user_id = actor_id as is_actor,
      abs(coalesce(r.rating, 1200) - actor_rating) as rating_diff
    from public.queue_entries q
    left join public.player_ratings r
      on r.profile_id = q.user_id and r.sport = p_sport
    where q.status = 'waiting'
      and q.sport = p_sport
      and q.mode = p_mode
      and q.quick = (p_venue_id is null)
      and q.venue_id is not distinct from p_venue_id
      and abs(coalesce(r.rating, 1200) - actor_rating) <= 250
      and not exists (
        select 1
        from public.match_members mm
        join public.matches m on m.id = mm.match_id
        where mm.user_id = q.user_id and m.phase not in ('done', 'canceled')
      )
      and (
        p_venue_id is not null
        or (
          q.lat is not null
          and q.lng is not null
          and 6371.0 * 2.0 * asin(
            sqrt(
              least(
                1.0,
                greatest(
                  0.0,
                  power(sin(radians(q.lat - p_lat) / 2.0), 2)
                  + cos(radians(p_lat)) * cos(radians(q.lat))
                    * power(sin(radians(q.lng - p_lng) / 2.0), 2)
                )
              )
            )
          ) <= 3.0
        )
      )
    order by is_actor desc, rating_diff, q.created_at, q.id
    limit required_capacity
    for update of q
  ) as pool;

  if coalesce(cardinality(chosen_queue_ids), 0) = required_capacity then
    host_user_id := chosen_user_ids[1];

    if p_venue_id is not null then
      chosen_venue_id := p_venue_id;
    else
      select v.id into chosen_venue_id
      from public.venues v
      cross join lateral (
        select avg(q.lat) as lat, avg(q.lng) as lng
        from public.queue_entries q
        where q.id = any(chosen_queue_ids)
      ) center
      where v.active and p_sport = any(v.sports)
      order by
        case when center.lat is null or center.lng is null then 0
          else power(v.lat - center.lat, 2) + power(v.lng - center.lng, 2)
        end,
        v.id
      limit 1;
    end if;

    if chosen_venue_id is null then
      raise exception using errcode = 'P0001', message = 'No active venue supports this sport';
    end if;

    insert into public.matches (venue_id, sport, mode, capacity, host_id, phase, quick)
    values (chosen_venue_id, p_sport, p_mode, required_capacity, host_user_id, 'scheduling', p_venue_id is null)
    returning id into new_match_id;

    insert into public.match_members (match_id, user_id, team, is_host)
    select
      new_match_id,
      ranked.user_id,
      case when ranked.rating_rank % 2 = 1 then 'a'::public.team_side else 'b'::public.team_side end,
      ranked.user_id = host_user_id
    from (
      select
        q.user_id,
        row_number() over (order by coalesce(r.rating, 1200) desc, q.created_at, q.id) as rating_rank
      from public.queue_entries q
      left join public.player_ratings r on r.profile_id = q.user_id and r.sport = p_sport
      where q.id = any(chosen_queue_ids)
    ) ranked;

    update public.queue_entries
    set status = 'matched', match_id = new_match_id, matched_at = now()
    where id = any(chosen_queue_ids);

    insert into public.chat_messages (match_id, sender_id, body, system)
    values (new_match_id, null, '매칭이 완료되었습니다. 예약 가능한 시간을 골라 투표해 주세요.', true);

    insert into public.notifications (user_id, title, body, link)
    select user_id, '매칭 완료!', required_capacity || '명이 모두 모였어요. 시간을 조율해 주세요.', '/room'
    from public.match_members where match_id = new_match_id;
  end if;

  select to_jsonb(q) into entry_json from public.queue_entries q where q.id = entry_id;
  return jsonb_build_object(
    'queue_entry', entry_json,
    'status', case when new_match_id is null then 'waiting' else 'matched' end,
    'match_id', new_match_id
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'You already have an active queue entry';
end;
$$;

create or replace function public.cancel_match_queue()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  canceled_id uuid;
  active_match_id uuid;
  active_slot_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('matchpoint:user:' || actor_id::text, 0));

  update public.queue_entries
  set status = 'canceled', canceled_at = now()
  where user_id = actor_id and status = 'waiting'
  returning id into canceled_id;

  if canceled_id is not null then
    return true;
  end if;

  -- A participant may abandon an active match only before its result is
  -- finalized. Locking the match serializes cancellation with every lifecycle
  -- RPC, and releasing a held slot prevents an abandoned reservation.
  select m.id, m.confirmed_slot_id
  into active_match_id, active_slot_id
  from public.matches m
  join public.match_members mm on mm.match_id = m.id
  where mm.user_id = actor_id
    and m.phase not in ('done', 'canceled')
    and m.finalized_at is null
  order by m.created_at desc, m.id desc
  limit 1
  for update of m;

  if active_match_id is null then
    return false;
  end if;

  update public.matches
  set phase = 'canceled'
  where id = active_match_id and finalized_at is null;

  update public.venue_slots
  set status = 'open', reserved_match_id = null
  where id = active_slot_id
    and reserved_match_id = active_match_id
    and status = 'held';

  update public.queue_entries
  set status = 'canceled', canceled_at = coalesce(canceled_at, now())
  where match_id = active_match_id and status = 'matched';

  insert into public.notifications (user_id, title, body, link)
  select mm.user_id,
    '매칭이 취소되었습니다',
    case
      when mm.user_id = actor_id then '요청에 따라 매칭을 취소했습니다.'
      else '참가자 한 명이 나가 매칭이 취소되었습니다.'
    end,
    '/home'
  from public.match_members mm
  where mm.match_id = active_match_id;

  return true;
end;
$$;

create or replace function public.vote_match_slot(p_match_id uuid, p_venue_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  member_count integer;
  agreeing_count integer;
  consensus boolean := false;
  next_phase public.match_phase;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can vote';
  end if;

  select * into target_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if target_match.phase <> 'scheduling' then
    raise exception using errcode = '55000', message = 'This match is not scheduling';
  end if;
  if not exists (
    select 1 from public.venue_slots s
    where s.id = p_venue_slot_id
      and s.venue_id = target_match.venue_id
      and s.status = 'open'
      and s.starts_at > now()
  ) then
    raise exception using errcode = '22023', message = 'Slot is unavailable or belongs to another venue';
  end if;

  insert into public.slot_votes (match_id, user_id, venue_slot_id)
  values (p_match_id, actor_id, p_venue_slot_id)
  on conflict (match_id, user_id) do update
    set venue_slot_id = excluded.venue_slot_id, updated_at = now();

  select count(*) into member_count from public.match_members where match_id = p_match_id;
  select count(*) into agreeing_count
  from public.slot_votes
  where match_id = p_match_id and venue_slot_id = p_venue_slot_id;

  if member_count = target_match.capacity and agreeing_count = member_count then
    consensus := true;
    next_phase := case when target_match.mode = '1v1' then 'payment' else 'teaming' end;
    update public.matches
    set confirmed_slot_id = p_venue_slot_id, phase = next_phase
    where id = p_match_id;

    insert into public.chat_messages (match_id, sender_id, body, system)
    values (p_match_id, null, '전원이 같은 시간에 투표해 경기 시간이 확정되었습니다.', true);

    insert into public.notifications (user_id, title, body, link)
    select user_id,
      '시간 확정!',
      case when next_phase = 'teaming' then '이제 팀 구성을 확인해 주세요.' else '참가를 확정해 주세요.' end,
      case when next_phase = 'teaming' then '/teams' else '/payment' end
    from public.match_members where match_id = p_match_id;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id,
    'venue_slot_id', p_venue_slot_id,
    'consensus', consensus,
    'votes', agreeing_count,
    'members', member_count,
    'phase', coalesce(next_phase, target_match.phase)
  );
end;
$$;

create or replace function public.set_match_teams(
  p_match_id uuid,
  p_team_a uuid[],
  p_team_b uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  supplied_count integer;
  valid_count integer;
begin
  select * into target_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if actor_id is null or actor_id <> target_match.host_id then
    raise exception using errcode = '42501', message = 'Only the host can set teams';
  end if;
  if target_match.phase <> 'teaming' then
    raise exception using errcode = '55000', message = 'This match is not in team setup';
  end if;
  if cardinality(p_team_a) <> target_match.capacity / 2
    or cardinality(p_team_b) <> target_match.capacity / 2 then
    raise exception using errcode = '22023', message = 'Each team must contain half of the members';
  end if;

  select count(*), count(distinct member_id)
  into supplied_count, valid_count
  from unnest(p_team_a || p_team_b) as supplied(member_id);
  if supplied_count <> target_match.capacity or valid_count <> target_match.capacity then
    raise exception using errcode = '22023', message = 'Each member must appear exactly once';
  end if;
  select count(*) into valid_count
  from public.match_members mm
  where mm.match_id = p_match_id and mm.user_id = any(p_team_a || p_team_b);
  if valid_count <> target_match.capacity then
    raise exception using errcode = '22023', message = 'Teams contain a non-member';
  end if;

  update public.match_members
  set team = case when user_id = any(p_team_a) then 'a'::public.team_side else 'b'::public.team_side end,
      ready = false
  where match_id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'phase', target_match.phase, 'teams_updated', true);
end;
$$;

create or replace function public.set_match_ready(p_match_id uuid, p_ready boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  ready_count integer;
  member_count integer;
  all_ready boolean;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can become ready';
  end if;
  select * into target_match from public.matches where id = p_match_id for update;
  if target_match.phase <> 'teaming' then
    raise exception using errcode = '55000', message = 'This match is not in team setup';
  end if;

  update public.match_members set ready = p_ready
  where match_id = p_match_id and user_id = actor_id;

  select count(*), count(*) filter (where ready)
  into member_count, ready_count
  from public.match_members where match_id = p_match_id;
  all_ready := member_count = target_match.capacity and ready_count = member_count;

  if all_ready then
    update public.matches set phase = 'payment' where id = p_match_id;
    insert into public.notifications (user_id, title, body, link)
    select user_id, '팀 확정!', '전원이 준비되었습니다. 참가를 확정해 주세요.', '/payment'
    from public.match_members where match_id = p_match_id;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id, 'ready', p_ready, 'ready_count', ready_count,
    'members', member_count, 'all_ready', all_ready,
    'phase', case when all_ready then 'payment' else 'teaming' end
  );
end;
$$;

create or replace function public.confirm_match_attendance(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  confirmed_count integer;
  member_count integer;
  all_confirmed boolean;
  target_slot public.venue_slots%rowtype;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can confirm attendance';
  end if;
  select * into target_match from public.matches where id = p_match_id for update;
  if target_match.phase <> 'payment' then
    raise exception using errcode = '55000', message = 'This match is not awaiting confirmation';
  end if;

  update public.match_members set paid = true
  where match_id = p_match_id and user_id = actor_id;

  select count(*), count(*) filter (where paid)
  into member_count, confirmed_count
  from public.match_members where match_id = p_match_id;
  all_confirmed := member_count = target_match.capacity and confirmed_count = member_count;

  if all_confirmed then
    select * into target_slot
    from public.venue_slots where id = target_match.confirmed_slot_id for update;
    if not found or target_slot.status <> 'open' or target_slot.starts_at <= now() then
      update public.matches
      set phase = 'scheduling', confirmed_slot_id = null
      where id = p_match_id;
      update public.match_members
      set ready = false, paid = false
      where match_id = p_match_id;
      delete from public.slot_votes where match_id = p_match_id;
      insert into public.notifications (user_id, title, body, link)
      select user_id, '시간을 다시 선택해 주세요', '선택한 시간이 먼저 마감되었습니다.', '/room'
      from public.match_members where match_id = p_match_id;
      return jsonb_build_object(
        'match_id', p_match_id, 'confirmed_count', 0, 'members', member_count,
        'all_confirmed', false, 'slot_unavailable', true, 'phase', 'scheduling'
      );
    end if;

    update public.venue_slots
    set status = 'held', reserved_match_id = p_match_id
    where id = target_match.confirmed_slot_id;
    update public.matches set phase = 'confirmed' where id = p_match_id;

    insert into public.notifications (user_id, title, body, link)
    select user_id, '경기 확정!', '전원이 참가를 확정했습니다.', '/room'
    from public.match_members where match_id = p_match_id;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id, 'confirmed_count', confirmed_count,
    'members', member_count, 'all_confirmed', all_confirmed,
    'phase', case when all_confirmed then 'confirmed' else 'payment' end
  );
end;
$$;

create or replace function public.open_match_reporting(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  slot_ends_at timestamptz;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can open reporting';
  end if;
  select * into target_match from public.matches where id = p_match_id for update;
  if target_match.phase <> 'confirmed' then
    raise exception using errcode = '55000', message = 'Only a confirmed match can enter reporting';
  end if;
  select ends_at into slot_ends_at from public.venue_slots where id = target_match.confirmed_slot_id;
  if slot_ends_at is null then
    raise exception using errcode = '55000', message = 'The confirmed slot is unavailable';
  end if;
  if slot_ends_at > now() then
    raise exception using errcode = '55000', message = 'Reporting opens after the reserved slot ends';
  end if;

  update public.matches set phase = 'reporting' where id = p_match_id;
  insert into public.notifications (user_id, title, body, link)
  select user_id, '경기가 끝났어요', '승패를 투표해 결과를 확정해 주세요.', '/result'
  from public.match_members where match_id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'phase', 'reporting');
end;
$$;

create or replace function public.vote_match_result(
  p_match_id uuid,
  p_winner_team public.team_side,
  p_score text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_match public.matches%rowtype;
  member_count integer;
  agreeing_count integer;
  is_consensus boolean := false;
  average_a numeric;
  average_b numeric;
  expected_a numeric;
  delta_a integer;
  final_score text;
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can vote on a result';
  end if;
  select * into target_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if target_match.phase <> 'reporting' or target_match.finalized_at is not null then
    raise exception using errcode = '55000', message = 'This match is not accepting result votes';
  end if;
  if p_score is not null and char_length(p_score) > 40 then
    raise exception using errcode = '22023', message = 'Score is too long';
  end if;

  insert into public.result_votes (match_id, user_id, winner_team, score)
  values (p_match_id, actor_id, p_winner_team, nullif(btrim(p_score), ''))
  on conflict (match_id, user_id) do update
    set winner_team = excluded.winner_team, score = excluded.score, updated_at = now();

  select count(*) into member_count from public.match_members where match_id = p_match_id;
  select count(*) into agreeing_count
  from public.result_votes
  where match_id = p_match_id
    and winner_team = p_winner_team
    and score is not distinct from nullif(btrim(p_score), '');

  if member_count = target_match.capacity and agreeing_count = member_count then
    is_consensus := true;

    -- Make missing rating rows explicit before taking rating locks.
    insert into public.player_ratings (profile_id, sport)
    select mm.user_id, target_match.sport
    from public.match_members mm
    where mm.match_id = p_match_id
    on conflict (profile_id, sport) do nothing;

    perform 1
    from public.player_ratings r
    join public.match_members mm on mm.user_id = r.profile_id and mm.match_id = p_match_id
    where r.sport = target_match.sport
    order by r.profile_id
    for update of r;

    select
      avg(r.rating) filter (where mm.team = 'a'),
      avg(r.rating) filter (where mm.team = 'b')
    into average_a, average_b
    from public.match_members mm
    join public.player_ratings r on r.profile_id = mm.user_id and r.sport = target_match.sport
    where mm.match_id = p_match_id;

    if average_a is null or average_b is null then
      raise exception using errcode = '55000', message = 'Both teams must contain rated members';
    end if;

    expected_a := 1.0 / (1.0 + power(10.0, (average_b - average_a) / 400.0));
    delta_a := round(32.0 * ((case when p_winner_team = 'a' then 1.0 else 0.0 end) - expected_a));

    update public.match_members mm
    set rating_before = r.rating,
        rating_delta = case when mm.team = 'a' then delta_a else -delta_a end,
        rating_after = greatest(100, r.rating + case when mm.team = 'a' then delta_a else -delta_a end)
    from public.player_ratings r
    where mm.match_id = p_match_id
      and r.profile_id = mm.user_id
      and r.sport = target_match.sport;

    insert into public.rating_events (
      match_id, profile_id, sport, rating_before, delta, rating_after
    )
    select match_id, user_id, target_match.sport, rating_before, rating_delta, rating_after
    from public.match_members
    where match_id = p_match_id
    on conflict (match_id, profile_id, sport) do nothing;

    update public.player_ratings r
    set rating = mm.rating_after,
        wins = r.wins + case when mm.team = p_winner_team then 1 else 0 end,
        losses = r.losses + case when mm.team = p_winner_team then 0 else 1 end,
        played = r.played + 1
    from public.match_members mm
    where mm.match_id = p_match_id
      and mm.user_id = r.profile_id
      and r.sport = target_match.sport;

    final_score := nullif(btrim(p_score), '');

    update public.matches
    set winner_team = p_winner_team, score = final_score, finalized_at = now()
    where id = p_match_id and finalized_at is null;

    update public.venue_slots
    set status = 'booked'
    where id = target_match.confirmed_slot_id and reserved_match_id = p_match_id;

    insert into public.notifications (user_id, title, body, link)
    select mm.user_id,
      '결과 확정!',
      case when mm.team = p_winner_team then '승리가 기록되었습니다.' else '경기 결과가 기록되었습니다.' end,
      '/result'
    from public.match_members mm where mm.match_id = p_match_id;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id,
    'winner_team', p_winner_team,
    'consensus', is_consensus,
    'votes', agreeing_count,
    'members', member_count,
    'phase', 'reporting'
  );
end;
$$;

create or replace function public.complete_match(p_match_id uuid)
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
    raise exception using errcode = '42501', message = 'Only match members can complete a match';
  end if;
  select * into target_match from public.matches where id = p_match_id for update;
  if target_match.phase = 'done' then
    return jsonb_build_object('match_id', p_match_id, 'phase', 'done');
  end if;
  if target_match.phase <> 'reporting' or target_match.finalized_at is null then
    raise exception using errcode = '55000', message = 'The result must be finalized first';
  end if;
  update public.matches set phase = 'done' where id = p_match_id;
  return jsonb_build_object('match_id', p_match_id, 'phase', 'done');
end;
$$;

-- Row-level access control ----------------------------------------------------
alter table public.profiles enable row level security;
alter table public.player_ratings enable row level security;
alter table public.venues enable row level security;
alter table public.venue_slots enable row level security;
alter table public.queue_entries enable row level security;
alter table public.matches enable row level security;
alter table public.match_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.slot_votes enable row level security;
alter table public.result_votes enable row level security;
alter table public.rating_events enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists ratings_read on public.player_ratings;
create policy ratings_read on public.player_ratings for select to authenticated using (true);

drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues for select to anon, authenticated using (active);
drop policy if exists slots_read on public.venue_slots;
create policy slots_read on public.venue_slots for select to anon, authenticated using (status <> 'canceled');

drop policy if exists queue_read_own on public.queue_entries;
create policy queue_read_own on public.queue_entries for select to authenticated using (user_id = auth.uid());

drop policy if exists matches_read_member on public.matches;
create policy matches_read_member on public.matches for select to authenticated
  using (public.is_match_member(id));
drop policy if exists members_read_member on public.match_members;
create policy members_read_member on public.match_members for select to authenticated
  using (public.is_match_member(match_id));

drop policy if exists messages_read_member on public.chat_messages;
create policy messages_read_member on public.chat_messages for select to authenticated
  using (public.is_match_member(match_id));
drop policy if exists messages_insert_member on public.chat_messages;
create policy messages_insert_member on public.chat_messages for insert to authenticated
  with check (public.is_match_member(match_id) and sender_id = auth.uid() and not system);

drop policy if exists slot_votes_read_member on public.slot_votes;
create policy slot_votes_read_member on public.slot_votes for select to authenticated
  using (public.is_match_member(match_id));
drop policy if exists result_votes_read_member on public.result_votes;
create policy result_votes_read_member on public.result_votes for select to authenticated
  using (public.is_match_member(match_id));

drop policy if exists rating_events_read_own on public.rating_events;
create policy rating_events_read_own on public.rating_events for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and public.is_match_member(match_id)
    and exists (
      select 1
      from public.match_members mm
      where mm.match_id = reports.match_id
        and mm.user_id = reports.reported_id
    )
  );
drop policy if exists reports_read_own on public.reports;
create policy reports_read_own on public.reports for select to authenticated
  using (reporter_id = auth.uid());

-- Explicit grants keep writes server-authoritative even when a project's
-- default public-schema privileges have been customized.
revoke all privileges on table
  public.profiles, public.player_ratings, public.venues, public.venue_slots,
  public.queue_entries, public.matches, public.match_members, public.chat_messages,
  public.slot_votes, public.result_votes, public.rating_events, public.notifications,
  public.reports
from anon, authenticated;

-- Trusted server jobs and the local verifier need administrative access. This
-- role is never exposed to the browser and bypasses RLS by design in Supabase.
grant all privileges on table
  public.profiles, public.player_ratings, public.venues, public.venue_slots,
  public.queue_entries, public.matches, public.match_members, public.chat_messages,
  public.slot_votes, public.result_votes, public.rating_events, public.notifications,
  public.reports
to service_role;

grant select on public.venues to anon;
grant select (id, venue_id, starts_at, ends_at, status, price, created_at, updated_at)
  on public.venue_slots to anon, authenticated;
grant select on table
  public.profiles, public.player_ratings, public.venues,
  public.queue_entries, public.matches, public.match_members, public.chat_messages,
  public.slot_votes, public.result_votes, public.rating_events, public.notifications,
  public.reports
to authenticated;
grant update (nickname, avatar_url, interests) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (match_id, sender_id, body) on public.chat_messages to authenticated;
grant insert (reporter_id, reported_id, match_id, reason, details)
  on public.reports to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
drop function if exists public.is_match_member(uuid, uuid);
revoke all on function public.is_match_member(uuid) from public, anon, authenticated;
revoke all on function public.match_capacity(public.match_mode) from public, anon;
grant execute on function public.is_match_member(uuid) to authenticated;
grant execute on function public.match_capacity(public.match_mode) to authenticated;

revoke all on function public.join_match_queue(public.sport_code, public.match_mode, text, double precision, double precision) from public, anon;
revoke all on function public.cancel_match_queue() from public, anon;
revoke all on function public.vote_match_slot(uuid, uuid) from public, anon;
revoke all on function public.set_match_teams(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.set_match_ready(uuid, boolean) from public, anon;
revoke all on function public.confirm_match_attendance(uuid) from public, anon;
revoke all on function public.open_match_reporting(uuid) from public, anon;
revoke all on function public.vote_match_result(uuid, public.team_side, text) from public, anon;
revoke all on function public.complete_match(uuid) from public, anon;

grant execute on function public.join_match_queue(public.sport_code, public.match_mode, text, double precision, double precision) to authenticated;
grant execute on function public.cancel_match_queue() to authenticated;
grant execute on function public.vote_match_slot(uuid, uuid) to authenticated;
grant execute on function public.set_match_teams(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.set_match_ready(uuid, boolean) to authenticated;
grant execute on function public.confirm_match_attendance(uuid) to authenticated;
grant execute on function public.open_match_reporting(uuid) to authenticated;
grant execute on function public.vote_match_result(uuid, public.team_side, text) to authenticated;
grant execute on function public.complete_match(uuid) to authenticated;

alter table public.matches replica identity full;
alter table public.queue_entries replica identity full;
alter table public.match_members replica identity full;
alter table public.slot_votes replica identity full;
alter table public.result_votes replica identity full;
alter table public.notifications replica identity full;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'queue_entries', 'matches', 'match_members', 'chat_messages',
      'slot_votes', 'result_votes', 'notifications'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;
