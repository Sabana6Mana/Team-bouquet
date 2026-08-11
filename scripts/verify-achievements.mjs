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
  console.error('Supabase 도전과제 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 Docker Desktop과 `npm run supabase:start`를 먼저 실행하세요.')
  console.error('원격 프로젝트는 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-achievement-verify-${name}`,
    },
  })
}

const admin = client('admin', serviceKey)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertObject(value, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: 객체 응답이 아닙니다.`)
  return value
}

function assertKeys(value, expected, label) {
  const row = assertObject(value, label)
  for (const keyName of expected) {
    assert(Object.hasOwn(row, keyName), `${label}: ${keyName} 필드가 없습니다.`)
  }
  return row
}

function assertAchievementRows(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label}: 도전과제 배열이 비어 있습니다.`)
  for (const rowValue of value) {
    const row = assertKeys(rowValue, [
      'code', 'name', 'description', 'icon', 'reward_title', 'rarity',
      'target', 'progress', 'unlocked_at', 'equipped',
    ], label)
    assert(typeof row.code === 'string' && row.code.length > 0, `${label}: code 형식이 잘못되었습니다.`)
    assert(typeof row.name === 'string' && typeof row.description === 'string', `${label}: 설명 필드 형식이 잘못되었습니다.`)
    assert(typeof row.icon === 'string' && typeof row.reward_title === 'string', `${label}: 보상 필드 형식이 잘못되었습니다.`)
    assert(['common', 'rare', 'epic', 'legendary'].includes(row.rarity), `${label}: rarity 형식이 잘못되었습니다.`)
    assert(Number.isInteger(row.target) && row.target > 0, `${label}: target 형식이 잘못되었습니다.`)
    assert(Number.isInteger(row.progress) && row.progress >= 0, `${label}: progress 형식이 잘못되었습니다.`)
    assert(row.unlocked_at === null || typeof row.unlocked_at === 'string', `${label}: unlocked_at 형식이 잘못되었습니다.`)
    assert(typeof row.equipped === 'boolean', `${label}: equipped 형식이 잘못되었습니다.`)
  }
  return value
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

async function anonymous(name) {
  const value = client(name)
  const { data, error } = await value.auth.signInAnonymously()
  if (error) throw error
  assert(data.user && data.session, `${name}: 익명 사용자 생성 실패`)
  return { client: value, user: data.user }
}

async function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

function rowByCode(rows, code, label) {
  const row = rows.find((candidate) => candidate.code === code)
  assert(row, `${label}: ${code} 도전과제가 없습니다.`)
  return row
}

