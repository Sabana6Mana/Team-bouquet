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
      'event_id', 'venue_id', 'max_hp', 'remaining_hp', 'damage_per_match', 'ends_at',
      'my_contribution', 'throne_name', 'throne_points', 'defeated',
    ], `${label}.boss`)
    assert(typeof boss.event_id === 'string' && typeof boss.venue_id === 'string', `${label}.boss: 이벤트 식별자가 잘못되었습니다.`)
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
    residualChecks.push(['보스 이벤트', admin.from('venue_boss_events').select('id').in('id', eventIds)])
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
        max_hp: 10,
        starting_damage: 6,
        damage_per_match: 2,
        champion_profile_id: null,
        champion_name: 'Nate_Rush',
        champion_points: 3,
      })
      .select('id, venue_id, max_hp, starting_damage, damage_per_match, champion_name, champion_points')
      .single(),
    '격리된 테스트 보스 이벤트 생성 실패',
  )
  context.bossEventIds.add(bossEvent.id)

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
    '보스 퀘스트 완료 전에 칭호를 장착할 수 있습니다.',
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
    assert(outcome.boss_damage === bossEvent.damage_per_match, '보스 피해 응답이 경기당 고정값이 아닙니다.')
    assert(
      outcome.boss_remaining_hp === bossEvent.max_hp - bossEvent.starting_damage - bossEvent.damage_per_match,
      '보스 남은 HP 응답이 잘못되었습니다.',
    )
    assert(outcome.unlocked_achievement_codes.includes('boss_raider'), '보스 퀘스트 해금 코드가 결과에 없습니다.')
  }

  const secondOutcome = assertOutcome(
    await rpc(second.client, 'sync_my_match_gameplay', { p_match_id: finalizedMatch.id }),
    '두 번째 참가자 게임 진행도 동기화',
  )
  assert(secondOutcome.new_venue === true && secondOutcome.boss_damage === bossEvent.damage_per_match, '두 번째 참가자 outcome이 일관되지 않습니다.')

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
  assert(hitRows.length === 1, `보스 전역 피해 행이 ${hitRows.length}개입니다.`)
  assert(hitRows[0].event_id === bossEvent.id && hitRows[0].damage === bossEvent.damage_per_match, '보스 전역 피해가 경기당 한 번 반영되지 않았습니다.')
  assert(contributionRows.length === 2, `참가자별 보스 기여 행이 ${contributionRows.length}개입니다.`)
  assert(new Set(contributionRows.map((row) => row.profile_id)).size === 2, '보스 개인 기여가 한 참가자에게 중복되었습니다.')
  assert(contributionRows.every((row) => row.points > 0), '보스 개인 기여 점수가 양수가 아닙니다.')
  assert(outcomeRows.length === 2, `참가자별 게임 outcome이 ${outcomeRows.length}개입니다.`)

  const firstSummary = assertSummary(await rpc(first.client, 'get_my_gameplay_summary'), '첫 참가자 게임 요약')
  assert(firstSummary.region.code === regionCode, '게임 요약이 격리된 테스트 지역을 반환하지 않았습니다.')
  assert(firstSummary.region.discovered === 1 && firstSummary.region.total === 1, '게임 요약의 지역 도감이 1/1이 아닙니다.')
  const venueSummary = firstSummary.venues.find((row) => row.venue_id === venueId)
  assert(venueSummary?.visits === 1, '정상 확정 경기 한 건이 체육관 방문 1회로 집계되지 않았습니다.')
  assert(firstSummary.boss?.event_id === bossEvent.id, '게임 요약이 격리된 테스트 보스를 반환하지 않았습니다.')
  assert(firstSummary.boss.remaining_hp === 2, '게임 요약의 보스 HP가 10-6-2=2가 아닙니다.')
  assert(firstSummary.boss.my_contribution === contributionRows.find((row) => row.profile_id === first.user.id)?.points, '내 보스 기여 합계가 원본과 다릅니다.')
  assert(firstSummary.boss.throne_name === 'Nate_Rush' && firstSummary.boss.throne_points === 3, '시드 왕좌 정보가 잘못되었습니다.')
  assert(firstSummary.boss.defeated === false, 'HP가 남은 보스가 defeated로 표시됩니다.')
  assert(firstSummary.season?.code === season.code, '게임 요약이 격리된 테스트 시즌을 반환하지 않았습니다.')
  const firstMatchQuest = rowByCode(firstSummary.season.quests, 'first_match', '시즌 퀘스트')
  const bossQuest = rowByCode(firstSummary.season.quests, 'boss_raider', '시즌 퀘스트')
  assert(firstMatchQuest.progress === 1 && firstMatchQuest.unlocked_at, '시즌 first_match 퀘스트가 해금되지 않았습니다.')
  assert(bossQuest.progress === 1 && bossQuest.unlocked_at, '시즌 boss_raider 퀘스트가 해금되지 않았습니다.')

  const savedOutcome = assertOutcome(
    await rpc(first.client, 'get_my_match_gameplay_outcome', { p_match_id: finalizedMatch.id }),
    '저장된 경기 게임 outcome',
  )
  assert(savedOutcome.new_venue === true && savedOutcome.boss_remaining_hp === 2, '저장된 outcome이 동기화 응답과 다릅니다.')

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
    '보스 경기에 참가하지 않은 사용자가 boss_raider 칭호를 장착할 수 있습니다.',
  )

  const directCollection = await outsider.client.from('venue_collection_entries').insert({
    profile_id: outsider.user.id,
    venue_id: venueId,
    first_match_id: finalizedMatch.id,
    unlocked_at: new Date().toISOString(),
  })
  assert(directCollection.error, '브라우저 사용자가 체육관 도감을 직접 생성할 수 있습니다.')
  const directCredit = await outsider.client.from('venue_gameplay_credits').insert({
    match_id: finalizedMatch.id,
    profile_id: outsider.user.id,
    venue_id: venueId,
    season_id: season.id,
    evidence_kind: 'booking_consensus',
    credited_at: new Date().toISOString(),
  })
  assert(directCredit.error, '브라우저 사용자가 체육관 인정 경기를 직접 생성할 수 있습니다.')
  const directContribution = await outsider.client.from('venue_boss_contributions').insert({
    event_id: bossEvent.id,
    match_id: finalizedMatch.id,
    profile_id: outsider.user.id,
    points: 999,
  })
  assert(directContribution.error, '브라우저 사용자가 보스 기여를 직접 생성할 수 있습니다.')
  const directHit = await first.client.from('venue_boss_match_hits').insert({
    event_id: bossEvent.id,
    match_id: canceledMatch.id,
    damage: 999,
  })
  assert(directHit.error, '브라우저 사용자가 보스 전역 피해를 직접 생성할 수 있습니다.')

  const [otherCredits, otherCollections, otherContributions, otherOutcomes] = await Promise.all([
    requireData(
      await second.client.from('venue_gameplay_credits').select('match_id').eq('profile_id', first.user.id),
      '타 사용자 체육관 인정 경기 RLS 조회 실패',
    ),
    requireData(
      await second.client.from('venue_collection_entries').select('venue_id').eq('profile_id', first.user.id),
      '타 사용자 체육관 도감 RLS 조회 실패',
    ),
    requireData(
      await second.client.from('venue_boss_contributions').select('match_id').eq('profile_id', first.user.id),
      '타 사용자 보스 기여 RLS 조회 실패',
    ),
    requireData(
      await second.client.from('gameplay_member_outcomes').select('match_id').eq('profile_id', first.user.id),
      '타 사용자 게임 outcome RLS 조회 실패',
    ),
  ])
  assert(otherCredits.length === 0, '다른 사용자의 체육관 인정 경기 원본이 노출됩니다.')
  assert(otherCollections.length === 0, '다른 사용자의 체육관 도감 원본이 노출됩니다.')
  assert(otherContributions.length === 0, '다른 사용자의 보스 기여 원본이 노출됩니다.')
  assert(otherOutcomes.length === 0, '다른 사용자의 경기 게임 outcome 원본이 노출됩니다.')

  console.log('✓ 취소·결과 미확정 경기 진행도 제외')
  console.log('✓ 확정 경기 체육관 도감·방문 1회/참가자별 인정')
  console.log('✓ 보스 전역 피해 경기당 1회/참가자별 개인 기여')
  console.log('✓ 시즌 first_match·boss_raider 퀘스트/칭호 해금·장착')
  console.log('✓ summary/outcome 응답 shape와 저장 결과 일치')
  console.log('✓ 동시 sync 8회 멱등/RLS/직접 쓰기·외부인 차단')
  console.log(`게임 진행도 검증 성공: ${finalizedMatch.id}`)
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
