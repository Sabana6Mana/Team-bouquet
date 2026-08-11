-- Harden the non-payment match lifecycle used by the competition MVP.
-- This migration intentionally replaces the affected RPCs so a fresh database
-- and an upgraded database enforce exactly the same server-side rules.

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

  -- Store one canonical representation so semantically identical votes such as
  -- `21 - 18` and `21-18` can reach consensus.
  new.score := normalized_score;
  return new;
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
  normalized_score text := nullif(
    regexp_replace(coalesce(p_score, ''), '[[:space:]]+', '', 'g'),
    ''
  );
begin
  if actor_id is null or not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can vote on a result';
  end if;

  select * into target_match
  from public.matches
  where id = p_match_id
  for update;

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
  values (p_match_id, actor_id, p_winner_team, normalized_score)
  on conflict (match_id, user_id) do update
    set winner_team = excluded.winner_team,
        score = excluded.score,
        updated_at = now();

  select count(*) into member_count
  from public.match_members
  where match_id = p_match_id;

  select count(*) into agreeing_count
  from public.result_votes
  where match_id = p_match_id
    and winner_team = p_winner_team
    and score is not distinct from normalized_score;

  if member_count = target_match.capacity and agreeing_count = member_count then
    is_consensus := true;

    insert into public.player_ratings (profile_id, sport)
    select member.user_id, target_match.sport
    from public.match_members member
    where member.match_id = p_match_id
    on conflict (profile_id, sport) do nothing;

    perform 1
    from public.player_ratings rating
    join public.match_members member
      on member.user_id = rating.profile_id and member.match_id = p_match_id
    where rating.sport = target_match.sport
    order by rating.profile_id
    for update of rating;

    select
      avg(rating.rating) filter (where member.team = 'a'),
      avg(rating.rating) filter (where member.team = 'b')
    into average_a, average_b
    from public.match_members member
    join public.player_ratings rating
      on rating.profile_id = member.user_id and rating.sport = target_match.sport
    where member.match_id = p_match_id;

    if average_a is null or average_b is null then
      raise exception using errcode = '55000', message = 'Both teams must contain rated members';
    end if;

    expected_a := 1.0 / (1.0 + power(10.0, (average_b - average_a) / 400.0));
    delta_a := round(
      32.0 * ((case when p_winner_team = 'a' then 1.0 else 0.0 end) - expected_a)
    );

    update public.match_members member
    set rating_before = rating.rating,
        rating_delta = case when member.team = 'a' then delta_a else -delta_a end,
        rating_after = greatest(
          100,
          rating.rating + case when member.team = 'a' then delta_a else -delta_a end
        )
    from public.player_ratings rating
    where member.match_id = p_match_id
      and rating.profile_id = member.user_id
      and rating.sport = target_match.sport;

    insert into public.rating_events (
      match_id, profile_id, sport, rating_before, delta, rating_after
    )
    select
      match_id,
      user_id,
      target_match.sport,
      rating_before,
      rating_delta,
      rating_after
    from public.match_members
    where match_id = p_match_id
    on conflict (match_id, profile_id, sport) do nothing;

    update public.player_ratings rating
    set rating = member.rating_after,
        wins = rating.wins + case when member.team = p_winner_team then 1 else 0 end,
        losses = rating.losses + case when member.team = p_winner_team then 0 else 1 end,
        played = rating.played + 1
    from public.match_members member
    where member.match_id = p_match_id
      and member.user_id = rating.profile_id
      and rating.sport = target_match.sport;

    update public.matches
    set winner_team = p_winner_team,
        score = normalized_score,
        finalized_at = now()
    where id = p_match_id and finalized_at is null;

    update public.venue_slots
    set status = 'booked'
    where id = target_match.confirmed_slot_id and reserved_match_id = p_match_id;

    insert into public.notifications (user_id, title, body, link)
    select member.user_id,
      '결과 확정!',
      case
        when member.team = p_winner_team then '승리가 기록되었습니다.'
        else '경기 결과가 기록되었습니다.'
      end,
      '/result'
    from public.match_members member
    where member.match_id = p_match_id;
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

  -- A crashed browser must not leave a matchable queue row forever. Retrying
  -- after the TTL transparently expires the old row and creates a fresh one.
  update public.queue_entries
  set status = 'canceled', canceled_at = coalesce(canceled_at, now())
  where user_id = actor_id
    and status = 'waiting'
    and created_at <= now() - interval '15 minutes';

  -- A shared match enters `done` when the first member acknowledges the result,
  -- so completed_at (not only the shared phase) decides who may queue again.
  if exists (
    select 1
    from public.match_members mm
    join public.matches m on m.id = mm.match_id
    where mm.user_id = actor_id
      and (
        m.phase not in ('done', 'canceled')
        or (m.phase = 'done' and mm.completed_at is null)
      )
  ) then
    raise exception using errcode = '55000', message = 'You already have an active match';
  end if;

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
    select 1
    from public.venues v
    where v.id = p_venue_id and v.active and p_sport = any(v.sports)
  ) then
    raise exception using errcode = '22023', message = 'Venue is inactive or does not support this sport';
  end if;
  if p_venue_id is not null and not exists (
    select 1
    from public.venue_slots slot
    where slot.venue_id = p_venue_id
      and slot.status = 'open'
      and slot.starts_at > now()
  ) then
    raise exception using errcode = '22023', message = 'Venue has no future open slots';
  end if;
  if p_venue_id is null and p_lat is null then
    raise exception using errcode = '22023', message = 'Coordinates are required for quick matching';
  end if;

  -- One lock per sport/mode/venue pool keeps expiry and claiming atomic.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(':', 'matchpoint', p_sport::text, p_mode::text, coalesce(p_venue_id, 'quick')),
      0
    )
  );

  update public.queue_entries q
  set status = 'canceled', canceled_at = coalesce(q.canceled_at, now())
  where q.status = 'waiting'
    and q.sport = p_sport
    and q.mode = p_mode
    and q.quick = (p_venue_id is null)
    and q.venue_id is not distinct from p_venue_id
    and q.created_at <= now() - interval '15 minutes';

  -- Re-check after the pool lock closes the gap with another caller creating a
  -- match or acknowledging a result for this user.
  if exists (
    select 1
    from public.match_members mm
    join public.matches m on m.id = mm.match_id
    where mm.user_id = actor_id
      and (
        m.phase not in ('done', 'canceled')
        or (m.phase = 'done' and mm.completed_at is null)
      )
  ) then
    raise exception using errcode = '55000', message = 'You already have an active match';
  end if;

  insert into public.player_ratings (profile_id, sport)
  values (actor_id, p_sport)
  on conflict (profile_id, sport) do nothing;

  select rating into actor_rating
  from public.player_ratings
  where profile_id = actor_id and sport = p_sport;

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
      and q.created_at > now() - interval '15 minutes'
      and abs(coalesce(r.rating, 1200) - actor_rating) <= 250
      and not exists (
        select 1
        from public.match_members mm
        join public.matches m on m.id = mm.match_id
        where mm.user_id = q.user_id
          and (
            m.phase not in ('done', 'canceled')
            or (m.phase = 'done' and mm.completed_at is null)
          )
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
      select venue_candidate.id into chosen_venue_id
      from public.venues venue_candidate
      cross join lateral (
        select avg(q.lat) as lat, avg(q.lng) as lng
        from public.queue_entries q
        where q.id = any(chosen_queue_ids)
      ) center
      cross join lateral (
        select 6371.0 * 2.0 * asin(
          sqrt(
            least(
              1.0,
              greatest(
                0.0,
                power(sin(radians(venue_candidate.lat - center.lat) / 2.0), 2)
                + cos(radians(center.lat)) * cos(radians(venue_candidate.lat))
                  * power(sin(radians(venue_candidate.lng - center.lng) / 2.0), 2)
              )
            )
          )
        ) as distance_km
      ) proximity
      where venue_candidate.active
        and p_sport = any(venue_candidate.sports)
        and proximity.distance_km <= 5.0
        and exists (
          select 1
          from public.venue_slots slot
          where slot.venue_id = venue_candidate.id
            and slot.status = 'open'
            and slot.starts_at > now()
        )
      order by proximity.distance_km, venue_candidate.id
      limit 1;
    end if;

    -- With no safe venue the users remain in the queue instead of being sent to
    -- an arbitrary distant venue or trapped in a slot-less match.
    if chosen_venue_id is not null then
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
  end if;

  select to_jsonb(q) into entry_json
  from public.queue_entries q
  where q.id = entry_id;

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

  -- Normal cancellation is allowed while coordinating, and for a confirmed
  -- match only until its reserved start. Played/reporting matches must use a
  -- separate forfeit or dispute flow so a participant cannot erase a loss.
  select match.id, match.confirmed_slot_id
  into active_match_id, active_slot_id
  from public.matches match
  join public.match_members member on member.match_id = match.id
  left join public.venue_slots slot on slot.id = match.confirmed_slot_id
  where member.user_id = actor_id
    and match.finalized_at is null
    and (
      match.phase in ('queue', 'scheduling', 'teaming', 'payment')
      or (match.phase = 'confirmed' and slot.starts_at > now())
    )
  order by match.created_at desc, match.id desc
  limit 1
  for update of match;

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
  select member.user_id,
    '매칭이 취소되었습니다',
    case
      when member.user_id = actor_id then '요청에 따라 매칭을 취소했습니다.'
      else '참가자 한 명이 나가 매칭이 취소되었습니다.'
    end,
    '/'
  from public.match_members member
  where member.match_id = active_match_id;

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

  select * into target_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if target_match.phase <> 'scheduling' then
    raise exception using errcode = '55000', message = 'This match is not scheduling';
  end if;
  if not exists (
    select 1
    from public.venue_slots slot
    where slot.id = p_venue_slot_id
      and slot.venue_id = target_match.venue_id
      and slot.status = 'open'
      and slot.starts_at > now()
  ) then
    raise exception using errcode = '22023', message = 'Slot is unavailable or belongs to another venue';
  end if;

  insert into public.slot_votes (match_id, user_id, venue_slot_id)
  values (p_match_id, actor_id, p_venue_slot_id)
  on conflict (match_id, user_id) do update
    set venue_slot_id = excluded.venue_slot_id, updated_at = now();

  select count(*) into member_count
  from public.match_members
  where match_id = p_match_id;

  select count(*) into agreeing_count
  from public.slot_votes
  where match_id = p_match_id and venue_slot_id = p_venue_slot_id;

  if member_count = target_match.capacity and agreeing_count = member_count then
    consensus := true;
    next_phase := case
      when target_match.mode = '1v1' then 'payment'::public.match_phase
      else 'teaming'::public.match_phase
    end;

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
    from public.match_members
    where match_id = p_match_id;
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

-- Browser clients can no longer bypass validation by inserting chat rows
-- directly. Lifecycle functions retain owner-level access for system messages.
revoke insert on table public.chat_messages from anon, authenticated;
revoke insert (match_id, sender_id, body, system) on public.chat_messages from anon, authenticated;

create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_body text := btrim(p_body);
  target_phase public.match_phase;
  last_message_at timestamptz;
  message_count integer;
  saved_message public.chat_messages%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if normalized_body is null or char_length(normalized_body) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Message must contain between 1 and 1000 characters';
  end if;
  if not public.is_match_member(p_match_id) then
    raise exception using errcode = '42501', message = 'Only match members can send messages';
  end if;

  -- The match row serializes quota checks and message inserts across every
  -- participant, and orders a concurrent cancellation before or after the send.
  select phase into target_phase
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found';
  end if;
  if target_phase not in ('scheduling', 'teaming', 'payment', 'confirmed', 'reporting') then
    raise exception using errcode = '55000', message = 'Chat is closed for this match';
  end if;

  select max(created_at) into last_message_at
  from public.chat_messages
  where match_id = p_match_id and sender_id = actor_id;

  if last_message_at is not null and last_message_at > now() - interval '3 seconds' then
    raise exception using errcode = '55000', message = '메시지는 3초에 한 번 보낼 수 있습니다.';
  end if;

  select count(*)::integer into message_count
  from public.chat_messages
  where match_id = p_match_id;

  if message_count >= 5000 then
    raise exception using errcode = '54000', message = '이 경기의 채팅 메시지 한도에 도달했습니다.';
  end if;

  insert into public.chat_messages (match_id, sender_id, body, system)
  values (p_match_id, actor_id, normalized_body, false)
  returning * into saved_message;

  return saved_message;
end;
$$;

revoke all on function public.normalize_result_vote_score()
  from public, anon, authenticated;

revoke all on function public.join_match_queue(
  public.sport_code, public.match_mode, text, double precision, double precision
) from public, anon;
revoke all on function public.cancel_match_queue() from public, anon;
revoke all on function public.vote_match_slot(uuid, uuid) from public, anon;
revoke all on function public.vote_match_result(uuid, public.team_side, text)
  from public, anon;
revoke all on function public.send_match_message(uuid, text)
  from public, anon, authenticated;

grant execute on function public.join_match_queue(
  public.sport_code, public.match_mode, text, double precision, double precision
) to authenticated;
grant execute on function public.cancel_match_queue() to authenticated;
grant execute on function public.vote_match_slot(uuid, uuid) to authenticated;
grant execute on function public.vote_match_result(uuid, public.team_side, text)
  to authenticated;
grant execute on function public.send_match_message(uuid, text) to authenticated;

comment on function public.send_match_message(uuid, text) is
  'Sends one rate-limited message to an active match and returns the saved chat row.';