async function achievementState(profileId, codes) {
  const data = await requireData(
    await admin
      .from('player_achievements')
      .select('profile_id, achievement_code, progress, unlocked_at, unlocked_match_id, notified_at')
      .eq('profile_id', profileId)
      .in('achievement_code', codes)
      .order('achievement_code'),
    '도전과제 내부 상태 조회 실패',
  )
  return data ?? []
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
  const matchIds = new Set(context.matchId ? [context.matchId] : [])
  if (userIds.length > 0) {
    await attempt('정리할 매치 탐색', async () => {
      const result = await admin
        .from('match_members')
        .select('match_id')
        .in('user_id', userIds)
      if (result.error) throw result.error
      for (const row of result.data ?? []) matchIds.add(row.match_id)
    })
  }

  if (matchIds.size > 0) {
    await attempt('테스트 매치 삭제', () =>
      admin.from('matches').delete().in('id', [...matchIds]),
    )
  }
  if (userIds.length > 0) {
    await attempt('테스트 큐 삭제', () =>
      admin.from('queue_entries').delete().in('user_id', userIds),
    )
  }
  if (context.slotId) {
    await attempt('테스트 슬롯 삭제', () =>
      admin.from('venue_slots').delete().eq('id', context.slotId),
    )
  }
  if (context.venueId) {
    await attempt('테스트 체육관 삭제', () =>
      admin.from('venues').delete().eq('id', context.venueId),
    )
  }

  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () =>
      admin.auth.admin.deleteUser(userId),
    )
  }

  if (userIds.length > 0) {
    await attempt('테스트 프로필 잔존 확인', async () => {
      const result = await admin.from('profiles').select('id').in('id', userIds)
      if (result.error) throw result.error
      assert((result.data ?? []).length === 0, '삭제되지 않은 테스트 프로필이 있습니다.')
    })
  }
  if (context.venueId) {
    await attempt('테스트 체육관 잔존 확인', async () => {
      const result = await admin.from('venues').select('id').eq('id', context.venueId)
      if (result.error) throw result.error
      assert((result.data ?? []).length === 0, '삭제되지 않은 테스트 체육관이 있습니다.')
    })
  }

  if (failures.length > 0) throw new Error(`검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
}

async function runVerification(context) {
  const runId = context.runId
  const nicknameSuffix = runId.slice(-7)
  const venueId = `verify-ach-${runId}`
  context.venueId = venueId

  await requireData(
    await admin.from('venues').insert({
      id: venueId,
      name: `도전과제 검증 체육관 ${runId}`,
      sports: ['badminton'],
      address: '자동 검증 전용',
      lat: 37.5001,
      lng: 127.0401,
      price_per_hour: 20_000,
      active: true,
    }),
    '격리된 테스트 체육관 생성 실패',
  )

  const futureStart = new Date(Date.now() + 365 * 24 * 60 * 60_000)
  const futureEnd = new Date(futureStart.getTime() + 60 * 60_000)
  const slot = await requireData(
    await admin
      .from('venue_slots')
      .insert({
        venue_id: venueId,
        starts_at: futureStart.toISOString(),
        ends_at: futureEnd.toISOString(),
        status: 'open',
        price: 20_000,
      })
      .select('id, status, starts_at, ends_at')
      .single(),
    '안전한 미래 테스트 슬롯 생성 실패',
  )
  context.slotId = slot.id
  assert(slot.status === 'open' && new Date(slot.starts_at) > new Date(), '테스트 슬롯이 미래 open 상태가 아닙니다.')

  // Register each actor in the cleanup context immediately. If the second auth
  // request fails, the first user must still be removed in `finally`.
  const first = await anonymous(`winner-${runId}`)
  context.actors.push(first)
  const second = await anonymous(`loser-${runId}`)
  context.actors.push(second)

  const [firstProfile, secondProfile] = await Promise.all([
    rpc(first.client, 'save_my_profile', {
      p_nickname: `a${nicknameSuffix}`,
      p_interests: ['badminton'],
      p_avatar_url: '🦖',
    }),
    rpc(second.client, 'save_my_profile', {
      p_nickname: `b${nicknameSuffix}`,
      p_interests: ['badminton'],
      p_avatar_url: '🐲',
    }),
  ])
  assertKeys(firstProfile, ['id', 'nickname', 'interests', 'onboarding_completed_at'], 'save_my_profile 첫 사용자 응답')
  assertKeys(secondProfile, ['id', 'nickname', 'interests', 'onboarding_completed_at'], 'save_my_profile 두 번째 사용자 응답')

  const duplicateAvailable = await rpc(second.client, 'is_nickname_available', {
    p_nickname: firstProfile.nickname.toUpperCase(),
  })
  assert(duplicateAvailable === false, '대소문자만 다른 중복 닉네임이 사용 가능으로 표시됩니다.')
  await expectRpcError(
    second.client,
    'save_my_profile',
    {
      p_nickname: firstProfile.nickname.toUpperCase(),
      p_interests: ['badminton'],
      p_avatar_url: null,
    },
    '대소문자만 다른 중복 닉네임 저장이 허용되었습니다.',
  )
  const directProfileUpdate = await first.client
    .from('profiles')
    .update({ nickname: '열세글자닉네임우회시도입니다' })
    .eq('id', first.user.id)
  assert(directProfileUpdate.error, '브라우저가 프로필 저장 RPC를 우회해 직접 수정할 수 있습니다.')

  // A very low, isolated rating prevents a concurrently-running normal test or
  // browser user from being pulled into this verifier's queue.
  await requireData(
    await admin
      .from('player_ratings')
      .update({ rating: 101 })
      .in('profile_id', [first.user.id, second.user.id])
      .eq('sport', 'badminton'),
    '테스트 매칭 풀 격리 실패',
  )

  const initialFirst = assertAchievementRows(
    await rpc(first.client, 'get_my_achievements'),
    '경기 전 도전과제 응답',
  )
  const lockedFirstMatch = rowByCode(initialFirst, 'first_match', '경기 전 도전과제 응답')
  assert(lockedFirstMatch.progress === 0 && lockedFirstMatch.unlocked_at === null, '첫 경기 전 first_match가 잠금 상태가 아닙니다.')
  await expectRpcError(
    first.client,
    'equip_my_title',
    { p_achievement_code: 'first_match' },
    '잠긴 칭호를 장착할 수 있습니다.',
  )

  const forbiddenInsert = await first.client.from('player_achievements').insert({
    profile_id: first.user.id,
    achievement_code: 'first_match',
    progress: 999,
  })
  assert(forbiddenInsert.error, '브라우저 사용자가 도전과제 진행도를 직접 생성할 수 있습니다.')
  const forbiddenUpdate = await first.client
    .from('player_achievements')
    .update({ progress: 999 })
    .eq('profile_id', first.user.id)
    .eq('achievement_code', 'first_match')
  assert(forbiddenUpdate.error, '브라우저 사용자가 도전과제 진행도를 직접 변경할 수 있습니다.')

  const queueArgs = {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: venueId,
    p_lat: null,
    p_lng: null,
  }
  const waiting = assertKeys(
    await rpc(first.client, 'join_match_queue', queueArgs),
    ['queue_entry', 'status', 'match_id'],
    '첫 큐 응답',
  )
  assert(waiting.status === 'waiting' && waiting.match_id === null, '첫 사용자가 waiting 상태가 아닙니다.')
  assertKeys(waiting.queue_entry, ['id', 'user_id', 'sport', 'mode', 'status'], '큐 엔트리 응답')

  const matched = assertKeys(
    await rpc(second.client, 'join_match_queue', queueArgs),
    ['queue_entry', 'status', 'match_id'],
    '매칭 성사 응답',
  )
  assert(matched.status === 'matched' && typeof matched.match_id === 'string', '두 번째 사용자 참가 후 매칭이 성사되지 않았습니다.')
  context.matchId = matched.match_id

  const members = await requireData(
    await first.client
      .from('match_members')
      .select('user_id, team')
      .eq('match_id', context.matchId)
      .order('user_id'),
    '매치 참가자 조회 실패',
  )
  assert(members?.length === 2, '1v1 매치 참가자가 정확히 두 명이 아닙니다.')
  const firstTeam = members.find((member) => member.user_id === first.user.id)?.team
  assert(firstTeam === 'a' || firstTeam === 'b', '승자 팀을 결정할 수 없습니다.')

  const firstAcceptance = await rpc(first.client, 'accept_match', { p_match_id: context.matchId })
  assert(firstAcceptance.phase === 'queue', '첫 번째 매칭 수락 뒤 queue 상태가 유지되지 않았습니다.')
  const secondAcceptance = await rpc(second.client, 'accept_match', { p_match_id: context.matchId })
  assert(secondAcceptance.phase === 'scheduling', '전원 매칭 수락 뒤 scheduling 단계로 전환되지 않았습니다.')

  const firstSlotVote = assertKeys(
    await rpc(first.client, 'vote_match_slot', {
      p_match_id: context.matchId,
      p_venue_slot_id: context.slotId,
    }),
    ['match_id', 'venue_slot_id', 'consensus', 'votes', 'members', 'phase'],
    '첫 시간 투표 응답',
  )
  assert(firstSlotVote.consensus === false && firstSlotVote.phase === 'scheduling', '첫 시간 투표가 잘못 확정되었습니다.')
  const slotConsensus = assertKeys(
    await rpc(second.client, 'vote_match_slot', {
      p_match_id: context.matchId,
      p_venue_slot_id: context.slotId,
    }),
    ['match_id', 'venue_slot_id', 'consensus', 'votes', 'members', 'phase'],
    '시간 합의 응답',
  )
  assert(slotConsensus.consensus === true && slotConsensus.phase === 'payment', '시간 합의가 payment 단계로 전환되지 않았습니다.')

  const firstAttendance = assertKeys(
    await rpc(first.client, 'confirm_match_attendance', { p_match_id: context.matchId }),
    ['match_id', 'confirmed_count', 'members', 'all_confirmed', 'phase'],
    '첫 참가 확정 응답',
  )
  assert(firstAttendance.all_confirmed === false && firstAttendance.phase === 'payment', '한 명만 확인했는데 경기가 확정되었습니다.')
  const attendance = assertKeys(
    await rpc(second.client, 'confirm_match_attendance', { p_match_id: context.matchId }),
    ['match_id', 'confirmed_count', 'members', 'all_confirmed', 'phase'],
    '전원 참가 확정 응답',
  )
  assert(attendance.all_confirmed === true && attendance.phase === 'confirmed', '전원 참가 확정이 confirmed 단계로 전환되지 않았습니다.')

  const endedAt = new Date(Date.now() - 60_000)
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000)
  await requireData(
    await admin
      .from('venue_slots')
      .update({ starts_at: startedAt.toISOString(), ends_at: endedAt.toISOString() })
      .eq('id', context.slotId),
    '테스트 슬롯 종료 시각 전환 실패',
  )

  const reporting = assertKeys(
    await rpc(first.client, 'open_match_reporting', { p_match_id: context.matchId }),
    ['match_id', 'phase'],
    '결과 입력 시작 응답',
  )
  assert(reporting.phase === 'reporting', '결과 입력 단계가 열리지 않았습니다.')

  // Both users vote concurrently. The match row lock must serialize finalization,
  // and exactly one response must report consensus.
  const resultResponses = await Promise.all([
    rpc(first.client, 'vote_match_result', {
      p_match_id: context.matchId,
      p_winner_team: firstTeam,
      p_score: '21-18',
    }),
    rpc(second.client, 'vote_match_result', {
      p_match_id: context.matchId,
      p_winner_team: firstTeam,
      p_score: '21-18',
    }),
  ])
  for (const [index, response] of resultResponses.entries()) {
    assertKeys(
      response,
      ['match_id', 'winner_team', 'consensus', 'votes', 'members', 'phase'],
      `동시 결과 투표 ${index + 1} 응답`,
    )
  }
  assert(resultResponses.filter((response) => response.consensus === true).length === 1, '동시 결과 투표가 정확히 한 번 확정되지 않았습니다.')

  await expectRpcError(
    first.client,
    'vote_match_result',
    { p_match_id: context.matchId, p_winner_team: firstTeam, p_score: '21-18' },
    '확정된 경기 결과를 반복 투표할 수 있습니다.',
  )

  const firstRows = assertAchievementRows(
    await rpc(first.client, 'get_my_achievements'),
    '승자 도전과제 응답',
  )
  const secondRows = assertAchievementRows(
    await rpc(second.client, 'get_my_achievements'),
    '패자 도전과제 응답',
  )
  const winnerFirstMatch = rowByCode(firstRows, 'first_match', '승자 도전과제')
  const winnerFirstWin = rowByCode(firstRows, 'first_win', '승자 도전과제')
  const loserFirstMatch = rowByCode(secondRows, 'first_match', '패자 도전과제')
  const loserFirstWin = rowByCode(secondRows, 'first_win', '패자 도전과제')
  assert(winnerFirstMatch.progress === 1 && winnerFirstMatch.unlocked_at, '승자의 first_match가 해금되지 않았습니다.')
  assert(winnerFirstWin.progress === 1 && winnerFirstWin.unlocked_at, '승자의 first_win이 해금되지 않았습니다.')
  assert(loserFirstMatch.progress === 1 && loserFirstMatch.unlocked_at, '패자의 first_match가 해금되지 않았습니다.')
  assert(loserFirstWin.progress === 0 && loserFirstWin.unlocked_at === null, '패자에게 first_win이 잘못 해금되었습니다.')

  const beforeRefresh = await achievementState(first.user.id, ['first_match', 'first_win'])
  assert(beforeRefresh.length === 2, '승자의 핵심 해금 행이 정확히 두 개가 아닙니다.')
  await Promise.all([
    rpc(admin, 'refresh_profile_achievements', {
      p_profile_id: first.user.id,
      p_source_match: context.matchId,
    }),
    rpc(admin, 'refresh_profile_achievements', {
      p_profile_id: first.user.id,
      p_source_match: context.matchId,
    }),
    rpc(admin, 'refresh_profile_achievements', {
      p_profile_id: second.user.id,
      p_source_match: context.matchId,
    }),
    rpc(admin, 'refresh_profile_achievements', {
      p_profile_id: second.user.id,
      p_source_match: context.matchId,
    }),
  ])
  const afterRefresh = await achievementState(first.user.id, ['first_match', 'first_win'])
  assert(afterRefresh.length === 2, '반복 갱신 후 도전과제 행이 중복되었습니다.')
  for (const before of beforeRefresh) {
    const after = afterRefresh.find((row) => row.achievement_code === before.achievement_code)
    assert(after, `${before.achievement_code}: 반복 갱신 후 행이 사라졌습니다.`)
    assert(after.progress === before.progress, `${before.achievement_code}: 반복 갱신으로 progress가 변했습니다.`)
    assert(after.unlocked_at === before.unlocked_at, `${before.achievement_code}: 반복 갱신으로 unlocked_at이 변했습니다.`)
    assert(after.unlocked_match_id === before.unlocked_match_id, `${before.achievement_code}: 해금 원본 매치가 변했습니다.`)
    assert(after.notified_at === before.notified_at, `${before.achievement_code}: 반복 갱신으로 알림 idempotency가 깨졌습니다.`)
  }

  const [winnerNotifications, loserNotifications] = await Promise.all([
    requireData(
      await admin
        .from('notifications')
        .select('id, title')
        .eq('user_id', first.user.id)
        .like('title', '도전과제 달성!%'),
      '승자 해금 알림 조회 실패',
    ),
    requireData(
      await admin
        .from('notifications')
        .select('id, title')
        .eq('user_id', second.user.id)
        .like('title', '도전과제 달성!%'),
      '패자 해금 알림 조회 실패',
    ),
  ])
  assert(winnerNotifications?.length === 2, `승자의 first_match/first_win 알림 개수가 ${winnerNotifications?.length ?? 0}개입니다.`)
  assert(loserNotifications?.length === 1, `패자의 first_match 알림 개수가 ${loserNotifications?.length ?? 0}개입니다.`)

  const outsiderProgress = await requireData(
    await second.client
      .from('player_achievements')
      .select('achievement_code, progress')
      .eq('profile_id', first.user.id),
    '타 사용자 도전과제 RLS 조회 실패',
  )
  assert((outsiderProgress ?? []).length === 0, '다른 사용자의 비공개 도전과제 진행도가 노출됩니다.')

  const equippedFirstWin = await rpc(first.client, 'equip_my_title', {
    p_achievement_code: 'first_win',
  })
  assert(equippedFirstWin === 'first_win', '해금한 칭호 장착 RPC 응답이 잘못되었습니다.')
  const equippedAgain = await rpc(first.client, 'equip_my_title', {
    p_achievement_code: 'first_win',
  })
  assert(equippedAgain === 'first_win', '칭호 반복 장착이 멱등하지 않습니다.')
  const equippedRows = assertAchievementRows(
    await rpc(first.client, 'get_my_achievements'),
    '칭호 장착 후 도전과제 응답',
  )
  assert(rowByCode(equippedRows, 'first_win', '칭호 장착 확인').equipped === true, '장착한 칭호가 목록에 반영되지 않았습니다.')
  assert(equippedRows.filter((row) => row.equipped).length === 1, '둘 이상의 칭호가 동시에 장착되었습니다.')

  const cleared = await rpc(first.client, 'equip_my_title', { p_achievement_code: null })
  assert(cleared === null, '칭호 해제 RPC가 null을 반환하지 않았습니다.')
  const profileAfterClear = await requireData(
    await first.client
      .from('profiles')
      .select('equipped_title_code')
      .eq('id', first.user.id)
      .single(),
    '칭호 해제 프로필 조회 실패',
  )
  assert(profileAfterClear.equipped_title_code === null, '칭호가 프로필에서 해제되지 않았습니다.')

  const firstComplete = assertKeys(
    await rpc(first.client, 'complete_match', { p_match_id: context.matchId }),
    ['match_id', 'phase', 'acknowledged', 'remaining_members'],
    '첫 참가자 경기 완료 응답',
  )
  assert(firstComplete.phase === 'done' && firstComplete.remaining_members === 1, '첫 참가자의 완료 상태가 올바르게 기록되지 않았습니다.')
  const completionRows = await requireData(
    await admin
      .from('match_members')
      .select('user_id, completed_at')
      .eq('match_id', context.matchId),
    '참가자별 경기 완료 상태 조회 실패',
  )
  assert(completionRows.find((row) => row.user_id === first.user.id)?.completed_at, '첫 참가자의 completed_at이 기록되지 않았습니다.')
  assert(completionRows.find((row) => row.user_id === second.user.id)?.completed_at === null, '상대의 결과 확인이 자동 완료되었습니다.')

  await requireData(
    await admin
      .from('venue_slots')
      .update({
        starts_at: futureStart.toISOString(),
        ends_at: futureEnd.toISOString(),
        status: 'open',
        reserved_match_id: null,
      })
      .eq('id', context.slotId)
      .select('id')
      .single(),
    '완료 후 재매칭용 미래 슬롯 복구 실패',
  )
  const nextQueue = await rpc(first.client, 'join_match_queue', queueArgs)
  assert(nextQueue.status === 'waiting', '결과를 확인한 사용자가 다음 매칭을 시작하지 못했습니다.')
  assert(await rpc(first.client, 'cancel_match_queue') === true, '완료 후 생성한 검증 큐를 취소하지 못했습니다.')

  const complete = assertKeys(
    await rpc(second.client, 'complete_match', { p_match_id: context.matchId }),
    ['match_id', 'phase', 'acknowledged', 'remaining_members'],
    '두 번째 참가자 경기 완료 응답',
  )
  assert(complete.phase === 'done' && complete.remaining_members === 0, '전원 확인 뒤 1v1 흐름이 done 단계로 끝나지 않았습니다.')

  console.log('✓ 격리된 미래 슬롯에서 익명 사용자 1v1 전체 흐름')
  console.log('✓ 승자 first_match/first_win · 패자 first_match 해금')
  console.log('✓ 잠긴 칭호 거부 · 해금 칭호 장착/반복 장착/해제')
  console.log('✓ 진행도 직접 쓰기 차단 · 타 사용자 진행도 RLS')
  console.log('✓ RPC 응답 shape · 동시 결과 확정 · 해금/알림 멱등성')
  console.log(`도전과제 검증 성공: ${context.matchId}`)
}

async function main() {
  const context = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    actors: [],
    matchId: null,
    slotId: null,
    venueId: null,
  }
  console.log(`MATCHPOINT 도전과제 검증 시작 (${url})`)

  let verificationError = null
  try {
    await runVerification(context)
  } catch (error) {
    verificationError = error
  }

  try {
    await cleanup(context)
    console.log('✓ 검증 데이터 정리 완료')
  } catch (cleanupError) {
    if (verificationError) {
      console.error('검증 중 오류:', verificationError instanceof Error ? verificationError.message : verificationError)
    }
    verificationError = cleanupError
  }

  if (verificationError) throw verificationError
}

main().catch((error) => {
  console.error('도전과제 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
