-- Replace the retired NPC boss mini-game with a real, designated human boss.
--
-- A challenge creates an ordinary badminton 1v1 match immediately. Both the
-- challenger and the designated boss then use the existing five-minute match
-- acceptance, scheduling, attendance, reporting, result consensus, ELO, honor,
-- report, and completion lifecycle. The boss title is additional cosmetic
-- evidence granted only when the challenger wins that authoritative match.

alter table public.venue_boss_events
  add column if not exists boss_profile_id uuid
    references public.profiles(id) on delete set null;

alter table public.matches
  add column if not exists boss_event_id uuid
    references public.venue_boss_events(id) on delete restrict,
  add column if not exists boss_challenger_id uuid
    references public.profiles(id) on delete restrict,
  add column if not exists boss_profile_id uuid
    references public.profiles(id) on delete restrict;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_boss_metadata_all_or_none'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_boss_metadata_all_or_none
      check (
        (boss_event_id is null and boss_challenger_id is null and boss_profile_id is null)
        or (
          boss_event_id is not null
          and boss_challenger_id is not null
          and boss_profile_id is not null
          and boss_challenger_id <> boss_profile_id
          and sport = 'badminton'::public.sport_code
          and mode = '1v1'::public.match_mode
          and capacity = 2
        )
      );
  end if;
end
$migration$;

create index if not exists matches_boss_event_idx
  on public.matches (boss_event_id, created_at desc)
  where boss_event_id is not null;

create or replace function public.enforce_boss_match_metadata_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.boss_event_id is distinct from old.boss_event_id
    or new.boss_challenger_id is distinct from old.boss_challenger_id
    or new.boss_profile_id is distinct from old.boss_profile_id
  then
    raise exception using
      errcode = '23514',
      message = 'Boss match identity cannot be changed after creation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_boss_match_metadata_immutable on public.matches;
create trigger enforce_boss_match_metadata_immutable
  before update of boss_event_id, boss_challenger_id, boss_profile_id on public.matches
  for each row execute function public.enforce_boss_match_metadata_immutable();

create index if not exists venue_boss_events_human_boss_idx
  on public.venue_boss_events (boss_profile_id)
  where boss_profile_id is not null;

alter table public.boss_challenges
  add column if not exists match_id uuid
    references public.matches(id) on delete restrict,
  add column if not exists boss_profile_id uuid
    references public.profiles(id) on delete restrict;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'boss_challenges_human_match_pair_valid'
      and conrelid = 'public.boss_challenges'::regclass
  ) then
    alter table public.boss_challenges
      add constraint boss_challenges_human_match_pair_valid
      check (
        (match_id is null and boss_profile_id is null)
        or (
          match_id is not null
          and boss_profile_id is not null
          and profile_id <> boss_profile_id
        )
      );
  end if;
end
$migration$;

create unique index if not exists boss_challenges_human_match_unique
  on public.boss_challenges (match_id)
  where match_id is not null;

drop index if exists public.boss_challenges_boss_active_idx;
create unique index if not exists boss_challenges_one_active_human_per_boss
  on public.boss_challenges (boss_profile_id)
  where boss_profile_id is not null and status = 'active';

create unique index if not exists boss_challenges_one_active_human_per_challenger
  on public.boss_challenges (profile_id)
  where match_id is not null and status = 'active';

-- No NPC attempt may remain as a victory after the NPC RPC is retired. Keep
-- the row as abandoned audit data while releasing the old one-win index for a
-- future verified human match.
update public.boss_challenges
set status = 'abandoned',
    resolved_at = coalesce(resolved_at, now()),
    score = null,
    updated_at = now()
where match_id is null
  and status <> 'abandoned';

update public.achievement_definitions
set name = '체육관 보스 격파',
    description = '지정된 배드민턴 체육관 보스와 실제 1대1 경기를 치러 승리하세요.',
    icon = '🏸',
    title_name = '보스의 천적',
    metric_code = 'external_grant',
    target = 1,
    active = true,
    hidden = false,
    updated_at = now()
