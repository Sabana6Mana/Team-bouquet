import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function dotenvFile() {
  try {
    const path = fileURLToPath(new URL('../.env.local', import.meta.url))
    return Object.fromEntries(
      readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]] : []
      }),
    )
  } catch {
    return {}
  }
}

function localSupabaseEnv() {
  try {
    const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url))
    const output = execFileSync(process.execPath, [cli, 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    })
    return Object.fromEntries(
      output.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
        return match ? [[match[1], match[2].replace(/"$/, '')]] : []
      }),
    )
  } catch {
    return {}
  }
}

const envFile = dotenvFile()
const configuredUrl = process.env.VITE_SUPABASE_URL
  || process.env.SUPABASE_URL
  || envFile.VITE_SUPABASE_URL
const configuredKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || envFile.VITE_SUPABASE_PUBLISHABLE_KEY
  || envFile.VITE_SUPABASE_ANON_KEY
const configuredServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY
const local = configuredUrl && configuredKey && configuredServiceKey ? {} : localSupabaseEnv()
const url = configuredUrl || local.API_URL
const key = configuredKey || local.PUBLISHABLE_KEY || local.ANON_KEY
const serviceKey = configuredServiceKey || local.SERVICE_ROLE_KEY || local.SECRET_KEY

if (!url || !key || !serviceKey) {
  console.error('Supabase 사람 보스 매칭 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 Docker Desktop과 `npm run supabase:start`를 먼저 실행하세요.')
  console.error('원격은 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-human-boss-verify-${name}`,
    },
  })
}

const admin = client('admin', serviceKey)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function rpc(value, functionName, args = {}) {
  const { data, error } = await value.rpc(functionName, args)
  if (error) throw new Error(`${functionName}: ${error.message}`)
  return data
}

async function expectRpcError(value, functionName, args, message) {
  const { error } = await value.rpc(functionName, args)
  assert(error, message)
  return error
}

async function anonymous(name, context) {
  const value = client(name)
  const { data, error } = await value.auth.signInAnonymously()
  if (error) throw error
  assert(data.user && data.session, `${name}: 익명 사용자 생성 실패`)
  const actor = { client: value, user: data.user }
  context.actors.push(actor)
  return actor
}

