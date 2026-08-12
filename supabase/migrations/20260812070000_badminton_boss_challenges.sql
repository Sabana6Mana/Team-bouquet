-- Replace the passive weekly venue boss with a direct badminton NPC challenge.
--
-- Normal finalized matches still unlock venue collection and ordinary season
-- quests, but they no longer damage a boss, create boss contributions, or grant
-- the boss_raider title. Boss challenge results are cosmetic-only and never
-- mutate matchmaking, match history, wins/losses, ELO, or rating events.

alter table public.venue_boss_events
  add column if not exists sport public.sport_code not null default 'badminton'::public.sport_code,
  add column if not exists boss_name text not null default '셔틀콕 가디언',
  add column if not exists boss_avatar_url text,
  add column if not exists boss_rating integer not null default 1350,
  add column if not exists win_rate_bps integer not null default 5000,
  add column if not exists challenge_enabled boolean not null default true;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_boss_events_badminton_only'
      and conrelid = 'public.venue_boss_events'::regclass
  ) then
    alter table public.venue_boss_events
      add constraint venue_boss_events_badminton_only
      check (sport = 'badminton'::public.sport_code);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_boss_events_boss_name_length'
      and conrelid = 'public.venue_boss_events'::regclass
  ) then
    alter table public.venue_boss_events
      add constraint venue_boss_events_boss_name_length
      check (char_length(btrim(boss_name)) between 1 and 80);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_boss_events_boss_avatar_url_length'
      and conrelid = 'public.venue_boss_events'::regclass
  ) then
    alter table public.venue_boss_events
      add constraint venue_boss_events_boss_avatar_url_length
      check (boss_avatar_url is null or char_length(boss_avatar_url) between 1 and 2048);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_boss_events_boss_rating_valid'
      and conrelid = 'public.venue_boss_events'::regclass
  ) then
    alter table public.venue_boss_events
      add constraint venue_boss_events_boss_rating_valid
      check (boss_rating >= 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_boss_events_win_rate_bps_valid'
      and conrelid = 'public.venue_boss_events'::regclass
  ) then
    alter table public.venue_boss_events
      add constraint venue_boss_events_win_rate_bps_valid
      check (win_rate_bps between 0 and 10000);
  end if;
end
$migration$;

create table if not exists public.boss_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  -- Preserve the victory proof while an earned title references it indirectly.
  -- Operators must remove challenge rows explicitly before deleting an event.
  event_id uuid not null references public.venue_boss_events(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'won', 'lost', 'abandoned')),
  challenger_rating integer not null check (challenger_rating >= 100),
  boss_rating integer not null check (boss_rating >= 100),
  score text check (score is null or char_length(score) between 1 and 80),
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and resolved_at is null and score is null)
    or (status in ('won', 'lost') and resolved_at is not null and score is not null)
    or (status = 'abandoned' and resolved_at is not null and score is null)
  )
);

create unique index if not exists boss_challenges_one_active_per_event_profile
  on public.boss_challenges (event_id, profile_id)
  where status = 'active';

create unique index if not exists boss_challenges_one_win_per_event_profile
  on public.boss_challenges (event_id, profile_id)
  where status = 'won';

create index if not exists boss_challenges_profile_started_idx
  on public.boss_challenges (profile_id, started_at desc);

drop trigger if exists set_updated_at on public.boss_challenges;
create trigger set_updated_at
  before update on public.boss_challenges
  for each row execute function public.set_updated_at();

-- Every pre-migration boss hit/contribution/title came from an ordinary match:
-- no direct boss challenge path existed yet. Remove those legacy grants before
-- installing the new invariant, while leaving ordinary match and ELO history
-- untouched. A verified direct win is excluded so this migration remains safe
-- if a recovery workflow intentionally replays its SQL.
update public.profiles profile
set equipped_title_code = null
where profile.equipped_title_code = 'boss_raider'
  and not exists (
    select 1
    from public.boss_challenges challenge
    where challenge.profile_id = profile.id
      and challenge.status = 'won'
  );