where code = 'boss_raider';

-- The old NPC random roll is no longer valid proof. Remove its cosmetic grant;
-- ordinary match/ELO history is untouched. A valid human proof cannot predate
-- this migration, but the NOT EXISTS clauses make recovery replays safe.
update public.profiles profile
set equipped_title_code = null
where profile.equipped_title_code = 'boss_raider'
  and not exists (
    select 1
    from public.boss_challenges challenge
    join public.matches match_value on match_value.id = challenge.match_id
    join public.match_members challenger
      on challenger.match_id = match_value.id
     and challenger.user_id = challenge.profile_id
    join public.match_members boss_member
      on boss_member.match_id = match_value.id
     and boss_member.user_id = challenge.boss_profile_id
    where challenge.profile_id = profile.id
      and challenge.status = 'won'
      and match_value.sport = 'badminton'::public.sport_code
      and match_value.mode = '1v1'::public.match_mode
      and match_value.capacity = 2
      and match_value.finalized_at is not null
      and challenger.team = match_value.winner_team
      and boss_member.team <> challenger.team
  );

delete from public.notifications notification
where notification.user_id is not null
  and notification.link = '/achievements'
  and notification.title like '도전과제 달성!%'
  and notification.body = '칭호 「보스의 천적」을 획득했어요. 프로필에서 장착해 보세요.'
  and not exists (
    select 1
    from public.boss_challenges challenge
    join public.matches match_value on match_value.id = challenge.match_id
    join public.match_members challenger
      on challenger.match_id = match_value.id
     and challenger.user_id = challenge.profile_id
    join public.match_members boss_member
      on boss_member.match_id = match_value.id
     and boss_member.user_id = challenge.boss_profile_id
    where challenge.profile_id = notification.user_id
      and challenge.status = 'won'
      and match_value.sport = 'badminton'::public.sport_code
      and match_value.mode = '1v1'::public.match_mode
      and match_value.capacity = 2
      and match_value.finalized_at is not null
      and challenger.team = match_value.winner_team
      and boss_member.team <> challenger.team
  );

delete from public.player_achievements achievement
where achievement.achievement_code = 'boss_raider'
  and not exists (
    select 1
    from public.boss_challenges challenge
    join public.matches match_value on match_value.id = challenge.match_id
    join public.match_members challenger
      on challenger.match_id = match_value.id
     and challenger.user_id = challenge.profile_id
    join public.match_members boss_member
      on boss_member.match_id = match_value.id
     and boss_member.user_id = challenge.boss_profile_id
    where challenge.profile_id = achievement.profile_id
      and challenge.status = 'won'
      and match_value.sport = 'badminton'::public.sport_code
      and match_value.mode = '1v1'::public.match_mode
      and match_value.capacity = 2
      and match_value.finalized_at is not null
      and challenger.team = match_value.winner_team
      and boss_member.team <> challenger.team
  );

-- Human challenge rows are a projection of one authoritative normal match.
-- This trigger also protects service-role repair scripts from accidentally
-- manufacturing title evidence that does not agree with the match result.
create or replace function public.enforce_human_boss_challenge_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.venue_boss_events%rowtype;
  match_row public.matches%rowtype;
  challenger_team public.team_side;
  boss_team public.team_side;
  member_count integer;
