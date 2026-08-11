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
  console.error('Supabase 명예 시스템 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 Docker Desktop과 `npm run supabase:start`를 먼저 실행하세요.')
  console.error('원격 프로젝트는 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-honor-verify-${name}`,
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
  const actor = { client: value, user: data.user, nickname: null }
  context.actors.push(actor)
  return actor
}

async function profileHonorCounts(profileId) {
  return requireData(
    await admin
      .from('profiles')
      .select('id, honor_total, honor_manner, honor_skill, honor_punctual, honor_fun')
      .eq('id', profileId)
      .single(),
    '명예 카운터 조회 실패',
  )
}

function assertZeroCounts(profile, label) {
  assert(
    profile.honor_total === 0
      && profile.honor_manner === 0
      && profile.honor_skill === 0
      && profile.honor_punctual === 0
      && profile.honor_fun === 0,
    `${label}: 명예 카운터가 0으로 정리되지 않았습니다.`,
  )
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

  if (context.matchId) {
    await attempt('테스트 매치 삭제', () =>
      admin.from('matches').delete().eq('id', context.matchId),
    )
  }
  if (context.venueId) {
    await attempt('테스트 체육관 삭제', () =>
      admin.from('venues').delete().eq('id', context.venueId),
    )
  }

  const userIds = context.actors.map((actor) => actor.user.id)
  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () =>
      admin.auth.admin.deleteUser(userId),
    )
  }

  if (context.matchId) {
    await attempt('테스트 매치/명예 잔존 확인', async () => {
      const [matches, honors] = await Promise.all([
        admin.from('matches').select('id').eq('id', context.matchId),
        admin.from('match_honors').select('id').eq('match_id', context.matchId),
      ])
      if (matches.error) throw matches.error
      if (honors.error) throw honors.error
      assert((matches.data ?? []).length === 0, '삭제되지 않은 테스트 매치가 있습니다.')
      assert((honors.data ?? []).length === 0, '삭제되지 않은 테스트 명예 행이 있습니다.')
    })
  }
  if (userIds.length > 0) {
    await attempt('테스트 사용자/알림 잔존 확인', async () => {
      const [profiles, notifications] = await Promise.all([
        admin.from('profiles').select('id').in('id', userIds),
        admin.from('notifications').select('id').in('user_id', userIds),
      ])
      if (profiles.error) throw profiles.error
      if (notifications.error) throw notifications.error
      assert((profiles.data ?? []).length === 0, '삭제되지 않은 테스트 프로필이 있습니다.')
      assert((notifications.data ?? []).length === 0, '삭제되지 않은 테스트 알림이 있습니다.')
    })
  }
  if (context.venueId) {
    await attempt('테스트 체육관 잔존 확인', async () => {
      const venue = await admin.from('venues').select('id').eq('id', context.venueId)
      if (venue.error) throw venue.error
      assert((venue.data ?? []).length === 0, '삭제되지 않은 테스트 체육관이 있습니다.')
    })
  }

  if (failures.length > 0) throw new Error(`검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
}

async function runVerification(context) {
  const runId = context.runId
  context.venueId = `verify-honor-${runId}`

  await requireData(
    await admin.from('venues').insert({
      id: context.venueId,
      name: `명예 검증 체육관 ${runId}`,
      sports: ['badminton'],
      address: '자동 검증 전용',
      lat: 37.501,
      lng: 127.041,
      price_per_hour: 0,
      active: true,
    }),
    '격리된 테스트 체육관 생성 실패',
  )

  const actors = []
  for (const role of ['giver', 'teammate', 'receiver', 'opponent', 'outsider']) {
    actors.push(await anonymous(`${role}-${runId}`, context))
  }
  const [giver, teammate, receiver, opponent, outsider] = actors

  for (const [index, actor] of actors.entries()) {
    const profile = await rpc(actor.client, 'save_my_profile', {
      p_nickname: `h${runId.slice(-6)}${index + 1}`,
      p_interests: ['badminton'],
      p_avatar_url: null,
    })
    actor.nickname = profile.nickname
  }

  const match = await requireData(
    await admin
      .from('matches')
      .insert({
        venue_id: context.venueId,
        sport: 'badminton',
        mode: '2v2',
        capacity: 4,
        host_id: giver.user.id,
        phase: 'reporting',
        quick: false,
      })
      .select('id')
      .single(),
    '테스트 매치 생성 실패',
  )
  context.matchId = match.id

  await requireData(
    await admin.from('match_members').insert([
      { match_id: match.id, user_id: giver.user.id, team: 'a', is_host: true },
      { match_id: match.id, user_id: teammate.user.id, team: 'a', is_host: false },
      { match_id: match.id, user_id: receiver.user.id, team: 'b', is_host: false },
      { match_id: match.id, user_id: opponent.user.id, team: 'b', is_host: false },
    ]),
    '테스트 매치 참가자 생성 실패',
  )

  await expectRpcError(
    giver.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: receiver.user.id, p_honor_type: 'manner' },
    '경기 결과 확정 전에 명예를 보낼 수 있습니다.',
  )

  await requireData(
    await admin
      .from('matches')
      .update({ winner_team: 'a', finalized_at: new Date().toISOString() })
      .eq('id', match.id),
    '테스트 경기 결과 확정 실패',
  )

  await expectRpcError(
    giver.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: giver.user.id, p_honor_type: 'manner' },
    '본인에게 명예를 보낼 수 있습니다.',
  )
  await expectRpcError(
    giver.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: teammate.user.id, p_honor_type: 'skill' },
    '같은 팀원에게 명예를 보낼 수 있습니다.',
  )
  await expectRpcError(
    outsider.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: receiver.user.id, p_honor_type: 'fun' },
    '비참가자가 경기 명예를 보낼 수 있습니다.',
  )

  const forbiddenInsert = await giver.client.from('match_honors').insert({
    match_id: match.id,
    giver_id: giver.user.id,
    receiver_id: receiver.user.id,
    honor_type: 'manner',
  })
  assert(forbiddenInsert.error, '브라우저 사용자가 RPC를 우회해 명예 행을 직접 생성할 수 있습니다.')

  const forbiddenCounterUpdate = await receiver.client
    .from('profiles')
    .update({ honor_total: 99 })
    .eq('id', receiver.user.id)
  assert(forbiddenCounterUpdate.error, '브라우저 사용자가 서버 명예 카운터를 직접 변경할 수 있습니다.')

  const beforeNotifications = await requireData(
    await receiver.client.from('notifications').select('id'),
    '명예 전 알림 조회 실패',
  )
  const baselineNotificationIds = new Set((beforeNotifications ?? []).map((row) => row.id))

  const created = await rpc(giver.client, 'give_match_honor', {
    p_match_id: match.id,
    p_receiver_id: receiver.user.id,
    p_honor_type: 'manner',
  })
  assert(created.created === true, '정상 명예 전달이 새 행 생성으로 응답하지 않았습니다.')
  assert(created.match_id === match.id, '명예 응답의 match_id가 다릅니다.')
  assert(created.receiver_id === receiver.user.id, '명예 응답의 receiver_id가 다릅니다.')
  assert(created.honor_type === 'manner', '명예 응답의 honor_type이 다릅니다.')

  const retried = await rpc(giver.client, 'give_match_honor', {
    p_match_id: match.id,
    p_receiver_id: receiver.user.id,
    p_honor_type: 'manner',
  })
  assert(retried.created === false, '동일 명예 재시도가 멱등 응답을 반환하지 않았습니다.')

  await expectRpcError(
    giver.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: receiver.user.id, p_honor_type: 'skill' },
    '한 경기에서 다른 종류의 두 번째 명예를 보낼 수 있습니다.',
  )
  await expectRpcError(
    giver.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: opponent.user.id, p_honor_type: 'manner' },
    '한 경기에서 다른 상대에게 두 번째 명예를 보낼 수 있습니다.',
  )

  const [giverView, receiverView, outsiderView, adminView] = await Promise.all([
    requireData(
      await giver.client.from('match_honors').select('*').eq('match_id', match.id),
      '보낸 사람의 명예 원본 조회 실패',
    ),
    requireData(
      await receiver.client.from('match_honors').select('*').eq('match_id', match.id),
      '받은 사람의 명예 원본 RLS 조회 실패',
    ),
    requireData(
      await outsider.client.from('match_honors').select('*').eq('match_id', match.id),
      '외부인의 명예 원본 RLS 조회 실패',
    ),
    requireData(
      await admin.from('match_honors').select('*').eq('match_id', match.id),
      '관리자 명예 원본 조회 실패',
    ),
  ])
  assert(giverView.length === 1, '보낸 사람이 자신이 전달한 명예를 조회할 수 없습니다.')
  assert(receiverView.length === 0, '받은 사람에게 명예를 보낸 사람의 원본 정보가 노출됩니다.')
  assert(outsiderView.length === 0, '비참가자에게 명예 원본 정보가 노출됩니다.')
  assert(adminView.length === 1 && adminView[0].giver_id === giver.user.id, '명예 원본이 정확히 한 건 저장되지 않았습니다.')

  const receiverCounts = await profileHonorCounts(receiver.user.id)
  assert(
    receiverCounts.honor_total === 1
      && receiverCounts.honor_manner === 1
      && receiverCounts.honor_skill === 0
      && receiverCounts.honor_punctual === 0
      && receiverCounts.honor_fun === 0,
    '받은 사람의 총합/유형별 명예 카운터가 정확하지 않습니다.',
  )

  const afterNotifications = await requireData(
    await receiver.client
      .from('notifications')
      .select('id, title, body, link')
      .order('created_at'),
    '명예 후 알림 조회 실패',
  )
  const honorNotifications = (afterNotifications ?? []).filter((row) => !baselineNotificationIds.has(row.id))
  assert(honorNotifications.length === 1, '명예 전달로 익명 알림이 정확히 한 건 생성되지 않았습니다.')
  const [honorNotification] = honorNotifications
  assert(honorNotification.title.includes('명예'), '명예 알림 제목이 명예 수신을 설명하지 않습니다.')
  assert(honorNotification.body.includes('매너'), '명예 알림 본문에 받은 유형이 표시되지 않습니다.')
  assert(honorNotification.link === '/profile', '명예 알림의 프로필 링크가 정확하지 않습니다.')
  assert(!honorNotification.title.includes(giver.nickname), '익명 명예 알림 제목에 보낸 사람 닉네임이 노출됩니다.')
  assert(!honorNotification.body.includes(giver.nickname), '익명 명예 알림 본문에 보낸 사람 닉네임이 노출됩니다.')
  assert(!honorNotification.body.includes(giver.user.id), '익명 명예 알림 본문에 보낸 사람 ID가 노출됩니다.')

  const teammateCompleted = await rpc(teammate.client, 'complete_match', { p_match_id: match.id })
  assert(teammateCompleted.phase === 'done', '명예 완료 가드용 경기 완료 처리에 실패했습니다.')
  await expectRpcError(
    teammate.client,
    'give_match_honor',
    { p_match_id: match.id, p_receiver_id: receiver.user.id, p_honor_type: 'punctual' },
    '경기 화면을 완료한 사용자가 새 명예를 보낼 수 있습니다.',
  )

  const giverCompleted = await rpc(giver.client, 'complete_match', { p_match_id: match.id })
  assert(giverCompleted.phase === 'done', '명예 전달자의 경기 완료 처리에 실패했습니다.')
  const completedRetry = await rpc(giver.client, 'give_match_honor', {
    p_match_id: match.id,
    p_receiver_id: receiver.user.id,
    p_honor_type: 'manner',
  })
  assert(completedRetry.created === false, '완료 직전 성공한 동일 요청을 안전하게 재시도할 수 없습니다.')

  await requireData(
    await admin.from('matches').delete().eq('id', match.id),
    '카운터 원복 검증용 매치 삭제 실패',
  )
  const [remainingHonors, cleanedReceiverCounts] = await Promise.all([
    requireData(
      await admin.from('match_honors').select('id').eq('match_id', match.id),
      '매치 삭제 후 명예 잔존 조회 실패',
    ),
    profileHonorCounts(receiver.user.id),
  ])
  assert(remainingHonors.length === 0, '매치 삭제 후 명예 행이 남았습니다.')
  assertZeroCounts(cleanedReceiverCounts, '매치 삭제 후 받은 사람')

  console.log('✓ 결과 확정 전/본인/팀원/비참가자/직접 쓰기 차단')
  console.log('✓ 상대 명예 1회/동일 재시도 멱등/다른 두 번째 제출 차단')
  console.log('✓ 수신자·외부인 원본 비노출/RLS 익명성')
  console.log('✓ 프로필 총합·유형별 카운터/익명 알림 1건')
  console.log('✓ 개인 완료 전후 가드/안전한 성공 요청 재시도')
  console.log('✓ 매치 삭제 cascade/명예 카운터 원복')
  console.log(`명예 시스템 검증 성공: ${match.id}`)
}

async function main() {
  const context = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    actors: [],
    venueId: null,
    matchId: null,
  }
  let verificationError = null

  try {
    await runVerification(context)
  } catch (error) {
    verificationError = error
  }

  try {
    await cleanup(context)
    console.log('✓ 명예 시스템 검증 데이터 정리 완료')
  } catch (cleanupError) {
    if (verificationError) {
      console.error('검증 중 오류:', verificationError instanceof Error ? verificationError.message : verificationError)
    }
    verificationError = cleanupError
  }

  if (verificationError) throw verificationError
}

main().catch((error) => {
  console.error('명예 시스템 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