delete from public.notifications notification
using public.achievement_definitions definition
where definition.code = 'boss_raider'
  and notification.link = '/achievements'
  and notification.title = '도전과제 달성! ' || definition.name
  and notification.body = '칭호 「' || definition.title_name || '」을 획득했어요. 프로필에서 장착해 보세요.'
  and not exists (
    select 1
    from public.boss_challenges challenge
    where challenge.profile_id = notification.user_id
      and challenge.status = 'won'
  );

delete from public.player_achievements achievement
where achievement.achievement_code = 'boss_raider'
  and not exists (
    select 1
    from public.boss_challenges challenge
    where challenge.profile_id = achievement.profile_id
      and challenge.status = 'won'
  );

update public.gameplay_member_outcomes
set boss_damage = 0,
    boss_remaining_hp = null,
    unlocked_achievement_codes = array_remove(unlocked_achievement_codes, 'boss_raider')
where boss_damage <> 0
   or boss_remaining_hp is not null
   or 'boss_raider' = any(unlocked_achievement_codes);

delete from public.venue_boss_contributions;
delete from public.venue_boss_match_hits;

-- The old HP/champion columns remain as a one-victory compatibility projection
-- for clients deployed before this migration. They no longer drive rewards.
update public.venue_boss_events
set sport = 'badminton'::public.sport_code,
    max_hp = 1,
    starting_damage = 0,
    damage_per_match = 1,
    champion_profile_id = null,
    champion_name = null,
    champion_points = 0,
    settled_at = null,
    updated_at = now();

update public.achievement_definitions
set name = '셔틀콕 가디언 격파',
    description = '배드민턴 NPC 보스와 직접 대결해 승리하세요.',
    icon = '🏸',
    title_name = '보스의 천적',
    metric_code = 'external_grant',
    target = 1,
    active = true,
    hidden = false,
    updated_at = now()
where code = 'boss_raider';

create or replace function public.enforce_boss_raider_requires_win()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.achievement_code = 'boss_raider'
    and new.unlocked_at is not null
    and not exists (
      select 1
      from public.boss_challenges challenge
      join public.venue_boss_events boss on boss.id = challenge.event_id
      where challenge.profile_id = new.profile_id
        and challenge.status = 'won'
        and boss.sport = 'badminton'::public.sport_code
    )
  then
    raise exception using
      errcode = '23514',
      message = 'boss_raider requires a verified badminton boss victory';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_boss_raider_requires_win on public.player_achievements;
create trigger enforce_boss_raider_requires_win
  before insert or update on public.player_achievements
  for each row execute function public.enforce_boss_raider_requires_win();

create or replace function public.enforce_no_active_boss_challenge_on_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'waiting' then
    -- A closed browser cannot call the resolve RPC. Release challenges that
    -- can no longer be played before deciding whether queue entry is blocked.
    update public.boss_challenges challenge
    set status = 'abandoned',
        resolved_at = now(),
        score = null,
        updated_at = now()
    where challenge.profile_id = new.user_id
      and challenge.status = 'active'
      and (
        challenge.started_at <= now() - interval '30 minutes'
        or not exists (
          select 1
          from public.venue_boss_events boss
          where boss.id = challenge.event_id
            and boss.challenge_enabled
            and now() >= boss.starts_at
            and now() < boss.ends_at
        )
      );

    if exists (
      select 1
      from public.boss_challenges challenge
      where challenge.profile_id = new.user_id
        and challenge.status = 'active'
    ) then
      raise exception using
        errcode = '55000',
        message = 'Finish the active boss challenge before joining a match queue';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_no_active_boss_challenge_on_queue on public.queue_entries;
create trigger enforce_no_active_boss_challenge_on_queue
  before insert or update of user_id, status on public.queue_entries
  for each row execute function public.enforce_no_active_boss_challenge_on_queue();

