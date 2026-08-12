import type { Match, MatchRecord, Player, SportId } from '../types'
import { REGION, VENUES } from './seed'

export type SeasonQuestCode = 'first_match' | 'venues_3' | 'boss_raider'

export interface GameplayVenueProgress {
  id: string
  name: string
  address: string
  sports: SportId[]
  icon: string
  discovered: boolean
  discoveredAt: string | null
  matchCount: number
}

export interface GameplayRegionProgress {
  id: string
  name: string
  discovered: number
  total: number
  completionPercent: number
}

export interface GameplayThroneHolder {
  nickname: string
  avatar: string
  contribution: number
  isMe: boolean
}

export interface GameplayBoss {
  venueId: string
  venueName: string
  name: string
  icon: string
  maxHp: number
  remainingHp: number
  startingDamage: number
  totalDamage: number
  myContribution: number
  defeated: boolean
  endsLabel: string
  throne: GameplayThroneHolder
}

export interface GameplaySeasonQuest {
  code: SeasonQuestCode
  name: string
  description: string
  icon: string
  rewardTitle: string
  progress: number
  target: number
  completed: boolean
}

export interface GameplaySeason {
  id: string
  name: string
  subtitle: string
  endsLabel: string
  completed: number
  total: number
  quests: GameplaySeasonQuest[]
}

/**
 * 지도·도감·도전과제·랭킹이 함께 소비하는 최소 읽기 모델이다.
 * ELO나 매칭 수치와 분리해 게임 요소가 경기 공정성에 영향을 주지 않게 한다.
 */
export interface GameplaySummary {
  region: GameplayRegionProgress
  venues: GameplayVenueProgress[]
  boss: GameplayBoss
  season: GameplaySeason
}

/** 경기 결과 화면에서 한 번 보여 줄 변화량 스냅샷이다. */
export interface GameplayOutcome {
  matchId: string
  venueId: string
  venueName: string
  newVenue: boolean
  discovered: number
  totalVenues: number
  bossDamage: number
  bossRemainingHp: number
  bossMaxHp: number
  seasonCompleted: number
  seasonTotal: number
  unlockedQuests: GameplaySeasonQuest[]
}

const BOSS_VENUE_ID = 'v1'
const BOSS_MAX_HP = 10
const BOSS_STARTING_DAMAGE = 6
const NATE_RUSH = {
  nickname: 'Nate_Rush',
  avatar: '🐲',
  contribution: 3,
  isMe: false,
} satisfies GameplayThroneHolder

const SPORT_ICONS: Record<SportId, string> = {
  tennis: '🎾',
  badminton: '🏸',
  tabletennis: '🏓',
  basketball: '🏀',
}

/** 라이브 진행도를 아직 받지 못했거나 이벤트가 쉬는 기간에 쓰는 중립 상태. */
export function unavailableGameplaySummary(): GameplaySummary {
  return {
    region: {
      id: 'gangnam', name: `${REGION} 도감`, discovered: 0, total: VENUES.length, completionPercent: 0,
    },
    venues: VENUES.map((venue) => ({
      id: venue.id,
      name: venue.name,
      address: venue.address,
      sports: [...venue.sports],
      icon: SPORT_ICONS[venue.sports[0]] ?? '🏟️',
      discovered: false,
      discoveredAt: null,
      matchCount: 0,
    })),
    boss: {
      venueId: '',
      venueName: '다음 보스 준비 중',
      name: '주간 보스 휴식 중',
      icon: '👾',
      maxHp: 0,
      remainingHp: 0,
      startingDamage: 0,
      totalDamage: 0,
      myContribution: 0,
      defeated: false,
      endsLabel: '다음 이벤트를 기다려 주세요',
      throne: { nickname: '왕좌 집계 전', avatar: '👑', contribution: 0, isMe: false },
    },
    season: {
      id: '',
      name: '다음 시즌 준비 중',
      subtitle: '새로운 탐험 퀘스트를 준비하고 있습니다.',
      endsLabel: '시즌 휴식기',
      completed: 0,
      total: 0,
      quests: [],
    },
  }
}

function distinctHistory(history: MatchRecord[]): MatchRecord[] {
  const ids = new Set<string>()
  return history.filter((record) => {
    if (ids.has(record.id)) return false
    ids.add(record.id)
    return true
  })
}

function quest(
  code: SeasonQuestCode,
  progress: number,
  target: number,
  copy: Pick<GameplaySeasonQuest, 'name' | 'description' | 'icon' | 'rewardTitle'>,
): GameplaySeasonQuest {
  return {
    code,
    ...copy,
    progress: Math.min(progress, target),
    target,
    completed: progress >= target,
  }
}

