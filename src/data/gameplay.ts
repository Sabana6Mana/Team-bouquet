import type { Match, MatchRecord, Player, SportId } from '../types'
import { bossVictoriesOf } from './achievements'
import { DEMO_BOSS_EVENT_ID, DEMO_BOSS_PLAYER, DEMO_BOSS_VENUE_ID, REGION, VENUES } from './seed'

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

export interface GameplayBossOpponent {
  nickname: string
  avatar: string
  avatarUrl: string | null
  rating: number
}

export interface GameplayBoss {
  eventId: string
  venueId: string
  venueName: string
  name: string
  icon: string
  sport: 'badminton'
  opponent: GameplayBossOpponent
  /** 이미 생성된 보스 일반 매치가 있으면 이어가기 위해 제공한다. */
  matchId?: string | null
  matchPhase?: string | null
  canChallenge: boolean
  titleUnlocked: boolean
  rewardTitle: string
  defeated: boolean
  endsLabel: string
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
  seasonCompleted: number
  seasonTotal: number
  unlockedQuests: GameplaySeasonQuest[]
}

const DEMO_BOSS = {
  nickname: DEMO_BOSS_PLAYER.nickname,
  avatar: DEMO_BOSS_PLAYER.avatar,
  avatarUrl: DEMO_BOSS_PLAYER.avatarUrl ?? null,
  rating: DEMO_BOSS_PLAYER.elo.badminton,
} satisfies GameplayBossOpponent

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
      eventId: '',
      venueId: '',
      venueName: '다음 보스 준비 중',
      name: '배드민턴 보스 휴식 중',
      icon: '🏸',
      sport: 'badminton',
      opponent: { ...DEMO_BOSS },
      matchId: null,
      matchPhase: null,
      canChallenge: false,
      titleUnlocked: false,
      rewardTitle: '보스의 천적',
      defeated: false,
      endsLabel: '다음 이벤트를 기다려 주세요',
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
  const bossVictories = bossVictoriesOf(records, me.id)

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
    quest('boss_raider', bossVictories, 1, {
      name: '체육관 보스 격파',
      description: '지정된 배드민턴 보스 사용자와 실제 1대1 경기에서 승리하세요.',
      icon: '🏸',
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
      eventId: DEMO_BOSS_EVENT_ID,
      venueId: DEMO_BOSS_VENUE_ID,
      venueName: VENUES.find((venue) => venue.id === DEMO_BOSS_VENUE_ID)?.name ?? '대치체육센터',
      name: '배드민턴 주간 보스',
      icon: '🏸',
      sport: 'badminton',
      opponent: { ...DEMO_BOSS },
      matchId: null,
      matchPhase: null,
      canChallenge: bossVictories === 0,
      titleUnlocked: bossVictories > 0,
      rewardTitle: '보스의 천적',
      defeated: bossVictories > 0,
      endsLabel: '일요일 23:59 종료',
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
    bossEventId: match.bossEventId,
    bossPlayerId: match.bossPlayerId,
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
    seasonCompleted: after.season.completed,
    seasonTotal: after.season.total,
    unlockedQuests: after.season.quests.filter((afterQuest) => (
      afterQuest.completed
      && !before.season.quests.find((beforeQuest) => beforeQuest.code === afterQuest.code)?.completed
    )),
  }
}