begin
  -- Retained NPC audit rows have neither link. They can never grant a title
  -- after enforce_boss_raider_requires_win is replaced below.
  if new.match_id is null then
    if new.boss_profile_id is not null then
      raise exception using
        errcode = '23514',
        message = 'A human boss profile requires a linked match';
    end if;
    return new;
  end if;

  if new.boss_profile_id is null or new.profile_id = new.boss_profile_id then
    raise exception using
      errcode = '23514',
      message = 'Human boss challenges require two different profiles';
  end if;

  select * into event_row
  from public.venue_boss_events
  where id = new.event_id;

  select * into match_row
  from public.matches
  where id = new.match_id;

  if event_row.id is null or match_row.id is null
    or event_row.sport <> 'badminton'::public.sport_code
    or match_row.sport <> 'badminton'::public.sport_code
    or match_row.mode <> '1v1'::public.match_mode
    or match_row.capacity <> 2
    or match_row.venue_id <> event_row.venue_id
    or match_row.boss_event_id is distinct from new.event_id
    or match_row.boss_challenger_id is distinct from new.profile_id
    or match_row.boss_profile_id is distinct from new.boss_profile_id
  then
    raise exception using
      errcode = '23514',
      message = 'Boss evidence must link one badminton 1v1 match at the event venue';
  end if;

  select member.team into challenger_team
  from public.match_members member
  where member.match_id = new.match_id
    and member.user_id = new.profile_id;

  select member.team into boss_team
  from public.match_members member
  where member.match_id = new.match_id
    and member.user_id = new.boss_profile_id;

  select count(*)::integer into member_count
  from public.match_members member
  where member.match_id = new.match_id;

  if challenger_team is null or boss_team is null
    or challenger_team = boss_team
    or member_count <> 2
  then
    raise exception using
      errcode = '23514',
      message = 'Boss match members must be the challenger and designated boss on opposite teams';
  end if;

  if new.status = 'active' then
    if match_row.finalized_at is not null or match_row.phase = 'canceled' then
      raise exception using
        errcode = '23514',
        message = 'An active boss challenge requires an active unfinalized match';
    end if;
  elsif new.status in ('won', 'lost') then
    if match_row.finalized_at is null or match_row.winner_team is null
      or new.score is distinct from match_row.score
      or (new.status = 'won') <> (challenger_team = match_row.winner_team)
    then
      raise exception using
        errcode = '23514',
        message = 'Boss challenge outcome must equal the finalized match result';
    end if;
  elsif new.status = 'abandoned' and match_row.phase <> 'canceled' then
    raise exception using
      errcode = '23514',
      message = 'A linked boss challenge is abandoned only with a canceled match';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_human_boss_challenge_integrity on public.boss_challenges;
create trigger enforce_human_boss_challenge_integrity
  before insert or update on public.boss_challenges
  for each row execute function public.enforce_human_boss_challenge_integrity();

-- A boss title now requires a persisted human-boss match victory, not merely a
-- status value from the retired NPC mini-game.
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
      join public.venue_boss_events event_value
        on event_value.id = challenge.event_id
      join public.matches match_value
        on match_value.id = challenge.match_id
      join public.match_members challenger
        on challenger.match_id = match_value.id
       and challenger.user_id = challenge.profile_id
      join public.match_members boss_member
        on boss_member.match_id = match_value.id
       and boss_member.user_id = challenge.boss_profile_id
      where challenge.profile_id = new.profile_id
        and challenge.status = 'won'
        and challenge.match_id is not null
        and challenge.boss_profile_id is not null
        and event_value.sport = 'badminton'::public.sport_code
        and match_value.sport = 'badminton'::public.sport_code
        and match_value.mode = '1v1'::public.match_mode
        and match_value.capacity = 2
        and match_value.finalized_at is not null
        and challenger.team = match_value.winner_team
        and boss_member.team <> challenger.team
    )
  then
    raise exception using
      errcode = '23514',
      message = 'boss_raider requires a verified human badminton boss victory';
  end if;

  return new;
end;
$$;

-- Keep challenge status synchronized with every cancellation path and with the
-- unanimous result transaction. Rating updates remain entirely owned by the
-- existing vote_match_result RPC; this trigger only adds cosmetic evidence.
create or replace function public.sync_human_boss_challenge_from_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge_row public.boss_challenges%rowtype;
  challenger_team public.team_side;
