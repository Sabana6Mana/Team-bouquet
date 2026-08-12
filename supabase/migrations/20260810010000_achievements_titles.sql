-- MATCHPOINT achievements and cosmetic titles
--
-- Achievement progress is derived only from finalized server-side match data.
-- Browser clients may read their own progress and equip an earned title through
-- an RPC, but cannot write progress or the equipped title column directly.

alter table public.player_ratings
  add column if not exists current_streak integer not null default 0,
  add column if not exists best_streak integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'player_ratings_current_streak_nonnegative'
      and conrelid = 'public.player_ratings'::regclass
  ) then
    alter table public.player_ratings
      add constraint player_ratings_current_streak_nonnegative
      check (current_streak >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'player_ratings_best_streak_valid'
      and conrelid = 'public.player_ratings'::regclass
  ) then
    alter table public.player_ratings
      add constraint player_ratings_best_streak_valid
      check (best_streak >= current_streak and best_streak >= 0);
  end if;
end $$;

create table if not exists public.achievement_definitions (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 240),
  icon text not null check (char_length(icon) between 1 and 20),
  metric_code text not null check (metric_code in (
    'matches_played',
    'matches_won',
    'best_win_streak',
    'distinct_venues',
    'gangnam_venues',
    'distinct_sports',
    'giant_killer',
    'unique_rivals',
    'home_venue_wins',
    'highest_rating'
  )),
  target integer not null check (target > 0),
  title_name text not null check (char_length(title_name) between 1 and 60),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  sort_order integer not null default 0,
  active boolean not null default true,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.achievement_definitions (
  code, name, description, icon, metric_code, target, title_name, rarity, sort_order, hidden
)
values
  (
    'first_match', '호루라기가 울렸다', '첫 경기를 결과 확정까지 마무리하세요.', '🎟️',
    'matches_played', 1, '코트에 소환된 자', 'common', 10, false
  ),
  (
    'first_win', '승리도 처음이 제일 짜릿해', 'MATCHPOINT에서 첫 승리를 기록하세요.', '🔥',
    'matches_won', 1, '승리의 불씨', 'common', 20, false
  ),
  (
    'matches_10', '운동화 밑창 워밍업 완료', '결과가 확정된 경기를 10번 완료하세요.', '👟',
    'matches_played', 10, '코트 출근러', 'rare', 30, false
  ),
  (
    'streak_3', '불이 붙었다!', '한 종목에서 3연승을 달성하세요.', '⚡',
    'best_win_streak', 3, '연승 점화자', 'rare', 40, false
  ),
  (
    'streak_5', '브레이크는 장식일 뿐', '한 종목에서 5연승을 달성하세요.', '🚂',
    'best_win_streak', 5, '멈출 수 없는 자', 'epic', 50, false
  ),
  (
    'venues_3', '지도에 핀 세 개', '서로 다른 체육관 3곳에서 경기를 완료하세요.', '📍',
    'distinct_venues', 3, '코트 유목민', 'rare', 60, false
  ),
  (
    'gangnam_all_clear', '강남 체육관 ALL CLEAR', '강남 데모 거점 8곳에서 모두 경기를 완료하세요.', '🗺️',
    'gangnam_venues', 8, '강남의 제패자', 'legendary', 70, false
  ),
  (
    'venues_50', '한반도에 발도장', '서로 다른 체육관 50곳에서 경기를 완료하세요.', '🇰🇷',
    'distinct_venues', 50, '전국의 제패자', 'legendary', 80, false
  ),
  (
    'all_sports', '라켓도 공도 가리지 않는다', '테니스·배드민턴·탁구·농구 경기를 모두 완료하세요.', '🎯',
    'distinct_sports', 4, '올라운드 몬스터', 'epic', 90, false
  ),
  (
    'unique_rivals_10', '열 명과 땀으로 인사하기', '서로 다른 상대 10명과 경기를 완료하세요.', '🤝',
    'unique_rivals', 10, '코트 인싸', 'rare', 100, false
  ),
  (
    'home_wins_5', '이 코트, 눈 감고도 안다', '같은 체육관에서 5승을 기록하세요.', '🏠',
    'home_venue_wins', 5, '우리 동네 터줏대감', 'epic', 110, false
  ),
  (
    'giant_killer', '거인은 쓰러지라고 있는 법', '평균 ELO가 150 이상 높은 팀을 꺾으세요.', '🗡️',
    'giant_killer', 1, '자이언트 킬러', 'epic', 120, false
  ),
  (
    'gold_any', '금빛 문을 열다', '한 종목에서 ELO 1400을 달성하세요.', '👑',
    'highest_rating', 1400, '골드 입성자', 'epic', 130, false
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
  active = true,
  hidden = excluded.hidden,
  updated_at = now();

alter table public.profiles
  add column if not exists equipped_title_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_equipped_title_code_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_equipped_title_code_fkey
      foreign key (equipped_title_code)
      references public.achievement_definitions(code)
      on update cascade on delete set null;
  end if;
end $$;

create table if not exists public.player_achievements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  achievement_code text not null references public.achievement_definitions(code) on update cascade on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  unlocked_at timestamptz,
  unlocked_match_id uuid references public.matches(id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, achievement_code),
  check (unlocked_at is not null or unlocked_match_id is null),
  check (notified_at is null or unlocked_at is not null)
);

