import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { NPCS } from '../data/seed'
import { SPORT_LIST, SPORTS, TIERS, tierOf } from '../lib/game'
import { useBackend } from '../context/BackendProvider'
import { WeeklyBossCard } from '../components/gameplay/GameplayWidgets'
import { Jumbotron } from '../components/ui'
import PlayerAvatar from '../components/PlayerAvatar'
import type { SportId } from '../types'
import { useGameplay } from '../lib/useGameplay'

export default function RankingScreen() {
  const me = useApp((s) => s.me)
  const history = useApp((s) => s.history)
  const [sport, setSport] = useState<SportId>('badminton')
  const backend = useBackend()
  const nav = useNavigate()
  const gameplay = useGameplay()

  const all = [...NPCS, me].sort((a, b) => b.elo[sport] - a.elo[sport])
  const myRank = all.findIndex((p) => p.id === me.id) + 1
  const myTier = tierOf(me.elo[sport])
  const nextTier = TIERS.find((t) => t.min > me.elo[sport])

  return (
    <div className="screen">
      <div className="pad stack" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="h1">랭킹</h1>
          <p className="body">서울 강남구 · 시즌 1</p>
        </div>

        <div className="row" style={{ gap: 7, overflowX: 'auto' }}>
          {SPORT_LIST.map((s) => {
            const on = sport === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSport(s.id)}
                className="chip"
                style={{
                  flexShrink: 0, height: 34,
                  borderColor: on ? s.color : 'var(--line)',
                  color: on ? s.color : 'var(--muted)',
                  background: on ? `${s.color}16` : 'var(--surface)',
                }}
              >
                {s.emoji} {s.label}
              </button>
            )
          })}
        </div>

        {sport === 'badminton' && (
          <WeeklyBossCard
            gameplay={gameplay}
            onOpenVenue={(venueId) => nav(`/?venue=${venueId}`)}
            onChallenge={() => nav('/boss')}
          />
        )}

        {/* 내 순위 카드 */}
        <div
          className="card stack"
          style={{ gap: 13, borderColor: `${myTier.color}55`, background: `linear-gradient(160deg, ${myTier.color}18, transparent)` }}
        >
          <div className="row" style={{ gap: 13 }}>
            <PlayerAvatar player={me} className="avatar lg" style={{ borderColor: `${myTier.color}66` }} />
            <div className="stack grow" style={{ gap: 5 }}>
              <strong style={{ fontSize: 17 }}>{me.nickname}</strong>
              {me.title && <span className="profile-title">《{me.title}》</span>}
              <span className="chip" style={{ color: myTier.color, borderColor: `${myTier.color}55`, background: `${myTier.color}16`, alignSelf: 'flex-start' }}>
                {myTier.name} · {SPORTS[sport].label}
              </span>
            </div>
            <div className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
              <span className="mono" style={{ fontSize: 26, fontWeight: 800, color: myTier.color }}>
                {me.elo[sport]}
              </span>
              <span className="small" style={{ fontSize: 11 }}>#{myRank} / {all.length}</span>
            </div>
          </div>
          {nextTier && (
            <>
              <div className="bar">
                <i
                  style={{
                    width: `${((me.elo[sport] - myTier.min) / (nextTier.min - myTier.min)) * 100}%`,
                    background: `linear-gradient(90deg, ${myTier.color}, ${nextTier.color})`,
                  }}
                />
              </div>
              <span className="small" style={{ fontSize: 11 }}>
                {nextTier.name}까지 <span className="mono" style={{ color: nextTier.color }}>{nextTier.min - me.elo[sport]}</span> 점
              </span>
            </>
          )}
        </div>

        {/* 티어 구간 */}
        <div className="row" style={{ gap: 5 }}>
          {TIERS.map((t) => (
            <div
              key={t.name}
              className="stack center"
              style={{
                flex: 1, gap: 3, padding: '9px 0', borderRadius: 10,
                background: tierOf(me.elo[sport]).name === t.name ? `${t.color}1f` : 'var(--surface)',
                border: `1px solid ${tierOf(me.elo[sport]).name === t.name ? `${t.color}66` : 'var(--line)'}`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, color: t.color }}>{t.short}</span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>{t.min}</span>
            </div>
          ))}
        </div>

        <Jumbotron title={`${SPORTS[sport].label} Top 20`}>
          {all.slice(0, 20).map((p, i) => {
            const t = tierOf(p.elo[sport])
            const mine = p.id === me.id
            return (
              <div
                key={p.id}
                className="lb-row"
                style={mine ? { background: 'rgba(111, 220, 149, 0.16)' } : undefined}
              >
                <span className={`rank${i < 3 ? ` g${i + 1}` : ''}`}>{i + 1}</span>
                <div className="row grow" style={{ gap: 9, minWidth: 0 }}>
                  <PlayerAvatar player={p} style={{ width: 26, height: 26, flexShrink: 0 }} />
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13, fontWeight: mine ? 800 : 600,
                        color: mine ? '#7fe0a0' : '#eef8f0',
                        textShadow: mine ? '0 0 8px rgba(127,224,160,0.7)' : undefined,
                      }}
                    >
                      {p.nickname}{mine && ' (나)'}
                    </span>
                    <span className="small" style={{ fontSize: 10 }}>{p.wins}승 {p.losses}패</span>
                    {p.title && <span className="small" style={{ fontSize: 9, color: '#eacb74' }}>《{p.title}》</span>}
                  </div>
                </div>
                <div className="stack" style={{ alignItems: 'flex-end', gap: 1 }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: t.led }}>{p.elo[sport]}</span>
                  <span style={{ fontSize: 9, color: '#9fc9ac' }}>{t.name}</span>
                </div>
              </div>
            )
          })}
        </Jumbotron>
      </div>
    </div>
  )
}
