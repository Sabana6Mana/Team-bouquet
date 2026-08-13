import type { AchievementProgress, AchievementRarity, MatchRecord, Player } from '../types'

export interface AchievementDefinition {
  code: string
  name: string
  description: string
  icon: string
  rewardTitle: string
  rarity: AchievementRarity
  target: number
  metric:
    | 'matches_played'
    | 'wins'
    | 'best_streak'
    | 'unique_venues'
    | 'gangnam_venues'
    | 'sports_played'
    | 'unique_rivals'
    | 'home_venue_wins'
    | 'giant_killer_wins'
    | 'highest_rating'
    | 'boss_victories'
}

/**
 * 서버의 achievement_definitions seed와 같은 카탈로그다.
 * 프론트에도 두는 이유는 NPC 데모 매치와 로그인 전 미리보기를 동일한 문구로 보여주기 위해서다.
 */
export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    code: 'first_match', name: '호루라기가 울렸다', icon: '🎟️', rarity: 'common',
    description: '첫 경기를 결과 확정까지 마무리하세요.', rewardTitle: '코트에 소환된 자',
    metric: 'matches_played', target: 1,
  },
  {
    code: 'first_win', name: '승리도 처음이 제일 짜릿해', icon: '🔥', rarity: 'common',
    description: 'MATCHPOINT에서 첫 승리를 기록하세요.', rewardTitle: '승리의 불씨',
    metric: 'wins', target: 1,
  },
  {
    code: 'matches_10', name: '운동화 밑창 워밍업 완료', icon: '👟', rarity: 'rare',
    description: '결과가 확정된 경기를 10번 완료하세요.', rewardTitle: '코트 출근러',
    metric: 'matches_played', target: 10,
  },
  {
    code: 'streak_3', name: '불이 붙었다!', icon: '⚡', rarity: 'rare',
    description: '한 종목에서 3연승을 달성하세요.', rewardTitle: '연승 점화자',
    metric: 'best_streak', target: 3,
  },
  {
    code: 'streak_5', name: '브레이크는 장식일 뿐', icon: '🚂', rarity: 'epic',
    description: '한 종목에서 5연승을 달성하세요.', rewardTitle: '멈출 수 없는 자',
    metric: 'best_streak', target: 5,
  },
  {
    code: 'venues_3', name: '지도에 핀 세 개', icon: '📍', rarity: 'rare',
    description: '서로 다른 체육관 3곳에서 경기를 완료하세요.', rewardTitle: '코트 유목민',
    metric: 'unique_venues', target: 3,
  },
  {
    code: 'gangnam_all_clear', name: '강남 체육관 ALL CLEAR', icon: '🗺️', rarity: 'legendary',
    description: '강남 데모 거점 8곳에서 모두 경기를 완료하세요.', rewardTitle: '강남의 제패자',
    metric: 'gangnam_venues', target: 8,
  },
  {
    code: 'venues_50', name: '한반도에 발도장', icon: '🇰🇷', rarity: 'legendary',
    description: '서로 다른 체육관 50곳에서 경기를 완료하세요.', rewardTitle: '전국의 제패자',
    metric: 'unique_venues', target: 50,
  },
  {
    code: 'all_sports', name: '라켓도 공도 가리지 않는다', icon: '🎯', rarity: 'epic',
    description: '테니스·배드민턴·탁구·농구 경기를 모두 완료하세요.', rewardTitle: '올라운드 몬스터',
    metric: 'sports_played', target: 4,
  },
  {
    code: 'unique_rivals_10', name: '열 명과 땀으로 인사하기', icon: '🤝', rarity: 'rare',
    description: '서로 다른 상대 10명과 경기를 완료하세요.', rewardTitle: '코트 인싸',
    metric: 'unique_rivals', target: 10,
  },
  {
    code: 'home_wins_5', name: '이 코트, 눈 감고도 안다', icon: '🏠', rarity: 'epic',
    description: '같은 체육관에서 5승을 기록하세요.', rewardTitle: '우리 동네 터줏대감',
    metric: 'home_venue_wins', target: 5,
  },
  {
    code: 'giant_killer', name: '거인은 쓰러지라고 있는 법', icon: '🗡️', rarity: 'epic',
    description: '평균 ELO가 150 이상 높은 팀을 꺾으세요.', rewardTitle: '자이언트 킬러',
    metric: 'giant_killer_wins', target: 1,
  },
  {
    code: 'gold_any', name: '금빛 문을 열다', icon: '👑', rarity: 'epic',
    description: '한 종목에서 ELO 1400을 달성하세요.', rewardTitle: '골드 입성자',
    metric: 'highest_rating', target: 1400,
  },
  {
    code: 'boss_raider', name: '체육관 보스 격파', icon: '🏸', rarity: 'epic',
    description: '지정된 배드민턴 보스 사용자와 실제 1대1 경기에서 승리하세요.', rewardTitle: '보스의 천적',
    metric: 'boss_victories', target: 1,
  },
]

