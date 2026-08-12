-- MATCHPOINT competition gameplay vertical slice
-- Finalized matches illuminate the venue collection, damage the weekly venue
-- boss once per match, and feed featured season achievements/titles. None of
-- these values participate in matchmaking, team balance, or ELO calculation.

create table if not exists public.regions (
  code text primary key check (code ~ '^[a-z0-9_-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  parent_code text references public.regions(code) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.venues
  add column if not exists region_code text references public.regions(code) on update cascade on delete set null,
  add column if not exists checkin_radius_m integer not null default 300 check (checkin_radius_m between 50 and 2000);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.gameplay_match_events (
  match_id uuid primary key references public.matches(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venue_gameplay_credits (
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text not null references public.venues(id) on update cascade on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  evidence_kind text not null default 'booking_consensus'
    check (evidence_kind in ('booking_consensus', 'venue_checkin', 'finalized_match')),
  credited_at timestamptz not null default now(),
  invalidated_at timestamptz,
  primary key (match_id, profile_id)
);

create index if not exists venue_gameplay_credits_profile_venue_idx
  on public.venue_gameplay_credits (profile_id, venue_id, credited_at desc)
  where invalidated_at is null;

create table if not exists public.venue_collection_entries (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text not null references public.venues(id) on update cascade on delete cascade,
  first_match_id uuid not null references public.matches(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, venue_id)
);

create table if not exists public.venue_boss_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]+$'),
  venue_id text not null references public.venues(id) on update cascade on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_hp integer not null check (max_hp > 0),
  starting_damage integer not null default 0 check (starting_damage >= 0),
  damage_per_match integer not null default 1 check (damage_per_match > 0),
  champion_profile_id uuid references public.profiles(id) on delete set null,
  champion_name text,
  champion_points integer not null default 0 check (champion_points >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (starting_damage <= max_hp)
);

create index if not exists venue_boss_events_active_idx
  on public.venue_boss_events (venue_id, starts_at desc, ends_at);

create table if not exists public.venue_boss_match_hits (
  event_id uuid not null references public.venue_boss_events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  damage integer not null check (damage > 0),
  created_at timestamptz not null default now(),
  primary key (event_id, match_id)
);

create table if not exists public.venue_boss_contributions (
  event_id uuid not null references public.venue_boss_events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null default 1 check (points > 0),
  credited_on date not null default (timezone('Asia/Seoul', now()))::date,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  primary key (event_id, match_id, profile_id)
);

create index if not exists venue_boss_contributions_rank_idx
  on public.venue_boss_contributions (event_id, profile_id, created_at)
  where invalidated_at is null;

create table if not exists public.gameplay_member_outcomes (
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  new_venue boolean not null default false,
  venue_id text not null references public.venues(id) on update cascade on delete cascade,
  collection_discovered integer not null default 0 check (collection_discovered >= 0),
  collection_total integer not null default 0 check (collection_total >= 0),
  boss_damage integer not null default 0 check (boss_damage >= 0),
  boss_remaining_hp integer check (boss_remaining_hp >= 0),
  unlocked_achievement_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (match_id, profile_id),
  check (collection_discovered <= collection_total)
);

create table if not exists public.season_quest_definitions (
  season_id uuid not null references public.seasons(id) on delete cascade,
  achievement_code text not null references public.achievement_definitions(code) on update cascade on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (season_id, achievement_code)
);

-- Extend the existing cosmetic-only achievement catalog with an internally
-- granted metric. The general statistics refresher treats unknown/external
-- metrics as zero and preserves any already-unlocked row monotonically.
do $migration$
declare
  constraint_name text;
begin
  select constraint_row.conname
  into constraint_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.achievement_definitions'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%metric_code%'
  order by constraint_row.conname
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.achievement_definitions drop constraint %I', constraint_name);
  end if;
end
$migration$;

alter table public.achievement_definitions
  add constraint achievement_definitions_metric_code_check check (metric_code in (
    'matches_played',
    'matches_won',
    'best_win_streak',
    'distinct_venues',
    'gangnam_venues',
    'distinct_sports',
    'giant_killer',
    'unique_rivals',
    'home_venue_wins',
    'highest_rating',
    'external_grant'
  ));

insert into public.achievement_definitions (
  code, name, description, icon, metric_code, target, title_name, rarity, sort_order, active, hidden
)
values (
  'boss_raider',
  '왕좌를 흔든 한 방',
  '주간 체육관 보스전에 유효 경기로 기여하세요.',
  '👾',
  'external_grant',
  1,
  '보스의 천적',
  'epic',
  135,
  true,
  false
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  metric_code = excluded.metric_code,
  target = excluded.target,
  title_name = excluded.title_name,
  rarity = excluded.rarity,
  sort_order = excluded.sort_order,
  active = excluded.active,
  hidden = excluded.hidden,
  updated_at = now();

create or replace function public.grant_profile_achievement(
  p_profile_id uuid,
  p_achievement_code text,
  p_source_match uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_value integer;
  already_unlocked boolean := false;
begin
  select definition.target
  into target_value
  from public.achievement_definitions definition
  where definition.code = p_achievement_code
    and definition.active
  for share;

  if target_value is null then
    raise exception '알 수 없는 도전과제입니다.';
  end if;

  select progress.unlocked_at is not null
  into already_unlocked
  from public.player_achievements progress
  where progress.profile_id = p_profile_id
    and progress.achievement_code = p_achievement_code;

  insert into public.player_achievements as current_progress (
    profile_id, achievement_code, progress, unlocked_at, unlocked_match_id
  ) values (
    p_profile_id, p_achievement_code, target_value, now(), p_source_match
  )
  on conflict (profile_id, achievement_code) do update set
    progress = greatest(current_progress.progress, excluded.progress),
    unlocked_at = coalesce(current_progress.unlocked_at, excluded.unlocked_at),
    unlocked_match_id = case
      when current_progress.unlocked_at is null then excluded.unlocked_match_id
      else current_progress.unlocked_match_id
    end,
    updated_at = now();

  return not coalesce(already_unlocked, false);
end;
$$;

create or replace function public.process_gameplay_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.matches%rowtype;
  member_row record;
  event_row public.venue_boss_events%rowtype;
  active_season_id uuid;
  region_value text;
  was_new_venue boolean;
  region_discovered integer;
  region_total integer;
  boss_damage_value integer := 0;
  boss_remaining integer := null;
  unlocked_codes text[];
begin
  insert into public.gameplay_match_events (match_id, status)
  values (p_match_id, 'pending')
  on conflict (match_id) do nothing;

  perform 1
  from public.gameplay_match_events event
  where event.match_id = p_match_id
  for update;

  if exists (
    select 1 from public.gameplay_match_events event
    where event.match_id = p_match_id and event.status = 'processed'
  ) then
    return;
  end if;

  select match_value.*
  into match_row
  from public.matches match_value
  where match_value.id = p_match_id
  for share;

  if match_row.id is null
    or match_row.finalized_at is null
    or match_row.phase = 'canceled'
    or match_row.venue_id is null
  then
    delete from public.gameplay_match_events where match_id = p_match_id;
    return;
  end if;

  update public.gameplay_match_events
  set status = 'processing', attempt_count = attempt_count + 1, error_message = null, updated_at = now()
  where match_id = p_match_id;

  select venue.region_code
  into region_value
  from public.venues venue
  where venue.id = match_row.venue_id;

  -- Lock the matching boss row so concurrent matches cannot produce a stale HP
  -- snapshot. A venue-specific event also selects the correct overlapping test
  -- season without relying on a single global active-season flag.
  select boss.*
  into event_row
  from public.venue_boss_events boss
  where boss.venue_id = match_row.venue_id
    and match_row.finalized_at >= boss.starts_at
    and match_row.finalized_at < boss.ends_at
  order by boss.starts_at desc, boss.id
  limit 1
  for update;

  if event_row.id is not null then
    active_season_id := event_row.season_id;
  else
    select season.id
    into active_season_id
    from public.seasons season
    where season.active
      and match_row.finalized_at >= season.starts_at
      and match_row.finalized_at < season.ends_at
    order by season.starts_at desc, season.id
    limit 1;
  end if;

  if event_row.id is not null then
    insert into public.venue_boss_match_hits (event_id, match_id, damage)
    values (event_row.id, p_match_id, event_row.damage_per_match)
    on conflict (event_id, match_id) do nothing;

    boss_damage_value := event_row.damage_per_match;
    select greatest(0, event_row.max_hp - event_row.starting_damage - coalesce(sum(hit.damage), 0))::integer
    into boss_remaining
    from public.venue_boss_match_hits hit
    where hit.event_id = event_row.id;
  end if;

  for member_row in
    select member.user_id
    from public.match_members member
    where member.match_id = p_match_id
    order by member.user_id
  loop
    insert into public.venue_gameplay_credits (
      match_id, profile_id, venue_id, season_id, evidence_kind, credited_at
    ) values (
      p_match_id,
      member_row.user_id,
      match_row.venue_id,
      active_season_id,
      'booking_consensus',
      match_row.finalized_at
    )
    on conflict (match_id, profile_id) do nothing;

    was_new_venue := false;
    insert into public.venue_collection_entries (
      profile_id, venue_id, first_match_id, unlocked_at
    ) values (
      member_row.user_id, match_row.venue_id, p_match_id, match_row.finalized_at
    )
    on conflict (profile_id, venue_id) do nothing
    returning true into was_new_venue;
    was_new_venue := coalesce(was_new_venue, false);

    if event_row.id is not null then
      insert into public.venue_boss_contributions (
        event_id, match_id, profile_id, points, credited_on
      ) values (
        event_row.id,
        p_match_id,
        member_row.user_id,
        1,
        (timezone('Asia/Seoul', match_row.finalized_at))::date
      )
      on conflict (event_id, match_id, profile_id) do nothing;

      perform public.grant_profile_achievement(member_row.user_id, 'boss_raider', p_match_id);
    end if;

    -- Refresh permanent achievements after the collection credit exists. The
    -- existing function is monotonic, so an external grant cannot be revoked.
    perform public.refresh_profile_achievements(member_row.user_id, p_match_id);

    select count(*)::integer
    into region_total
    from public.venues venue
    where venue.active and venue.region_code is not distinct from region_value;

    select count(*)::integer
    into region_discovered
    from public.venue_collection_entries entry
    join public.venues venue on venue.id = entry.venue_id
    where entry.profile_id = member_row.user_id
      and venue.active
      and venue.region_code is not distinct from region_value;

    select coalesce(array_agg(progress.achievement_code order by progress.achievement_code), '{}')
    into unlocked_codes
    from public.player_achievements progress
    where progress.profile_id = member_row.user_id
      and progress.unlocked_match_id = p_match_id
      and progress.unlocked_at is not null;

    insert into public.gameplay_member_outcomes (
      match_id,
      profile_id,
      new_venue,
      venue_id,
      collection_discovered,
      collection_total,
      boss_damage,
      boss_remaining_hp,
      unlocked_achievement_codes
    ) values (
      p_match_id,
      member_row.user_id,
      was_new_venue,
      match_row.venue_id,
      region_discovered,
      region_total,
      boss_damage_value,
      boss_remaining,
      coalesce(unlocked_codes, '{}')
    )
    on conflict (match_id, profile_id) do nothing;
  end loop;

  update public.gameplay_match_events
  set status = 'processed', processed_at = now(), error_message = null, updated_at = now()
  where match_id = p_match_id;
exception
  when others then
    update public.gameplay_match_events
    set status = 'failed', error_message = left(sqlerrm, 500), updated_at = now()
    where match_id = p_match_id;
    raise;
end;
$$;

create or replace function public.get_my_match_gameplay_outcome(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  stored public.gameplay_member_outcomes%rowtype;
  venue_value text;
  discovered_value integer := 0;
  total_value integer := 0;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (
    select 1 from public.match_members member
    where member.match_id = p_match_id and member.user_id = actor_id
  ) then
    raise exception '경기 참가자만 게임 결과를 조회할 수 있습니다.';
  end if;

  select outcome.*
  into stored
  from public.gameplay_member_outcomes outcome
  where outcome.match_id = p_match_id and outcome.profile_id = actor_id;

  if stored.match_id is not null then
    return jsonb_build_object(
      'match_id', stored.match_id,
      'new_venue', stored.new_venue,
      'venue_id', stored.venue_id,
      'collection_discovered', stored.collection_discovered,
      'collection_total', stored.collection_total,
      'boss_damage', stored.boss_damage,
      'boss_remaining_hp', stored.boss_remaining_hp,
      'unlocked_achievement_codes', to_jsonb(stored.unlocked_achievement_codes)
    );
  end if;

  select match_value.venue_id into venue_value
  from public.matches match_value where match_value.id = p_match_id;

  select count(*)::integer into total_value
  from public.venues venue
  where venue.active
    and venue.region_code is not distinct from (
      select selected.region_code from public.venues selected where selected.id = venue_value
    );

  select count(*)::integer into discovered_value
  from public.venue_collection_entries entry
  join public.venues venue on venue.id = entry.venue_id
  where entry.profile_id = actor_id
    and venue.region_code is not distinct from (
      select selected.region_code from public.venues selected where selected.id = venue_value
    );

  return jsonb_build_object(
    'match_id', p_match_id,
    'new_venue', false,
    'venue_id', coalesce(venue_value, ''),
    'collection_discovered', discovered_value,
    'collection_total', total_value,
    'boss_damage', 0,
    'boss_remaining_hp', null,
    'unlocked_achievement_codes', '[]'::jsonb
  );
end;
$$;

create or replace function public.sync_my_match_gameplay(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  eligible boolean;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (
    select 1 from public.match_members member
    where member.match_id = p_match_id and member.user_id = actor_id
  ) then
    raise exception '경기 참가자만 게임 진행도를 동기화할 수 있습니다.';
  end if;

  select match_value.finalized_at is not null and match_value.phase <> 'canceled'
  into eligible
  from public.matches match_value
  where match_value.id = p_match_id;

  if coalesce(eligible, false) then
    perform public.process_gameplay_match(p_match_id);
  end if;

  return public.get_my_match_gameplay_outcome(p_match_id);
end;
$$;

create or replace function public.get_my_gameplay_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  region_value text;
  season_value uuid;
  boss_value uuid;
  region_json jsonb;
  venues_json jsonb;
  boss_json jsonb;
  season_json jsonb;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select venue.region_code
  into region_value
  from public.venue_gameplay_credits credit
  join public.venues venue on venue.id = credit.venue_id
  where credit.profile_id = actor_id and credit.invalidated_at is null
  order by credit.credited_at desc, credit.match_id desc
  limit 1;

  if region_value is null then
    region_value := 'gangnam';
  end if;

  select season.id into season_value
  from public.seasons season
  where season.active and now() >= season.starts_at and now() < season.ends_at
  order by season.starts_at desc, season.id
  limit 1;

  select boss.id into boss_value
  from public.venue_boss_events boss
  join public.venues venue on venue.id = boss.venue_id
  where venue.region_code = region_value
    and (season_value is null or boss.season_id = season_value)
    and now() >= boss.starts_at and now() < boss.ends_at
  order by boss.starts_at desc, boss.id
  limit 1;

  select jsonb_build_object(
    'code', region.code,
    'name', region.name,
    'discovered', (
      select count(*) from public.venue_collection_entries entry
      join public.venues venue on venue.id = entry.venue_id
      where entry.profile_id = actor_id and venue.active and venue.region_code = region.code
    ),
    'total', (
      select count(*) from public.venues venue where venue.active and venue.region_code = region.code
    )
  )
  into region_json
  from public.regions region
  where region.code = region_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'venue_id', venue.id,
    'discovered_at', entry.unlocked_at,
    'visits', coalesce((
      select count(*) from public.venue_gameplay_credits credit
      where credit.profile_id = actor_id
        and credit.venue_id = venue.id
        and credit.invalidated_at is null
    ), 0)
  ) order by venue.id), '[]'::jsonb)
  into venues_json
  from public.venues venue
  left join public.venue_collection_entries entry
    on entry.profile_id = actor_id and entry.venue_id = venue.id
  where venue.active and venue.region_code = region_value;

  if boss_value is not null then
    with contribution_totals as (
      select contribution.profile_id, sum(contribution.points)::integer as points, min(contribution.created_at) as reached_at
      from public.venue_boss_contributions contribution
      where contribution.event_id = boss_value and contribution.invalidated_at is null
      group by contribution.profile_id
    ), live_champion as (
      select profile.nickname, totals.points, totals.reached_at
      from contribution_totals totals
      join public.profiles profile on profile.id = totals.profile_id
      order by totals.points desc, totals.reached_at, totals.profile_id
      limit 1
    )
    select jsonb_build_object(
      'event_id', boss.id,
      'venue_id', boss.venue_id,
      'max_hp', boss.max_hp,
      'remaining_hp', greatest(0, boss.max_hp - boss.starting_damage - coalesce((
        select sum(hit.damage) from public.venue_boss_match_hits hit where hit.event_id = boss.id
      ), 0)),
      'damage_per_match', boss.damage_per_match,
      'ends_at', boss.ends_at,
      'my_contribution', coalesce((
        select sum(contribution.points) from public.venue_boss_contributions contribution
        where contribution.event_id = boss.id
          and contribution.profile_id = actor_id
          and contribution.invalidated_at is null
      ), 0),
      'throne_name', case
        when coalesce(champion.points, 0) > boss.champion_points then champion.nickname
        else coalesce(boss.champion_name, champion.nickname, '도전자 모집 중')
      end,
      'throne_points', greatest(boss.champion_points, coalesce(champion.points, 0)),
      'defeated', greatest(0, boss.max_hp - boss.starting_damage - coalesce((
        select sum(hit.damage) from public.venue_boss_match_hits hit where hit.event_id = boss.id
      ), 0)) = 0
    )
    into boss_json
    from public.venue_boss_events boss
    left join live_champion champion on true
    where boss.id = boss_value;
  end if;

  if season_value is not null then
    select jsonb_build_object(
      'code', season.code,
      'name', season.name,
      'ends_at', season.ends_at,
      'quests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'achievement_code', definition.code,
          'name', definition.name,
          'description', definition.description,
          'icon', definition.icon,
          'reward_title', definition.title_name,
          'target', definition.target,
          'progress', least(definition.target, coalesce(progress.progress, 0)),
          'unlocked_at', progress.unlocked_at
        ) order by quest.sort_order, definition.code)
        from public.season_quest_definitions quest
        join public.achievement_definitions definition on definition.code = quest.achievement_code
        left join public.player_achievements progress
          on progress.profile_id = actor_id and progress.achievement_code = definition.code
        where quest.season_id = season.id and definition.active
      ), '[]'::jsonb)
    )
    into season_json
    from public.seasons season
    where season.id = season_value;
  end if;

  return jsonb_build_object(
    'region', coalesce(region_json, jsonb_build_object('code', region_value, 'name', '지역 도감', 'discovered', 0, 'total', 0)),
    'venues', coalesce(venues_json, '[]'::jsonb),
    'boss', boss_json,
    'season', season_json
  );
