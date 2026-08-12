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
      timeout: 75_000,
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
const url = process.env.VITE_SUPABASE_URL
  || process.env.SUPABASE_URL
  || envFile.VITE_SUPABASE_URL
  || local.API_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || envFile.VITE_SUPABASE_PUBLISHABLE_KEY
  || envFile.VITE_SUPABASE_ANON_KEY
  || local.PUBLISHABLE_KEY
  || local.ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY
  || local.SERVICE_ROLE_KEY
  || local.SECRET_KEY

if (!url || !key || !serviceKey) {
  console.error('Supabase 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 `npm run supabase:start` 후 다시 실행하세요.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-acceptance-${name}`,
    },
  })
}

const admin = client('admin', serviceKey)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function anonymous(name, context) {
  const value = client(name)
  const { data, error } = await value.auth.signInAnonymously()
  if (error) throw error
  assert(data.user, `${name}: 익명 사용자 생성 실패`)
  const actor = { client: value, user: data.user }
  // Register immediately so another concurrent sign-in failure cannot leak it.
  context.actors.push(actor)
  return actor
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

async function requireAcceptanceSchema() {
  const [matches, members] = await Promise.all([
    admin.from('matches').select('acceptance_deadline').limit(1),
    admin.from('match_members').select('accepted_at').limit(1),
  ])
  if (matches.error || members.error) {
    const detail = matches.error?.message || members.error?.message
    throw new Error(`최신 match acceptance migration이 적용되지 않았습니다: ${detail}`)
  }
}

async function createFixture(context) {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  startsAt.setUTCMinutes(0, 0, 0)
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)

  const venue = {
    id: context.venueId,
    name: `수락 검증 체육관 ${context.runId}`,
    sports: ['badminton'],
    address: '검증 전용 미래 슬롯',
    lat: 37.4979,
    lng: 127.0276,
    price_per_hour: 20000,
    active: true,
  }
  const venueResult = await admin.from('venues').insert(venue)
  if (venueResult.error) throw new Error(`검증 체육관 생성 실패: ${venueResult.error.message}`)

  const { data: slot, error: slotError } = await admin
    .from('venue_slots')
    .insert({
      venue_id: context.venueId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'open',
      price: 20000,
    })
    .select('id')
    .single()
  if (slotError) throw new Error(`검증 미래 슬롯 생성 실패: ${slotError.message}`)
  context.slotId = slot.id
}

async function saveProfilesAndRatings(actors, context) {
  for (const [index, actor] of actors.entries()) {
    await rpc(actor.client, 'save_my_profile', {
      p_nickname: `ac${context.runId.slice(-8)}${index + 1}`,
      p_interests: ['badminton'],
      p_avatar_url: null,
    })
  }

  const firstPool = actors.slice(0, 2).map((actor) => actor.user.id)
  const expiryPool = actors.slice(2, 4).map((actor) => actor.user.id)
  const updates = await Promise.all([
    admin.from('player_ratings').update({ rating: context.firstPoolRating })
      .in('profile_id', firstPool).eq('sport', 'badminton'),
    admin.from('player_ratings').update({ rating: context.expiryPoolRating })
      .in('profile_id', expiryPool).eq('sport', 'badminton'),
  ])
  for (const result of updates) {
    if (result.error) throw new Error(`검증 매칭 풀 격리 실패: ${result.error.message}`)
  }
}

function queueArgs(context) {
  return {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: context.venueId,
    p_lat: null,
    p_lng: null,
  }
}

async function formMatch(context, firstActor, secondActor) {
  const args = queueArgs(context)
  const first = await rpc(firstActor.client, 'join_match_queue', args)
  assert(first.status === 'waiting', '첫 번째 참가자는 waiting 상태여야 합니다.')

  const retry = await rpc(firstActor.client, 'join_match_queue', args)
  assert(
    retry.queue_entry?.id === first.queue_entry?.id,
    '매칭 전 같은 사용자의 큐 재시도가 멱등하지 않습니다.',
  )

  const second = await rpc(secondActor.client, 'join_match_queue', args)
  assert(second.status === 'matched' && second.match_id, '두 번째 참가 후 매칭이 성사되지 않았습니다.')
  context.matchIds.add(second.match_id)
  return second.match_id
}

