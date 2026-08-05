import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

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

const local = localSupabaseEnv()
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || local.API_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || local.PUBLISHABLE_KEY
  || local.ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY
  || local.SERVICE_ROLE_KEY
  || local.SECRET_KEY

if (!url || !key || !serviceKey) {
  console.error('Supabase 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 `npm run supabase:start` 후 다시 실행하세요.')
  console.error('원격 프로젝트는 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY를 설정해야 합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `matchpoint-verify-${name}` },
  })
}

const admin = client('admin', serviceKey)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function anonymous(name) {
  const value = client(name)
  const { data, error } = await value.auth.signInAnonymously()
  if (error) throw error
  assert(data.user, `${name}: 익명 사용자 생성 실패`)
  return { client: value, user: data.user }
}

async function rpc(value, functionName, args = {}) {
  const { data, error } = await value.rpc(functionName, args)
  if (error) throw new Error(`${functionName}: ${error.message}`)
  return data
}

async function expectRpcError(value, functionName, args, message) {
  const { error } = await value.rpc(functionName, args)
  assert(error, message)
}

const fixedQueue = {
  p_sport: 'badminton', p_mode: '1v1', p_venue_id: 'v1', p_lat: null, p_lng: null,
}

async function availableSlot(value, venueId) {
  const { data, error } = await value
    .from('venue_slots')
    .select('id')
    .eq('venue_id', venueId)
    .eq('status', 'open')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(1)
  if (error) throw error
  assert(data?.[0]?.id, `${venueId}: 검증에 사용할 예약 가능 슬롯이 없습니다.`)
  return data[0].id
}

async function formMatch(firstActor, secondActor, queueArgs = fixedQueue) {
  const first = await rpc(firstActor.client, 'join_match_queue', queueArgs)
  assert(first.status === 'waiting', '첫 번째 사용자는 waiting 상태여야 합니다.')
  const retry = await rpc(firstActor.client, 'join_match_queue', queueArgs)
  assert(retry.queue_entry?.id === first.queue_entry?.id, '동일 사용자의 큐 재시도가 멱등하지 않습니다.')

  const second = await rpc(secondActor.client, 'join_match_queue', queueArgs)
  assert(second.match_id, '두 번째 참가 후 match_id가 생성되지 않았습니다.')
  return second.match_id
}