-- Ordinary finalized matches now process only collection and ordinary
-- achievements. In particular, venue/time overlap with a boss event is not
-- evidence of a direct NPC boss challenge.
create or replace function public.process_gameplay_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.matches%rowtype;
  member_row record;
  active_season_id uuid;
  region_value text;
  was_new_venue boolean;
  region_discovered integer;
  region_total integer;
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
    select 1
    from public.gameplay_match_events event
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
  set status = 'processing',
      attempt_count = attempt_count + 1,
      error_message = null,
      updated_at = now()
  where match_id = p_match_id;

  select venue.region_code
  into region_value
  from public.venues venue
  where venue.id = match_row.venue_id;

  select season.id
  into active_season_id
  from public.seasons season
  where season.active
    and match_row.finalized_at >= season.starts_at
    and match_row.finalized_at < season.ends_at
  order by season.starts_at desc, season.id
  limit 1;

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
      member_row.user_id,
      match_row.venue_id,
      p_match_id,
      match_row.finalized_at
    )
    on conflict (profile_id, venue_id) do nothing
    returning true into was_new_venue;
    was_new_venue := coalesce(was_new_venue, false);

    perform public.refresh_profile_achievements(member_row.user_id, p_match_id);

    select count(*)::integer
    into region_total
    from public.venues venue
    where venue.active
      and venue.region_code is not distinct from region_value;

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
      and progress.unlocked_at is not null
      and progress.achievement_code <> 'boss_raider';

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
      0,
      null,
      coalesce(unlocked_codes, '{}')
    )
    on conflict (match_id, profile_id) do nothing;
  end loop;

  update public.gameplay_match_events
  set status = 'processed',
      processed_at = now(),
      error_message = null,
      updated_at = now()
  where match_id = p_match_id;
exception
  when others then
    update public.gameplay_match_events
    set status = 'failed',
        error_message = left(sqlerrm, 500),
        updated_at = now()
    where match_id = p_match_id;
    raise;
end;
$$;

