import { NPCS, REGION } from '../data/seed'
import { SPORTS } from '../lib/game'
import { useApp } from '../store/useApp'
import type { SportId } from '../types'

/**
 * 지도 상단의 LED 전광판. MVP에서 선택한 한 종목의 지역 1위만 보여
 * 지도 위 정보량을 줄이고 시안의 게임 HUD 인상을 유지한다.
 */
export default function RankTicker({ sportId = 'badminton' }: { sportId?: SportId }) {
  const me = useApp((s) => s.me)

  const sport = SPORTS[sportId]
  const player = [...NPCS, me].sort((a, b) => b.elo[sportId] - a.elo[sportId])[0]

  // 같은 내용을 두 벌 이어 붙이고 절반만큼 밀어 끊김 없이 순환시킨다.
  const row = (
    <div className="ticker-row" aria-hidden="true">
      <span className="ticker-item ticker-focus">
        <span className="ticker-chevron">≪</span>
        <span className="ticker-name">{REGION} {sport.label} 1위</span>
        <span className="ticker-crown">♛</span>
        <span className="ticker-elo mono">ELO {player.elo[sportId]}</span>
        <span className="ticker-chevron">≫</span>
      </span>
    </div>
  )

  return (
    <div className="ticker">
      <div className="ticker-track">
        {row}
        {row}
      </div>
      {/* 화면 낭독기에는 흐르는 텍스트 대신 정적인 요약을 준다 */}
      <span className="sr-only">
        {REGION} {sport.label} 1위 {player.nickname}, ELO {player.elo[sportId]}점
      </span>
    </div>
  )
}