end;
$$;

create or replace function public.enqueue_finalized_match_gameplay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.finalized_at is not null
    and (tg_op = 'INSERT' or old.finalized_at is null)
    and new.phase <> 'canceled'
  then
    begin
      perform public.process_gameplay_match(new.id);
    exception when others then
      -- Game cosmetics must never roll back the authoritative match result/ELO.
      null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_gameplay_after_finalization on public.matches;
create trigger enqueue_gameplay_after_finalization
  after insert or update of finalized_at on public.matches
  for each row execute function public.enqueue_finalized_match_gameplay();

-- Competition seed: eight Gangnam venues, one current season, and one weekly
-- boss with an already-visible shared progress/champion snapshot.
insert into public.regions (code, name, parent_code)
values ('gangnam', '강남구 도감', null)
on conflict (code) do update set name = excluded.name, updated_at = now();

-- Migrations run before seed.sql on a clean reset, so the competition venues
-- must exist here before the boss FK is inserted. seed.sql can safely upsert
-- the same catalog again when it creates rolling reservation slots.
insert into public.venues (
  id, name, sports, lat, lng, address, price_per_hour, region_code, checkin_radius_m
)
values
  ('v1', '대치체육센터', array['badminton', 'tabletennis', 'basketball']::public.sport_code[], 37.4999, 127.0581, '서울 강남구 대치동', 24000, 'gangnam', 300),
  ('v2', '테헤란 테니스파크', array['tennis']::public.sport_code[], 37.5064, 127.0436, '서울 강남구 역삼동', 40000, 'gangnam', 300),
  ('v3', '역삼 배드민턴센터', array['badminton']::public.sport_code[], 37.5011, 127.0374, '서울 강남구 역삼동', 28000, 'gangnam', 300),
  ('v4', '선릉 탁구아레나', array['tabletennis']::public.sport_code[], 37.5048, 127.0486, '서울 강남구 삼성동', 16000, 'gangnam', 300),
  ('v5', '삼성 코트하우스', array['basketball']::public.sport_code[], 37.5112, 127.0567, '서울 강남구 삼성동', 36000, 'gangnam', 300),
  ('v6', '도곡 시민체육관', array['tennis', 'basketball']::public.sport_code[], 37.4887, 127.0450, '서울 강남구 도곡동', 20000, 'gangnam', 300),
  ('v7', '강남 스포츠플렉스', array['badminton', 'tabletennis', 'tennis']::public.sport_code[], 37.5089, 127.0396, '서울 강남구 논현동', 32000, 'gangnam', 300),
  ('v8', '대청 커뮤니티체육관', array['basketball', 'badminton']::public.sport_code[], 37.4934, 127.0610, '서울 강남구 일원동', 22000, 'gangnam', 300)
