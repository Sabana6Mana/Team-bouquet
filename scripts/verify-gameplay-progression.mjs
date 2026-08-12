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
  console.error('Supabase 게임 진행도 검증 연결 정보를 찾지 못했습니다.')
  console.error('로컬에서는 Docker Desktop과 `npm run supabase:start`를 먼저 실행하세요.')
  console.error('원격 프로젝트는 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  process.exit(1)
}

function client(name, apiKey = key) {
  return createClient(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `matchpoint-gameplay-verify-${name}`,
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

function assertSummary(value, label) {
  const summary = assertKeys(value, ['region', 'venues', 'boss', 'season'], label)
  const region = assertKeys(summary.region, ['code', 'name', 'discovered', 'total'], `${label}.region`)
  assert(typeof region.code === 'string' && typeof region.name === 'string', `${label}.region: 지역 식별자가 잘못되었습니다.`)
  assert(Number.isInteger(region.discovered) && region.discovered >= 0, `${label}.region: discovered가 잘못되었습니다.`)
  assert(Number.isInteger(region.total) && region.total >= region.discovered, `${label}.region: total이 잘못되었습니다.`)

  assert(Array.isArray(summary.venues), `${label}.venues: 배열이 아닙니다.`)
  for (const valueRow of summary.venues) {
    const row = assertKeys(valueRow, ['venue_id', 'discovered_at', 'visits'], `${label}.venues[]`)
    assert(typeof row.venue_id === 'string' && row.venue_id.length > 0, `${label}.venues[]: venue_id가 잘못되었습니다.`)
    assert(
      row.discovered_at === null || typeof row.discovered_at === 'string',
      `${label}.venues[]: discovered_at이 잘못되었습니다.`,
    )
    assert(Number.isInteger(row.visits) && row.visits >= 0, `${label}.venues[]: visits가 잘못되었습니다.`)
  }

  if (summary.boss !== null) {
    const boss = assertKeys(summary.boss, [
      'event_id', 'venue_id', 'sport', 'boss_name', 'boss_avatar_url', 'boss_rating',
      'challenge_id', 'challenge_status', 'can_challenge', 'title_code', 'title_unlocked',
      'max_hp', 'remaining_hp', 'damage_per_match', 'ends_at', 'my_contribution',
      'throne_name', 'throne_points', 'defeated',
    ], `${label}.boss`)
    assert(typeof boss.event_id === 'string' && typeof boss.venue_id === 'string', `${label}.boss: 이벤트 식별자가 잘못되었습니다.`)
    assert(boss.sport === 'badminton', `${label}.boss: 배드민턴 보스가 아닙니다.`)
    assert(typeof boss.boss_name === 'string' && boss.boss_name.length > 0, `${label}.boss: 보스 이름이 잘못되었습니다.`)
    assert(
      boss.boss_avatar_url === null || typeof boss.boss_avatar_url === 'string',
      `${label}.boss: 보스 아바타가 잘못되었습니다.`,
    )
    assert(Number.isInteger(boss.boss_rating) && boss.boss_rating >= 100, `${label}.boss: 보스 레이팅이 잘못되었습니다.`)
    assert(
      boss.challenge_id === null || typeof boss.challenge_id === 'string',
      `${label}.boss: challenge_id가 잘못되었습니다.`,
    )
    assert(
      boss.challenge_status === null
        || ['active', 'won', 'lost', 'abandoned'].includes(boss.challenge_status),
      `${label}.boss: challenge_status가 잘못되었습니다.`,
    )
    assert(typeof boss.can_challenge === 'boolean', `${label}.boss: can_challenge가 boolean이 아닙니다.`)
    assert(
      boss.title_code === null || boss.title_code === 'boss_raider',
      `${label}.boss: title_code가 잘못되었습니다.`,
    )
    assert(typeof boss.title_unlocked === 'boolean', `${label}.boss: title_unlocked가 boolean이 아닙니다.`)
    assert(Number.isInteger(boss.max_hp) && boss.max_hp > 0, `${label}.boss: max_hp가 잘못되었습니다.`)
    assert(
      Number.isInteger(boss.remaining_hp) && boss.remaining_hp >= 0 && boss.remaining_hp <= boss.max_hp,
      `${label}.boss: remaining_hp가 잘못되었습니다.`,
    )
    assert(Number.isInteger(boss.damage_per_match) && boss.damage_per_match > 0, `${label}.boss: damage_per_match가 잘못되었습니다.`)
    assert(Number.isInteger(boss.my_contribution) && boss.my_contribution >= 0, `${label}.boss: my_contribution이 잘못되었습니다.`)
    assert(Number.isInteger(boss.throne_points) && boss.throne_points >= 0, `${label}.boss: throne_points가 잘못되었습니다.`)
    assert(typeof boss.ends_at === 'string' && typeof boss.defeated === 'boolean', `${label}.boss: 종료 상태가 잘못되었습니다.`)
    assert(boss.throne_name === null || typeof boss.throne_name === 'string', `${label}.boss: throne_name이 잘못되었습니다.`)
  }

  if (summary.season !== null) {
    const season = assertKeys(summary.season, ['code', 'name', 'ends_at', 'quests'], `${label}.season`)
    assert(typeof season.code === 'string' && typeof season.name === 'string', `${label}.season: 시즌 식별자가 잘못되었습니다.`)
    assert(typeof season.ends_at === 'string' && Array.isArray(season.quests), `${label}.season: 시즌 응답이 잘못되었습니다.`)
    for (const valueRow of season.quests) {
      const row = assertKeys(valueRow, [
        'achievement_code', 'name', 'description', 'icon', 'reward_title',
        'target', 'progress', 'unlocked_at',
      ], `${label}.season.quests[]`)
      assert(typeof row.achievement_code === 'string' && row.achievement_code.length > 0, `${label}.season.quests[]: 코드가 잘못되었습니다.`)
      assert(typeof row.name === 'string' && typeof row.description === 'string', `${label}.season.quests[]: 설명이 잘못되었습니다.`)
      assert(typeof row.icon === 'string' && typeof row.reward_title === 'string', `${label}.season.quests[]: 보상이 잘못되었습니다.`)
      assert(Number.isInteger(row.target) && row.target > 0, `${label}.season.quests[]: target이 잘못되었습니다.`)
      assert(Number.isInteger(row.progress) && row.progress >= 0 && row.progress <= row.target, `${label}.season.quests[]: progress가 잘못되었습니다.`)
      assert(row.unlocked_at === null || typeof row.unlocked_at === 'string', `${label}.season.quests[]: unlocked_at이 잘못되었습니다.`)
    }
  }

  return summary
}

function assertChallenge(value, label) {
  const challenge = assertKeys(value, [
    'challenge_id', 'event_id', 'venue_id', 'sport', 'boss_name', 'boss_avatar_url',
    'boss_rating', 'status', 'won', 'score', 'title_code', 'title_unlocked', 'newly_unlocked',
  ], label)
  assert(typeof challenge.challenge_id === 'string', `${label}: challenge_id가 잘못되었습니다.`)
  assert(typeof challenge.event_id === 'string' && typeof challenge.venue_id === 'string', `${label}: 이벤트 식별자가 잘못되었습니다.`)
  assert(challenge.sport === 'badminton', `${label}: 배드민턴 보스전이 아닙니다.`)
  assert(typeof challenge.boss_name === 'string' && challenge.boss_name.length > 0, `${label}: 보스 이름이 잘못되었습니다.`)
  assert(
    challenge.boss_avatar_url === null || typeof challenge.boss_avatar_url === 'string',
    `${label}: 보스 아바타가 잘못되었습니다.`,
  )
  assert(Number.isInteger(challenge.boss_rating) && challenge.boss_rating >= 100, `${label}: 보스 레이팅이 잘못되었습니다.`)
  assert(['active', 'won', 'lost', 'abandoned'].includes(challenge.status), `${label}: status가 잘못되었습니다.`)
  assert(challenge.won === null || typeof challenge.won === 'boolean', `${label}: won이 잘못되었습니다.`)
  assert(challenge.score === null || typeof challenge.score === 'string', `${label}: score가 잘못되었습니다.`)
  assert(
    challenge.title_code === null || challenge.title_code === 'boss_raider',
    `${label}: title_code가 잘못되었습니다.`,
  )
  assert(typeof challenge.title_unlocked === 'boolean', `${label}: title_unlocked가 boolean이 아닙니다.`)
  assert(typeof challenge.newly_unlocked === 'boolean', `${label}: newly_unlocked가 boolean이 아닙니다.`)
  return challenge
}

function assertOutcome(value, label) {
  const outcome = assertKeys(value, [
    'match_id', 'new_venue', 'venue_id', 'collection_discovered', 'collection_total',
    'boss_damage', 'boss_remaining_hp', 'unlocked_achievement_codes',
  ], label)
  assert(typeof outcome.match_id === 'string' && typeof outcome.venue_id === 'string', `${label}: 경기·체육관 식별자가 잘못되었습니다.`)
  assert(typeof outcome.new_venue === 'boolean', `${label}: new_venue가 boolean이 아닙니다.`)
  assert(Number.isInteger(outcome.collection_discovered) && outcome.collection_discovered >= 0, `${label}: collection_discovered가 잘못되었습니다.`)
  assert(
    Number.isInteger(outcome.collection_total) && outcome.collection_total >= outcome.collection_discovered,
    `${label}: collection_total이 잘못되었습니다.`,
  )
  assert(Number.isInteger(outcome.boss_damage) && outcome.boss_damage >= 0, `${label}: boss_damage가 잘못되었습니다.`)
  assert(
    outcome.boss_remaining_hp === null || (Number.isInteger(outcome.boss_remaining_hp) && outcome.boss_remaining_hp >= 0),
    `${label}: boss_remaining_hp가 잘못되었습니다.`,
  )
  assert(
    Array.isArray(outcome.unlocked_achievement_codes)
      && outcome.unlocked_achievement_codes.every((code) => typeof code === 'string'),
    `${label}: unlocked_achievement_codes가 잘못되었습니다.`,
  )
  return outcome
}

function rowByCode(rows, code, label) {
  const row = rows.find((candidate) => candidate.achievement_code === code)
  assert(row, `${label}: ${code} 퀘스트가 없습니다.`)
  return row
}

async function createPastSlot(context, venueId, startsAt) {
  const slot = await requireData(
    await admin
      .from('venue_slots')
      .insert({
        venue_id: venueId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
        status: 'open',
        price: 0,
      })
      .select('id, venue_id, starts_at, ends_at, status')
      .single(),
    '격리된 과거 슬롯 생성 실패',
  )
  context.slotIds.add(slot.id)
  return slot
}

async function createMatch(context, options) {
  const { venueId, slot, first, second, phase, finalized } = options
  const finalizedAt = finalized ? new Date().toISOString() : null
  const match = await requireData(
    await admin
      .from('matches')
      .insert({
        venue_id: venueId,
        sport: 'badminton',
        mode: '1v1',
        capacity: 2,
        host_id: first.user.id,
        // A finalized row is inserted as canceled before members exist, so the
        // automatic gameplay trigger deliberately skips it. Moving only the
        // phase after members are present lets the eight concurrent sync calls
        // race on the first real processing attempt instead of a cached result.
        phase: finalized ? 'canceled' : phase,
        quick: false,
        confirmed_slot_id: slot.id,
        winner_team: finalized ? 'a' : null,
        score: finalized ? '21-18' : null,
        finalized_at: finalizedAt,
      })
      .select('id, phase, finalized_at')
      .single(),
    `${phase} 검증 매치 생성 실패`,
  )
  context.matchIds.add(match.id)

  await requireData(
    await admin.from('match_members').insert([
      {
        match_id: match.id,
        user_id: first.user.id,
        team: 'a',
        is_host: true,
        ready: true,
        paid: true,
      },
      {
        match_id: match.id,
        user_id: second.user.id,
        team: 'b',
        is_host: false,
        ready: true,
        paid: true,
      },
    ]),
    `${phase} 검증 매치 참가자 생성 실패`,
  )

  await requireData(
    await admin
      .from('venue_slots')
      .update({
        status: phase === 'canceled' ? 'open' : 'booked',
        reserved_match_id: phase === 'canceled' ? null : match.id,
      })
      .eq('id', slot.id),
    `${phase} 검증 슬롯 연결 실패`,
  )

  if (!finalized) return match

  return requireData(
    await admin
      .from('matches')
      .update({
        phase,
      })
      .eq('id', match.id)
      .select('id, phase, winner_team, score, finalized_at')
      .single(),
    '정상 검증 매치 결과 확정 실패',
  )
}

async function rowsForMatches(table, matchIds, columns = '*') {
  if (matchIds.length === 0) return []
  return requireData(
    await admin.from(table).select(columns).in('match_id', matchIds),
    `${table} 매치 행 조회 실패`,
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

  const userIds = context.actors.map((actor) => actor.user.id)
  const matchIds = [...context.matchIds]
  const eventIds = [...context.bossEventIds]

  if (eventIds.length > 0) {
    await attempt('직접 보스전 삭제', () =>
      admin.from('boss_challenges').delete().in('event_id', eventIds),
    )
  }

  if (matchIds.length > 0) {
    await attempt('게임 결과 행 삭제', () =>
      admin.from('gameplay_member_outcomes').delete().in('match_id', matchIds),
    )
    await attempt('보스 개인 기여 삭제', () =>
      admin.from('venue_boss_contributions').delete().in('match_id', matchIds),
    )
    await attempt('보스 경기 피해 삭제', () =>
      admin.from('venue_boss_match_hits').delete().in('match_id', matchIds),
    )
    await attempt('체육관 인정 경기 삭제', () =>
      admin.from('venue_gameplay_credits').delete().in('match_id', matchIds),
    )
    await attempt('게임 처리 원장 삭제', () =>
      admin.from('gameplay_match_events').delete().in('match_id', matchIds),
    )
  }
  if (userIds.length > 0) {
    await attempt('체육관 도감 삭제', () =>
      admin.from('venue_collection_entries').delete().in('profile_id', userIds),
    )
    await attempt('테스트 큐 삭제', () =>
      admin.from('queue_entries').delete().in('user_id', userIds),
    )
  }
  if (matchIds.length > 0) {
    await attempt('테스트 매치 삭제', () =>
      admin.from('matches').delete().in('id', matchIds),
    )
  }

  for (const userId of userIds) {
    await attempt(`테스트 auth 사용자 ${userId} 삭제`, () =>
      admin.auth.admin.deleteUser(userId),
    )
  }

  if (eventIds.length > 0) {
    await attempt('테스트 보스 이벤트 삭제', () =>
      admin.from('venue_boss_events').delete().in('id', eventIds),
    )
  }
  if (context.seasonIds.size > 0) {
    await attempt('테스트 시즌 퀘스트 삭제', () =>
      admin.from('season_quest_definitions').delete().in('season_id', [...context.seasonIds]),
    )
    await attempt('테스트 시즌 삭제', () =>
      admin.from('seasons').delete().in('id', [...context.seasonIds]),
    )
  }
  if (context.venueIds.size > 0) {
    await attempt('테스트 체육관 삭제', () =>
      admin.from('venues').delete().in('id', [...context.venueIds]),
    )
  }
  if (context.regionCodes.size > 0) {
    await attempt('테스트 지역 삭제', () =>
      admin.from('regions').delete().in('code', [...context.regionCodes]),
    )
  }

  const residualChecks = []
  if (matchIds.length > 0) {
    residualChecks.push(
      ['매치', admin.from('matches').select('id').in('id', matchIds)],
      ['게임 처리 원장', admin.from('gameplay_match_events').select('match_id').in('match_id', matchIds)],
      ['체육관 인정 경기', admin.from('venue_gameplay_credits').select('match_id').in('match_id', matchIds)],
      ['보스 경기 피해', admin.from('venue_boss_match_hits').select('match_id').in('match_id', matchIds)],
      ['보스 개인 기여', admin.from('venue_boss_contributions').select('match_id').in('match_id', matchIds)],
      ['게임 결과', admin.from('gameplay_member_outcomes').select('match_id').in('match_id', matchIds)],
    )
  }
  if (userIds.length > 0) {
    residualChecks.push(
      ['프로필', admin.from('profiles').select('id').in('id', userIds)],
      ['도전과제', admin.from('player_achievements').select('profile_id').in('profile_id', userIds)],
      ['체육관 도감', admin.from('venue_collection_entries').select('profile_id').in('profile_id', userIds)],
      ['큐', admin.from('queue_entries').select('id').in('user_id', userIds)],
      ['알림', admin.from('notifications').select('id').in('user_id', userIds)],
    )
  }
  if (eventIds.length > 0) {
    residualChecks.push(
      ['직접 보스전', admin.from('boss_challenges').select('id').in('event_id', eventIds)],
      ['보스 이벤트', admin.from('venue_boss_events').select('id').in('id', eventIds)],
    )
  }
  if (context.seasonIds.size > 0) {
    residualChecks.push(
      ['시즌 퀘스트', admin.from('season_quest_definitions').select('season_id').in('season_id', [...context.seasonIds])],
      ['시즌', admin.from('seasons').select('id').in('id', [...context.seasonIds])],
    )
  }
  if (context.venueIds.size > 0) {
    residualChecks.push(
      ['체육관', admin.from('venues').select('id').in('id', [...context.venueIds])],
      ['슬롯', admin.from('venue_slots').select('id').in('venue_id', [...context.venueIds])],
    )
  }
  if (context.regionCodes.size > 0) {
    residualChecks.push(['지역', admin.from('regions').select('code').in('code', [...context.regionCodes])])
  }

  for (const [label, operation] of residualChecks) {
    await attempt(`${label} 잔존 확인`, async () => {
      const result = await operation
      if (result.error) throw result.error
      assert((result.data ?? []).length === 0, `삭제되지 않은 테스트 ${label} 데이터가 있습니다.`)
    })
  }

  if (failures.length > 0) throw new Error(`검증 데이터 정리 실패\n- ${failures.join('\n- ')}`)
}

async function syncIneligible(actor, matchId, label) {
  const { data, error } = await actor.client.rpc('sync_my_match_gameplay', { p_match_id: matchId })
  if (error) return

  const outcome = assertOutcome(data, `${label} no-op 응답`)
  assert(outcome.new_venue === false, `${label}: 미완료 경기로 체육관이 발견되었습니다.`)
  assert(outcome.boss_damage === 0, `${label}: 미완료 경기로 보스 피해가 반영되었습니다.`)
  assert(outcome.unlocked_achievement_codes.length === 0, `${label}: 미완료 경기로 도전과제가 해금되었습니다.`)
}

async function assertNoGameplaySideEffects(matchIds, profileIds, eventId, label) {
  const [events, credits, hits, contributions, outcomes, collections] = await Promise.all([
    rowsForMatches('gameplay_match_events', matchIds, 'match_id, status'),
    rowsForMatches('venue_gameplay_credits', matchIds, 'match_id, profile_id'),
    rowsForMatches('venue_boss_match_hits', matchIds, 'event_id, match_id, damage'),
    rowsForMatches('venue_boss_contributions', matchIds, 'event_id, match_id, profile_id, points'),
    rowsForMatches('gameplay_member_outcomes', matchIds, 'match_id, profile_id'),
    requireData(
      await admin
        .from('venue_collection_entries')
        .select('profile_id, venue_id')
        .in('profile_id', profileIds),
      `${label}: 체육관 도감 조회 실패`,
    ),
  ])
  assert(events.length === 0, `${label}: 게임 처리 원장이 생성되었습니다.`)
  assert(credits.length === 0, `${label}: 체육관 인정 경기가 생성되었습니다.`)
  assert(hits.filter((row) => row.event_id === eventId).length === 0, `${label}: 보스 경기 피해가 생성되었습니다.`)
  assert(contributions.filter((row) => row.event_id === eventId).length === 0, `${label}: 보스 개인 기여가 생성되었습니다.`)
  assert(outcomes.length === 0, `${label}: 개인 결과가 생성되었습니다.`)
  assert(collections.length === 0, `${label}: 체육관 도감이 생성되었습니다.`)
}

async function runVerification(context) {
  const { runId } = context
  const suffix = runId.slice(-7)
  const regionCode = `verify-${runId}`
  const venueId = `verify-game-${runId}`
  context.regionCodes.add(regionCode)
  context.venueIds.add(venueId)

  const now = Date.now()
  const startsAt = new Date(now - 60 * 60_000)
  const endsAt = new Date(now + 7 * 24 * 60 * 60_000)

  await requireData(
    await admin.from('regions').insert({
      code: regionCode,
      name: `게임 검증 지역 ${runId}`,
      parent_code: null,
    }),
    '격리된 테스트 지역 생성 실패',
  )

  const season = await requireData(
    await admin
      .from('seasons')
      .insert({
        code: `verify-season-${runId}`,
        name: `게임 검증 시즌 ${runId}`,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        active: true,
      })
      .select('id, code, name, starts_at, ends_at, active')
      .single(),
    '격리된 테스트 시즌 생성 실패',
  )
  context.seasonIds.add(season.id)

  await requireData(
    await admin.from('venues').insert({
      id: venueId,
      name: `게임 검증 체육관 ${runId}`,
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

  await requireData(
    await admin.from('season_quest_definitions').insert([
      { season_id: season.id, achievement_code: 'first_match', sort_order: 10 },
      { season_id: season.id, achievement_code: 'boss_raider', sort_order: 20 },
    ]),
    '격리된 시즌 퀘스트 생성 실패',
  )

  const bossEvent = await requireData(
    await admin
      .from('venue_boss_events')
      .insert({
        code: `verify-boss-${runId}`,
        venue_id: venueId,
        season_id: season.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        max_hp: 1,
        starting_damage: 0,
        damage_per_match: 1,
        champion_profile_id: null,
        champion_name: null,
        champion_points: 0,
        sport: 'badminton',
        boss_name: '검증 셔틀콕 가디언',
        boss_avatar_url: null,
        boss_rating: 1750,
        win_rate_bps: 10_000,
        challenge_enabled: true,
      })
      .select('id, venue_id, sport, boss_name, boss_rating, win_rate_bps')
      .single(),
    '격리된 테스트 보스 이벤트 생성 실패',
  )
  context.bossEventIds.add(bossEvent.id)

  const nonBadmintonBoss = await admin.from('venue_boss_events').insert({
    code: `verify-tennis-boss-${runId}`,
    venue_id: venueId,
    season_id: season.id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    max_hp: 1,
    starting_damage: 0,
    damage_per_match: 1,
    sport: 'tennis',
    boss_name: '생성되면 안 되는 보스',
    boss_rating: 1750,
    win_rate_bps: 10_000,
    challenge_enabled: true,
  })
  assert(nonBadmintonBoss.error, '배드민턴이 아닌 종목의 보스 이벤트를 생성할 수 있습니다.')

  const first = await anonymous(`a-${runId}`, context)
  const second = await anonymous(`b-${runId}`, context)
  const outsider = await anonymous(`outsider-${runId}`, context)
  for (const [index, actor] of [first, second, outsider].entries()) {
    await rpc(actor.client, 'save_my_profile', {
      p_nickname: `g${suffix}${index + 1}`,
      p_interests: ['badminton'],
      p_avatar_url: null,
    })
  }

  await requireData(
    await admin
      .from('player_ratings')
      .update({ rating: 610_000 })
      .in('profile_id', [first.user.id, second.user.id, outsider.user.id])
      .eq('sport', 'badminton'),
    '검증 사용자 레이팅 격리 실패',
  )

  const staleChallenge = await requireData(
    await admin
      .from('boss_challenges')
      .insert({
        event_id: bossEvent.id,
        profile_id: outsider.user.id,
        status: 'active',
        challenger_rating: 610_000,
        boss_rating: bossEvent.boss_rating,
        started_at: new Date(now - 31 * 60_000).toISOString(),
      })
      .select('id, status')
      .single(),
    '만료 보스전 원본 생성 실패',
  )
  context.bossChallengeIds.add(staleChallenge.id)
  await createPastSlot(context, venueId, new Date(now + 24 * 60 * 60_000))

  const queueAfterStaleBoss = await rpc(outsider.client, 'join_match_queue', {
    p_sport: 'badminton',
    p_mode: '1v1',
    p_venue_id: venueId,
    p_lat: null,
    p_lng: null,
  })
  assert(queueAfterStaleBoss?.status === 'waiting', '만료 보스전 정리 후 일반 큐에 진입하지 못했습니다.')
  const staleChallengeAfterQueue = await requireData(
    await admin
      .from('boss_challenges')
      .select('id, status, resolved_at')
      .eq('id', staleChallenge.id)
      .single(),
    '만료 보스전 자동 정리 확인 실패',
  )
  assert(
    staleChallengeAfterQueue.status === 'abandoned' && staleChallengeAfterQueue.resolved_at,
    '일반 큐 진입 시 만료 보스전이 abandoned 처리되지 않았습니다.',
  )
  assert(
    await rpc(outsider.client, 'cancel_match_queue') === true,
    '만료 보스전 검증 큐 정리에 실패했습니다.',
  )

  const emptySummary = assertSummary(
    await rpc(outsider.client, 'get_my_gameplay_summary'),
    '경기 전 외부인 게임 요약',
  )
  assert(emptySummary.region.discovered === 0, '경기 전 사용자에게 발견 체육관이 있습니다.')
  assert(
    emptySummary.venues.every((venue) => venue.discovered_at === null && venue.visits === 0),
    '경기 전 사용자 요약에 발견 시각 또는 방문 횟수가 있습니다.',
  )

  await expectRpcError(
    first.client,
    'equip_my_title',
    { p_achievement_code: 'boss_raider' },
    '직접 보스 승리 전에 칭호를 장착할 수 있습니다.',
  )

  const canceledSlot = await createPastSlot(context, venueId, new Date(now - 50 * 60_000))
  const unfinishedSlot = await createPastSlot(context, venueId, new Date(now - 40 * 60_000))
  const finalizedSlot = await createPastSlot(context, venueId, new Date(now - 30 * 60_000))
  const canceledMatch = await createMatch(context, {
    venueId,
    slot: canceledSlot,
    first,
    second,
    phase: 'canceled',
    finalized: false,
  })
  const unfinishedMatch = await createMatch(context, {
    venueId,
    slot: unfinishedSlot,
    first,
    second,
    phase: 'reporting',
    finalized: false,
  })

  await syncIneligible(first, canceledMatch.id, '취소 경기')
  await syncIneligible(first, unfinishedMatch.id, '결과 미확정 경기')
  await assertNoGameplaySideEffects(
    [canceledMatch.id, unfinishedMatch.id],
    [first.user.id, second.user.id],
    bossEvent.id,
    '취소·미확정 경기',
  )

  const finalizedMatch = await createMatch(context, {
    venueId,
    slot: finalizedSlot,
    first,
    second,
    phase: 'reporting',
    finalized: true,
  })
  assert(finalizedMatch.finalized_at && finalizedMatch.winner_team === 'a', '정상 경기 결과가 확정되지 않았습니다.')

  await expectRpcError(
    outsider.client,
    'sync_my_match_gameplay',
    { p_match_id: finalizedMatch.id },
    '비참가자가 경기 게임 진행도를 동기화할 수 있습니다.',
  )
  await expectRpcError(
    outsider.client,
    'get_my_match_gameplay_outcome',
    { p_match_id: finalizedMatch.id },
    '비참가자가 경기 게임 결과를 조회할 수 있습니다.',
  )

  const syncResponses = await Promise.all(
    Array.from({ length: 8 }, () => rpc(first.client, 'sync_my_match_gameplay', {
      p_match_id: finalizedMatch.id,
    })),
  )
  const outcomes = syncResponses.map((value, index) =>
    assertOutcome(value, `동시 게임 진행도 동기화 ${index + 1}`),
  )
  for (const outcome of outcomes) {
    assert(outcome.match_id === finalizedMatch.id, '동시 동기화가 다른 경기 결과를 반환했습니다.')
    assert(outcome.venue_id === venueId && outcome.new_venue === true, '최초 체육관 발견 결과가 멱등하지 않습니다.')
    assert(outcome.collection_discovered === 1 && outcome.collection_total === 1, '지역 도감 1/1 결과가 잘못되었습니다.')
    assert(outcome.boss_damage === 0, '일반 배드민턴 경기가 보스 피해로 반영되었습니다.')
    assert(outcome.boss_remaining_hp === null, '일반 배드민턴 경기가 보스 HP를 변경했습니다.')
    assert(!outcome.unlocked_achievement_codes.includes('boss_raider'), '일반 배드민턴 경기로 보스 칭호가 해금되었습니다.')
  }

  const secondOutcome = assertOutcome(
    await rpc(second.client, 'sync_my_match_gameplay', { p_match_id: finalizedMatch.id }),
    '두 번째 참가자 게임 진행도 동기화',
  )
  assert(
    secondOutcome.new_venue === true
      && secondOutcome.boss_damage === 0
      && secondOutcome.boss_remaining_hp === null,
    '두 번째 참가자 일반 경기 outcome이 일관되지 않습니다.',
  )

  const [eventRows, creditRows, collectionRows, hitRows, contributionRows, outcomeRows] = await Promise.all([
    rowsForMatches('gameplay_match_events', [finalizedMatch.id], 'match_id, status, attempt_count, processed_at'),
    rowsForMatches('venue_gameplay_credits', [finalizedMatch.id], 'match_id, profile_id, venue_id, season_id, evidence_kind, credited_at'),
    requireData(
      await admin
        .from('venue_collection_entries')
        .select('profile_id, venue_id, first_match_id, unlocked_at')
        .in('profile_id', [first.user.id, second.user.id])
        .eq('venue_id', venueId),
      '체육관 도감 원본 조회 실패',
    ),
    rowsForMatches('venue_boss_match_hits', [finalizedMatch.id], 'event_id, match_id, damage'),
    rowsForMatches('venue_boss_contributions', [finalizedMatch.id], 'event_id, match_id, profile_id, points'),
    rowsForMatches('gameplay_member_outcomes', [finalizedMatch.id], 'match_id, profile_id, new_venue, venue_id, boss_damage, boss_remaining_hp, unlocked_achievement_codes'),
  ])
  assert(eventRows.length === 1 && eventRows[0].status === 'processed' && eventRows[0].processed_at, '게임 처리 원장이 정확히 한 번 완료되지 않았습니다.')
  assert(creditRows.length === 2, `참가자별 체육관 인정 경기가 ${creditRows.length}개입니다.`)
  assert(new Set(creditRows.map((row) => row.profile_id)).size === 2, '체육관 인정 경기가 한 참가자에게 중복되었습니다.')
  assert(collectionRows.length === 2, `참가자별 체육관 도감 행이 ${collectionRows.length}개입니다.`)
  assert(collectionRows.every((row) => row.first_match_id === finalizedMatch.id), '체육관 최초 발견 경기 ID가 잘못되었습니다.')
  assert(hitRows.length === 0, `일반 경기에서 보스 피해 행이 ${hitRows.length}개 생성되었습니다.`)
  assert(contributionRows.length === 0, `일반 경기에서 보스 기여 행이 ${contributionRows.length}개 생성되었습니다.`)
  assert(outcomeRows.length === 2, `참가자별 게임 outcome이 ${outcomeRows.length}개입니다.`)
  assert(
    outcomeRows.every((row) => row.boss_damage === 0 && row.boss_remaining_hp === null),
    '저장된 일반 경기 outcome에 보스 효과가 남아 있습니다.',
  )

  const ordinaryBossAchievements = await requireData(
    await admin
      .from('player_achievements')
      .select('profile_id, achievement_code, progress, unlocked_at')
      .in('profile_id', [first.user.id, second.user.id])
      .eq('achievement_code', 'boss_raider'),
    '일반 경기 후 보스 도전과제 조회 실패',
  )
  assert(
    ordinaryBossAchievements.every((row) => row.progress === 0 && row.unlocked_at === null),
    '일반 배드민턴 경기로 boss_raider 진행도 또는 칭호가 지급되었습니다.',
  )

  const forgedTitle = await admin.from('player_achievements').upsert({
    profile_id: outsider.user.id,
    achievement_code: 'boss_raider',
    progress: 1,
    unlocked_at: new Date().toISOString(),
    unlocked_match_id: null,
  }, { onConflict: 'profile_id,achievement_code' })
  assert(forgedTitle.error, '직접 보스 승리 증거 없이 service-role 칭호 해금이 허용됩니다.')

  const ordinarySummary = assertSummary(await rpc(first.client, 'get_my_gameplay_summary'), '일반 경기 후 게임 요약')
  assert(ordinarySummary.region.code === regionCode, '게임 요약이 격리된 테스트 지역을 반환하지 않았습니다.')
  assert(ordinarySummary.region.discovered === 1 && ordinarySummary.region.total === 1, '게임 요약의 지역 도감이 1/1이 아닙니다.')
  const venueSummary = ordinarySummary.venues.find((row) => row.venue_id === venueId)
  assert(venueSummary?.visits === 1, '정상 확정 경기 한 건이 체육관 방문 1회로 집계되지 않았습니다.')
  assert(ordinarySummary.boss?.event_id === bossEvent.id, '게임 요약이 격리된 테스트 보스를 반환하지 않았습니다.')
  assert(ordinarySummary.boss.challenge_id === null && ordinarySummary.boss.challenge_status === null, '도전 전 summary에 보스전이 존재합니다.')
  assert(ordinarySummary.boss.can_challenge === false, '미완료 일반 경기 중 보스 도전이 열려 있습니다.')
  assert(ordinarySummary.boss.title_unlocked === false && ordinarySummary.boss.title_code === null, '일반 경기 후 보스 칭호가 지급되었습니다.')
  assert(ordinarySummary.boss.my_contribution === 0 && ordinarySummary.boss.defeated === false, '일반 경기 결과가 보스 상태에 투영되었습니다.')
  assert(ordinarySummary.season?.code === season.code, '게임 요약이 격리된 테스트 시즌을 반환하지 않았습니다.')
  const firstMatchQuest = rowByCode(ordinarySummary.season.quests, 'first_match', '시즌 퀘스트')
  const bossQuestBefore = rowByCode(ordinarySummary.season.quests, 'boss_raider', '시즌 퀘스트')
  assert(firstMatchQuest.progress === 1 && firstMatchQuest.unlocked_at, '시즌 first_match 퀘스트가 해금되지 않았습니다.')
  assert(bossQuestBefore.progress === 0 && bossQuestBefore.unlocked_at === null, '직접 대결 전 boss_raider 퀘스트가 해금되었습니다.')

  const savedOutcome = assertOutcome(
    await rpc(first.client, 'get_my_match_gameplay_outcome', { p_match_id: finalizedMatch.id }),
    '저장된 경기 게임 outcome',
  )
  assert(
    savedOutcome.new_venue === true
      && savedOutcome.boss_damage === 0
      && savedOutcome.boss_remaining_hp === null,
    '저장된 일반 경기 outcome에 보스 효과가 있습니다.',
  )

  await requireData(
    await admin
      .from('match_members')
      .update({ completed_at: new Date().toISOString() })
      .eq('match_id', finalizedMatch.id),
    '보스전 전 일반 경기 참가자 완료 처리 실패',
  )
  await requireData(
    await admin.from('matches').update({ phase: 'canceled' }).eq('id', unfinishedMatch.id),
    '보스전 전 미확정 경기 취소 처리 실패',
  )
  await requireData(
    await admin.from('matches').update({ phase: 'done' }).eq('id', finalizedMatch.id),
    '보스전 전 일반 경기 종료 처리 실패',
  )

  const eligibleSummary = assertSummary(
    await rpc(first.client, 'get_my_gameplay_summary'),
    '일반 경기 종료 후 게임 요약',
  )
  assert(eligibleSummary.boss?.can_challenge === true, '일반 경기 종료 후 보스 도전이 열리지 않았습니다.')

  const ratingBefore = await requireData(
    await admin
      .from('player_ratings')
      .select('profile_id, sport, rating, wins, losses, played')
      .eq('profile_id', first.user.id)
      .eq('sport', 'badminton')
      .single(),
    '보스전 전 ELO 조회 실패',
  )
  const ratingEventsBefore = await requireData(
    await admin
      .from('rating_events')
      .select('id, match_id, profile_id, sport, rating_before, delta, rating_after')
      .eq('profile_id', first.user.id)
      .order('id'),
    '보스전 전 rating_events 조회 실패',
  )

  const startResponses = await Promise.all(
    Array.from({ length: 8 }, () => rpc(first.client, 'start_my_boss_challenge', {
      p_event_id: bossEvent.id,
    })),
  )
  const starts = startResponses.map((value, index) => assertChallenge(value, `동시 보스전 시작 ${index + 1}`))
  const challengeIds = new Set(starts.map((row) => row.challenge_id))
  assert(challengeIds.size === 1, `동시 보스전 시작이 ${challengeIds.size}개 challenge_id를 반환했습니다.`)
  assert(starts.every((row) => row.status === 'active' && row.won === null), '시작한 보스전 상태가 active가 아닙니다.')
  const challengeId = starts[0].challenge_id
  context.bossChallengeIds.add(challengeId)

  const challengeRowsAfterStart = await requireData(
    await admin
      .from('boss_challenges')
      .select('id, event_id, profile_id, status, challenger_rating, boss_rating, score, resolved_at')
      .eq('event_id', bossEvent.id)
      .eq('profile_id', first.user.id),
    '동시 보스전 시작 원본 조회 실패',
  )
  assert(challengeRowsAfterStart.length === 1, `동시 보스전 시작으로 원본이 ${challengeRowsAfterStart.length}개 생성되었습니다.`)
  assert(challengeRowsAfterStart[0].status === 'active', '생성된 보스전 원본이 active가 아닙니다.')
  assert(challengeRowsAfterStart[0].challenger_rating === ratingBefore.rating, '보스전 시작 시 ELO 스냅샷이 잘못되었습니다.')

  const activeSummary = assertSummary(await rpc(first.client, 'get_my_gameplay_summary'), '진행 중 보스전 게임 요약')
  assert(activeSummary.boss?.challenge_id === challengeId, 'summary에 진행 중 보스전 ID가 없습니다.')
  assert(activeSummary.boss.challenge_status === 'active', 'summary에 진행 중 보스전 상태가 없습니다.')
  assert(activeSummary.boss.title_unlocked === false, '해결 전 보스 칭호가 지급되었습니다.')

  await expectRpcError(
    outsider.client,
    'resolve_my_boss_challenge',
    { p_challenge_id: challengeId },
    '다른 사용자가 보스전을 해결할 수 있습니다.',
  )

  const resolveResponses = await Promise.all(
    Array.from({ length: 8 }, () => rpc(first.client, 'resolve_my_boss_challenge', {
      p_challenge_id: challengeId,
    })),
  )
  const resolved = resolveResponses.map((value, index) => assertChallenge(value, `동시 보스전 해결 ${index + 1}`))
  assert(
    resolved.every((row) => row.challenge_id === challengeId && row.status === 'won' && row.won === true && row.score),
    '보스전 해결 재시도가 동일한 승리 결과를 반환하지 않았습니다.',
  )
  assert(
    resolved.filter((row) => row.newly_unlocked).length === 1,
    'boss_raider 신규 해금 응답이 정확히 한 번 발생하지 않았습니다.',
  )
  assert(resolved.every((row) => row.title_unlocked && row.title_code === 'boss_raider'), '승리 응답에 보스 칭호가 없습니다.')

  const resolvedAgain = assertChallenge(
    await rpc(first.client, 'resolve_my_boss_challenge', { p_challenge_id: challengeId }),
    '완료된 보스전 반복 해결',
  )
  assert(resolvedAgain.status === 'won' && resolvedAgain.newly_unlocked === false, '완료된 보스전 반복 해결이 멱등하지 않습니다.')

  const resumedWin = assertChallenge(
    await rpc(first.client, 'start_my_boss_challenge', { p_event_id: bossEvent.id }),
    '승리 후 보스전 반복 시작',
  )
  assert(resumedWin.challenge_id === challengeId && resumedWin.status === 'won', '승리 후 반복 시작이 기존 승리를 반환하지 않았습니다.')

  const [challengeRowsAfterWin, bossAchievementRows, ratingAfter, ratingEventsAfter] = await Promise.all([
    requireData(
      await admin
        .from('boss_challenges')
        .select('id, event_id, profile_id, status, score, resolved_at')
        .eq('event_id', bossEvent.id)
        .eq('profile_id', first.user.id),
      '보스전 승리 원본 조회 실패',
    ),
    requireData(
      await admin
        .from('player_achievements')
        .select('profile_id, achievement_code, progress, unlocked_at, unlocked_match_id')
        .eq('profile_id', first.user.id)
        .eq('achievement_code', 'boss_raider'),
      '보스 칭호 원본 조회 실패',
    ),
    requireData(
      await admin
        .from('player_ratings')
        .select('profile_id, sport, rating, wins, losses, played')
        .eq('profile_id', first.user.id)
        .eq('sport', 'badminton')
        .single(),
      '보스전 후 ELO 조회 실패',
    ),
    requireData(
      await admin
        .from('rating_events')
        .select('id, match_id, profile_id, sport, rating_before, delta, rating_after')
        .eq('profile_id', first.user.id)
        .order('id'),
      '보스전 후 rating_events 조회 실패',
    ),
  ])
  assert(challengeRowsAfterWin.length === 1 && challengeRowsAfterWin[0].status === 'won', '보스전 승리 원본이 정확히 1행이 아닙니다.')
  assert(bossAchievementRows.length === 1, `boss_raider 칭호 원본이 ${bossAchievementRows.length}행입니다.`)
  assert(bossAchievementRows[0].progress === 1 && bossAchievementRows[0].unlocked_at, '승리한 사용자의 boss_raider가 해금되지 않았습니다.')
  assert(bossAchievementRows[0].unlocked_match_id === null, '보스 칭호가 일반 match_id에 연결되었습니다.')
  assert(JSON.stringify(ratingAfter) === JSON.stringify(ratingBefore), '보스전이 배드민턴 ELO/전적을 변경했습니다.')
  assert(JSON.stringify(ratingEventsAfter) === JSON.stringify(ratingEventsBefore), '보스전이 rating_events를 생성하거나 변경했습니다.')

  const victorySummary = assertSummary(await rpc(first.client, 'get_my_gameplay_summary'), '보스 승리 후 게임 요약')
  assert(victorySummary.boss?.challenge_id === challengeId, '승리 summary의 보스전 ID가 잘못되었습니다.')
  assert(victorySummary.boss.challenge_status === 'won' && victorySummary.boss.defeated === true, '승리 summary에 보스 격파가 반영되지 않았습니다.')
  assert(victorySummary.boss.can_challenge === false, '이미 승리한 보스에 다시 도전할 수 있습니다.')
  assert(victorySummary.boss.title_unlocked === true && victorySummary.boss.title_code === 'boss_raider', '승리 summary에 칭호가 없습니다.')
  assert(victorySummary.boss.throne_name === null && victorySummary.boss.throne_points === 0, 'summary에 폐기한 왕좌 정보가 남아 있습니다.')
  const bossQuestAfter = rowByCode(victorySummary.season?.quests ?? [], 'boss_raider', '승리 후 시즌 퀘스트')
  assert(bossQuestAfter.progress === 1 && bossQuestAfter.unlocked_at, '직접 보스 승리가 시즌 boss_raider에 반영되지 않았습니다.')

  const equipped = await rpc(first.client, 'equip_my_title', { p_achievement_code: 'boss_raider' })
  assert(equipped === 'boss_raider', '해금한 boss_raider 칭호를 장착하지 못했습니다.')
  const equippedAgain = await rpc(first.client, 'equip_my_title', { p_achievement_code: 'boss_raider' })
  assert(equippedAgain === 'boss_raider', 'boss_raider 칭호 반복 장착이 멱등하지 않습니다.')
  const achievements = await rpc(first.client, 'get_my_achievements')
  const bossAchievement = achievements.find((row) => row.code === 'boss_raider')
  assert(bossAchievement?.unlocked_at && bossAchievement.equipped === true, 'boss_raider 해금·장착 상태가 도전과제 응답에 없습니다.')
  await expectRpcError(
    outsider.client,
    'equip_my_title',
    { p_achievement_code: 'boss_raider' },
    '보스에게 승리하지 않은 사용자가 boss_raider 칭호를 장착할 수 있습니다.',
  )

  const directChallenge = await outsider.client.from('boss_challenges').insert({
    event_id: bossEvent.id,
    profile_id: outsider.user.id,
    status: 'active',
    challenger_rating: 610_000,
    boss_rating: bossEvent.boss_rating,
  })
  assert(directChallenge.error, '브라우저 사용자가 보스전을 직접 생성할 수 있습니다.')
  const directUpdate = await first.client.from('boss_challenges').update({ score: '21-0' }).eq('id', challengeId)
  assert(directUpdate.error, '브라우저 사용자가 보스전 결과를 직접 수정할 수 있습니다.')
  const directDelete = await first.client.from('boss_challenges').delete().eq('id', challengeId)
  assert(directDelete.error, '브라우저 사용자가 보스전 증거를 직접 삭제할 수 있습니다.')
  const directTitle = await outsider.client.from('player_achievements').insert({
    profile_id: outsider.user.id,
    achievement_code: 'boss_raider',
    progress: 1,
    unlocked_at: new Date().toISOString(),
  })
  assert(directTitle.error, '브라우저 사용자가 boss_raider 칭호를 직접 생성할 수 있습니다.')

  const [ownChallenges, otherChallenges] = await Promise.all([
    requireData(
      await first.client.from('boss_challenges').select('id, status').eq('id', challengeId),
      '본인 보스전 RLS 조회 실패',
    ),
    requireData(
      await second.client.from('boss_challenges').select('id, status').eq('id', challengeId),
      '타 사용자 보스전 RLS 조회 실패',
    ),
  ])
  assert(ownChallenges.length === 1 && ownChallenges[0].status === 'won', '본인 보스전 원본을 조회할 수 없습니다.')
  assert(otherChallenges.length === 0, '다른 사용자의 보스전 원본이 노출됩니다.')

  console.log('✓ 취소·결과 미확정 경기 진행도 제외')
  console.log('✓ 일반 배드민턴 경기 도감 반영/보스 피해·기여·칭호 0')
  console.log('✓ 배드민턴 전용 보스 제약/승리 증거 없는 칭호 위조 차단')
  console.log('✓ 만료·종료 보스전 자동 포기 후 일반 매칭 허용')
  console.log('✓ 보스전 동시 시작 8회 멱등/원본 1행')
  console.log('✓ 타 사용자 해결 차단/동시 해결 8회 동일 승리·칭호 1회')
  console.log('✓ 보스전 ELO·전적·rating_events 불변')
  console.log('✓ 직접 쓰기 차단/RLS/summary 직접 대결 shape')
  console.log(`직접 배드민턴 보스 검증 성공: ${challengeId}`)
}

async function main() {
  const context = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    actors: [],
    matchIds: new Set(),
    slotIds: new Set(),
    venueIds: new Set(),
    regionCodes: new Set(),
    seasonIds: new Set(),
    bossEventIds: new Set(),
    bossChallengeIds: new Set(),
  }
  console.log(`MATCHPOINT 게임 진행도 검증 시작 (${url})`)

  let verificationError = null
  try {
    await runVerification(context)
  } catch (error) {
    verificationError = error
  }

  try {
    await cleanup(context)
    console.log('✓ 게임 진행도 검증 데이터 정리 완료')
  } catch (cleanupError) {
    if (verificationError) {
      console.error('검증 중 오류:', verificationError instanceof Error ? verificationError.message : verificationError)
    }
    verificationError = cleanupError
  }

  if (verificationError) throw verificationError
}

main().catch((error) => {
  console.error('게임 진행도 검증 실패:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