create or replace function public.start_my_boss_challenge(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  event_row public.venue_boss_events%rowtype;
  challenge_row public.boss_challenges%rowtype;
  challenger_rating_value integer;
  title_unlocked_value boolean := false;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if public.is_profile_permanently_banned(actor_id) then
    raise exception using errcode = '42501', message = 'This account is permanently suspended';
  end if;

  -- Use the same per-user lock as join_match_queue so queue creation and boss
  -- challenge creation cannot pass each other's eligibility checks.
  perform pg_advisory_xact_lock(hashtextextended('matchpoint:user:' || actor_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('matchpoint:boss:' || actor_id::text || ':' || p_event_id::text, 0)
  );

  select boss.*
  into event_row
  from public.venue_boss_events boss
  where boss.id = p_event_id
  for share;

  if event_row.id is null then
    raise exception using errcode = 'P0002', message = 'Boss event not found';
  end if;
  if not event_row.challenge_enabled
    or now() < event_row.starts_at
    or now() >= event_row.ends_at
  then
    raise exception using errcode = '55000', message = 'This boss challenge is not active';
  end if;
  if event_row.sport <> 'badminton'::public.sport_code then
    raise exception using errcode = '22023', message = 'Boss challenges support badminton only';
  end if;
  if not exists (
    select 1
    from public.venues venue
    where venue.id = event_row.venue_id
      and venue.active
      and 'badminton'::public.sport_code = any(venue.sports)
  ) then
    raise exception using errcode = '55000', message = 'The boss venue does not support badminton';
  end if;

  if exists (
    select 1
    from public.queue_entries queue
    where queue.user_id = actor_id and queue.status = 'waiting'
  ) then
    raise exception using errcode = '55000', message = 'Leave the match queue before challenging the boss';
  end if;

  if exists (
    select 1
    from public.match_members member
    join public.matches match_value on match_value.id = member.match_id
    where member.user_id = actor_id
      and (
        match_value.phase not in ('done', 'canceled')
        or (match_value.phase = 'done' and member.completed_at is null)
      )
  ) then
    raise exception using errcode = '55000', message = 'Finish the active match before challenging the boss';
  end if;

  update public.boss_challenges challenge
  set status = 'abandoned', resolved_at = now(), score = null, updated_at = now()
  where challenge.event_id = event_row.id
    and challenge.profile_id = actor_id
    and challenge.status = 'active'
    and challenge.started_at <= now() - interval '30 minutes';

  select challenge.*
  into challenge_row
  from public.boss_challenges challenge
  where challenge.event_id = event_row.id
    and challenge.profile_id = actor_id
    and challenge.status = 'won'
  order by challenge.resolved_at desc, challenge.id
  limit 1;

  if challenge_row.id is null then
    select challenge.*
    into challenge_row
    from public.boss_challenges challenge
    where challenge.event_id = event_row.id
      and challenge.profile_id = actor_id
      and challenge.status = 'active'
    order by challenge.started_at desc, challenge.id
    limit 1
    for update;
  end if;

  if challenge_row.id is null then
    insert into public.player_ratings (profile_id, sport)
    values (actor_id, 'badminton'::public.sport_code)
    on conflict (profile_id, sport) do nothing;

    select rating.rating
    into challenger_rating_value
    from public.player_ratings rating
    where rating.profile_id = actor_id
      and rating.sport = 'badminton'::public.sport_code;

    insert into public.boss_challenges (
      event_id, profile_id, status, challenger_rating, boss_rating
    ) values (
      event_row.id, actor_id, 'active', challenger_rating_value, event_row.boss_rating
    )
    returning * into challenge_row;
  end if;

  select exists (
    select 1
    from public.player_achievements achievement
    where achievement.profile_id = actor_id
      and achievement.achievement_code = 'boss_raider'
      and achievement.unlocked_at is not null
  ) into title_unlocked_value;

  return jsonb_build_object(
    'challenge_id', challenge_row.id,
    'event_id', event_row.id,
    'venue_id', event_row.venue_id,
    'sport', event_row.sport,
    'boss_name', event_row.boss_name,
    'boss_avatar_url', event_row.boss_avatar_url,
    'boss_rating', challenge_row.boss_rating,
    'status', challenge_row.status,
    'won', case challenge_row.status when 'won' then true when 'lost' then false else null end,
    'score', challenge_row.score,
    'title_code', case when title_unlocked_value then 'boss_raider' else null end,
    'title_unlocked', title_unlocked_value,
    'newly_unlocked', false
  );
end;
$$;

create or replace function public.resolve_my_boss_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  event_row public.venue_boss_events%rowtype;
  challenge_row public.boss_challenges%rowtype;
  did_win boolean;
  score_value text;
  newly_unlocked_value boolean := false;
  title_unlocked_value boolean := false;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if public.is_profile_permanently_banned(actor_id) then
    raise exception using errcode = '42501', message = 'This account is permanently suspended';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matchpoint:user:' || actor_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('matchpoint:boss-challenge:' || p_challenge_id::text, 0)
  );

  select challenge.*
  into challenge_row
  from public.boss_challenges challenge
  where challenge.id = p_challenge_id
    and challenge.profile_id = actor_id
  for update;

  if challenge_row.id is null then
    raise exception using errcode = 'P0002', message = 'Boss challenge not found';
  end if;

  select boss.*
  into event_row
  from public.venue_boss_events boss
  where boss.id = challenge_row.event_id
  for share;

  if event_row.id is null or event_row.sport <> 'badminton'::public.sport_code then
    raise exception using errcode = '55000', message = 'The badminton boss event is unavailable';
  end if;

  if challenge_row.status = 'active' then
    if not event_row.challenge_enabled
      or now() < event_row.starts_at
      or now() >= event_row.ends_at
      or challenge_row.started_at <= now() - interval '30 minutes'
    then
      update public.boss_challenges
      set status = 'abandoned', resolved_at = now(), score = null, updated_at = now()
      where id = challenge_row.id
      returning * into challenge_row;
    else
      -- The client never supplies a winner. The first locked resolution rolls
      -- once on the server and persists the outcome; retries return that row.
      did_win := floor(random() * 10000)::integer < event_row.win_rate_bps;
      score_value := case when did_win then '21-17,21-19' else '17-21,19-21' end;

      update public.boss_challenges
      set status = case when did_win then 'won' else 'lost' end,
          score = score_value,
          resolved_at = now(),
          updated_at = now()
      where id = challenge_row.id
      returning * into challenge_row;

      if did_win then
        newly_unlocked_value := public.grant_profile_achievement(
          actor_id,
          'boss_raider',
          null
        );
        perform public.refresh_profile_achievements(actor_id, null);
      end if;
    end if;
  end if;

  select exists (
    select 1
    from public.player_achievements achievement
    where achievement.profile_id = actor_id
      and achievement.achievement_code = 'boss_raider'
      and achievement.unlocked_at is not null
  ) into title_unlocked_value;

  return jsonb_build_object(
    'challenge_id', challenge_row.id,
    'event_id', event_row.id,
    'venue_id', event_row.venue_id,
    'sport', event_row.sport,
    'boss_name', event_row.boss_name,
    'boss_avatar_url', event_row.boss_avatar_url,
    'boss_rating', challenge_row.boss_rating,
    'status', challenge_row.status,
    'won', case challenge_row.status when 'won' then true when 'lost' then false else null end,
    'score', challenge_row.score,
    'title_code', case when title_unlocked_value then 'boss_raider' else null end,
    'title_unlocked', title_unlocked_value,
    'newly_unlocked', newly_unlocked_value
  );
end;
$$;

-- Keep the existing gameplay summary keys so an older client sees a simple
-- personal 0/1 boss target. New clients receive the direct-challenge fields and
-- should ignore throne/HP concepts entirely.
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

  select season.id
  into season_value
  from public.seasons season
  where season.active and now() >= season.starts_at and now() < season.ends_at
  order by season.starts_at desc, season.id
  limit 1;

  select boss.id
  into boss_value
  from public.venue_boss_events boss
  join public.venues venue on venue.id = boss.venue_id
  where venue.region_code = region_value
    and boss.sport = 'badminton'::public.sport_code
    and (season_value is null or boss.season_id = season_value)
    and now() >= boss.starts_at and now() < boss.ends_at
  order by boss.starts_at desc, boss.id
  limit 1;

  select jsonb_build_object(
    'code', region.code,
    'name', region.name,
    'discovered', (
      select count(*)
      from public.venue_collection_entries entry
      join public.venues venue on venue.id = entry.venue_id
      where entry.profile_id = actor_id
        and venue.active
        and venue.region_code = region.code
    ),
    'total', (
      select count(*)
      from public.venues venue
      where venue.active and venue.region_code = region.code
    )
  )
  into region_json
  from public.regions region
  where region.code = region_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'venue_id', venue.id,
    'discovered_at', entry.unlocked_at,
    'visits', coalesce((
      select count(*)
      from public.venue_gameplay_credits credit
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
    select jsonb_build_object(
      'event_id', boss.id,
      'venue_id', boss.venue_id,
      'sport', boss.sport,
      'boss_name', boss.boss_name,
      'boss_avatar_url', boss.boss_avatar_url,
      'boss_rating', boss.boss_rating,
      'challenge_id', challenge.id,
      'challenge_status', challenge.status,
      'can_challenge',
        boss.challenge_enabled
        and coalesce(challenge.status, '') <> 'won'
        and not public.is_profile_permanently_banned(actor_id)
        and not exists (
          select 1
          from public.queue_entries queue
          where queue.user_id = actor_id and queue.status = 'waiting'
        )
        and not exists (
          select 1
          from public.match_members member
          join public.matches match_value on match_value.id = member.match_id
          where member.user_id = actor_id
            and (
              match_value.phase not in ('done', 'canceled')
              or (match_value.phase = 'done' and member.completed_at is null)
            )
        ),
      'title_code', case when title_state.unlocked then 'boss_raider' else null end,
      'title_unlocked', title_state.unlocked,
      -- Backward-compatible projection. This is personal challenge state, not
      -- shared HP, contribution, or a throne leaderboard.
      'max_hp', 1,
      'remaining_hp', case when challenge.status = 'won' then 0 else 1 end,
      'damage_per_match', 1,
      'ends_at', boss.ends_at,
      'my_contribution', case when challenge.status = 'won' then 1 else 0 end,
      'throne_name', null,
      'throne_points', 0,
      'defeated', coalesce(challenge.status = 'won', false)
    )
    into boss_json
    from public.venue_boss_events boss
    left join lateral (
      select saved.*
      from public.boss_challenges saved
      where saved.event_id = boss.id
        and saved.profile_id = actor_id
      order by
        case saved.status when 'won' then 0 when 'active' then 1 else 2 end,
        saved.started_at desc,
        saved.id
      limit 1
    ) challenge on true
    cross join lateral (
      select exists (
        select 1
        from public.player_achievements achievement
        where achievement.profile_id = actor_id
          and achievement.achievement_code = 'boss_raider'
          and achievement.unlocked_at is not null
      ) as unlocked
    ) title_state
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
        join public.achievement_definitions definition
          on definition.code = quest.achievement_code
        left join public.player_achievements progress
          on progress.profile_id = actor_id
         and progress.achievement_code = definition.code
        where quest.season_id = season.id and definition.active
      ), '[]'::jsonb)
    )
    into season_json
    from public.seasons season
    where season.id = season_value;
  end if;

  return jsonb_build_object(
    'region', coalesce(
      region_json,
      jsonb_build_object(
        'code', region_value,
        'name', '지역 도감',
        'discovered', 0,
        'total', 0
      )
    ),
    'venues', coalesce(venues_json, '[]'::jsonb),
    'boss', boss_json,
    'season', season_json
  );