export const RARITY_META: Record<AchievementRarity, { label: string; color: string }> = {
  common: { label: '일반', color: '#8EA09A' },
  rare: { label: '희귀', color: '#3C91E6' },
  epic: { label: '영웅', color: '#9B5DE5' },
  legendary: { label: '전설', color: '#E6A817' },
}

export function achievementDefinition(code?: string | null): AchievementDefinition | null {
  return ACHIEVEMENTS.find((achievement) => achievement.code === code) ?? null
}

export function titleForAchievement(code?: string | null): string | null {
  return achievementDefinition(code)?.rewardTitle ?? null
}

/** 지정 보스와 실제로 맞붙어 이긴 일반 배드민턴 1v1 경기만 센다. */
export function bossVictoriesOf(history: MatchRecord[], playerId: string): number {
  return history.filter((record) => {
    const bossPlayerId = record.bossPlayerId
    if (!record.bossEventId || !bossPlayerId) return false
    return record.sport === 'badminton'
      && record.mode === '1v1'
      && record.winners.includes(playerId)
      && Boolean(bossPlayerId && bossPlayerId !== playerId && record.losers.includes(bossPlayerId))
  }).length
}

/** 데모 모드에서 확인 가능한 통계만 계산한다. 서버 전용 고급 통계는 0으로 둔다. */
export function localAchievementProgress(
  me: Player,
  history: MatchRecord[],
  equippedCode?: string | null,
): AchievementProgress[] {
  const wins = history.filter((record) => record.winners.includes(me.id))
  const metric: Record<AchievementDefinition['metric'], number> = {
    matches_played: history.length,
    wins: wins.length,
    best_streak: me.bestStreak ?? me.streak ?? 0,
    unique_venues: new Set(history.map((record) => record.venueId)).size,
    gangnam_venues: new Set(history.filter((record) => /^v[1-8]$/.test(record.venueId)).map((record) => record.venueId)).size,
    sports_played: new Set(history.map((record) => record.sport)).size,
    unique_rivals: new Set(history.flatMap((record) => (
      record.winners.includes(me.id) ? record.losers : record.winners
    ))).size,
    home_venue_wins: Math.max(0, ...Object.values(wins.reduce<Record<string, number>>((counts, record) => {
      counts[record.venueId] = (counts[record.venueId] ?? 0) + 1
      return counts
    }, {}))),
    giant_killer_wins: 0,
    highest_rating: Math.max(...Object.values(me.elo)),
    boss_victories: bossVictoriesOf(history, me.id),
  }

  return ACHIEVEMENTS.map((definition) => {
    const progress = metric[definition.metric]
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      rewardTitle: definition.rewardTitle,
      rarity: definition.rarity,
      target: definition.target,
      progress,
      unlockedAt: progress >= definition.target ? 'demo' : null,
      equipped: equippedCode === definition.code,
    }
  })
}
