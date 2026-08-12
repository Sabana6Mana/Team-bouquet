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
  console.error('Supabase 제재 시스템 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 Docker Desktop과 `npm run supabase:start`를 먼저 실행하세요.')
  console.error('원격 프로젝트는 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-sanctions-verify-${name}`,
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

function assertBannedError(error, label) {
  assert(error, `${label}: 영구 정지 가드가 오류를 반환하지 않았습니다.`)
  assert(
    error.message?.includes('영구 정지'),
    `${label}: 다른 조건이 아닌 영구 정지 가드로 차단되었는지 확인할 수 없습니다. (${error.message})`,
  )
}

async function expectBannedRpc(value, functionName, args, label) {
  const error = await expectRpcError(
    value,
    functionName,
    args,
    `${label}: 영구 정지 계정의 RPC가 허용되었습니다.`,
  )
  assertBannedError(error, label)
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

async function createMatch(context, members, options) {
  const row = await requireData(
    await admin
      .from('matches')
      .insert({
        venue_id: context.venueId,
        sport: 'badminton',
        mode: options.mode,
        capacity: options.capacity,
        host_id: members[0].actor.user.id,
        phase: options.phase,
        quick: false,
        winner_team: options.finalized ? 'a' : null,
        score: options.finalized ? '21-18' : null,
        finalized_at: options.finalized ? new Date().toISOString() : null,
      })
      .select('id')
      .single(),
    `${options.label} 생성 실패`,
  )
  context.matchIds.add(row.id)

  await requireData(
    await admin.from('match_members').insert(
      members.map(({ actor, team }, index) => ({
        match_id: row.id,
        user_id: actor.user.id,
        team,
        is_host: index === 0,
        completed_at: options.completed ? new Date().toISOString() : null,
      })),
    ),
    `${options.label} 참가자 생성 실패`,
  )

  return row.id
}

async function createReport(reporter, reported, matchId, reason) {
  return requireData(
    await reporter.client
      .from('reports')
      .insert({
        reporter_id: reporter.user.id,
        reported_id: reported.user.id,
        match_id: matchId,
        reason,
        details: `sanctions verifier: ${reason}`,
      })
      .select('id, status, reviewed_at, review_note')
      .single(),
    `${reason} 신고 생성 실패`,
  )
}

async function reviewReport(reportId, upheld, note) {
  return rpc(admin, 'review_match_report', {
    p_report_id: reportId,
    p_upheld: upheld,
    p_review_note: note,
  })
}

async function sanctionRow(profileId) {
  return requireData(
    await admin
      .from('account_sanctions')
      .select('*')
      .eq('profile_id', profileId)
      .single(),
    '제재 행 조회 실패',
  )
}

async function cleanup(context) {
  const failures = []
  const describeError = (error) => {
    if (error instanceof Error) return error.message
    if (error && typeof error === 'object' && 'message' in error) return String(error.message)
    return String(error)
  }
  const attempt = async (label, operation) => {
    try {
      const result = await operation()
      if (result?.error) throw result.error
    } catch (error) {
      failures.push(`${label}: ${describeError(error)}`)
    }
  }

  await Promise.all(context.actors.map((actor) =>
    attempt(`사용자 ${actor.user.id} 로그아웃`, () => actor.client.auth.signOut()),
  ))

  const matchIds = [...context.matchIds]
  if (matchIds.length > 0) {
    await attempt('테스트 매치 삭제', () =>
      admin.from('matches').delete().in('id', matchIds),
    )
  }

  const userIds = context.actors.map((actor) => actor.user.id)
  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () =>
      admin.auth.admin.deleteUser(userId),
    )
  }

  // queue_entries keeps a foreign key to venues. Deleting auth users first
  // cascades their verifier queues so the isolated venue can then be removed.
  if (context.venueId) {
    await attempt('테스트 체육관/슬롯 삭제', () =>
      admin.from('venues').delete().eq('id', context.venueId),
    )
  }

  if (matchIds.length > 0) {
    await attempt('매치/신고 잔존 확인', async () => {
      const [matches, reports] = await Promise.all([
        admin.from('matches').select('id').in('id', matchIds),
        admin.from('reports').select('id').in('match_id', matchIds),
      ])
      if (matches.error) throw matches.error
      if (reports.error) throw reports.error
      assert((matches.data ?? []).length === 0, '삭제되지 않은 테스트 매치가 있습니다.')
      assert((reports.data ?? []).length === 0, '삭제되지 않은 테스트 신고가 있습니다.')
    })
  }

  if (context.venueId) {
    await attempt('체육관/슬롯 잔존 확인', async () => {
      const [venues, slots] = await Promise.all([
        admin.from('venues').select('id').eq('id', context.venueId),
        admin.from('venue_slots').select('id').eq('venue_id', context.venueId),
      ])
      if (venues.error) throw venues.error
      if (slots.error) throw slots.error
      assert((venues.data ?? []).length === 0, '삭제되지 않은 테스트 체육관이 있습니다.')
      assert((slots.data ?? []).length === 0, '삭제되지 않은 테스트 슬롯이 있습니다.')
    })
  }

  if (userIds.length > 0) {
    await attempt('프로필/큐/알림/제재 잔존 확인', async () => {
      const [profiles, queues, notifications, sanctions] = await Promise.all([
        admin.from('profiles').select('id').in('id', userIds),
        admin.from('queue_entries').select('id').in('user_id', userIds),
        admin.from('notifications').select('id').in('user_id', userIds),
        admin.from('account_sanctions').select('profile_id').in('profile_id', userIds),
      ])
      if (profiles.error) throw profiles.error
      if (queues.error) throw queues.error
      if (notifications.error) throw notifications.error
      if (sanctions.error) throw sanctions.error
      assert((profiles.data ?? []).length === 0, '삭제되지 않은 테스트 프로필이 있습니다.')
      assert((queues.data ?? []).length === 0, '삭제되지 않은 테스트 큐가 있습니다.')
      assert((notifications.data ?? []).length === 0, '삭제되지 않은 테스트 알림이 있습니다.')
      assert((sanctions.data ?? []).length === 0, '삭제되지 않은 테스트 제재 행이 있습니다.')
    })

    for (const userId of userIds) {
      await attempt(`auth 사용자 ${userId} 잔존 확인`, async () => {
        const { data } = await admin.auth.admin.getUserById(userId)
        assert(!data?.user, '삭제되지 않은 테스트 auth 사용자가 있습니다.')
      })
    }
  }

  if (failures.length > 0) throw new Error(`검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
}

async function runVerification(context) {
  const { runId } = context
  context.venueId = `verify-sanctions-${runId}`

  await requireData(
    await admin.from('venues').insert({
      id: context.venueId,
      name: `제재 검증 체육관 ${runId}`,
      sports: ['badminton'],
      address: '제재 자동 검증 전용',
      lat: 37.502,
      lng: 127.042,
      price_per_hour: 0,
      active: true,
    }),
    '격리된 테스트 체육관 생성 실패',
  )

  const slotStart = new Date(Date.now() + 24 * 60 * 60_000)
  const slotEnd = new Date(slotStart.getTime() + 60 * 60_000)
  const slot = await requireData(
    await admin
      .from('venue_slots')
      .insert({
        venue_id: context.venueId,
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
        status: 'open',
        price: 0,
      })
      .select('id')
      .single(),
    '제재 검증 슬롯 생성 실패',
  )
  context.slotId = slot.id

  const [target, reporter1, reporter2, reporter3] = await Promise.all([
    anonymous(`target-${runId}`, context),
    anonymous(`reporter-1-${runId}`, context),
    anonymous(`reporter-2-${runId}`, context),
    anonymous(`reporter-3-${runId}`, context),
  ])

  for (const [index, actor] of context.actors.entries()) {
    await rpc(actor.client, 'save_my_profile', {
      p_nickname: `s${runId.slice(-6)}${index + 1}`,
      p_interests: ['badminton'],
      p_avatar_url: null,
    })
  }

  const match1 = await createMatch(context, [
    { actor: target, team: 'a' },
    { actor: reporter1, team: 'b' },
  ], {
    label: '신고 매치 1',
    mode: '1v1',
    capacity: 2,
    phase: 'done',
    finalized: true,
    completed: true,
  })
  const match2 = await createMatch(context, [
    { actor: target, team: 'a' },
    { actor: reporter1, team: 'b' },
  ], {
    label: '신고 매치 2',
    mode: '1v1',
    capacity: 2,
    phase: 'done',
    finalized: true,
    completed: true,
  })
  const match3 = await createMatch(context, [
    { actor: target, team: 'a' },
    { actor: reporter1, team: 'a' },
    { actor: reporter2, team: 'b' },
    { actor: reporter3, team: 'b' },
  ], {
    label: '신고 매치 3',
    mode: '2v2',
    capacity: 4,
    phase: 'done',
    finalized: true,
    completed: true,
  })

  const dismissedReport = await createReport(reporter1, target, match1, 'dismissed-case')
  const firstUpheldReport = await createReport(reporter1, target, match2, 'upheld-case-1')
  const legacyResolvedReport = await createReport(reporter2, target, match3, 'legacy-resolved')
  const finalUpheldReport = await createReport(reporter3, target, match3, 'upheld-case-final')

  await requireData(
    await admin
      .from('reports')
      .update({ status: 'resolved', reviewed_at: null, review_note: null })
      .eq('id', legacyResolvedReport.id),
    'legacy resolved 신고 준비 실패',
  )

  const forbiddenReview = await expectRpcError(
    reporter1.client,
    'review_match_report',
    {
      p_report_id: dismissedReport.id,
      p_upheld: true,
      p_review_note: 'forbidden',
    },
    '인증된 일반 사용자가 신고를 판정할 수 있습니다.',
  )
  assert(forbiddenReview, '일반 사용자 신고 판정 차단 오류가 없습니다.')
  const stillOpen = await requireData(
    await admin.from('reports').select('status').eq('id', dismissedReport.id).single(),
    '미권한 판정 후 신고 상태 조회 실패',
  )
  assert(stillOpen.status === 'open', '미권한 판정이 신고 상태를 변경했습니다.')

  const dismissed = await reviewReport(dismissedReport.id, false, 'not enough evidence')
  assert(dismissed.status === 'dismissed', '무효 신고가 dismissed로 판정되지 않았습니다.')
  assert(dismissed.upheld_report_count === 0, '무효 신고가 strike에 포함되었습니다.')
  assert(dismissed.permanently_banned_at === null, '무효 신고만으로 계정이 정지되었습니다.')

  const firstUpheld = await reviewReport(firstUpheldReport.id, true, 'upheld-1')
  assert(firstUpheld.status === 'resolved', '첫 번째 인정 신고가 resolved로 변경되지 않았습니다.')
  assert(firstUpheld.upheld_report_count === 1, '첫 번째 인정 신고 count가 1이 아닙니다.')
  assert(firstUpheld.permanently_banned_at === null, 'strike 1회에서 계정이 정지되었습니다.')

  const reviewedOnce = await requireData(
    await admin
      .from('reports')
      .select('status, reviewed_at, review_note')
      .eq('id', firstUpheldReport.id)
      .single(),
    '첫 번째 인정 신고 조회 실패',
  )
  const firstRetry = await reviewReport(firstUpheldReport.id, true, 'upheld-1')
  const reviewedAfterRetry = await requireData(
    await admin
      .from('reports')
      .select('status, reviewed_at, review_note')
      .eq('id', firstUpheldReport.id)
      .single(),
    '첫 번째 인정 신고 재시도 후 조회 실패',
  )
  assert(firstRetry.upheld_report_count === 1, '동일 판정 재시도가 strike를 중복 증가시켰습니다.')
  assert(
    reviewedAfterRetry.reviewed_at === reviewedOnce.reviewed_at
      && reviewedAfterRetry.review_note === reviewedOnce.review_note,
    '동일 판정 재시도가 완료된 판정 원본을 변경했습니다.',
  )

  const legacyBeforeReview = await requireData(
    await admin
      .from('reports')
      .select('status, reviewed_at')
      .eq('id', legacyResolvedReport.id)
      .single(),
    'legacy resolved 신고의 명시 판정 전 상태 조회 실패',
  )
  assert(
    legacyBeforeReview.status === 'resolved' && legacyBeforeReview.reviewed_at === null,
    'legacy resolved 신고가 reviewed_at NULL 상태로 준비되지 않았습니다.',
  )

  const legacyReviewed = await reviewReport(legacyResolvedReport.id, true, 'legacy-upheld')
  assert(legacyReviewed.upheld_report_count === 2, '명시 판정된 legacy 신고가 두 번째 strike가 되지 않았습니다.')
  assert(legacyReviewed.permanently_banned_at === null, 'strike 2회에서 계정이 정지되었습니다.')
  const legacyAfterReview = await requireData(
    await admin
      .from('reports')
      .select('status, reviewed_at, review_note')
      .eq('id', legacyResolvedReport.id)
      .single(),
    'legacy resolved 신고의 명시 판정 후 상태 조회 실패',
  )
  assert(
    legacyAfterReview.status === 'resolved'
      && legacyAfterReview.reviewed_at
      && legacyAfterReview.review_note === 'legacy-upheld',
    'legacy resolved 신고의 명시 판정 메타데이터가 저장되지 않았습니다.',
  )

  const queueArgs = {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: context.venueId,
    p_lat: null,
    p_lng: null,
  }
  const targetQueue = await rpc(target.client, 'join_match_queue', queueArgs)
  assert(targetQueue.status === 'waiting', '제재 전 active 매치용 첫 큐 진입에 실패했습니다.')
  const partnerQueue = await rpc(reporter1.client, 'join_match_queue', queueArgs)
  assert(partnerQueue.status === 'matched' && partnerQueue.match_id, '제재 전 active 매치 생성에 실패했습니다.')
  const activeMatchId = partnerQueue.match_id
  context.matchIds.add(activeMatchId)

  await requireData(
    await admin
      .from('venue_slots')
      .update({ status: 'held', reserved_match_id: activeMatchId })
      .eq('id', slot.id),
    '제재 시 held 슬롯 반환 검증 준비 실패',
  )
  await requireData(
    await admin
      .from('matches')
      .update({
        phase: 'reporting',
        finalized_at: null,
        acceptance_deadline: null,
        confirmed_slot_id: slot.id,
      })
      .eq('id', activeMatchId),
    '제재 시 reporting 매치 취소 검증 준비 실패',
  )

  const waitingQueue = await requireData(
    await admin
      .from('queue_entries')
      .insert({
        user_id: target.user.id,
        sport: 'badminton',
        mode: '1v1',
        capacity: 2,
        venue_id: context.venueId,
        quick: false,
        status: 'waiting',
      })
      .select('id')
      .single(),
    '영구 정지 전 대기 큐 생성 실패',
  )
  context.queueId = waitingQueue.id

  const finalUpheld = await reviewReport(finalUpheldReport.id, true, 'upheld-final')
  assert(finalUpheld.upheld_report_count === 3, '세 번째 인정 신고 count가 3이 아닙니다.')
  assert(finalUpheld.permanently_banned_at, 'strike 3회에서 permanently_banned_at이 생성되지 않았습니다.')

  const finalRetry = await reviewReport(finalUpheldReport.id, true, 'upheld-final')
  assert(finalRetry.upheld_report_count === 3, '세 번째 판정 재시도가 strike를 중복 증가시켰습니다.')
  assert(
    finalRetry.permanently_banned_at === finalUpheld.permanently_banned_at,
    '세 번째 판정 재시도가 영구 정지 시각을 변경했습니다.',
  )

  const sanctions = await sanctionRow(target.user.id)
  assert(sanctions.upheld_report_count === 3, '저장된 strike count가 3이 아닙니다.')
  assert(sanctions.permanently_banned_at, '제재 행에 permanently_banned_at이 없습니다.')
  assert(
    sanctions.last_reviewed_report_id === finalUpheldReport.id,
    '제재 행의 마지막 판정 신고 ID가 정확하지 않습니다.',
  )

  const banNotifications = await requireData(
    await admin
      .from('notifications')
      .select('id, title, body, link')
      .eq('user_id', target.user.id)
      .eq('title', '계정이 영구 정지되었습니다'),
    '영구 정지 알림 조회 실패',
  )
  assert(banNotifications.length === 1, '영구 정지 알림이 정확히 1건 생성되지 않았습니다.')
  assert(banNotifications[0].link === '/profile', '영구 정지 알림 링크가 프로필이 아닙니다.')

  const canceledQueue = await requireData(
    await admin
      .from('queue_entries')
      .select('status, canceled_at')
      .eq('id', waitingQueue.id)
      .single(),
    '영구 정지 후 대기 큐 조회 실패',
  )
  assert(
    canceledQueue.status === 'canceled' && canceledQueue.canceled_at,
    '영구 정지 시 기존 waiting 큐가 자동 취소되지 않았습니다.',
  )

  const [canceledActiveMatch, canceledMatchedQueues, releasedSlot] = await Promise.all([
    requireData(
      await admin
        .from('matches')
        .select('phase, finalized_at, confirmed_slot_id')
        .eq('id', activeMatchId)
        .single(),
      '영구 정지 후 reporting 매치 조회 실패',
    ),
    requireData(
      await admin
        .from('queue_entries')
        .select('user_id, status, canceled_at')
        .eq('match_id', activeMatchId),
      '영구 정지 후 matched 큐 조회 실패',
    ),
    requireData(
      await admin
        .from('venue_slots')
        .select('status, reserved_match_id')
        .eq('id', slot.id)
        .single(),
      '영구 정지 후 held 슬롯 조회 실패',
    ),
  ])
  assert(
    canceledActiveMatch.phase === 'canceled' && canceledActiveMatch.finalized_at === null,
    '영구 정지 시 미확정 reporting 매치가 canceled 처리되지 않았습니다.',
  )
  assert(
    canceledMatchedQueues.length === 2
      && canceledMatchedQueues.every((entry) => entry.status === 'canceled' && entry.canceled_at),
    '영구 정지 시 active 매치의 matched 큐가 모두 canceled 처리되지 않았습니다.',
  )
  assert(
    releasedSlot.status === 'open' && releasedSlot.reserved_match_id === null,
    '영구 정지 시 active 매치의 held 슬롯이 open으로 반환되지 않았습니다.',
  )

  const partnerRejoined = await rpc(reporter1.client, 'join_match_queue', queueArgs)
  assert(
    partnerRejoined.status === 'waiting' && partnerRejoined.match_id === null,
    '영구 정지로 취소된 reporting 매치의 다른 참가자가 다시 큐에 들어가지 못했습니다.',
  )
  assert(
    await rpc(reporter1.client, 'cancel_match_queue') === true,
    '재큐한 다른 참가자의 검증용 waiting 큐를 취소하지 못했습니다.',
  )

  const [ownSanctions, reporterView, otherSanctions] = await Promise.all([
    requireData(
      await target.client
        .from('account_sanctions')
        .select('profile_id, upheld_report_count, permanently_banned_at, updated_at'),
      '제재 대상의 본인 제재 조회 실패',
    ),
    requireData(
      await reporter1.client
        .from('account_sanctions')
        .select('profile_id, upheld_report_count, permanently_banned_at, updated_at')
        .eq('profile_id', target.user.id),
      '신고자의 타인 제재 RLS 조회 실패',
    ),
    requireData(
      await target.client
        .from('account_sanctions')
        .select('profile_id, upheld_report_count, permanently_banned_at, updated_at')
        .eq('profile_id', reporter1.user.id),
      '제재 대상의 타인 제재 RLS 조회 실패',
    ),
  ])
  assert(
    ownSanctions.length === 1 && ownSanctions[0].profile_id === target.user.id,
    '제재 대상이 본인 제재 행만 조회하지 못합니다.',
  )
  assert(reporterView.length === 0, '신고자에게 제재 대상의 제재 행이 노출됩니다.')
  assert(otherSanctions.length === 0, '제재 대상이 타인의 제재 행을 조회할 수 있습니다.')

  await requireData(
    await admin
      .from('matches')
      .update({
        phase: 'scheduling',
        winner_team: null,
        score: null,
        finalized_at: null,
        confirmed_slot_id: null,
      })
      .eq('id', match1),
    '일반 취소 차단용 매치 준비 실패',
  )
  await expectBannedRpc(target.client, 'cancel_match_queue', {}, '일반 매칭 취소')
  const cancelGuardMatch = await requireData(
    await admin.from('matches').select('phase').eq('id', match1).single(),
    '일반 취소 차단 후 매치 조회 실패',
  )
  assert(cancelGuardMatch.phase === 'scheduling', '영구 정지 사용자의 취소 RPC가 매치를 변경했습니다.')

  await requireData(
    await admin
      .from('matches')
      .update({
        phase: 'reporting',
        winner_team: 'a',
        score: '21-18',
        finalized_at: new Date().toISOString(),
      })
      .eq('id', match1),
    '채팅/명예 차단용 매치 준비 실패',
  )

  await expectBannedRpc(
    target.client,
    'send_match_message',
    { p_match_id: match1, p_body: 'blocked chat' },
    '채팅',
  )
  await expectBannedRpc(
    target.client,
    'give_match_honor',
    { p_match_id: match1, p_receiver_id: reporter1.user.id, p_honor_type: 'manner' },
    '명예',
  )

  const bannedReportInsert = await target.client.from('reports').insert({
    reporter_id: target.user.id,
    reported_id: reporter1.user.id,
    match_id: match3,
    reason: 'blocked-report',
    details: '영구 정지 후 신고 차단 검증',
  })
  assertBannedError(bannedReportInsert.error, '신고')

  await requireData(
    await admin
      .from('matches')
      .update({ winner_team: null, score: null, finalized_at: null, phase: 'reporting' })
      .eq('id', match1),
    '결과 투표 차단용 매치 준비 실패',
  )
  await expectBannedRpc(
    target.client,
    'vote_match_result',
    { p_match_id: match1, p_winner_team: 'a', p_score: '21-18' },
    '결과 투표',
  )

  await requireData(
    await admin
      .from('matches')
      .update({
        winner_team: null,
        score: null,
        finalized_at: null,
        phase: 'scheduling',
        confirmed_slot_id: null,
        acceptance_deadline: null,
      })
      .eq('id', match2),
    '시간 투표 차단용 매치 준비 실패',
  )
  await expectBannedRpc(
    target.client,
    'vote_match_slot',
    { p_match_id: match2, p_venue_slot_id: slot.id },
    '시간 투표',
  )

  await requireData(
    await admin
      .from('matches')
      .update({
        phase: 'queue',
        acceptance_deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      .eq('id', match2),
    '수락 차단용 매치 준비 실패',
  )
  await expectBannedRpc(target.client, 'accept_match', { p_match_id: match2 }, '매치 수락')

  await requireData(
    await admin.from('matches').update({ phase: 'teaming' }).eq('id', match2),
    '준비 차단용 매치 준비 실패',
  )
  await expectBannedRpc(
    target.client,
    'set_match_ready',
    { p_match_id: match2, p_ready: true },
    '팀 준비',
  )

  await requireData(
    await admin.from('matches').update({ phase: 'payment' }).eq('id', match2),
    '참가 확정 차단용 매치 준비 실패',
  )
  await expectBannedRpc(
    target.client,
    'confirm_match_attendance',
    { p_match_id: match2 },
    '참가 확정',
  )

  await requireData(
    await admin
      .from('matches')
      .update({ phase: 'teaming', winner_team: null, score: null, finalized_at: null })
      .eq('id', match3),
    '팀 재편 차단용 매치 준비 실패',
  )
  const teamsBefore = await requireData(
    await admin
      .from('match_members')
      .select('user_id, team')
      .eq('match_id', match3)
      .order('user_id'),
    '팀 재편 차단 전 팀 조회 실패',
  )
  await expectBannedRpc(
    target.client,
    'set_match_teams',
    {
      p_match_id: match3,
      p_team_a: [target.user.id, reporter2.user.id],
      p_team_b: [reporter1.user.id, reporter3.user.id],
    },
    '팀 재편',
  )
  const teamsAfter = await requireData(
    await admin
      .from('match_members')
      .select('user_id, team')
      .eq('match_id', match3)
      .order('user_id'),
    '팀 재편 차단 후 팀 조회 실패',
  )
  assert(
    JSON.stringify(teamsAfter) === JSON.stringify(teamsBefore),
    '영구 정지 host의 팀 재편 RPC가 팀 구성을 변경했습니다.',
  )

  await requireData(
    await admin
      .from('matches')
      .update({ phase: 'reporting', winner_team: 'a', score: '21-18', finalized_at: new Date().toISOString() })
      .eq('id', match2),
    '경기 완료 차단용 매치 준비 실패',
  )
  await requireData(
    await admin
      .from('match_members')
      .update({ completed_at: null })
      .eq('match_id', match2)
      .eq('user_id', target.user.id),
    '경기 완료 차단용 참가자 상태 준비 실패',
  )
  await expectBannedRpc(target.client, 'complete_match', { p_match_id: match2 }, '경기 완료')
  const completionGuard = await requireData(
    await admin
      .from('match_members')
      .select('completed_at')
      .eq('match_id', match2)
      .eq('user_id', target.user.id)
      .single(),
    '경기 완료 차단 후 참가자 상태 조회 실패',
  )
  assert(completionGuard.completed_at === null, '영구 정지 사용자의 complete_match가 완료 상태를 저장했습니다.')

  const [blockedRows, memberState] = await Promise.all([
    Promise.all([
      requireData(
        await admin.from('chat_messages').select('id').eq('match_id', match1).eq('sender_id', target.user.id),
        '차단 후 채팅 잔존 조회 실패',
      ),
      requireData(
        await admin.from('reports').select('id').eq('reporter_id', target.user.id),
        '차단 후 신고 잔존 조회 실패',
      ),
      requireData(
        await admin.from('match_honors').select('id').eq('giver_id', target.user.id),
        '차단 후 명예 잔존 조회 실패',
      ),
      requireData(
        await admin.from('slot_votes').select('match_id').eq('match_id', match2).eq('user_id', target.user.id),
        '차단 후 시간 투표 잔존 조회 실패',
      ),
      requireData(
        await admin.from('result_votes').select('match_id').eq('match_id', match1).eq('user_id', target.user.id),
        '차단 후 결과 투표 잔존 조회 실패',
      ),
    ]),
    requireData(
      await admin
        .from('match_members')
        .select('accepted_at, ready, paid')
        .eq('match_id', match2)
        .eq('user_id', target.user.id)
        .single(),
      '차단 후 참가자 상태 조회 실패',
    ),
  ])
  assert(blockedRows.every((rows) => rows.length === 0), '차단된 사용자 동작이 DB에 저장되었습니다.')
  assert(
    memberState.accepted_at === null && memberState.ready === false && memberState.paid === false,
    '영구 정지 후 accepted/ready/paid 상태가 변경되었습니다.',
  )

  const matchIds = [...context.matchIds]
  await requireData(
    await admin.from('matches').update({ phase: 'done' }).in('id', matchIds),
    '새 큐 차단용 매치 종료 처리 실패',
  )
  await requireData(
    await admin
      .from('match_members')
      .update({ completed_at: new Date().toISOString() })
      .in('match_id', matchIds)
      .eq('user_id', target.user.id),
    '새 큐 차단용 결과 확인 처리 실패',
  )

  await expectBannedRpc(
    target.client,
    'join_match_queue',
    {
      p_sport: 'badminton',
      p_mode: '1v1',
      p_venue_id: context.venueId,
      p_lat: null,
      p_lng: null,
    },
    '새 매칭 큐 진입',
  )
  const targetWaitingQueues = await requireData(
    await admin
      .from('queue_entries')
      .select('id')
      .eq('user_id', target.user.id)
      .eq('status', 'waiting'),
    '영구 정지 후 waiting 큐 조회 실패',
  )
  assert(targetWaitingQueues.length === 0, '영구 정지 후 새 waiting 큐가 남았습니다.')

  console.log('✓ 일반 사용자 판정 차단/dismissed·미검토 legacy resolved strike 제외')
  console.log('✓ legacy resolved 명시 판정/strike 1·2회 미정지/동일 판정 재시도 멱등')
  console.log('✓ upheld 3회 영구 정지/알림 1건/waiting 큐 자동 취소')
  console.log('✓ reporting active 매치·matched 큐 원자 취소/held 슬롯 반환/상대 재큐')
  console.log('✓ 본인 제재만 조회/타인 제재 RLS 차단')
  console.log('✓ queue/cancel/teams/complete/chat/report/honor/slot/result/accepted/ready/paid 차단')
  console.log(`신고 제재 검증 성공: ${target.user.id}`)
}

async function main() {
  const context = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    actors: [],
    venueId: null,
    slotId: null,
    queueId: null,
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
    console.log('✓ 신고 제재 검증 데이터 정리 완료')
  } catch (cleanupError) {
    if (verificationError) {
      console.error('검증 중 오류:', verificationError instanceof Error ? verificationError.message : verificationError)
    }
    verificationError = cleanupError
  }

  if (verificationError) throw verificationError
}

main().catch((error) => {
  console.error('신고 제재 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
