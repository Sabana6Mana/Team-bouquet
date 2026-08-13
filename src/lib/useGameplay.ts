import { useMemo } from 'react'
import { localGameplaySummary, unavailableGameplaySummary } from '../data/gameplay'
import { useBackend } from '../context/BackendProvider'
import { winStreakOf } from './game'
import { useApp } from '../store/useApp'
import type { GameplaySummary } from '../data/gameplay'
import type { MatchRecord, Player } from '../types'

/**
 * 체험 기록을 포함한 진행 상황.
 *
 * 원래는 화면마다 `backend.liveMatch ? backend.gameplay : localGameplaySummary(...)`
 * 를 따로 적어 두었는데, 같은 판단이 여덟 군데로 복사돼 있어 한 곳으로 모았다.
 *
 * 체험 매칭은 서버에 저장되지 않으므로 서버가 내려주는 진행도에 잡히지 않는다.
 * 체험 기록이 있으면 서버 기록과 합쳐 직접 계산해, 시즌 퀘스트·도감·보스가
 * 도전과제와 같은 기준으로 움직이게 한다.
 */
export function useGameplay(): GameplaySummary {
  const backend = useBackend()
  const me = useApp((state) => state.me)
  const history = useApp((state) => state.history)
  const demoHistory = useApp((state) => state.demoHistory)

  const hasDemo = demoHistory.length > 0

  const combined = useMemo<MatchRecord[]>(
    () => (hasDemo ? [...demoHistory, ...history] : history),
    [hasDemo, demoHistory, history],
  )

  // 서버가 내려준 프로필에는 체험 연승이 없다. 합친 기록으로 다시 센다.
  const player = useMemo<Player>(() => {
    if (!hasDemo) return me
    const streak = winStreakOf({ ...me, isMe: true }, combined)
    return { ...me, bestStreak: Math.max(me.bestStreak ?? 0, streak) }
  }, [hasDemo, me, combined])

  return useMemo(() => {
    // 체험 기록이 있으면 서버 값 대신 합친 기록으로 계산한다.
    if (hasDemo || !backend.liveMatch) return localGameplaySummary(combined, player)
    return backend.gameplay ?? unavailableGameplaySummary()
  }, [hasDemo, backend.liveMatch, backend.gameplay, combined, player])
}