function assertBossMatch(value, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: 객체 응답이 아닙니다.`)
  for (const keyName of [
    'match_id', 'event_id', 'venue_id', 'boss_profile_id', 'boss_nickname',
    'boss_avatar_url', 'boss_rating', 'phase', 'acceptance_deadline', 'reused',
  ]) {
    assert(Object.hasOwn(value, keyName), `${label}: ${keyName} 필드가 없습니다.`)
  }
  assert(typeof value.match_id === 'string', `${label}: match_id가 잘못되었습니다.`)
  assert(typeof value.event_id === 'string' && typeof value.venue_id === 'string', `${label}: 이벤트 식별자가 잘못되었습니다.`)
  assert(typeof value.boss_profile_id === 'string', `${label}: boss_profile_id가 잘못되었습니다.`)
  assert(typeof value.boss_nickname === 'string' && value.boss_nickname.length > 0, `${label}: 보스 닉네임이 잘못되었습니다.`)
  assert(value.boss_avatar_url === null || typeof value.boss_avatar_url === 'string', `${label}: 보스 아바타가 잘못되었습니다.`)
  assert(Number.isInteger(value.boss_rating) && value.boss_rating >= 100, `${label}: 보스 ELO가 잘못되었습니다.`)
  assert(value.phase === 'queue', `${label}: 생성 직후 phase가 queue가 아닙니다.`)
  assert(typeof value.acceptance_deadline === 'string', `${label}: acceptance_deadline이 없습니다.`)
  assert(Number.isFinite(Date.parse(value.acceptance_deadline)), `${label}: acceptance_deadline이 날짜가 아닙니다.`)
  assert(typeof value.reused === 'boolean', `${label}: reused가 boolean이 아닙니다.`)
  return value
}

async function createFutureSlot(context, venueId, offsetMinutes) {
  const startsAt = new Date(Date.now() + offsetMinutes * 60_000)
  const slot = await requireData(
    await admin
      .from('venue_slots')
      .insert({
        venue_id: venueId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
        status: 'open',
        price: 0,
      })
      .select('id, venue_id, starts_at, ends_at, status')
      .single(),
    '미래 체육관 슬롯 생성 실패',
  )
  context.slotIds.add(slot.id)
  return slot
}

async function createBossEvent(context, options) {
  const {
    code,
    venueId,
    bossProfileId = null,
    startsOffsetSeconds = -3600,
  } = options
  const now = Date.now()
  const event = await requireData(
    await admin
      .from('venue_boss_events')
      .insert({
        code,
        venue_id: venueId,
        starts_at: new Date(now + startsOffsetSeconds * 1000).toISOString(),
        ends_at: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
        max_hp: 1,
        starting_damage: 0,
        damage_per_match: 1,
        sport: 'badminton',
        boss_name: '검증용 사람 보스',
        boss_avatar_url: null,
        boss_rating: 1600,
        win_rate_bps: 5000,
        challenge_enabled: true,
        boss_profile_id: bossProfileId,
      })
      .select('id, code, venue_id, sport, boss_profile_id')
      .single(),
    '사람 보스 이벤트 생성 실패',
  )
  context.bossEventIds.add(event.id)
  return event
}

async function createOrdinaryMatch(context, venueId, first, second) {
  const match = await requireData(
    await admin
      .from('matches')
      .insert({
        venue_id: venueId,
        sport: 'badminton',
        mode: '1v1',
        capacity: 2,
        host_id: first.user.id,
        phase: 'scheduling',
        quick: false,
      })
      .select('id, phase, acceptance_deadline, boss_event_id, boss_challenger_id, boss_profile_id')
      .single(),
    '일반 1v1 매치 생성 실패',
  )
  context.matchIds.add(match.id)
  await requireData(
    await admin.from('match_members').insert([
      { match_id: match.id, user_id: first.user.id, team: 'a', is_host: true },
      { match_id: match.id, user_id: second.user.id, team: 'b', is_host: false },
    ]),
    '일반 1v1 참가자 생성 실패',
  )
  return match
}

async function rating(profileId) {
  return requireData(
    await admin
      .from('player_ratings')
      .select('profile_id, sport, rating, wins, losses, played')
      .eq('profile_id', profileId)
      .eq('sport', 'badminton')
      .single(),
    '배드민턴 ELO 조회 실패',
  )
}

async function ratingEvents(matchId) {
  return requireData(
    await admin
      .from('rating_events')
      .select('match_id, profile_id, sport, rating_before, delta, rating_after')
      .eq('match_id', matchId)
      .order('profile_id'),
    'ELO 이벤트 조회 실패',
  )
}

async function bossTitleRows(profileId) {
  return requireData(
    await admin
      .from('player_achievements')
      .select('profile_id, achievement_code, progress, unlocked_at, unlocked_match_id')
      .eq('profile_id', profileId)
      .eq('achievement_code', 'boss_raider'),
    'boss_raider 조회 실패',
  )
}

async function assertNoBossTitle(profileId, label) {
  const rows = await bossTitleRows(profileId)
  assert(
    rows.length === 0 || rows.every((row) => row.progress === 0 && row.unlocked_at === null),
    `${label}: boss_raider가 잘못 지급되었습니다.`,
  )
}

async function playNormalLifecycle(options) {
  const { matchId, first, second, slot, winnerTeam, score = '21-18' } = options

  const firstAcceptance = await rpc(first.client, 'accept_match', { p_match_id: matchId })
  assert(firstAcceptance.accepted === true && firstAcceptance.all_accepted === false, '첫 수락 응답이 잘못되었습니다.')
  const secondAcceptance = await rpc(second.client, 'accept_match', { p_match_id: matchId })
  assert(secondAcceptance.all_accepted === true && secondAcceptance.phase === 'scheduling', '두 번째 수락 후 일정 단계로 가지 않았습니다.')

  const firstVote = await rpc(first.client, 'vote_match_slot', {
    p_match_id: matchId,
    p_venue_slot_id: slot.id,
  })
  assert(firstVote.consensus === false && firstVote.phase === 'scheduling', '첫 시간 투표 응답이 잘못되었습니다.')
  const secondVote = await rpc(second.client, 'vote_match_slot', {
    p_match_id: matchId,
    p_venue_slot_id: slot.id,
  })
  assert(secondVote.consensus === true && secondVote.phase === 'payment', '시간 합의 후 payment 단계가 아닙니다.')

  const firstAttendance = await rpc(first.client, 'confirm_match_attendance', { p_match_id: matchId })
  assert(firstAttendance.all_confirmed === false, '한 명 확인만으로 경기가 확정되었습니다.')
  const secondAttendance = await rpc(second.client, 'confirm_match_attendance', { p_match_id: matchId })
  assert(secondAttendance.all_confirmed === true && secondAttendance.phase === 'confirmed', '두 명 확인 후 confirmed가 아닙니다.')

  const endedAt = new Date(Date.now() - 60_000)
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000)
  await requireData(
    await admin
      .from('venue_slots')
      .update({ starts_at: startedAt.toISOString(), ends_at: endedAt.toISOString() })
      .eq('id', slot.id),
    '경기 종료 시각 이동 실패',
  )

  const reporting = await rpc(first.client, 'open_match_reporting', { p_match_id: matchId })
  assert(reporting.phase === 'reporting', '종료 후 reporting 단계가 열리지 않았습니다.')

  const firstResult = await rpc(first.client, 'vote_match_result', {
    p_match_id: matchId,
    p_winner_team: winnerTeam,
    p_score: score,
  })
  assert(firstResult.consensus === false, '첫 결과 투표만으로 결과가 확정되었습니다.')
  const secondResult = await rpc(second.client, 'vote_match_result', {
    p_match_id: matchId,
    p_winner_team: winnerTeam,
    p_score: score.replace('-', ' - '),
  })
  assert(secondResult.consensus === true, '같은 승패·점수가 만장일치로 확정되지 않았습니다.')

  const finalized = await requireData(
    await admin
      .from('matches')
      .select('id, phase, winner_team, score, finalized_at, confirmed_slot_id')
      .eq('id', matchId)
      .single(),
    '확정 경기 조회 실패',
  )
  assert(finalized.winner_team === winnerTeam && finalized.score === score, '확정 승패·점수가 잘못되었습니다.')
  assert(finalized.finalized_at && finalized.confirmed_slot_id === slot.id, '확정 시각 또는 예약 슬롯이 없습니다.')
  return finalized
}

async function completeMatch(first, second, matchId) {
  const firstComplete = await rpc(first.client, 'complete_match', { p_match_id: matchId })
  assert(firstComplete.remaining_members === 1, '첫 결과 확인 후 남은 인원이 1명이 아닙니다.')
  const secondComplete = await rpc(second.client, 'complete_match', { p_match_id: matchId })
  assert(secondComplete.remaining_members === 0 && secondComplete.phase === 'done', '두 결과 확인 후 done이 아닙니다.')
}

async function cleanup(context) {
  const failures = []
  const attempt = async (label, operation) => {
    try {
      const result = await operation()
      if (result?.error) throw result.error
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  await Promise.all(context.actors.map((actor) =>
    attempt(`사용자 ${actor.user.id} 로그아웃`, () => actor.client.auth.signOut()),
  ))

  const userIds = context.actors.map((actor) => actor.user.id)
  const matchIds = [...context.matchIds]
  const eventIds = [...context.bossEventIds]

  if (eventIds.length > 0) {
    await attempt('사람 보스 증거 삭제', () => admin.from('boss_challenges').delete().in('event_id', eventIds))
  }
  if (matchIds.length > 0) {
    await attempt('게임 결과 삭제', () => admin.from('gameplay_member_outcomes').delete().in('match_id', matchIds))
    await attempt('보스 기여 삭제', () => admin.from('venue_boss_contributions').delete().in('match_id', matchIds))
    await attempt('보스 타격 삭제', () => admin.from('venue_boss_match_hits').delete().in('match_id', matchIds))
    await attempt('체육관 크레딧 삭제', () => admin.from('venue_gameplay_credits').delete().in('match_id', matchIds))
    await attempt('게임 원장 삭제', () => admin.from('gameplay_match_events').delete().in('match_id', matchIds))
  }
  if (userIds.length > 0) {
    await attempt('체육관 도감 삭제', () => admin.from('venue_collection_entries').delete().in('profile_id', userIds))
    await attempt('테스트 큐 삭제', () => admin.from('queue_entries').delete().in('user_id', userIds))
  }
  if (matchIds.length > 0) {
    await attempt('테스트 매치 삭제', () => admin.from('matches').delete().in('id', matchIds))
  }
  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () => admin.auth.admin.deleteUser(userId))
  }
  if (eventIds.length > 0) {
    await attempt('테스트 보스 이벤트 삭제', () => admin.from('venue_boss_events').delete().in('id', eventIds))
  }
  if (context.venueIds.size > 0) {
    await attempt('테스트 체육관 삭제', () => admin.from('venues').delete().in('id', [...context.venueIds]))
  }
  if (context.regionCodes.size > 0) {
    await attempt('테스트 지역 삭제', () => admin.from('regions').delete().in('code', [...context.regionCodes]))
  }

  const residual = await Promise.all([
    matchIds.length > 0 ? admin.from('matches').select('id').in('id', matchIds) : Promise.resolve({ data: [], error: null }),
    eventIds.length > 0 ? admin.from('boss_challenges').select('id').in('event_id', eventIds) : Promise.resolve({ data: [], error: null }),
    eventIds.length > 0 ? admin.from('venue_boss_events').select('id').in('id', eventIds) : Promise.resolve({ data: [], error: null }),
    userIds.length > 0 ? admin.from('profiles').select('id').in('id', userIds) : Promise.resolve({ data: [], error: null }),
  ])
  for (const [index, result] of residual.entries()) {
    if (result.error) failures.push(`잔존 확인 ${index + 1}: ${result.error.message}`)
    else if ((result.data ?? []).length > 0) failures.push(`잔존 확인 ${index + 1}: 테스트 데이터가 남았습니다.`)
  }

  if (failures.length > 0) throw new Error(`검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
}