on conflict (id) do update set
  region_code = excluded.region_code,
  checkin_radius_m = excluded.checkin_radius_m;

insert into public.seasons (code, name, starts_at, ends_at, active)
values (
  'gangnam-expedition-1',
  '강남 원정대',
  date_trunc('week', now()),
  date_trunc('week', now()) + interval '7 days',
  true
)
on conflict (code) do update set
  name = excluded.name,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  active = true,
  updated_at = now();

insert into public.season_quest_definitions (season_id, achievement_code, sort_order)
select season.id, quest.code, quest.sort_order
from public.seasons season
cross join (values
  ('first_match'::text, 10),
  ('venues_3'::text, 20),
  ('boss_raider'::text, 30)
) as quest(code, sort_order)
where season.code = 'gangnam-expedition-1'
on conflict (season_id, achievement_code) do update set sort_order = excluded.sort_order;

insert into public.venue_boss_events (
  code, venue_id, season_id, starts_at, ends_at, max_hp, starting_damage,
  damage_per_match, champion_name, champion_points
)
select
  'gangnam-boss-1',
  'v1',
  season.id,
  season.starts_at,
  season.ends_at,
  10,
  6,
  1,
  'Nate_Rush',
  3
from public.seasons season
where season.code = 'gangnam-expedition-1'
  and exists (select 1 from public.venues venue where venue.id = 'v1')