begin
  select challenge.* into challenge_row
  from public.boss_challenges challenge
  where challenge.match_id = new.id
  for update;

  if challenge_row.id is null then
    return new;
  end if;

  if new.phase = 'canceled' and challenge_row.status = 'active' then
    update public.boss_challenges
    set status = 'abandoned',
        resolved_at = coalesce(resolved_at, now()),
        score = null,
        updated_at = now()
    where id = challenge_row.id
      and status = 'active';
    return new;
  end if;

  if new.finalized_at is not null
    and new.winner_team is not null
    and challenge_row.status in ('active', 'won', 'lost')
  then
    select member.team into challenger_team
    from public.match_members member
    where member.match_id = new.id
      and member.user_id = challenge_row.profile_id;

    if challenger_team is null then
      raise exception using
        errcode = '23514',
        message = 'Boss challenger is not a match member';
    end if;

    if challenge_row.status = 'active' then
      update public.boss_challenges
      set status = case
            when challenger_team = new.winner_team then 'won'
            else 'lost'
          end,
          score = new.score,
          resolved_at = new.finalized_at,
          updated_at = now()
      where id = challenge_row.id
        and status = 'active';
    end if;

    if challenger_team = new.winner_team then
      begin
        perform public.grant_profile_achievement(
          challenge_row.profile_id,
          'boss_raider',
          new.id
        );
        perform public.refresh_profile_achievements(challenge_row.profile_id, new.id);

        -- process_gameplay_match deliberately excludes boss_raider from ordinary
        -- matches. This authoritative human-boss result is the only path that
        -- appends it, so the existing result reward card can display the unlock.
        update public.gameplay_member_outcomes outcome
        set unlocked_achievement_codes = case
              when 'boss_raider' = any(outcome.unlocked_achievement_codes)
                then outcome.unlocked_achievement_codes
              else array_append(outcome.unlocked_achievement_codes, 'boss_raider')
            end
        where outcome.match_id = new.id
          and outcome.profile_id = challenge_row.profile_id;
      exception when others then
        -- A cosmetic title/notification failure must never roll back the
        -- authoritative result, ELO, or rating events. A later match phase
        -- update (for example completion) retries this idempotent block.
        null;
      end;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_human_boss_challenge_after_match on public.matches;
create trigger sync_human_boss_challenge_after_match
  after update of phase, finalized_at, winner_team on public.matches
  for each row execute function public.sync_human_boss_challenge_from_match();

