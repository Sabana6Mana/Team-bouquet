import { NPCS, REGION } from '../data/seed'
import { SPORT_LIST } from '../lib/game'
import { useApp } from '../store/useApp'

/** 종목마다 다른 감탄 이모지 */
const HYPE = ['🔥', '⚡', '💥', '🚀']

/**
 * 지도 상단의 LED 전광판.
 * 구역 이름을 먼저 외치고, 종목별 1위를 중계하듯 흘려보낸다.
 */
export default function RankTicker() {
  const me = useApp((s) => s.me)

  const items = SPORT_LIST.map((s, i) => {
    const top = [...NPCS, me].sort((a, b) => b.elo[s.id] - a.elo[s.id])[0]
    return { sport: s, player: top, hype: HYPE[i % HYPE.length] }
  })

  // 같은 내용을 두 벌 이어 붙이고 절반만큼 밀어 끊김 없이 순환시킨다.
  const row = (
    <div className="ticker-row" aria-hidden="true">
      <span className="ticker-item ticker-lead">
        📣 지금 <b>{REGION}</b> 실시간 랭킹 발표!! 📣
      </span>

      {items.map(({ sport, player, hype }) => (
        <span className="ticker-item" key={sport.id}>
          <span className="ticker-sport">{sport.emoji} {sport.label}</span>
          <span className="ticker-say">1위!는?!</span>
          <span className="ticker-crown">👑</span>
          <span className="ticker-name">
            {player.nickname}{player.isMe && ' (나)'}
          </span>
          <span className="ticker-say">님!!</span>
          <span className="ticker-elo mono">ELO {player.elo[sport.id]}</span>
          <span className="ticker-crown">{hype}</span>
        </span>
      ))}

      <span className="ticker-item ticker-lead">
        🏆 오늘도 {REGION}에서 한 판! 🏆
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
        {REGION} 종목별 1위 ·{' '}
        {items.map(({ sport, player }) => `${sport.label} ${player.nickname} ${player.elo[sport.id]}점`).join(', ')}
      </span>
    </div>
  )
}