on conflict (code) do update set
  venue_id = excluded.venue_id,
  season_id = excluded.season_id,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  max_hp = excluded.max_hp,
  starting_damage = excluded.starting_damage,
  damage_per_match = excluded.damage_per_match,
  champion_name = excluded.champion_name,
  champion_points = excluded.champion_points,
  updated_at = now();

-- Existing valid history immediately appears in the collection. Failures are
-- left retryable through sync_my_match_gameplay and do not abort migration.
do $$
declare
  existing_match uuid;
begin
  for existing_match in
    select match_value.id
    from public.matches match_value
    where match_value.finalized_at is not null and match_value.phase <> 'canceled'
    order by match_value.finalized_at, match_value.id
  loop
    begin
      perform public.process_gameplay_match(existing_match);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

-- Catalogs are readable, personal progress is own-only, and all mutations are
-- RPC/internal. Precise user movement is deliberately not stored in this MVP.
alter table public.regions enable row level security;
alter table public.seasons enable row level security;
alter table public.gameplay_match_events enable row level security;
alter table public.venue_gameplay_credits enable row level security;
alter table public.venue_collection_entries enable row level security;
alter table public.venue_boss_events enable row level security;
alter table public.venue_boss_match_hits enable row level security;
alter table public.venue_boss_contributions enable row level security;
alter table public.gameplay_member_outcomes enable row level security;
alter table public.season_quest_definitions enable row level security;