-- Result gameplay processing may run before or after the match→challenge sync,
-- and a failed enqueue may be retried later. Guard the outcome row itself so
-- every insert/update converges to the verified human-boss reward regardless
-- of trigger name order or retry timing.
create or replace function public.include_verified_boss_reward_in_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.boss_challenges challenge
    join public.matches match_value on match_value.id = challenge.match_id
    join public.match_members challenger
      on challenger.match_id = match_value.id
     and challenger.user_id = challenge.profile_id
    where challenge.match_id = new.match_id
      and challenge.profile_id = new.profile_id
      and challenge.status = 'won'
      and match_value.finalized_at is not null
      and challenger.team = match_value.winner_team
  ) then
    if not ('boss_raider' = any(new.unlocked_achievement_codes)) then
      new.unlocked_achievement_codes := array_append(
        new.unlocked_achievement_codes,
        'boss_raider'
      );
    end if;
  else
    -- A raw service write or a replayed ordinary-match outcome must not carry
    -- the cosmetic reward without authoritative human-boss proof.
    new.unlocked_achievement_codes := array_remove(
      new.unlocked_achievement_codes,
      'boss_raider'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists include_verified_boss_reward_in_outcome
  on public.gameplay_member_outcomes;
create trigger include_verified_boss_reward_in_outcome
  before insert or update of unlocked_achievement_codes
  on public.gameplay_member_outcomes
  for each row execute function public.include_verified_boss_reward_in_outcome();

-- The queue guard from the NPC implementation used a 30-minute mini-game TTL.
-- Human challenges may legitimately last until a future venue reservation, so
-- only a canceled linked match (or a retired unlinked NPC row) is abandoned.
create or replace function public.enforce_no_active_boss_challenge_on_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'waiting' then
    update public.boss_challenges challenge
    set status = 'abandoned',
        resolved_at = coalesce(challenge.resolved_at, now()),
        score = null,
        updated_at = now()
    where challenge.profile_id = new.user_id
      and challenge.status = 'active'
      and (
        challenge.match_id is null
        or exists (
          select 1
          from public.matches match_value
          where match_value.id = challenge.match_id
            and match_value.phase = 'canceled'
        )
      );

    if exists (
      select 1
      from public.boss_challenges challenge
      where (challenge.profile_id = new.user_id or challenge.boss_profile_id = new.user_id)
        and challenge.status = 'active'
    ) then
      raise exception using
        errcode = '55000',
        message = 'Finish the active boss match before joining a match queue';
    end if;
  end if;

  return new;
end;
$$;

-- Create (or idempotently return) the real boss match. The existing
-- prepare_match_acceptance trigger converts the inserted `scheduling` phase to
-- `queue` and assigns the five-minute deadline. No queue-entry fabrication is
-- necessary: the current-match query is authoritative through match_members.
create or replace function public.create_my_boss_match(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  event_row public.venue_boss_events%rowtype;
  boss_id uuid;
  first_lock_id uuid;
  second_lock_id uuid;
  actor_rating_value integer;
  boss_rating_value integer;
  match_row public.matches%rowtype;
  challenge_row public.boss_challenges%rowtype;
  stale_match_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if public.is_profile_permanently_banned(actor_id) then
    raise exception using errcode = '42501', message = 'This account is permanently suspended';
  end if;

  -- Lock the event first so exactly one caller can create a match against the
  -- designated boss at a time.
  select event_value.* into event_row
  from public.venue_boss_events event_value
  where event_value.id = p_event_id
  for update;

  if event_row.id is null then
    raise exception using errcode = 'P0002', message = 'Boss event not found';
  end if;

  boss_id := event_row.boss_profile_id;
  if boss_id is null then
    raise exception using errcode = '55000', message = 'A human boss has not been assigned';
  end if;
  if actor_id = boss_id then
    raise exception using errcode = '22023', message = 'The designated boss cannot challenge themself';
  end if;

  -- Use the matcher's exact per-user lock namespace. Sorting UUID text gives
  -- every concurrent challenger/boss transaction one deadlock-free order.
  if actor_id::text < boss_id::text then
    first_lock_id := actor_id;
    second_lock_id := boss_id;
  else
    first_lock_id := boss_id;
    second_lock_id := actor_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('matchpoint:user:' || first_lock_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('matchpoint:user:' || second_lock_id::text, 0)
  );

  -- Lazily cancel either participant's overdue acceptance. This mirrors
  -- expire_my_overdue_acceptances, including notifications, but is allowed to
  -- clean the designated boss as well as the caller while both user locks hold.
  for stale_match_id in
    select match_value.id
    from public.matches match_value
    where match_value.phase = 'queue'
      and match_value.acceptance_deadline is not null
      and match_value.acceptance_deadline <= now()
      and exists (
        select 1
        from public.match_members member
        where member.match_id = match_value.id
          and member.user_id = any(array[actor_id, boss_id])
      )
    order by match_value.acceptance_deadline, match_value.id
    for update
  loop
    update public.matches
    set phase = 'canceled'
    where id = stale_match_id and phase = 'queue';

    if found then
      update public.queue_entries
      set status = 'canceled',
          canceled_at = coalesce(canceled_at, now())
      where match_id = stale_match_id and status = 'matched';

      insert into public.notifications (user_id, title, body, link)
      select member.user_id,
        '매칭 수락 시간이 끝났습니다',
        '전원이 5분 안에 수락하지 않아 매칭이 취소되었습니다.',
        '/'
      from public.match_members member
      where member.match_id = stale_match_id;
    end if;
  end loop;

  -- A transport retry returns the same active/won challenge.
  select challenge.* into challenge_row
  from public.boss_challenges challenge
  where challenge.event_id = p_event_id
    and challenge.profile_id = actor_id
    and challenge.match_id is not null
    and challenge.status in ('won', 'active')
  order by case challenge.status when 'won' then 0 else 1 end,
           challenge.started_at desc,
           challenge.id
  limit 1
  for update;

  if challenge_row.id is not null then
    select * into match_row
    from public.matches
    where id = challenge_row.match_id;

    return jsonb_build_object(
      'match_id', challenge_row.match_id,
      'event_id', challenge_row.event_id,
      'venue_id', event_row.venue_id,
      'boss_profile_id', challenge_row.boss_profile_id,
      'boss_nickname', (
        select profile.nickname
        from public.profiles profile
        where profile.id = challenge_row.boss_profile_id
      ),
      'boss_avatar_url', (
        select profile.avatar_url
        from public.profiles profile
        where profile.id = challenge_row.boss_profile_id
      ),
      'boss_rating', challenge_row.boss_rating,
      'phase', match_row.phase,
      'acceptance_deadline', match_row.acceptance_deadline,
      'reused', true
    );
  end if;

  if not event_row.challenge_enabled
    or event_row.sport <> 'badminton'::public.sport_code
    or now() < event_row.starts_at
    or now() >= event_row.ends_at
  then
    raise exception using errcode = '55000', message = 'This human boss event is not active';
  end if;
  if public.is_profile_permanently_banned(boss_id) then
    raise exception using errcode = '55000', message = 'The designated boss is unavailable';
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
  if not exists (
    select 1
    from public.venue_slots slot
    where slot.venue_id = event_row.venue_id
      and slot.status = 'open'
      and slot.starts_at > now()
  ) then
    raise exception using errcode = '55000', message = 'The boss venue has no future open slots';
  end if;

  if exists (
    select 1
    from public.queue_entries queue
    where queue.user_id = any(array[actor_id, boss_id])
      and queue.status = 'waiting'
  ) then
    raise exception using errcode = '55000', message = 'A participant is already waiting in another match queue';
  end if;

  if exists (
    select 1
    from public.match_members member
    join public.matches match_value on match_value.id = member.match_id
    where member.user_id = any(array[actor_id, boss_id])
      and (
        match_value.phase not in ('done', 'canceled')
        or (match_value.phase = 'done' and member.completed_at is null)
      )
  ) then
    raise exception using errcode = '55000', message = 'A participant already has an active match';
  end if;

  insert into public.player_ratings (profile_id, sport)
  values
    (actor_id, 'badminton'::public.sport_code),
    (boss_id, 'badminton'::public.sport_code)
  on conflict (profile_id, sport) do nothing;

  select rating.rating into actor_rating_value
  from public.player_ratings rating
  where rating.profile_id = actor_id
    and rating.sport = 'badminton'::public.sport_code;

  select rating.rating into boss_rating_value
  from public.player_ratings rating
  where rating.profile_id = boss_id
    and rating.sport = 'badminton'::public.sport_code;

  insert into public.matches (
    venue_id,
    sport,
    mode,
    capacity,
    host_id,
    phase,
    quick,
    boss_event_id,
    boss_challenger_id,
    boss_profile_id
  ) values (
    event_row.venue_id,
    'badminton'::public.sport_code,
    '1v1'::public.match_mode,
    2,
    actor_id,
    'scheduling'::public.match_phase,
    false,
    p_event_id,
    actor_id,
    boss_id
  )
  returning * into match_row;

  -- The trigger above has already normalized phase to queue and assigned the
  -- deadline by the time RETURNING runs.
  insert into public.match_members (match_id, user_id, team, is_host)
  values
    (match_row.id, actor_id, 'a'::public.team_side, true),
    (match_row.id, boss_id, 'b'::public.team_side, false);

  insert into public.boss_challenges (
    event_id,
    profile_id,
    boss_profile_id,
    match_id,
    status,
    challenger_rating,
    boss_rating
  ) values (
    p_event_id,
    actor_id,
    boss_id,
    match_row.id,
    'active',
    actor_rating_value,
    boss_rating_value
  )
  returning * into challenge_row;

  update public.venue_boss_events
  set boss_rating = boss_rating_value,
      updated_at = now()
  where id = p_event_id;

  insert into public.chat_messages (match_id, sender_id, body, system)
  values (
    match_row.id,
    null,
    '도전자와 체육관 보스가 만났습니다. 두 사람 모두 5분 안에 매칭을 수락해 주세요.',
    true
  );

  insert into public.notifications (user_id, title, body, link)
  values
    (actor_id, '보스전 매칭 성사!', '5분 안에 수락해 주세요.', '/queue'),
    (boss_id, '보스 도착!', '도전자가 기다리고 있습니다. 5분 안에 수락해 주세요.', '/queue');

  return jsonb_build_object(
    'match_id', match_row.id,
    'event_id', challenge_row.event_id,
    'venue_id', event_row.venue_id,
    'boss_profile_id', boss_id,
    'boss_nickname', (
      select profile.nickname
      from public.profiles profile
      where profile.id = boss_id
    ),
    'boss_avatar_url', (
      select profile.avatar_url
      from public.profiles profile
      where profile.id = boss_id
    ),
    'boss_rating', boss_rating_value,
    'phase', match_row.phase,
    'acceptance_deadline', match_row.acceptance_deadline,
    'reused', false
  );
exception
  when unique_violation then
    -- Concurrent calls are serialized by event/user locks, but preserve a
    -- stable domain error if an operator changes assignments mid-transaction.
    raise exception using
      errcode = '23505',
      message = 'A boss challenge or active match already exists';
end;
$$;

-- Wrap the existing summary instead of copying its collection/season logic.
-- The legacy function remains private and supplies only the non-boss sections.
alter function public.get_my_gameplay_summary()
  rename to get_my_gameplay_summary_npc_legacy;

revoke all on function public.get_my_gameplay_summary_npc_legacy()
  from public, anon, authenticated;

create function public.get_my_gameplay_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  summary_value jsonb;
  event_id_value uuid;
  boss_json jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  summary_value := public.get_my_gameplay_summary_npc_legacy();
  event_id_value := nullif(summary_value #>> '{boss,event_id}', '')::uuid;

  if event_id_value is null then
    return summary_value;
  end if;

  select jsonb_build_object(
    'event_id', event_value.id,
    'venue_id', event_value.venue_id,
    'sport', event_value.sport,
    'boss_profile_id', event_value.boss_profile_id,
    'boss_name', coalesce(boss_profile.nickname, event_value.boss_name),
    'boss_avatar_url', coalesce(boss_profile.avatar_url, event_value.boss_avatar_url),
    'boss_rating', coalesce(boss_rating.rating, event_value.boss_rating),
    'challenge_id', challenge.id,
    'challenge_status', challenge.status,
    'match_id', challenge.match_id,
    'match_phase', challenge_match.phase,
    'acceptance_deadline', challenge_match.acceptance_deadline,
    'can_challenge',
      event_value.boss_profile_id is not null
      and actor_id <> event_value.boss_profile_id
      and event_value.challenge_enabled
      and now() >= event_value.starts_at
      and now() < event_value.ends_at
      and coalesce(challenge.status, '') <> 'won'
      and not public.is_profile_permanently_banned(actor_id)
      and not public.is_profile_permanently_banned(event_value.boss_profile_id)
      and not exists (
        select 1
        from public.queue_entries queue
        where queue.user_id = any(array[actor_id, event_value.boss_profile_id])
          and queue.status = 'waiting'
      )
      and not exists (
        select 1
        from public.match_members member
        join public.matches match_value on match_value.id = member.match_id
        where member.user_id = any(array[actor_id, event_value.boss_profile_id])
          and (
            match_value.phase not in ('done', 'canceled')
            or (match_value.phase = 'done' and member.completed_at is null)
          )
      ),
    'title_code', case when title_state.unlocked then 'boss_raider' else null end,
    'title_unlocked', title_state.unlocked,
    'max_hp', 1,
    'remaining_hp', case when challenge.status = 'won' then 0 else 1 end,
    'damage_per_match', 1,
    'ends_at', event_value.ends_at,
    'my_contribution', case when challenge.status = 'won' then 1 else 0 end,
    'throne_name', null,
    'throne_points', 0,
    'defeated', coalesce(challenge.status = 'won', false)
  )
  into boss_json
  from public.venue_boss_events event_value
  left join public.profiles boss_profile
    on boss_profile.id = event_value.boss_profile_id
  left join public.player_ratings boss_rating
    on boss_rating.profile_id = event_value.boss_profile_id
   and boss_rating.sport = 'badminton'::public.sport_code
  left join lateral (
    select saved.*
    from public.boss_challenges saved
    where saved.event_id = event_value.id
      and saved.profile_id = actor_id
      and saved.match_id is not null
    order by
      case saved.status when 'active' then 0 when 'won' then 1 else 2 end,
      saved.started_at desc,
      saved.id
    limit 1
  ) challenge on true
  left join public.matches challenge_match
    on challenge_match.id = challenge.match_id
  cross join lateral (
    select exists (
      select 1
      from public.player_achievements achievement
      where achievement.profile_id = actor_id
        and achievement.achievement_code = 'boss_raider'
        and achievement.unlocked_at is not null
    ) as unlocked
  ) title_state
  where event_value.id = event_id_value;

  return jsonb_set(
    summary_value,
    '{boss}',
    coalesce(boss_json, 'null'::jsonb),
    true
  );
end;
$$;

-- Retire client access to the random NPC mini-game RPCs. Keeping their
-- definitions avoids breaking historical migrations while making them
-- unreachable from every API role.
revoke all on function public.start_my_boss_challenge(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_my_boss_challenge(uuid)
  from public, anon, authenticated, service_role;

alter table public.boss_challenges enable row level security;

drop policy if exists boss_challenges_own_read on public.boss_challenges;
drop policy if exists boss_challenges_participant_read on public.boss_challenges;
create policy boss_challenges_participant_read
  on public.boss_challenges for select to authenticated
  using (profile_id = auth.uid() or boss_profile_id = auth.uid());

revoke all privileges on table public.boss_challenges
  from public, anon, authenticated;
grant select on table public.boss_challenges to authenticated;
grant all privileges on table public.boss_challenges to service_role;

revoke all on function public.enforce_human_boss_challenge_integrity()
  from public, anon, authenticated;
revoke all on function public.enforce_boss_match_metadata_immutable()
  from public, anon, authenticated;
revoke all on function public.enforce_boss_raider_requires_win()
  from public, anon, authenticated;
revoke all on function public.sync_human_boss_challenge_from_match()
  from public, anon, authenticated;
revoke all on function public.include_verified_boss_reward_in_outcome()
  from public, anon, authenticated;
revoke all on function public.enforce_no_active_boss_challenge_on_queue()
  from public, anon, authenticated;
revoke all on function public.create_my_boss_match(uuid)
  from public, anon;
revoke all on function public.get_my_gameplay_summary()
  from public, anon;

grant execute on function public.create_my_boss_match(uuid)
  to authenticated;
grant execute on function public.get_my_gameplay_summary()
  to authenticated;

comment on column public.venue_boss_events.boss_profile_id is
  'Designated human boss profile. NULL means this event is not challengeable.';
comment on column public.boss_challenges.match_id is
  'Authoritative normal badminton 1v1 match used as human boss evidence.';
comment on function public.create_my_boss_match(uuid) is
  'Creates or idempotently returns a real 1v1 badminton match against the designated human boss.';