end;
$$;

-- Competition demo: one badminton NPC boss at v1. A guaranteed first win keeps
-- a solo presentation deterministic; production events may use a lower rate.
insert into public.venue_boss_events (
  code,
  venue_id,
  season_id,
  starts_at,
  ends_at,
  max_hp,
  starting_damage,
  damage_per_match,
  champion_profile_id,
  champion_name,
  champion_points,
  sport,
  boss_name,
  boss_avatar_url,
  boss_rating,
  win_rate_bps,
  challenge_enabled
)
select
  'gangnam-boss-1',
  'v1',
  season.id,
  season.starts_at,
  season.ends_at,
  1,
  0,
  1,
  null,
  null,
  0,
  'badminton'::public.sport_code,
  '셔틀콕 가디언',
  null,
  1350,
  10000,
  true
from public.seasons season
where season.code = 'gangnam-expedition-1'
  and exists (
    select 1
    from public.venues venue
    where venue.id = 'v1'
      and 'badminton'::public.sport_code = any(venue.sports)
  )
on conflict (code) do update set
  venue_id = excluded.venue_id,
  season_id = excluded.season_id,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  max_hp = excluded.max_hp,
  starting_damage = excluded.starting_damage,
  damage_per_match = excluded.damage_per_match,
  champion_profile_id = null,
  champion_name = null,
  champion_points = 0,
  settled_at = null,
  sport = excluded.sport,
  boss_name = excluded.boss_name,
  boss_avatar_url = excluded.boss_avatar_url,
  boss_rating = excluded.boss_rating,
  win_rate_bps = excluded.win_rate_bps,
  challenge_enabled = excluded.challenge_enabled,
  updated_at = now();