create policy regions_read on public.regions for select to authenticated using (true);
create policy seasons_read on public.seasons for select to authenticated using (active);
create policy boss_events_read on public.venue_boss_events for select to authenticated using (true);
create policy season_quests_read on public.season_quest_definitions for select to authenticated using (true);
create policy gameplay_events_member_read on public.gameplay_match_events for select to authenticated
  using (exists (select 1 from public.match_members member where member.match_id = gameplay_match_events.match_id and member.user_id = auth.uid()));
create policy gameplay_credits_own_read on public.venue_gameplay_credits for select to authenticated using (profile_id = auth.uid());
create policy collection_own_read on public.venue_collection_entries for select to authenticated using (profile_id = auth.uid());
create policy boss_hits_read on public.venue_boss_match_hits for select to authenticated using (true);
create policy boss_contributions_own_read on public.venue_boss_contributions for select to authenticated using (profile_id = auth.uid());
create policy gameplay_outcomes_own_read on public.gameplay_member_outcomes for select to authenticated using (profile_id = auth.uid());

revoke all privileges on table
  public.regions,
  public.seasons,
  public.gameplay_match_events,
  public.venue_gameplay_credits,
  public.venue_collection_entries,
  public.venue_boss_events,
  public.venue_boss_match_hits,
  public.venue_boss_contributions,
  public.gameplay_member_outcomes,
  public.season_quest_definitions