async function runVerification(context) {
  const { runId } = context
  const suffix = runId.slice(-7)
  const regionCode = `verify-human-boss-${runId}`
  const venueId = `verify-human-boss-${runId}`
  context.regionCodes.add(regionCode)
  context.venueIds.add(venueId)

  await requireData(
    await admin.from('regions').insert({
      code: regionCode,
      name: `사람 보스 검증 지역 ${runId}`,
      parent_code: null,
    }),
    '격리된 테스트 지역 생성 실패',
  )
  await requireData(
    await admin.from('venues').insert({
      id: venueId,
      name: `사람 보스 검증 체육관 ${runId}`,
      sports: ['badminton'],
      address: '자동 검증 전용',
      region_code: regionCode,
      lat: 37.5002,
      lng: 127.0402,
      price_per_hour: 0,
      active: true,
    }),
    '격리된 테스트 체육관 생성 실패',
  )

  const actorNames = ['boss', 'winner', 'loser', 'expiry', 'cancel', 'ordinary-a', 'ordinary-b', 'outsider']
  const actors = []
  for (const actorName of actorNames) {
    actors.push(await anonymous(`${actorName}-${runId}`, context))
  }
  const [boss, winner, loser, expiry, canceler, ordinaryA, ordinaryB, outsider] = actors

  for (const [index, actor] of actors.entries()) {
    await rpc(actor.client, 'save_my_profile', {
      p_nickname: `hb${suffix}${index + 1}`,
      p_interests: ['badminton'],
      p_avatar_url: index === 0 ? '/assets/avatars/tiger.webp' : null,
    })
  }
  const ratingSeeds = actors.map((actor, index) => ({
    profile_id: actor.user.id,
    sport: 'badminton',
    rating: index === 0 ? 1600 : 1350 + index * 10,
    wins: 0,
    losses: 0,
    played: 0,
  }))
  await requireData(
    await admin.from('player_ratings').upsert(ratingSeeds, { onConflict: 'profile_id,sport' }),
    '검증 사용자 ELO 초기화 실패',
  )

  const ordinarySlot = await createFutureSlot(context, venueId, 60)
  const winSlot = await createFutureSlot(context, venueId, 180)
  const lossSlot = await createFutureSlot(context, venueId, 300)
  await createFutureSlot(context, venueId, 420)
  await createFutureSlot(context, venueId, 540)

  const unassignedEvent = await createBossEvent(context, {
    code: `verify-human-win-${runId}`,
    venueId,
    startsOffsetSeconds: -3600,
  })
  await expectRpcError(
    winner.client,
    'create_my_boss_match',
    { p_event_id: unassignedEvent.id },
    '지정된 사람 보스가 없는 이벤트에서 매치가 생성되었습니다.',
  )
  const nonBadmintonEvent = await admin.from('venue_boss_events').insert({
    code: `verify-human-tennis-${runId}`,
    venue_id: venueId,
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    max_hp: 1,
    starting_damage: 0,
    damage_per_match: 1,
    sport: 'tennis',
    boss_name: '잘못된 테니스 보스',
    boss_rating: 1600,
    challenge_enabled: true,
    boss_profile_id: boss.user.id,
  })
  assert(nonBadmintonEvent.error, '배드민턴이 아닌 보스 이벤트를 생성할 수 있습니다.')

  const ordinaryMatch = await createOrdinaryMatch(context, venueId, ordinaryA, ordinaryB)
  assert(ordinaryMatch.phase === 'queue' && ordinaryMatch.acceptance_deadline, '일반 매치의 5분 수락 단계가 열리지 않았습니다.')
  assert(
    ordinaryMatch.boss_event_id === null
      && ordinaryMatch.boss_challenger_id === null
      && ordinaryMatch.boss_profile_id === null,
    '일반 1v1에 보스 메타데이터가 붙었습니다.',
  )
  await playNormalLifecycle({
    matchId: ordinaryMatch.id,
    first: ordinaryA,
    second: ordinaryB,
    slot: ordinarySlot,
    winnerTeam: 'a',
    score: '21-16',
  })
  const ordinaryEvents = await ratingEvents(ordinaryMatch.id)
  assert(ordinaryEvents.length === 2, `일반 1v1 ELO 이벤트가 ${ordinaryEvents.length}개입니다.`)
  const ordinaryGameplay = await rpc(ordinaryA.client, 'sync_my_match_gameplay', {
    p_match_id: ordinaryMatch.id,
  })
  assert(
    !ordinaryGameplay.unlocked_achievement_codes.includes('boss_raider'),
    '일반 1v1 gameplay outcome에 boss_raider가 포함되었습니다.',
  )
  await assertNoBossTitle(ordinaryA.user.id, '일반 1v1 승자')
  await assertNoBossTitle(ordinaryB.user.id, '일반 1v1 패자')
  await completeMatch(ordinaryA, ordinaryB, ordinaryMatch.id)

  await requireData(
    await admin
      .from('venue_boss_events')
      .update({ boss_profile_id: boss.user.id })
      .eq('id', unassignedEvent.id),
    '사람 보스 지정 실패',
  )
  await expectRpcError(
    boss.client,
    'create_my_boss_match',
    { p_event_id: unassignedEvent.id },
    '지정된 보스가 자기 자신에게 도전할 수 있습니다.',
  )

  const bossQueue = await rpc(boss.client, 'join_match_queue', {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: venueId,
    p_lat: null,
    p_lng: null,
  })
  assert(bossQueue.status === 'waiting', '사람 보스 availability 검증용 일반 큐 진입에 실패했습니다.')
  await expectRpcError(
    winner.client,
    'create_my_boss_match',
    { p_event_id: unassignedEvent.id },
    '다른 일반 매칭을 기다리는 보스에게 도전할 수 있습니다.',
  )
  assert(await rpc(boss.client, 'cancel_match_queue') === true, '사람 보스 availability 검증 큐 정리에 실패했습니다.')

  const winRatingBefore = await rating(winner.user.id)
  const bossRatingBeforeWin = await rating(boss.user.id)
  const createdResponses = await Promise.all(
    Array.from({ length: 8 }, () => rpc(winner.client, 'create_my_boss_match', {
      p_event_id: unassignedEvent.id,
    })),
  )
  const createdMatches = createdResponses.map((value, index) => assertBossMatch(value, `동시 사람 보스 매치 생성 ${index + 1}`))
  const winMatchIds = new Set(createdMatches.map((row) => row.match_id))
  assert(winMatchIds.size === 1, `동시 생성이 ${winMatchIds.size}개의 매치를 만들었습니다.`)
  assert(createdMatches.filter((row) => row.reused === false).length === 1, '최초 생성 응답이 정확히 한 번이 아닙니다.')
  assert(createdMatches.filter((row) => row.reused === true).length === 7, '동시 재시도가 기존 매치를 반환하지 않았습니다.')
  const winMatchId = createdMatches[0].match_id
  context.matchIds.add(winMatchId)
  assert(createdMatches.every((row) => row.boss_profile_id === boss.user.id), '응답의 사람 보스 ID가 지정 사용자와 다릅니다.')

  const winMatch = await requireData(
    await admin
      .from('matches')
      .select('id, venue_id, sport, mode, capacity, host_id, phase, acceptance_deadline, boss_event_id, boss_challenger_id, boss_profile_id')
      .eq('id', winMatchId)
      .single(),
    '생성된 사람 보스 매치 조회 실패',
  )
  assert(
    winMatch.sport === 'badminton'
      && winMatch.mode === '1v1'
      && winMatch.capacity === 2
      && winMatch.host_id === winner.user.id
      && winMatch.phase === 'queue',
    '사람 보스 매치가 일반 배드민턴 1v1 queue가 아닙니다.',
  )
  assert(
    winMatch.boss_event_id === unassignedEvent.id
      && winMatch.boss_challenger_id === winner.user.id
      && winMatch.boss_profile_id === boss.user.id,
    '매치의 사람 보스 메타데이터가 잘못되었습니다.',
  )
  const deadlineRemaining = Date.parse(winMatch.acceptance_deadline) - Date.now()
  assert(
    deadlineRemaining > 4 * 60_000 && deadlineRemaining <= 5 * 60_000,
    `5분 수락 마감이 잘못되었습니다: ${deadlineRemaining}ms`,
  )

  const winMembers = await requireData(
    await admin
      .from('match_members')
      .select('match_id, user_id, team, is_host, accepted_at')
      .eq('match_id', winMatchId)
      .order('team'),
    '사람 보스 매치 참가자 조회 실패',
  )
  assert(winMembers.length === 2, `사람 보스 매치 참가자가 ${winMembers.length}명입니다.`)
  assert(
    winMembers[0].user_id === winner.user.id
      && winMembers[0].team === 'a'
      && winMembers[0].is_host === true
      && winMembers[1].user_id === boss.user.id
      && winMembers[1].team === 'b'
      && winMembers[1].is_host === false,
    '도전자와 사람 보스가 서로 다른 팀에 정확히 배치되지 않았습니다.',
  )
  const activeChallenges = await requireData(
    await admin
      .from('boss_challenges')
      .select('id, event_id, profile_id, boss_profile_id, match_id, status, challenger_rating, boss_rating')
      .eq('match_id', winMatchId),
    '사람 보스 증거 조회 실패',
  )
  assert(activeChallenges.length === 1 && activeChallenges[0].status === 'active', 'active 보스 증거가 정확히 한 행이 아닙니다.')
  assert(
    activeChallenges[0].profile_id === winner.user.id
      && activeChallenges[0].boss_profile_id === boss.user.id
      && activeChallenges[0].challenger_rating === winRatingBefore.rating
      && activeChallenges[0].boss_rating === bossRatingBeforeWin.rating,
    '보스 증거의 참가자 또는 ELO 스냅샷이 잘못되었습니다.',
  )
  const winChallengeId = activeChallenges[0].id

  const [winnerVisible, bossVisible, outsiderInvisible, outsiderMatchInvisible] = await Promise.all([
    requireData(await winner.client.from('boss_challenges').select('id, status').eq('id', winChallengeId), '도전자 보스 증거 RLS 조회 실패'),
    requireData(await boss.client.from('boss_challenges').select('id, status').eq('id', winChallengeId), '보스 보스 증거 RLS 조회 실패'),
    requireData(await outsider.client.from('boss_challenges').select('id, status').eq('id', winChallengeId), '외부인 보스 증거 RLS 조회 실패'),
    requireData(await outsider.client.from('matches').select('id').eq('id', winMatchId), '외부인 매치 RLS 조회 실패'),
  ])
  assert(winnerVisible.length === 1 && bossVisible.length === 1, '도전자 또는 보스가 자기 보스 증거를 읽지 못합니다.')
  assert(outsiderInvisible.length === 0 && outsiderMatchInvisible.length === 0, '외부인에게 사람 보스 경기 정보가 노출됩니다.')

  const directMatch = await outsider.client.from('matches').insert({
    venue_id: venueId,
    sport: 'badminton',
    mode: '1v1',
    capacity: 2,
    host_id: outsider.user.id,
    phase: 'queue',
    boss_event_id: unassignedEvent.id,
    boss_challenger_id: outsider.user.id,
    boss_profile_id: boss.user.id,
  })
  assert(directMatch.error, '브라우저 사용자가 보스 matches 행을 직접 생성할 수 있습니다.')
  const directChallenge = await outsider.client.from('boss_challenges').insert({
    event_id: unassignedEvent.id,
    profile_id: outsider.user.id,
    boss_profile_id: boss.user.id,
    match_id: winMatchId,
    status: 'active',
    challenger_rating: 1400,
    boss_rating: 1600,
  })
  assert(directChallenge.error, '브라우저 사용자가 보스 증거를 직접 생성할 수 있습니다.')
  const directUpdate = await winner.client.from('boss_challenges').update({ score: '21-0' }).eq('id', winChallengeId)
  assert(directUpdate.error, '브라우저 사용자가 보스 증거를 직접 수정할 수 있습니다.')

  const finalizedWin = await playNormalLifecycle({
    matchId: winMatchId,
    first: winner,
    second: boss,
    slot: winSlot,
    winnerTeam: 'a',
    score: '21-18',
  })
  assert(finalizedWin.finalized_at, '도전자 승리 보스 매치가 확정되지 않았습니다.')

  const [wonChallenge, winnerTitle, winEvents, winMemberRatings, winRatingAfter, bossRatingAfterWin] = await Promise.all([
    requireData(
      await admin.from('boss_challenges').select('id, status, score, resolved_at').eq('id', winChallengeId).single(),
      '승리 보스 증거 조회 실패',
    ),
    bossTitleRows(winner.user.id),
    ratingEvents(winMatchId),
    requireData(
      await admin
        .from('match_members')
        .select('user_id, team, rating_before, rating_delta, rating_after')
        .eq('match_id', winMatchId),
      '보스 매치 참가자 ELO 조회 실패',
    ),
    rating(winner.user.id),
    rating(boss.user.id),
  ])
  assert(wonChallenge.status === 'won' && wonChallenge.score === '21-18' && wonChallenge.resolved_at, '도전자 승리가 won 증거로 동기화되지 않았습니다.')
  assert(winnerTitle.length === 1, `boss_raider 원본이 ${winnerTitle.length}행입니다.`)
  assert(
    winnerTitle[0].progress === 1
      && winnerTitle[0].unlocked_at
      && winnerTitle[0].unlocked_match_id === winMatchId,
    '사람 보스를 이긴 매치가 boss_raider 해금 증거로 연결되지 않았습니다.',
  )
  assert(winEvents.length === 2 && winMemberRatings.length === 2, '사람 보스 경기 ELO 이벤트가 참가자별로 생성되지 않았습니다.')
  assert(winEvents.every((row) => row.sport === 'badminton'), '사람 보스 경기 ELO 종목이 배드민턴이 아닙니다.')
  assert(winEvents.reduce((sum, row) => sum + row.delta, 0) === 0, '사람 보스 경기 ELO 증감 합이 0이 아닙니다.')
  assert(
    winRatingAfter.played === winRatingBefore.played + 1
      && winRatingAfter.wins === winRatingBefore.wins + 1
      && winRatingAfter.rating > winRatingBefore.rating,
    '도전자 승리 ELO/전적이 정상 반영되지 않았습니다.',
  )
  assert(
    bossRatingAfterWin.played === bossRatingBeforeWin.played + 1
      && bossRatingAfterWin.losses === bossRatingBeforeWin.losses + 1
      && bossRatingAfterWin.rating < bossRatingBeforeWin.rating,
    '사람 보스 패배 ELO/전적이 정상 반영되지 않았습니다.',
  )

  const bossSummaryAfterLoss = await rpc(boss.client, 'get_my_gameplay_summary')
  assert(
    bossSummaryAfterLoss?.boss?.event_id === unassignedEvent.id
      && bossSummaryAfterLoss.boss.boss_profile_id === boss.user.id,
    '사람 보스 본인의 게임 요약이 지정된 보스 이벤트를 반환하지 않았습니다.',
  )
  assert(
    bossSummaryAfterLoss.boss.challenge_id === null
      && bossSummaryAfterLoss.boss.match_id === null
      && bossSummaryAfterLoss.boss.defeated === false
      && bossSummaryAfterLoss.boss.title_unlocked === false
      && bossSummaryAfterLoss.boss.title_code === null,
    '사람 보스 본인에게 도전자의 승리 또는 boss_raider 칭호가 귀속되었습니다.',
  )

  const titleNotifications = await requireData(
    await admin
      .from('notifications')
      .select('id, user_id, title, link')
      .eq('user_id', winner.user.id)
      .eq('title', '도전과제 달성! 체육관 보스 격파')
      .eq('link', '/achievements'),
    '보스 칭호 알림 조회 실패',
  )
  assert(titleNotifications.length === 1, `보스 칭호 알림이 ${titleNotifications.length}번 생성되었습니다.`)
  await expectRpcError(
    winner.client,
    'vote_match_result',
    { p_match_id: winMatchId, p_winner_team: 'a', p_score: '21-18' },
    '이미 확정된 보스 매치 결과를 다시 투표할 수 있습니다.',
  )
  const winGameplay = await rpc(winner.client, 'sync_my_match_gameplay', { p_match_id: winMatchId })
  const winGameplayRetry = await rpc(winner.client, 'sync_my_match_gameplay', { p_match_id: winMatchId })
  assert(
    winGameplay.unlocked_achievement_codes.includes('boss_raider')
      && winGameplayRetry.unlocked_achievement_codes.includes('boss_raider'),
    '사람 보스 승리 gameplay outcome에 boss_raider가 없습니다.',
  )
  assert((await bossTitleRows(winner.user.id)).length === 1, '게임 진행도 재동기화가 boss_raider를 중복 생성했습니다.')
  assert((await ratingEvents(winMatchId)).length === 2, '결과 재시도가 ELO 이벤트를 중복 생성했습니다.')
  const equipped = await rpc(winner.client, 'equip_my_title', { p_achievement_code: 'boss_raider' })
  assert(equipped === 'boss_raider', '사람 보스를 이긴 사용자가 칭호를 장착하지 못했습니다.')
  await completeMatch(winner, boss, winMatchId)

  const lossEvent = await createBossEvent(context, {
    code: `verify-human-loss-${runId}`,
    venueId,
    bossProfileId: boss.user.id,
    startsOffsetSeconds: -3500,
  })
  const lossCreated = assertBossMatch(
    await rpc(loser.client, 'create_my_boss_match', { p_event_id: lossEvent.id }),
    '사람 보스 패배 매치 생성',
  )
  context.matchIds.add(lossCreated.match_id)
  const loserRatingBefore = await rating(loser.user.id)
  await playNormalLifecycle({
    matchId: lossCreated.match_id,
    first: loser,
    second: boss,
    slot: lossSlot,
    winnerTeam: 'b',
    score: '15-21',
  })
  const lossChallenge = await requireData(
    await admin.from('boss_challenges').select('status, score, resolved_at').eq('match_id', lossCreated.match_id).single(),
    '패배 보스 증거 조회 실패',
  )
  assert(lossChallenge.status === 'lost' && lossChallenge.score === '15-21', '도전자 패배가 lost로 동기화되지 않았습니다.')
  await assertNoBossTitle(loser.user.id, '사람 보스에게 패배한 도전자')
  const loserRatingAfter = await rating(loser.user.id)
  assert(
    loserRatingAfter.played === loserRatingBefore.played + 1
      && loserRatingAfter.losses === loserRatingBefore.losses + 1
      && loserRatingAfter.rating < loserRatingBefore.rating,
    '보스에게 패배한 도전자의 ELO/전적이 정상 반영되지 않았습니다.',
  )
  assert((await ratingEvents(lossCreated.match_id)).length === 2, '보스 승리 경기의 ELO 이벤트가 2개가 아닙니다.')
  await completeMatch(loser, boss, lossCreated.match_id)

  const cancelEvent = await createBossEvent(context, {
    code: `verify-human-cancel-${runId}`,
    venueId,
    bossProfileId: boss.user.id,
    startsOffsetSeconds: -3400,
  })
  const cancelCreated = assertBossMatch(
    await rpc(canceler.client, 'create_my_boss_match', { p_event_id: cancelEvent.id }),
    '취소할 사람 보스 매치 생성',
  )
  context.matchIds.add(cancelCreated.match_id)
  assert(await rpc(canceler.client, 'cancel_match_queue') === true, '수락 전 사람 보스 매치를 취소하지 못했습니다.')
  const [canceledMatch, canceledChallenge] = await Promise.all([
    requireData(await admin.from('matches').select('phase, finalized_at').eq('id', cancelCreated.match_id).single(), '취소 보스 매치 조회 실패'),
    requireData(await admin.from('boss_challenges').select('status, score, resolved_at').eq('match_id', cancelCreated.match_id).single(), '취소 보스 증거 조회 실패'),
  ])
  assert(canceledMatch.phase === 'canceled' && canceledMatch.finalized_at === null, '취소한 보스 매치가 canceled가 아닙니다.')
  assert(canceledChallenge.status === 'abandoned' && canceledChallenge.score === null && canceledChallenge.resolved_at, '취소한 보스 증거가 abandoned가 아닙니다.')
  assert((await ratingEvents(cancelCreated.match_id)).length === 0, '취소한 보스 매치가 ELO를 변경했습니다.')
  await assertNoBossTitle(canceler.user.id, '보스 매치 취소 사용자')

  const expiryEvent = await createBossEvent(context, {
    code: `verify-human-expiry-${runId}`,
    venueId,
    bossProfileId: boss.user.id,
    startsOffsetSeconds: -3300,
  })
  const expiryCreated = assertBossMatch(
    await rpc(expiry.client, 'create_my_boss_match', { p_event_id: expiryEvent.id }),
    '만료할 사람 보스 매치 생성',
  )
  context.matchIds.add(expiryCreated.match_id)
  await requireData(
    await admin
      .from('matches')
      .update({ acceptance_deadline: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', expiryCreated.match_id),
    '수락 마감 시각 이동 실패',
  )
  const expiryResults = await Promise.all([
    rpc(expiry.client, 'expire_match_acceptance', { p_match_id: expiryCreated.match_id }),
    rpc(boss.client, 'expire_match_acceptance', { p_match_id: expiryCreated.match_id }),
  ])
  assert(expiryResults.filter((row) => row.expired === true).length === 1, '동시 만료가 정확히 한 번만 처리되지 않았습니다.')
  assert(expiryResults.filter((row) => row.expired === false).length === 1, '동시 만료 재시도가 성공적인 no-op이 아닙니다.')
  const [expiredMatch, expiredChallenge] = await Promise.all([
    requireData(await admin.from('matches').select('phase, finalized_at').eq('id', expiryCreated.match_id).single(), '만료 보스 매치 조회 실패'),
    requireData(await admin.from('boss_challenges').select('status, score, resolved_at').eq('match_id', expiryCreated.match_id).single(), '만료 보스 증거 조회 실패'),
  ])
  assert(expiredMatch.phase === 'canceled' && expiredMatch.finalized_at === null, '만료한 보스 매치가 canceled가 아닙니다.')
  assert(expiredChallenge.status === 'abandoned' && expiredChallenge.score === null && expiredChallenge.resolved_at, '만료한 보스 증거가 abandoned가 아닙니다.')
  assert((await ratingEvents(expiryCreated.match_id)).length === 0, '만료한 보스 매치가 ELO를 변경했습니다.')
  await assertNoBossTitle(expiry.user.id, '보스 매치 수락 만료 사용자')

  await expectRpcError(
    winner.client,
    'start_my_boss_challenge',
    { p_event_id: unassignedEvent.id },
    '폐기된 NPC 보스 시작 RPC를 인증 사용자가 호출할 수 있습니다.',
  )
  await expectRpcError(
    winner.client,
    'resolve_my_boss_challenge',
    { p_challenge_id: winChallengeId },
    '폐기된 NPC 보스 해결 RPC를 인증 사용자가 호출할 수 있습니다.',
  )
  const forgedTitle = await admin.from('player_achievements').upsert({
    profile_id: outsider.user.id,
    achievement_code: 'boss_raider',
    progress: 1,
    unlocked_at: new Date().toISOString(),
    unlocked_match_id: ordinaryMatch.id,
  }, { onConflict: 'profile_id,achievement_code' })
  assert(forgedTitle.error, 'service-role도 사람 보스 승리 증거 없이 boss_raider를 위조할 수 있습니다.')
  const browserTitle = await outsider.client.from('player_achievements').insert({
    profile_id: outsider.user.id,
    achievement_code: 'boss_raider',
    progress: 1,
    unlocked_at: new Date().toISOString(),
  })
  assert(browserTitle.error, '브라우저 사용자가 boss_raider를 직접 생성할 수 있습니다.')

  console.log('✓ 지정된 실제 사용자 보스/일반 큐·활성 경기 기반 availability')
  console.log('✓ create_my_boss_match 동시 8회 멱등/일반 1v1 원본 1개')
  console.log('✓ 정확히 2명·반대 팀·보스 메타데이터/5분 수락')
  console.log('✓ 일반 수락→시간 투표→참가 확인→결과 만장일치 흐름 재사용')
  console.log('✓ 도전자 승리 boss_raider 정확히 1회/ELO·rating_events 반영')
  console.log('✓ 보스 승리·일반 1v1 승리에는 boss_raider 미지급')
  console.log('✓ 직접 취소·5분 만료 challenge abandoned/ELO·칭호 미변경')
  console.log('✓ NPC RPC 폐기/직접 쓰기·위조·외부인 RLS 차단')
  console.log(`사람 배드민턴 보스 매칭 검증 성공: ${winMatchId}`)
}

async function main() {
  const context = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    actors: [],
    matchIds: new Set(),
    slotIds: new Set(),
    venueIds: new Set(),
    regionCodes: new Set(),
    bossEventIds: new Set(),
  }
  console.log(`MATCHPOINT 사람 보스 매칭 검증 시작 (${url})`)

  let verificationError = null
  try {
    await runVerification(context)
  } catch (error) {
    verificationError = error
  }

  try {
    await cleanup(context)
    console.log('✓ 사람 보스 검증 데이터 정리 완료')
  } catch (cleanupError) {
    if (verificationError) {
      console.error('검증 중 오류:', verificationError instanceof Error ? verificationError.message : verificationError)
    }
    verificationError = cleanupError
  }

  if (verificationError) throw verificationError
}

main().catch((error) => {
  console.error('사람 보스 매칭 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