alter table public.boss_challenges enable row level security;

drop policy if exists boss_challenges_own_read on public.boss_challenges;
create policy boss_challenges_own_read
  on public.boss_challenges for select to authenticated
  using (profile_id = auth.uid());

revoke all privileges on table public.boss_challenges
  from public, anon, authenticated;
grant select on table public.boss_challenges to authenticated;
grant all privileges on table public.boss_challenges to service_role;

revoke all on function public.enforce_boss_raider_requires_win()
  from public, anon, authenticated;
revoke all on function public.enforce_no_active_boss_challenge_on_queue()
  from public, anon, authenticated;
revoke all on function public.process_gameplay_match(uuid)
  from public, anon, authenticated;
revoke all on function public.start_my_boss_challenge(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_my_boss_challenge(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_gameplay_summary()
  from public, anon;

grant execute on function public.process_gameplay_match(uuid) to service_role;
grant execute on function public.start_my_boss_challenge(uuid) to authenticated;
grant execute on function public.resolve_my_boss_challenge(uuid) to authenticated;
grant execute on function public.get_my_gameplay_summary() to authenticated;

comment on table public.boss_challenges is
  'Server-resolved, badminton-only NPC boss attempts; never used for ELO or normal match history.';
comment on function public.start_my_boss_challenge(uuid) is
  'Starts or resumes the caller direct badminton NPC boss challenge.';
comment on function public.resolve_my_boss_challenge(uuid) is
  'Server-resolves one owned boss challenge and grants boss_raider only on victory.';