from anon, authenticated;

grant select on table
  public.regions,
  public.seasons,
  public.gameplay_match_events,
  public.venue_gameplay_credits,
  public.venue_collection_entries,
  public.venue_boss_events,
  public.venue_boss_match_hits,
  public.venue_boss_contributions,
  public.gameplay_member_outcomes,
  public.season_quest_definitions
to authenticated;

grant all privileges on table
  public.regions,
  public.seasons,
  public.gameplay_match_events,
  public.venue_gameplay_credits,
  public.venue_collection_entries,
  public.venue_boss_events,
  public.venue_boss_match_hits,
  public.venue_boss_contributions,
  public.gameplay_member_outcomes,
  public.season_quest_definitions
to service_role;

revoke all on function public.grant_profile_achievement(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.process_gameplay_match(uuid) from public, anon, authenticated;
revoke all on function public.enqueue_finalized_match_gameplay() from public, anon, authenticated;
revoke all on function public.sync_my_match_gameplay(uuid) from public, anon;
revoke all on function public.get_my_gameplay_summary() from public, anon;
revoke all on function public.get_my_match_gameplay_outcome(uuid) from public, anon;

grant execute on function public.grant_profile_achievement(uuid, text, uuid) to service_role;
grant execute on function public.process_gameplay_match(uuid) to service_role;
grant execute on function public.sync_my_match_gameplay(uuid) to authenticated;
grant execute on function public.get_my_gameplay_summary() to authenticated;
grant execute on function public.get_my_match_gameplay_outcome(uuid) to authenticated;