async function matchSnapshot(matchId) {
  const { data, error } = await admin
    .from('matches')
    .select('id, phase, acceptance_deadline')
    .eq('id', matchId)
    .single()
  if (error) throw new Error(`매치 상태 조회 실패: ${error.message}`)
  return data
}

async function memberSnapshots(matchId) {
  const { data, error } = await admin
    .from('match_members')
    .select('user_id, accepted_at')
    .eq('match_id', matchId)
    .order('user_id')
  if (error) throw new Error(`수락 상태 조회 실패: ${error.message}`)
  return data ?? []
}

async function verifyInitialAcceptance(matchId) {
  const [match, members] = await Promise.all([
    matchSnapshot(matchId),
    memberSnapshots(matchId),
  ])
  assert(match.phase === 'queue', '새 매치가 5분 수락 단계(queue)로 시작하지 않았습니다.')
  assert(match.acceptance_deadline, '새 매치에 수락 마감 시각이 없습니다.')
  const remainingMs = new Date(match.acceptance_deadline).getTime() - Date.now()
  assert(remainingMs > 0, '새 매치의 수락 마감 시각이 이미 지났습니다.')
  assert(remainingMs <= 5 * 60 * 1000 + 15_000, '수락 마감이 5분보다 과도하게 깁니다.')
  assert(members.length === 2, '1v1 매치의 참가자 수가 2명이 아닙니다.')
  assert(members.every((member) => member.accepted_at === null), '매치 생성 시 accepted_at이 비어 있지 않습니다.')
}

