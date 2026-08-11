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
  console.error('Supabase 수명주기 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 Docker Desktop과 `npm run supabase:start`를 먼저 실행하세요.')
  console.error('원격 프로젝트는 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-lifecycle-verify-${name}`,
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

async function setRatings(actors, rating) {
  await requireData(
    await admin
      .from('player_ratings')
      .update({ rating })
      .in('profile_id', actors.map((actor) => actor.user.id))
      .eq('sport', 'badminton'),
    `레이팅 ${rating} 매칭 풀 격리 실패`,
  )
}

function venueQueue(venueId) {
  return {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: venueId,
    p_lat: null,
    p_lng: null,
  }
}

function quickQueue(lat, lng) {
  return {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: null,
    p_lat: lat,
    p_lng: lng,
  }
}

async function formMatch(context, first, second, queueArgs) {
  const waiting = await rpc(first.client, 'join_match_queue', queueArgs)
  assert(waiting.status === 'waiting' && waiting.match_id === null, '첫 사용자가 waiting 상태가 아닙니다.')
  const matched = await rpc(second.client, 'join_match_queue', queueArgs)
  assert(matched.status === 'matched' && matched.match_id, '두 번째 사용자 참가 후 매칭이 성사되지 않았습니다.')
  context.matchIds.add(matched.match_id)
  return matched.match_id
}

async function acceptMatch(first, second, matchId) {
  const firstAccept = await rpc(first.client, 'accept_match', { p_match_id: matchId })
  assert(firstAccept.accepted === true && firstAccept.phase === 'queue', '첫 번째 매칭 수락 상태가 올바르지 않습니다.')
  const secondAccept = await rpc(second.client, 'accept_match', { p_match_id: matchId })
  assert(secondAccept.all_accepted === true && secondAccept.phase === 'scheduling', '전원 수락 후 scheduling으로 전환되지 않았습니다.')
}

async function messageCount(matchId) {
  const result = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
  if (result.error) throw new Error(`채팅 개수 조회 실패: ${result.error.message}`)
  return result.count ?? 0
}

async function fillMessageQuota(matchId, targetCount) {
  let remaining = targetCount - await messageCount(matchId)
  assert(remaining >= 0, '채팅 개수가 검증 목표 한도를 이미 초과했습니다.')
  while (remaining > 0) {
    const size = Math.min(remaining, 500)
    await requireData(
      await admin.from('chat_messages').insert(
        Array.from({ length: size }, () => ({
          match_id: matchId,
          sender_id: null,
          body: 'quota verifier',
          system: true,
        })),
      ),
      '채팅 quota 검증 행 생성 실패',
    )
    remaining -= size
  }
  assert(await messageCount(matchId) === targetCount, '채팅 quota 검증 행 개수가 정확하지 않습니다.')
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
    await attempt('정리할 매치 탐색', async () => {
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
    await attempt('테스트 매치 삭제', () =>
      admin.from('matches').delete().in('id', [...context.matchIds]),
    )
  }
  if (userIds.length > 0) {
    await attempt('테스트 큐 삭제', () =>
      admin.from('queue_entries').delete().in('user_id', userIds),
    )
  }
  if (context.venueIds.size > 0) {
    await attempt('테스트 체육관 삭제', () =>
      admin.from('venues').delete().in('id', [...context.venueIds]),
    )
  }

  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () =>
      admin.auth.admin.deleteUser(userId),
    )
  }

  if (context.matchIds.size > 0) {
    await attempt('테스트 매치/채팅 잔존 확인', async () => {
      const [matches, messages] = await Promise.all([
        admin.from('matches').select('id').in('id', [...context.matchIds]),
        admin.from('chat_messages').select('id').in('match_id', [...context.matchIds]),
      ])
      if (matches.error) throw matches.error
      if (messages.error) throw messages.error
      assert((matches.data ?? []).length === 0, '삭제되지 않은 테스트 매치가 있습니다.')
      assert((messages.data ?? []).length === 0, '삭제되지 않은 테스트 채팅이 있습니다.')
    })
  }
  if (userIds.length > 0) {
    await attempt('테스트 사용자/큐/알림 잔존 확인', async () => {
      const [profiles, queues, notifications] = await Promise.all([
        admin.from('profiles').select('id').in('id', userIds),
        admin.from('queue_entries').select('id').in('user_id', userIds),
        admin.from('notifications').select('id').in('user_id', userIds),
      ])
      if (profiles.error) throw profiles.error
      if (queues.error) throw queues.error
      if (notifications.error) throw notifications.error
      assert((profiles.data ?? []).length === 0, '삭제되지 않은 테스트 프로필이 있습니다.')
      assert((queues.data ?? []).length === 0, '삭제되지 않은 테스트 큐가 있습니다.')
      assert((notifications.data ?? []).length === 0, '삭제되지 않은 테스트 알림이 있습니다.')
    })
  }
  if (context.venueIds.size > 0) {
    await attempt('테스트 체육관/슬롯 잔존 확인', async () => {
      const [venues, slots] = await Promise.all([
        admin.from('venues').select('id').in('id', [...context.venueIds]),
        admin.from('venue_slots').select('id').in('venue_id', [...context.venueIds]),
      ])
      if (venues.error) throw venues.error
      if (slots.error) throw slots.error
      assert((venues.data ?? []).length === 0, '삭제되지 않은 테스트 체육관이 있습니다.')
      assert((slots.data ?? []).length === 0, '삭제되지 않은 테스트 슬롯이 있습니다.')
    })
  }

  if (failures.length > 0) throw new Error(`검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
}

async function runVerification(context) {
  const runId = context.runId
  const mainVenueId = `verify-life-main-${runId}`
  const noSlotVenueId = `verify-life-noslot-${runId}`
  context.venueIds.add(mainVenueId)
  context.venueIds.add(noSlotVenueId)

  const mainLocation = { lat: 37.5012, lng: 127.0396 }
  const remoteLocation = { lat: 35.1796, lng: 129.0756 }

  await requireData(
    await admin.from('venues').insert([
      {
        id: mainVenueId,
        name: `수명주기 검증 체육관 ${runId}`,
        sports: ['badminton'],
        address: '자동 검증 전용',
        lat: mainLocation.lat,
        lng: mainLocation.lng,
        price_per_hour: 0,
        active: true,
      },
      {
        id: noSlotVenueId,
        name: `슬롯 없음 검증 체육관 ${runId}`,
        sports: ['badminton'],
        address: '자동 검증 전용',
        lat: remoteLocation.lat,
        lng: remoteLocation.lng,
        price_per_hour: 0,
        active: true,
      },
    ]),
    '격리된 테스트 체육관 생성 실패',
  )

  const futureBase = new Date(Date.now() + 365 * 24 * 60 * 60_000)
  const slots = await requireData(
    await admin
      .from('venue_slots')
      .insert(Array.from({ length: 3 }, (_, index) => {
        const startsAt = new Date(futureBase.getTime() + index * 24 * 60 * 60_000)
        return {
          venue_id: mainVenueId,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
          status: 'open',
          price: 0,
        }
      }))
      .select('id, starts_at, ends_at, status'),
    '미래 테스트 슬롯 생성 실패',
  )
  assert(slots.length === 3, '미래 테스트 슬롯이 정확히 세 개 생성되지 않았습니다.')

  const actors = []
  for (const name of ['a', 'b', 'c', 'd', 'outsider']) {
    actors.push(await anonymous(`${name}-${runId}`, context))
  }
  const [a, b, c, d, outsider] = actors

  for (const [index, actor] of actors.entries()) {
    await rpc(actor.client, 'save_my_profile', {
      p_nickname: `l${runId.slice(-6)}${index + 1}`,
      p_interests: ['badminton'],
      p_avatar_url: null,
    })
  }
  await Promise.all([
    setRatings([a, b], 310_000),
    setRatings([c, d], 410_000),
    setRatings([outsider], 510_000),
  ])

  const noSlotError = await expectRpcError(
    outsider.client,
    'join_match_queue',
    venueQueue(noSlotVenueId),
    '미래 open 슬롯이 없는 지정 체육관 큐 참가가 허용되었습니다.',
  )
  assert(/future open slots/i.test(noSlotError.message), '지정 체육관 슬롯 없음 오류가 명확하지 않습니다.')
  const outsiderQueues = await requireData(
    await admin.from('queue_entries').select('id').eq('user_id', outsider.user.id),
    '슬롯 없음 사용자 큐 조회 실패',
  )
  assert(outsiderQueues.length === 0, '슬롯 없는 체육관 요청이 큐 행을 남겼습니다.')

  const staleWaiting = await rpc(c.client, 'join_match_queue', venueQueue(mainVenueId))
  assert(staleWaiting.status === 'waiting' && staleWaiting.queue_entry?.id, 'TTL 검증용 대기열 생성에 실패했습니다.')
  await requireData(
    await admin
      .from('queue_entries')
      .update({
        created_at: new Date(Date.now() - 16 * 60_000).toISOString(),
        updated_at: new Date(Date.now() - 16 * 60_000).toISOString(),
      })
      .eq('id', staleWaiting.queue_entry.id),
    '대기열 TTL 시각 이동 실패',
  )
  const freshWaiting = await rpc(d.client, 'join_match_queue', venueQueue(mainVenueId))
  assert(freshWaiting.status === 'waiting' && freshWaiting.match_id === null, '만료 대기열이 새 사용자와 매칭되었습니다.')
  const expiredQueue = await requireData(
    await admin
      .from('queue_entries')
      .select('status, canceled_at')
      .eq('id', staleWaiting.queue_entry.id)
      .single(),
    '만료 대기열 상태 조회 실패',
  )
  assert(expiredQueue.status === 'canceled' && expiredQueue.canceled_at, '15분 지난 waiting 큐가 canceled 처리되지 않았습니다.')
  assert(await rpc(d.client, 'cancel_match_queue') === true, 'TTL 검증의 새 waiting 큐 정리에 실패했습니다.')

  const remoteQueue = quickQueue(remoteLocation.lat, remoteLocation.lng)
  const remoteFirst = await rpc(c.client, 'join_match_queue', remoteQueue)
  const remoteSecond = await rpc(d.client, 'join_match_queue', remoteQueue)
  assert(remoteFirst.status === 'waiting', '원거리 첫 사용자가 waiting 상태가 아닙니다.')
  assert(
    remoteSecond.status === 'waiting' && remoteSecond.match_id === null,
    '미래 슬롯이 없는 근처 체육관 또는 5km 밖 체육관으로 빠른 매칭이 생성되었습니다.',
  )
  const remoteMatches = await requireData(
    await admin
      .from('match_members')
      .select('match_id')
      .in('user_id', [c.user.id, d.user.id]),
    '원거리 매칭 잔존 조회 실패',
  )
  assert(remoteMatches.length === 0, '원거리 빠른 매칭이 실제 매치 참가자를 생성했습니다.')
  assert(await rpc(c.client, 'cancel_match_queue') === true, '원거리 첫 큐 정리에 실패했습니다.')
  assert(await rpc(d.client, 'cancel_match_queue') === true, '원거리 두 번째 큐 정리에 실패했습니다.')

  const cancelMatchId = await formMatch(context, c, d, venueQueue(mainVenueId))
  const cancelMatchBefore = await requireData(
    await admin.from('matches').select('phase').eq('id', cancelMatchId).single(),
    '수락 단계 취소 매치 조회 실패',
  )
  assert(cancelMatchBefore.phase === 'queue', '새 매치가 5분 수락 단계에서 시작하지 않았습니다.')
  assert(await rpc(c.client, 'cancel_match_queue') === true, '경기 시작 전 일반 취소가 차단되었습니다.')
  const canceledMatch = await requireData(
    await admin.from('matches').select('phase').eq('id', cancelMatchId).single(),
    '취소 매치 상태 조회 실패',
  )
  assert(canceledMatch.phase === 'canceled', '경기 시작 전 취소가 매치에 반영되지 않았습니다.')

  const lifecycleMatchId = await formMatch(
    context,
    a,
    b,
    quickQueue(mainLocation.lat, mainLocation.lng),
  )
  const formedMatch = await requireData(
    await admin
      .from('matches')
      .select('venue_id, phase, acceptance_deadline')
      .eq('id', lifecycleMatchId)
      .single(),
    '빠른 매칭 결과 조회 실패',
  )
  assert(formedMatch.venue_id === mainVenueId, '빠른 매칭이 5km 안의 미래 슬롯 보유 체육관을 선택하지 않았습니다.')
  assert(formedMatch.phase === 'queue' && formedMatch.acceptance_deadline, '빠른 매칭이 수락 단계로 생성되지 않았습니다.')
  await acceptMatch(a, b, lifecycleMatchId)

  const forbiddenDirectMessage = await a.client.from('chat_messages').insert({
    match_id: lifecycleMatchId,
    sender_id: a.user.id,
    body: 'forbidden direct message',
  })
  assert(forbiddenDirectMessage.error, '브라우저 사용자가 채팅 RPC를 우회해 직접 INSERT할 수 있습니다.')

  const aMessage = await rpc(a.client, 'send_match_message', {
    p_match_id: lifecycleMatchId,
    p_body: '  안녕하세요  ',
  })
  assert(
    aMessage?.match_id === lifecycleMatchId
      && aMessage?.sender_id === a.user.id
      && aMessage?.body === '안녕하세요'
      && aMessage?.system === false,
    'send_match_message가 저장된 단일 채팅 행을 정확히 반환하지 않았습니다.',
  )
  const bMessage = await rpc(b.client, 'send_match_message', {
    p_match_id: lifecycleMatchId,
    p_body: '반갑습니다',
  })
  assert(bMessage?.sender_id === b.user.id, '다른 사용자의 독립적인 채팅 전송이 차단되었습니다.')

  const rateError = await expectRpcError(
    a.client,
    'send_match_message',
    { p_match_id: lifecycleMatchId, p_body: 'too fast' },
    '같은 사용자가 3초 안에 채팅을 반복 전송할 수 있습니다.',
  )
  assert(/3초/.test(rateError.message), '채팅 속도 제한 오류가 명확하지 않습니다.')
  await expectRpcError(
    outsider.client,
    'send_match_message',
    { p_match_id: lifecycleMatchId, p_body: 'outsider' },
    '비참가자가 경기 채팅을 전송할 수 있습니다.',
  )

  await requireData(
    await admin
      .from('chat_messages')
      .update({ created_at: new Date(Date.now() - 10_000).toISOString() })
      .eq('match_id', lifecycleMatchId)
      .eq('sender_id', a.user.id),
    '채팅 quota 검증용 전송 시각 이동 실패',
  )
  await fillMessageQuota(lifecycleMatchId, 5000)
  const quotaError = await expectRpcError(
    a.client,
    'send_match_message',
    { p_match_id: lifecycleMatchId, p_body: 'over quota' },
    '한 경기에서 5000개를 넘는 사용자 채팅이 허용되었습니다.',
  )
  assert(/한도/.test(quotaError.message), '채팅 총량 제한 오류가 명확하지 않습니다.')

  const firstSlotVote = await rpc(a.client, 'vote_match_slot', {
    p_match_id: lifecycleMatchId,
    p_venue_slot_id: slots[0].id,
  })
  assert(firstSlotVote.consensus === false && firstSlotVote.phase === 'scheduling', '첫 시간 투표 응답이 잘못되었습니다.')
  const slotConsensus = await rpc(b.client, 'vote_match_slot', {
    p_match_id: lifecycleMatchId,
    p_venue_slot_id: slots[0].id,
  })
  assert(slotConsensus.consensus === true && slotConsensus.phase === 'payment', '1v1 시간 합의가 enum payment 단계로 전환되지 않았습니다.')

  await rpc(a.client, 'confirm_match_attendance', { p_match_id: lifecycleMatchId })
  const attendance = await rpc(b.client, 'confirm_match_attendance', { p_match_id: lifecycleMatchId })
  assert(attendance.all_confirmed === true && attendance.phase === 'confirmed', '전원 참가 확정에 실패했습니다.')

  const endedAt = new Date(Date.now() - 60_000)
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000)
  await requireData(
    await admin
      .from('venue_slots')
      .update({ starts_at: startedAt.toISOString(), ends_at: endedAt.toISOString() })
      .eq('id', slots[0].id),
    '경기 시작/종료 시각 이동 실패',
  )

  assert(
    await rpc(a.client, 'cancel_match_queue') === false,
    '경기 시작 후 confirmed 매치를 일반 취소할 수 있습니다.',
  )
  const reporting = await rpc(a.client, 'open_match_reporting', { p_match_id: lifecycleMatchId })
  assert(reporting.phase === 'reporting', '종료 시각 이후 reporting 단계가 열리지 않았습니다.')

  const firstResult = await rpc(a.client, 'vote_match_result', {
    p_match_id: lifecycleMatchId,
    p_winner_team: 'a',
    p_score: '21-18',
  })
  assert(firstResult.consensus === false, '첫 결과 투표만으로 경기가 확정되었습니다.')
  const normalizedVote = await requireData(
    await admin
      .from('result_votes')
      .select('score')
      .eq('match_id', lifecycleMatchId)
      .eq('user_id', a.user.id)
      .single(),
    '정규화된 결과 투표 조회 실패',
  )
  assert(normalizedVote.score === '21-18', '점수 내부 공백이 canonical 형식으로 저장되지 않았습니다.')

  assert(
    await rpc(b.client, 'cancel_match_queue') === false,
    '결과 입력 중인 미확정 매치를 일반 취소할 수 있습니다.',
  )
  const stillReporting = await requireData(
    await admin.from('matches').select('phase, finalized_at').eq('id', lifecycleMatchId).single(),
    '취소 차단 후 매치 조회 실패',
  )
  assert(stillReporting.phase === 'reporting' && stillReporting.finalized_at === null, '차단된 취소가 경기 상태를 변경했습니다.')

  const finalizedResult = await rpc(b.client, 'vote_match_result', {
    p_match_id: lifecycleMatchId,
    p_winner_team: 'a',
    p_score: '21 - 18',
  })
  assert(finalizedResult.consensus === true, '공백만 다른 동일 점수 투표가 합의되지 않았습니다.')
  const finalizedMatch = await requireData(
    await admin
      .from('matches')
      .select('phase, score, finalized_at')
      .eq('id', lifecycleMatchId)
      .single(),
    '확정 경기 조회 실패',
  )
  assert(finalizedMatch.score === '21-18' && finalizedMatch.finalized_at, '정규화된 최종 점수가 저장되지 않았습니다.')

  const firstComplete = await rpc(a.client, 'complete_match', { p_match_id: lifecycleMatchId })
  assert(firstComplete.phase === 'done' && firstComplete.remaining_members === 1, '첫 참가자 결과 확인 상태가 잘못되었습니다.')

  await expectRpcError(
    b.client,
    'join_match_queue',
    venueQueue(mainVenueId),
    'completed_at이 없는 참가자가 shared done 경기 뒤 새 큐에 들어갈 수 있습니다.',
  )
  const completedUserQueue = await rpc(a.client, 'join_match_queue', venueQueue(mainVenueId))
  assert(completedUserQueue.status === 'waiting', '결과 확인을 마친 참가자가 새 큐에 들어가지 못했습니다.')
  assert(await rpc(a.client, 'cancel_match_queue') === true, '결과 확인 사용자의 새 큐 정리에 실패했습니다.')

  const terminalChatError = await expectRpcError(
    b.client,
    'send_match_message',
    { p_match_id: lifecycleMatchId, p_body: 'terminal message' },
    'done 경기에서 채팅을 보낼 수 있습니다.',
  )
  assert(/closed/i.test(terminalChatError.message), '종료 경기 채팅 차단 오류가 명확하지 않습니다.')

  const finalComplete = await rpc(b.client, 'complete_match', { p_match_id: lifecycleMatchId })
  assert(finalComplete.phase === 'done' && finalComplete.remaining_members === 0, '두 번째 참가자 결과 확인이 완료되지 않았습니다.')

  console.log('✓ 지정 체육관 미래 슬롯 필수/빠른 매칭 5km·미래 슬롯 가드')
  console.log('✓ 15분 waiting TTL/만료 행 canceled 처리')
  console.log('✓ 경기 시작·reporting 이후 일반 취소 차단/시작 전 취소 허용')
  console.log('✓ completed_at 기반 새 큐 허용·차단')
  console.log('✓ 결과 점수 공백 canonical 정규화/합의')
  console.log('✓ vote_match_slot enum 단계 전환')
  console.log('✓ 채팅 직접 INSERT·외부인·3초 제한·5000 quota·terminal 차단')
  console.log(`수명주기 보강 검증 성공: ${lifecycleMatchId}`)
}

async function main() {
  const context = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    actors: [],
    venueIds: new Set(),
    matchIds: new Set(),
  }
  let verificationError = null

  try {
    await runVerification(context)
  } catch (error) {
    verificationError = error
  }

  try {
    await cleanup(context)
    console.log('✓ 수명주기 보강 검증 데이터 정리 완료')
  } catch (cleanupError) {
    if (verificationError) {
      console.error('검증 중 오류:', verificationError instanceof Error ? verificationError.message : verificationError)
    }
    verificationError = cleanupError
  }

  if (verificationError) throw verificationError
}

main().catch((error) => {
  console.error('수명주기 보강 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