create index if not exists player_achievements_unlocked_idx
  on public.player_achievements (profile_id, unlocked_at desc)
  where unlocked_at is not null;
create index if not exists player_achievements_match_idx
  on public.player_achievements (profile_id, unlocked_match_id)
  where unlocked_match_id is not null;

drop trigger if exists set_updated_at on public.achievement_definitions;
create trigger set_updated_at
  before update on public.achievement_definitions
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.player_achievements;
create trigger set_updated_at
  before update on public.player_achievements
  for each row execute function public.set_updated_at();

create or replace function public.refresh_profile_achievements(
  p_profile_id uuid,
  p_source_match uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rating_row record;
  streak_current integer;
  streak_best integer;
  matches_played integer := 0;
  matches_won integer := 0;
  distinct_venues integer := 0;
  gangnam_venues integer := 0;
  distinct_sports integer := 0;
  best_win_streak integer := 0;
  unique_rivals integer := 0;
  home_venue_wins integer := 0;
  highest_rating integer := 0;
  giant_killer integer := 0;
begin
  if p_profile_id is null then
    raise exception using errcode = '22023', message = 'Profile id is required';
  end if;

  -- Do not lock the profile row here. Result finalization already holds rating
  -- rows, while profile saving locks the profile first; taking both in the
  -- opposite order would allow a profile↔rating deadlock. The achievement
  -- upsert and notified_at transition are independently idempotent.
  perform 1 from public.profiles where id = p_profile_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Profile not found';
  end if;

  insert into public.player_ratings (profile_id, sport)
  select p_profile_id, sport
  from unnest(enum_range(null::public.sport_code)) as sport
  on conflict (profile_id, sport) do nothing;

  -- Rebuild sport-specific streaks from finalized matches. Recalculation, rather
  -- than incrementing, keeps this safe for retries and historical backfills.
  for rating_row in
    select sport from public.player_ratings where profile_id = p_profile_id order by sport
  loop
    with outcomes as (
      select
        m.id,
        m.finalized_at,
        (mm.team = m.winner_team) as won
      from public.matches m
      join public.match_members mm on mm.match_id = m.id
      where mm.user_id = p_profile_id
        and m.sport = rating_row.sport
        and m.finalized_at is not null
        and m.winner_team is not null
    ), annotated as (
      select
        won,
        sum(case when won then 0 else 1 end) over (
          order by finalized_at desc, id desc rows between unbounded preceding and current row
        ) as losses_from_latest,
        sum(case when won then 0 else 1 end) over (
          order by finalized_at, id rows between unbounded preceding and current row
        ) as loss_group
      from outcomes
    ), win_runs as (
      select loss_group, count(*)::integer as run_length
      from annotated
      where won
      group by loss_group
    )
    select
      coalesce((
        select count(*)::integer from annotated where won and losses_from_latest = 0
      ), 0),
      coalesce((select max(run_length) from win_runs), 0)
    into streak_current, streak_best;

    update public.player_ratings
    set current_streak = streak_current,
        best_streak = streak_best
    where profile_id = p_profile_id and sport = rating_row.sport;
  end loop;

  select
    count(*)::integer,
    count(*) filter (where mm.team = m.winner_team)::integer,
    count(distinct m.venue_id)::integer,
    count(distinct m.venue_id) filter (
      where m.venue_id = any (array['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8']::text[])
    )::integer,
    count(distinct m.sport)::integer
  into matches_played, matches_won, distinct_venues, gangnam_venues, distinct_sports
  from public.matches m
  join public.match_members mm on mm.match_id = m.id
  where mm.user_id = p_profile_id
    and m.finalized_at is not null
    and m.winner_team is not null;

  select coalesce(max(r.best_streak), 0)
  into best_win_streak
  from public.player_ratings r
  where r.profile_id = p_profile_id;

  select count(distinct opponent.user_id)::integer
  into unique_rivals
  from public.matches m
  join public.match_members mine
    on mine.match_id = m.id and mine.user_id = p_profile_id
  join public.match_members opponent
    on opponent.match_id = m.id and opponent.team <> mine.team
  where m.finalized_at is not null and m.winner_team is not null;

  select coalesce(max(venue_wins), 0)
  into home_venue_wins
  from (
    select count(*)::integer as venue_wins
    from public.matches m
    join public.match_members mm
      on mm.match_id = m.id and mm.user_id = p_profile_id
    where m.finalized_at is not null
      and m.winner_team is not null
      and mm.team = m.winner_team
    group by m.venue_id
  ) as wins_by_venue;

  select greatest(
    coalesce((
      select max(r.rating) from public.player_ratings r where r.profile_id = p_profile_id
    ), 0),
    coalesce((
      select max(greatest(e.rating_before, e.rating_after))
      from public.rating_events e
      where e.profile_id = p_profile_id
    ), 0)
  )
  into highest_rating;

  select case when exists (
    select 1
    from public.matches m
    join public.match_members mine
      on mine.match_id = m.id and mine.user_id = p_profile_id
    join public.match_members participant on participant.match_id = m.id
    where m.finalized_at is not null
      and m.winner_team is not null
      and mine.team = m.winner_team
    group by m.id, mine.team
    having
      avg(participant.rating_before) filter (where participant.team <> mine.team) is not null
      and avg(participant.rating_before) filter (where participant.team = mine.team) is not null
      and avg(participant.rating_before) filter (where participant.team <> mine.team)
        >= avg(participant.rating_before) filter (where participant.team = mine.team) + 150
  ) then 1 else 0 end
  into giant_killer;

  with calculated as (
    select
      definition.code,
      definition.target,
      case definition.metric_code
        when 'matches_played' then matches_played
        when 'matches_won' then matches_won
        when 'best_win_streak' then best_win_streak
        when 'distinct_venues' then distinct_venues
        when 'gangnam_venues' then gangnam_venues
        when 'distinct_sports' then distinct_sports
        when 'giant_killer' then giant_killer
        when 'unique_rivals' then unique_rivals
        when 'home_venue_wins' then home_venue_wins
        when 'highest_rating' then highest_rating
        else 0
      end as raw_progress
    from public.achievement_definitions definition
    where definition.active
  ), prepared as (
    select
      code,
      least(target, greatest(0, raw_progress)) as stored_progress,
      raw_progress >= target as should_unlock
    from calculated
  )
  insert into public.player_achievements as existing (
    profile_id,
    achievement_code,
    progress,
    unlocked_at,
    unlocked_match_id
  )
  select
    p_profile_id,
    prepared.code,
    prepared.stored_progress,
    case when prepared.should_unlock then now() else null end,
    case when prepared.should_unlock then p_source_match else null end
  from prepared
  on conflict (profile_id, achievement_code) do update set
    progress = greatest(existing.progress, excluded.progress),
    unlocked_at = coalesce(existing.unlocked_at, excluded.unlocked_at),
    unlocked_match_id = case
      when existing.unlocked_at is null and excluded.unlocked_at is not null
        then excluded.unlocked_match_id
      else existing.unlocked_match_id
    end,
    updated_at = now();

  -- `notified_at is null` is the durable idempotency key. Only rows whose
  -- locked -> unlocked transition has never been announced create a message.
  with newly_notified as (
    update public.player_achievements achievement
    set notified_at = now(), updated_at = now()
    where achievement.profile_id = p_profile_id
      and achievement.unlocked_at is not null
      and achievement.notified_at is null
    returning achievement.achievement_code
  )
  insert into public.notifications (user_id, title, body, link)
  select
    p_profile_id,
    '도전과제 달성! ' || definition.name,
    '칭호 「' || definition.title_name || '」을 획득했어요. 프로필에서 장착해 보세요.',
    '/achievements'
  from newly_notified
  join public.achievement_definitions definition
    on definition.code = newly_notified.achievement_code;
end;
$$;

create or replace function public.refresh_match_members_achievements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid;
begin
  if new.finalized_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.finalized_at is not null then
      return new;
    end if;
  end if;

  for member_id in
    select member.user_id
    from public.match_members member
    where member.match_id = new.id
    order by member.user_id
  loop
    perform public.refresh_profile_achievements(member_id, new.id);
  end loop;

  return new;
end;
$$;

drop trigger if exists refresh_achievements_after_finalization on public.matches;
create trigger refresh_achievements_after_finalization
  after insert or update of finalized_at on public.matches
  for each row execute function public.refresh_match_members_achievements();

create or replace function public.get_my_achievements()
returns table (
  code text,
  name text,
  description text,
  icon text,
  reward_title text,
  rarity text,
  target integer,
  progress integer,
  unlocked_at timestamptz,
  equipped boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  return query
  select
    definition.code,
    definition.name,
    definition.description,
    definition.icon,
    definition.title_name,
    definition.rarity,
    definition.target,
    coalesce(achievement.progress, 0),
    achievement.unlocked_at,
    coalesce(profile.equipped_title_code = definition.code, false)
  from public.achievement_definitions definition
  join public.profiles profile on profile.id = actor_id
  left join public.player_achievements achievement
    on achievement.profile_id = actor_id
   and achievement.achievement_code = definition.code
  where definition.active
    and (not definition.hidden or achievement.unlocked_at is not null)
  order by definition.sort_order, definition.code;
end;
$$;

create or replace function public.equip_my_title(p_achievement_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_code text := nullif(btrim(p_achievement_code), '');
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  if normalized_code is null then
    update public.profiles
    set equipped_title_code = null
    where id = actor_id;

    return null;
  end if;

  perform 1
  from public.player_achievements achievement
  join public.achievement_definitions definition
    on definition.code = achievement.achievement_code
  where achievement.profile_id = actor_id
    and achievement.achievement_code = normalized_code
    and achievement.unlocked_at is not null;

  if not found then
    raise exception using errcode = '42501', message = 'This title has not been unlocked';
  end if;

  update public.profiles
  set equipped_title_code = normalized_code
  where id = actor_id;

  return normalized_code;
end;
$$;

-- Backfill existing profiles and rating streaks from authoritative match data.
do $$
declare
  existing_profile_id uuid;
begin
  for existing_profile_id in
    select profile.id from public.profiles profile order by profile.id
  loop
    perform public.refresh_profile_achievements(existing_profile_id, null);
  end loop;
end $$;

-- RLS keeps the catalog readable while progress remains private to its owner.
alter table public.achievement_definitions enable row level security;
alter table public.player_achievements enable row level security;

drop policy if exists achievement_definitions_read on public.achievement_definitions;
create policy achievement_definitions_read
  on public.achievement_definitions for select to authenticated
  using (active);

drop policy if exists player_achievements_read_own on public.player_achievements;
create policy player_achievements_read_own
  on public.player_achievements for select to authenticated
  using (profile_id = auth.uid());

-- No INSERT/UPDATE/DELETE grants or policies are given to browser roles.
revoke all privileges on table
  public.achievement_definitions,
  public.player_achievements
from anon, authenticated;

grant all privileges on table
  public.achievement_definitions,
  public.player_achievements
to service_role;

grant select on table public.achievement_definitions to authenticated;
grant select on table public.player_achievements to authenticated;

-- Existing profile grants are column-scoped for UPDATE. Keep the newly added
-- equipped title column RPC-only even if grants are later broadened elsewhere.
revoke update (equipped_title_code) on public.profiles from anon, authenticated;

revoke all on function public.refresh_profile_achievements(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_match_members_achievements()
  from public, anon, authenticated;
revoke all on function public.get_my_achievements()
  from public, anon;
revoke all on function public.equip_my_title(text)
  from public, anon;

grant execute on function public.refresh_profile_achievements(uuid, uuid) to service_role;
grant execute on function public.get_my_achievements() to authenticated;
grant execute on function public.equip_my_title(text) to authenticated;