async function verifyDirectUpdateBlocked(actor, matchId) {
  const direct = await actor.client
    .from('match_members')
    .update({ accepted_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('user_id', actor.user.id)
    .select('accepted_at')
  assert(
    direct.error || (direct.data ?? []).length === 0,
    '브라우저의 accepted_at 직접 UPDATE가 거부되지 않았습니다.',
  )
  const members = await memberSnapshots(matchId)
  const own = members.find((member) => member.user_id === actor.user.id)
  assert(own?.accepted_at === null, '직접 UPDATE 시도로 accepted_at이 실제 변경되었습니다.')
}

async function verifyHappyPath(context, a, b, outsider) {
  const matchId = await formMatch(context, a, b)
  await verifyInitialAcceptance(matchId)

  const { data: matchedQueues, error: queueError } = await admin
    .from('queue_entries')
    .select('user_id, status, match_id')
    .eq('match_id', matchId)
  if (queueError) throw queueError
  assert(
    matchedQueues.length === 2 && matchedQueues.every((entry) => entry.status === 'matched'),
    '성사된 매치의 큐 행이 matched 상태가 아닙니다.',
  )

  await verifyDirectUpdateBlocked(a, matchId)
  await expectRpcError(
    outsider.client,
    'accept_match',
    { p_match_id: matchId },
    '비참가자가 매칭을 수락할 수 있습니다.',
  )
  await expectRpcError(
    a.client,
    'vote_match_slot',
    { p_match_id: matchId, p_venue_slot_id: context.slotId },
    '수락 완료 전에 시간 투표가 허용되었습니다.',
  )

  const firstAccept = await rpc(a.client, 'accept_match', { p_match_id: matchId })
  assert(firstAccept.accepted === true, '첫 수락이 성공으로 처리되지 않았습니다.')
  assert(firstAccept.all_accepted === false, '한 명만 수락했는데 전원 수락으로 처리되었습니다.')
  assert(firstAccept.accepted_count === 1 && firstAccept.phase === 'queue', '첫 수락 후 집계나 단계가 잘못되었습니다.')
  const acceptedOnce = (await memberSnapshots(matchId))
    .find((member) => member.user_id === a.user.id)?.accepted_at
  assert(acceptedOnce, '첫 수락 후 accepted_at이 기록되지 않았습니다.')

  const retry = await rpc(a.client, 'accept_match', { p_match_id: matchId })
  assert(retry.accepted === true && retry.accepted_count === 1, '첫 수락의 동일 재시도가 멱등하지 않습니다.')
  assert(retry.all_accepted === false && retry.phase === 'queue', '수락 재시도가 단계를 잘못 전환했습니다.')
  const acceptedAfterRetry = (await memberSnapshots(matchId))
    .find((member) => member.user_id === a.user.id)?.accepted_at
  assert(acceptedAfterRetry === acceptedOnce, '수락 재시도가 기존 accepted_at을 덮어썼습니다.')

  const secondAccept = await rpc(b.client, 'accept_match', { p_match_id: matchId })
  assert(secondAccept.accepted === true && secondAccept.all_accepted === true, '둘째 수락 후 전원 수락이 되지 않았습니다.')
  assert(secondAccept.accepted_count === 2 && secondAccept.phase === 'scheduling', '둘째 수락 후 scheduling으로 전환되지 않았습니다.')

  const [scheduled, acceptedMembers] = await Promise.all([
    matchSnapshot(matchId),
    memberSnapshots(matchId),
  ])
  assert(scheduled.phase === 'scheduling', 'DB의 매치 단계가 scheduling이 아닙니다.')
  assert(acceptedMembers.every((member) => member.accepted_at), '전원 수락 후 accepted_at이 누락되었습니다.')

  console.log('✓ 5분 수락 초기 상태/투표 가드/비참가자·직접 UPDATE 차단')
  console.log('✓ 첫 수락 재시도 멱등성과 둘째 수락 scheduling 전환')
}

async function verifyExpiryPath(context, c, d) {
  const matchId = await formMatch(context, c, d)
  await verifyInitialAcceptance(matchId)

  const deadlineResult = await admin
    .from('matches')
    .update({ acceptance_deadline: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', matchId)
    .eq('phase', 'queue')
  if (deadlineResult.error) throw new Error(`수락 마감 과거 설정 실패: ${deadlineResult.error.message}`)

  const results = await Promise.all([
    rpc(c.client, 'expire_match_acceptance', { p_match_id: matchId }),
    rpc(d.client, 'expire_match_acceptance', { p_match_id: matchId }),
  ])
  assert(results.every((result) => result.phase === 'canceled'), '동시 만료 호출의 최종 단계가 canceled가 아닙니다.')
  assert(results.filter((result) => result.expired === true).length === 1, '동시 만료 호출이 정확히 한 번만 상태를 변경하지 않았습니다.')
  assert(results.filter((result) => result.expired === false).length === 1, '동시 만료 재시도가 성공적인 no-op이 아닙니다.')

  const expiredMatch = await matchSnapshot(matchId)
  assert(expiredMatch.phase === 'canceled', '만료된 매치가 canceled 상태가 아닙니다.')
  const expiredMembers = await memberSnapshots(matchId)
  assert(expiredMembers.every((member) => member.accepted_at === null), '만료 경로에서 accepted_at이 임의 생성되었습니다.')

  await expectRpcError(
    c.client,
    'accept_match',
    { p_match_id: matchId },
    '만료되어 취소된 매치를 다시 수락할 수 있습니다.',
  )

  const { data: oldQueues, error: oldQueueError } = await admin
    .from('queue_entries')
    .select('user_id, status, canceled_at')
    .eq('match_id', matchId)
  if (oldQueueError) throw oldQueueError
  assert(oldQueues.length === 2, '만료된 매치의 기존 큐 행 수가 잘못되었습니다.')
  assert(
    oldQueues.every((entry) => entry.status === 'canceled' && entry.canceled_at),
    '만료된 매치의 matched 큐 행이 canceled로 정리되지 않았습니다.',
  )

  for (const actor of [c, d]) {
    const rejoined = await rpc(actor.client, 'join_match_queue', queueArgs(context))
    assert(rejoined.status === 'waiting' && rejoined.queue_entry?.id, '만료 후 큐에 다시 진입할 수 없습니다.')
    const canceled = await rpc(actor.client, 'cancel_match_queue')
    assert(canceled === true, '재진입한 검증 큐를 취소하지 못했습니다.')
  }

  const { data: activeQueues, error: activeQueueError } = await admin
    .from('queue_entries')
    .select('id')
    .in('user_id', [c.user.id, d.user.id])
    .in('status', ['waiting', 'matched'])
  if (activeQueueError) throw activeQueueError
  assert(activeQueues.length === 0, '만료 검증 후 활성 큐 행이 남았습니다.')

  console.log('✓ 동시 만료 호출 멱등/매치 취소/만료 후 수락 차단')
  console.log('✓ matched 큐 정리와 두 사용자 재진입 가능')
}

async function moveAcceptanceDeadlineToPast(matchId, label) {
  const result = await admin
    .from('matches')
    .update({ acceptance_deadline: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', matchId)
    .eq('phase', 'queue')
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
}

async function assertExpiredMatchAndQueues(matchId, label) {
  const [match, queues] = await Promise.all([
    matchSnapshot(matchId),
    admin
      .from('queue_entries')
      .select('user_id, status, canceled_at')
      .eq('match_id', matchId),
  ])
  if (queues.error) throw new Error(`${label} 큐 조회 실패: ${queues.error.message}`)
  assert(match.phase === 'canceled', `${label}: 기한 지난 매치가 canceled가 아닙니다.`)
  assert((queues.data ?? []).length === 2, `${label}: 기존 matched 큐 행 수가 잘못되었습니다.`)
  assert(
    (queues.data ?? []).every((entry) => entry.status === 'canceled' && entry.canceled_at),
    `${label}: 기존 matched 큐가 canceled로 정리되지 않았습니다.`,
  )
}

async function rejoinAndCancelIndividually(context, actors, label) {
  for (const actor of actors) {
    const rejoined = await rpc(actor.client, 'join_match_queue', queueArgs(context))
    assert(
      rejoined.status === 'waiting' && rejoined.queue_entry?.id,
      `${label}: 만료 정리 후 큐에 다시 진입할 수 없습니다.`,
    )
    assert(
      await rpc(actor.client, 'cancel_match_queue') === true,
      `${label}: 재진입한 큐를 취소하지 못했습니다.`,
    )
  }
}

async function verifyOverdueCleanupPaths(context, c, d) {
  const explicitMatchId = await formMatch(context, c, d)
  await moveAcceptanceDeadlineToPast(explicitMatchId, '본인 만료 정리용 마감 시각 이동 실패')

  const cleanupResult = await rpc(c.client, 'expire_my_overdue_acceptances')
  assert(cleanupResult?.expired_count === 1, '본인 만료 정리 RPC가 정확히 한 매치를 취소하지 않았습니다.')
  assert(
    Array.isArray(cleanupResult?.match_ids) && cleanupResult.match_ids.includes(explicitMatchId),
    '본인 만료 정리 RPC 응답에 취소된 매치 ID가 없습니다.',
  )
  await assertExpiredMatchAndQueues(explicitMatchId, '본인 만료 정리 RPC')
  await rejoinAndCancelIndividually(context, [c, d], '본인 만료 정리 RPC')

  const lazyMatchId = await formMatch(context, c, d)
  await moveAcceptanceDeadlineToPast(lazyMatchId, '새 큐 지연 만료용 마감 시각 이동 실패')

  const rejoined = await rpc(c.client, 'join_match_queue', queueArgs(context))
  assert(
    rejoined.status === 'waiting' && rejoined.match_id === null && rejoined.queue_entry?.id,
    '새 큐 진입이 기한 지난 수락 매치를 정리하고 waiting 큐를 만들지 못했습니다.',
  )
  await assertExpiredMatchAndQueues(lazyMatchId, '새 큐 진입 지연 만료 정리')
  assert(await rpc(c.client, 'cancel_match_queue') === true, '지연 만료 후 새 waiting 큐 정리에 실패했습니다.')
  await rejoinAndCancelIndividually(context, [d], '새 큐 진입 지연 만료 정리')

  console.log('✓ expire_my_overdue_acceptances 응답/매치·matched 큐 원자 정리')
  console.log('✓ 기한 지난 수락 매치의 새 join 지연 정리/두 사용자 재큐 가능')
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
  if (userIds.length > 0) {
    await attempt('정리 대상 매치 탐색', async () => {
      const [members, queues] = await Promise.all([
        admin.from('match_members').select('match_id').in('user_id', userIds),
        admin.from('queue_entries').select('match_id').in('user_id', userIds),
      ])
      if (members.error) throw members.error
      if (queues.error) throw queues.error
      for (const row of members.data ?? []) context.matchIds.add(row.match_id)
      for (const row of queues.data ?? []) {
        if (row.match_id) context.matchIds.add(row.match_id)
      }
    })
  }

  if (context.matchIds.size > 0) {
    await attempt('검증 매치 삭제', () =>
      admin.from('matches').delete().in('id', [...context.matchIds]),
    )
  }
  if (userIds.length > 0) {
    await attempt('검증 큐 삭제', () =>
      admin.from('queue_entries').delete().in('user_id', userIds),
    )
  }
  await attempt('검증 체육관과 슬롯 삭제', () =>
    admin.from('venues').delete().eq('id', context.venueId),
  )
  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () =>
      admin.auth.admin.deleteUser(userId),
    )
  }

  if (context.matchIds.size > 0) {
    await attempt('검증 매치 잔존 확인', async () => {
      const result = await admin.from('matches').select('id').in('id', [...context.matchIds])
      if (result.error) throw result.error
      assert((result.data ?? []).length === 0, '삭제되지 않은 검증 매치가 있습니다.')
    })
  }
  if (userIds.length > 0) {
    await attempt('검증 사용자와 큐 잔존 확인', async () => {
      const [profiles, queues] = await Promise.all([
        admin.from('profiles').select('id').in('id', userIds),
        admin.from('queue_entries').select('id').in('user_id', userIds),
      ])
      if (profiles.error) throw profiles.error
      if (queues.error) throw queues.error
      assert((profiles.data ?? []).length === 0, '삭제되지 않은 테스트 프로필이 있습니다.')
      assert((queues.data ?? []).length === 0, '삭제되지 않은 테스트 큐가 있습니다.')
    })
    for (const userId of userIds) {
      await attempt(`auth 사용자 ${userId} 잔존 확인`, async () => {
        const result = await admin.auth.admin.getUserById(userId)
        assert(result.error || !result.data?.user, '삭제되지 않은 auth 사용자가 있습니다.')
      })
    }
  }
  await attempt('검증 체육관과 슬롯 잔존 확인', async () => {
    const [venues, slots] = await Promise.all([
      admin.from('venues').select('id').eq('id', context.venueId),
      context.slotId
        ? admin.from('venue_slots').select('id').eq('id', context.slotId)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (venues.error) throw venues.error
    if (slots.error) throw slots.error
    assert((venues.data ?? []).length === 0, '삭제되지 않은 검증 체육관이 있습니다.')
    assert((slots.data ?? []).length === 0, '삭제되지 않은 검증 슬롯이 있습니다.')
  })

  if (failures.length > 0) {
    throw new Error(`수락 검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
  }
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const context = {
  runId,
  venueId: `verify-accept-${runId}`,
  slotId: null,
  actors: [],
  matchIds: new Set(),
  firstPoolRating: 21000,
  expiryPoolRating: 22000,
}

let failure = null
try {
  console.log(`MATCHPOINT 5분 매칭 수락 검증 시작 (${url})`)
  await requireAcceptanceSchema()
  await createFixture(context)

  const actors = await Promise.all([
    anonymous(`happy-a-${runId}`, context),
    anonymous(`happy-b-${runId}`, context),
    anonymous(`expiry-c-${runId}`, context),
    anonymous(`expiry-d-${runId}`, context),
  ])
  await saveProfilesAndRatings(actors, context)

  const [a, b, c, d] = actors
  await verifyHappyPath(context, a, b, c)
  await verifyExpiryPath(context, c, d)
  await verifyOverdueCleanupPaths(context, c, d)
} catch (error) {
  failure = error
} finally {
  try {
    await cleanup(context)
    console.log('✓ 검증 데이터 완전 정리')
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], '검증과 정리가 모두 실패했습니다.')
      : cleanupError
  }
}

if (failure) throw failure
console.log(`검증 성공: ${runId}`)