/** Supabase가 없는 데모에서도 서버 읽기 모델과 같은 모양을 계산한다. */
export function localGameplaySummary(history: MatchRecord[], me: Player): GameplaySummary {
  const records = distinctHistory(history)
  const venues = VENUES.map<GameplayVenueProgress>((venue) => {
    const visits = records.filter((record) => record.venueId === venue.id)
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      sports: [...venue.sports],
      icon: SPORT_ICONS[venue.sports[0]] ?? '🏟️',
      discovered: visits.length > 0,
      discoveredAt: visits.length > 0 ? visits[visits.length - 1].playedAt : null,
      matchCount: visits.length,
    }
  })
  const discovered = venues.filter((venue) => venue.discovered).length
  const bossVisits = records.filter((record) => record.venueId === BOSS_VENUE_ID).length
  const totalDamage = Math.min(BOSS_MAX_HP, BOSS_STARTING_DAMAGE + bossVisits)
  const meOnThrone = bossVisits > NATE_RUSH.contribution
  const throne: GameplayThroneHolder = meOnThrone
    ? {
        nickname: me.nickname || '플레이어',
        avatar: me.avatar || '🦖',
        contribution: bossVisits,
        isMe: true,
      }
    : { ...NATE_RUSH }

  const quests = [
    quest('first_match', records.length, 1, {
      name: '호루라기가 울렸다',
      description: '첫 경기를 결과 확정까지 마무리하세요.',
      icon: '🎟️',
      rewardTitle: '코트에 소환된 자',
    }),
    quest('venues_3', discovered, 3, {
      name: '지도에 핀 세 개',
      description: '서로 다른 강남 체육관 3곳을 발견하세요.',
      icon: '📍',
      rewardTitle: '코트 유목민',
    }),
    quest('boss_raider', bossVisits, 1, {
      name: '왕좌를 흔든 한 방',
      description: '주간 체육관 보스전에 유효 경기로 기여하세요.',
      icon: '👾',
      rewardTitle: '보스의 천적',
    }),
  ]

  return {
    region: {
      id: 'gangnam',
      name: `${REGION} 도감`,
      discovered,
      total: venues.length,
      completionPercent: venues.length === 0 ? 0 : Math.round((discovered / venues.length) * 100),
    },
    venues,
    boss: {
      venueId: BOSS_VENUE_ID,
      venueName: VENUES.find((venue) => venue.id === BOSS_VENUE_ID)?.name ?? '대치체육센터',
      name: '주간 코트 가디언',
      icon: '👾',
      maxHp: BOSS_MAX_HP,
      remainingHp: BOSS_MAX_HP - totalDamage,
      startingDamage: BOSS_STARTING_DAMAGE,
      totalDamage,
      myContribution: bossVisits,
      defeated: totalDamage >= BOSS_MAX_HP,
      endsLabel: '일요일 23:59 종료',
      throne,
    },
    season: {
      id: 'gangnam-expedition-1',
      name: '강남 원정대',
      subtitle: '운동으로 강남의 거점을 하나씩 밝혀 보세요.',
      endsLabel: '시즌 1',
      completed: quests.filter((item) => item.completed).length,
      total: quests.length,
      quests,
    },
  }
}

function recordFromMatch(match: Match): MatchRecord {
  const winner = match.result?.winner ?? 'a'
  return {
    id: match.id,
    venueId: match.venueId,
    sport: match.sport,
    mode: match.mode,
    playedAt: '방금 전',
    winners: match.teams[winner],
    losers: match.teams[winner === 'a' ? 'b' : 'a'],
    score: match.result?.score ?? '-',
    eloDelta: match.result?.delta ?? 0,
  }
}

/**
 * 현재 결과를 history에 가상으로 한 번만 더해 이번 경기로 바뀐 게임 요소만 계산한다.
 * 같은 match id가 이미 동기화됐어도 먼저 제외하므로 재렌더링 결과가 멱등적이다.
 */
export function localGameplayOutcome(
  match: Match | null,
  history: MatchRecord[],
  me: Player,
): GameplayOutcome | null {
  if (!match?.result || !match.venueId) return null

  const beforeHistory = distinctHistory(history).filter((record) => record.id !== match.id)
  const before = localGameplaySummary(beforeHistory, me)
  const after = localGameplaySummary([recordFromMatch(match), ...beforeHistory], me)
  const beforeVenue = before.venues.find((venue) => venue.id === match.venueId)
  const afterVenue = after.venues.find((venue) => venue.id === match.venueId)

  return {
    matchId: match.id,
    venueId: match.venueId,
    venueName: afterVenue?.name ?? match.venueName ?? '새 체육관',
    newVenue: Boolean(afterVenue && !beforeVenue?.discovered),
    discovered: after.region.discovered,
    totalVenues: after.region.total,
    bossDamage: Math.max(0, before.boss.remainingHp - after.boss.remainingHp),
    bossRemainingHp: after.boss.remainingHp,
    bossMaxHp: after.boss.maxHp,
    seasonCompleted: after.season.completed,
    seasonTotal: after.season.total,
    unlockedQuests: after.season.quests.filter((afterQuest) => (
      afterQuest.completed
      && !before.season.quests.find((beforeQuest) => beforeQuest.code === afterQuest.code)?.completed
    )),
  }
}
