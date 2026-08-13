import type { Match } from '../types'

/**
 * 실제 사용자 보스전이 일반 매칭 화면을 재사용할 때 함께 내려오는 화면용 메타데이터.
 * 백엔드 계약이 배포되기 전에도 기존 Match 타입을 바꾸지 않고 안전하게 읽는다.
 */
export interface BossMatchMetadata {
  challengeId?: string
  eventId?: string
  challengerId: string
  bossId: string
  status?: string
  rewardTitle?: string
}

type MatchWithBossMetadata = Match & {
  bossChallenge?: unknown
}

/** 일반 매칭을 보스전으로 오인하지 않도록 두 참가자 id가 모두 있을 때만 인정한다. */
export function bossMatchMetadata(match: Match | null | undefined): BossMatchMetadata | null {
  const taggedMatch = match as MatchWithBossMetadata | null | undefined
  const value = taggedMatch?.bossChallenge
  if (value && typeof value === 'object') {
    const metadata = value as Record<string, unknown>
    if (typeof metadata.challengerId === 'string' && typeof metadata.bossId === 'string') {
      return {
        challengeId: typeof metadata.challengeId === 'string' ? metadata.challengeId : undefined,
        eventId: typeof metadata.eventId === 'string' ? metadata.eventId : undefined,
        challengerId: metadata.challengerId,
        bossId: metadata.bossId,
        status: typeof metadata.status === 'string' ? metadata.status : undefined,
        rewardTitle: typeof metadata.rewardTitle === 'string' ? metadata.rewardTitle : undefined,
      }
    }
  }

  // 데모 store는 최소한의 평면 필드만 붙인다. host가 도전자다.
  if (typeof taggedMatch?.bossEventId !== 'string' || typeof taggedMatch.bossPlayerId !== 'string') return null

  return {
    eventId: taggedMatch.bossEventId,
    challengerId: taggedMatch.hostId,
    bossId: taggedMatch.bossPlayerId,
  }
}