async function main() {
  const runId = Date.now().toString(36)
  console.log(`MATCHPOINT MVP 검증 시작 (${url})`)

  const actors = await Promise.all([
    anonymous(`a-${runId}`),
    anonymous(`b-${runId}`),
    anonymous(`outsider-${runId}`),
  ])
  const [a, b, outsider] = actors

  for (const [index, actor] of actors.entries()) {
    const { error } = await actor.client
      .from('profiles')
      .update({ nickname: `verify-${runId}-${index + 1}`, interests: ['badminton'] })
      .eq('id', actor.user.id)
    if (error) throw error
  }

  const forbiddenProfileWrite = await a.client
    .from('profiles')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', a.user.id)
  assert(forbiddenProfileWrite.error, '프로필의 서버 관리 컬럼을 사용자가 변경할 수 있습니다.')

  const matchId = await formMatch(a, b)

  await expectRpcError(
    a.client,
    'join_match_queue',
    fixedQueue,
    '활성 매치 참가자의 새 큐 진입이 차단되지 않았습니다.',
  )

  const { data: outsiderView, error: outsiderError } = await outsider.client
    .from('matches')
    .select('id')
    .eq('id', matchId)
  if (outsiderError) throw outsiderError
  assert(outsiderView.length === 0, '비참가자가 매칭을 조회할 수 있습니다. RLS를 확인하세요.')

  const hiddenReservation = await outsider.client
    .from('venue_slots')
    .select('reserved_match_id')
    .limit(1)
  assert(hiddenReservation.error, 'venue_slots.reserved_match_id가 브라우저에 노출됩니다.')

  const forbiddenSystemMessage = await a.client.from('chat_messages').insert({
    match_id: matchId,
    sender_id: a.user.id,
    body: 'forbidden system message',
    system: true,
  })
  assert(forbiddenSystemMessage.error, '사용자가 시스템 메시지를 생성할 수 있습니다.')

  const slotId = await availableSlot(a.client, 'v1')
  await rpc(a.client, 'vote_match_slot', { p_match_id: matchId, p_venue_slot_id: slotId })
  const slotConsensus = await rpc(b.client, 'vote_match_slot', {
    p_match_id: matchId, p_venue_slot_id: slotId,
  })
  assert(slotConsensus.consensus === true && slotConsensus.phase === 'payment', '시간 투표 합의가 payment 단계로 전환되지 않았습니다.')

  await rpc(a.client, 'confirm_match_attendance', { p_match_id: matchId })
  const attendance = await rpc(b.client, 'confirm_match_attendance', { p_match_id: matchId })
  assert(attendance.all_confirmed === true && attendance.phase === 'confirmed', '전원 참가 확정이 confirmed 단계로 전환되지 않았습니다.')

  await expectRpcError(
    a.client,
    'open_match_reporting',
    { p_match_id: matchId },
    '예약 종료 전에 결과 입력이 열렸습니다.',
  )

  const endedAt = new Date(Date.now() - 60_000)
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000)
  const { error: clockError } = await admin
    .from('venue_slots')
    .update({ starts_at: startedAt.toISOString(), ends_at: endedAt.toISOString() })
    .eq('id', slotId)
  if (clockError) throw new Error(`검증 슬롯 종료 처리 실패: ${clockError.message}`)

  const reporting = await rpc(a.client, 'open_match_reporting', { p_match_id: matchId })
  assert(reporting.phase === 'reporting', '예약 종료 후 결과 입력 단계를 열지 못했습니다.')

  await rpc(a.client, 'vote_match_result', {
    p_match_id: matchId, p_winner_team: 'a', p_score: '21-18',
  })
  const result = await rpc(b.client, 'vote_match_result', {
    p_match_id: matchId, p_winner_team: 'a', p_score: '21-18',
  })
  assert(result.consensus === true, '승자와 점수의 만장일치가 확정되지 않았습니다.')

  const { data: finalized, error: matchError } = await a.client
    .from('matches')
    .select('winner_team, score, finalized_at')
    .eq('id', matchId)
    .single()
  if (matchError) throw matchError
  assert(
    finalized.winner_team === 'a' && finalized.score === '21-18' && finalized.finalized_at,
    '경기 결과가 정확히 저장되지 않았습니다.',
  )

  const { data: ratings, error: ratingError } = await a.client
    .from('match_members')
    .select('user_id, rating_before, rating_delta, rating_after')
    .eq('match_id', matchId)
  if (ratingError) throw ratingError
  assert(ratings.length === 2, '참가자 레이팅 결과가 누락되었습니다.')
  assert(ratings.every((row) => row.rating_delta !== null && row.rating_after !== null), 'ELO 변경값이 기록되지 않았습니다.')

  const completed = await rpc(a.client, 'complete_match', { p_match_id: matchId })
  assert(completed.phase === 'done', '경기가 done 단계로 종료되지 않았습니다.')

  const cancelMatchId = await formMatch(a, b, {
    ...fixedQueue,
    p_venue_id: 'v3',
  })
  const cancelSlotId = await availableSlot(a.client, 'v3')
  await rpc(a.client, 'vote_match_slot', { p_match_id: cancelMatchId, p_venue_slot_id: cancelSlotId })
  await rpc(b.client, 'vote_match_slot', { p_match_id: cancelMatchId, p_venue_slot_id: cancelSlotId })
  await rpc(a.client, 'confirm_match_attendance', { p_match_id: cancelMatchId })
  await rpc(b.client, 'confirm_match_attendance', { p_match_id: cancelMatchId })
  assert(await rpc(a.client, 'cancel_match_queue') === true, '활성 매치 취소가 실패했습니다.')

  const [{ data: canceledMatch, error: canceledError }, { data: releasedSlot, error: releasedError }] = await Promise.all([
    a.client.from('matches').select('phase').eq('id', cancelMatchId).single(),
    a.client.from('venue_slots').select('status').eq('id', cancelSlotId).single(),
  ])
  if (canceledError) throw canceledError
  if (releasedError) throw releasedError
  assert(canceledMatch.phase === 'canceled', '활성 매치가 canceled 상태로 바뀌지 않았습니다.')
  assert(releasedSlot.status === 'open', '취소한 매치의 held 슬롯이 반환되지 않았습니다.')

  const [nearA, nearB, far, racer] = await Promise.all([
    anonymous(`near-a-${runId}`),
    anonymous(`near-b-${runId}`),
    anonymous(`far-${runId}`),
    anonymous(`racer-${runId}`),
  ])
  actors.push(nearA, nearB, far, racer)

  const quickBase = { p_sport: 'badminton', p_mode: '1v1', p_venue_id: null }
  const nearWaiting = await rpc(nearA.client, 'join_match_queue', {
    ...quickBase, p_lat: 37.5188, p_lng: 127.1012,
  })
  const farWaiting = await rpc(far.client, 'join_match_queue', {
    ...quickBase, p_lat: 35.1796, p_lng: 129.0756,
  })
  assert(nearWaiting.status === 'waiting' && farWaiting.status === 'waiting', '3km 밖 사용자가 잘못 매칭되었습니다.')
  const nearMatched = await rpc(nearB.client, 'join_match_queue', {
    ...quickBase, p_lat: 37.5190, p_lng: 127.1014,
  })
  assert(nearMatched.match_id, '3km 안의 가까운 사용자끼리 매칭되지 않았습니다.')
  await rpc(nearA.client, 'cancel_match_queue')
  await rpc(far.client, 'cancel_match_queue')

  const concurrent = await Promise.all([
    rpc(racer.client, 'join_match_queue', fixedQueue),
    rpc(racer.client, 'join_match_queue', fixedQueue),
  ])
  assert(
    concurrent[0].queue_entry?.id === concurrent[1].queue_entry?.id,
    '동시 큐 재시도가 중복 대기열을 만들었습니다.',
  )
  await rpc(racer.client, 'cancel_match_queue')

  await Promise.all(actors.map((actor) => actor.client.auth.signOut()))
  console.log('✓ 익명 인증/프로필 column grant')
  console.log('✓ 큐 멱등성/동시 재시도/활성 매치 중복 차단')
  console.log('✓ 3km 빠른 매칭/RLS/예약 메타데이터 격리')
  console.log('✓ 시간 투표/참가 확정/종료 시각 가드')
  console.log('✓ 결과·점수 만장일치/트랜잭션 ELO/경기 완료')
  console.log('✓ 활성 매치 취소/held 슬롯 반환')
  console.log(`검증 성공: ${matchId}`)
}

main().catch((error) => {
  console.error('MVP 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
