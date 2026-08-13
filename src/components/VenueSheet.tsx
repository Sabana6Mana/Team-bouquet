import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SportId, Venue } from '../types'
import {
  DAYS_AHEAD, SPORTS, TIME_SLOTS, dayLabel, distanceLabel, distanceMeters,
  earliestOpenSlot, isSlotOpen, slotShortLabel, tierOf, won,
} from '../lib/game'
import { leaderboardOf, npcById, recordsOf } from '../data/seed'
import { useBackend } from '../context/BackendProvider'
import { useApp } from '../store/useApp'
import { VenueGameplayCard } from './gameplay/GameplayWidgets'
import { activeMatchPath } from './ui'
import PlayerAvatar from './PlayerAvatar'
import { useGameplay } from '../lib/useGameplay'

/** 지도 위에 뜨는 체육관 상세 팝업. 마커는 왼쪽, 팝업은 오른쪽. */
export default function VenueSheet({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  const coords = useApp((s) => s.coords)
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const history = useApp((s) => s.history)
  const backend = useBackend()
  const nav = useNavigate()
  const [tab, setTab] = useState<'leaderboard' | 'recent'>('leaderboard')
  const [sport, setSport] = useState<SportId>(venue.sports[0])

  const dist = distanceMeters(coords, venue)
  const board = leaderboardOf(venue.id, sport)
  const records = recordsOf(venue.id)
  const earliest = earliestOpenSlot(venue.id)
  const gameplay = useGameplay()

  return (
    <div className="gpopup">
      {/* 헤더 */}
      <div className="gpopup-head">
        <span className="led" />
        <span className="grow">VENUE INFO</span>
        <button onClick={onClose} style={{ fontSize: 13, lineHeight: 1, padding: '0 2px' }} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="gpopup-body">
        {/* 이름 · 위치 · 거리 */}
        <div className="stack" style={{ gap: 5 }}>
          <strong style={{ fontSize: 15, lineHeight: 1.3 }}>{venue.name}</strong>
          <span className="small" style={{ fontSize: 10.5 }}>{venue.address}</span>
          <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
            <span className="chip" style={{ height: 22, fontSize: 10.5, color: 'var(--court)' }}>
              📍 {distanceLabel(dist)}
            </span>
            <span className="chip" style={{ height: 22, fontSize: 10.5, color: 'var(--gold)' }}>
              {won(venue.pricePerHour)}/h
            </span>
            <span className="chip" style={{ height: 22, fontSize: 10.5 }}>{records.length}경기</span>
          </div>
        </div>

        {/* 종목 */}
        <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
          {venue.sports.map((s) => {
            const meta = SPORTS[s]
            const on = sport === s
            return (
              <button
                key={s}
                onClick={() => setSport(s)}
                className="chip"
                style={{
                  height: 26, fontSize: 11,
                  borderColor: on ? meta.color : 'var(--line)',
                  color: on ? meta.color : 'var(--muted)',
                  background: on ? `${meta.color}18` : 'var(--surface)',
                }}
              >
                {meta.emoji} {meta.label}
              </button>
            )
          })}
        </div>

        <VenueGameplayCard
          venueId={venue.id}
          gameplay={gameplay}
          selectedSport={sport}
          onOpenCollection={() => nav('/collection')}
          onChallengeBoss={() => nav('/boss')}
        />

        {/* 전광판 */}
        <div className="jumbo">
          <div className="jumbo-head">
            <span className="led" />
            <span className="grow">{tab === 'leaderboard' ? 'ELO RANK' : 'RECENT'}</span>
            <button
              onClick={() => setTab(tab === 'leaderboard' ? 'recent' : 'leaderboard')}
              style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}
            >
              {tab === 'leaderboard' ? '최근 ▸' : '◂ 순위'}
            </button>
          </div>

          {tab === 'leaderboard'
            ? board.map((p, i) => {
                const t = tierOf(p.elo[sport])
                return (
                  <div className="lb-row" key={p.id} style={{ padding: '7px 10px' }}>
                    <span className={`rank${i < 3 ? ` g${i + 1}` : ''}`}>{i + 1}</span>
                    <div className="row grow" style={{ gap: 6, minWidth: 0 }}>
                      <PlayerAvatar player={p} style={{ width: 23, height: 23, flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 11.5, fontWeight: 600,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {p.nickname}
                      </span>
                    </div>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: t.led }}>
                      {p.elo[sport]}
                    </span>
                  </div>
                )
              })
            : records.slice(0, 5).map((r) => {
                const w = npcById(r.winners[0])
                const l = npcById(r.losers[0])
                return (
                  <div key={r.id} className="lb-row" style={{ gridTemplateColumns: '1fr auto', padding: '7px 10px' }}>
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <div className="row" style={{ gap: 4, fontSize: 11.5 }}>
                        <span style={{ color: '#7fe0a0', fontWeight: 700 }}>{w?.nickname}</span>
                        <span style={{ fontSize: 9, opacity: 0.7 }}>def.</span>
                        <span style={{ opacity: 0.75 }}>{l?.nickname}</span>
                      </div>
                      <span className="small" style={{ fontSize: 9 }}>
                        {SPORTS[r.sport].emoji} {r.mode} · {r.playedAt}
                      </span>
                    </div>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 800 }}>{r.score}</span>
                  </div>
                )
              })}
        </div>

        {/* 예약 가능 현황 (앞으로 7일) */}
        <div className="card stack" style={{ gap: 8, padding: 11 }}>
          <div className="row spread">
            <span className="label" style={{ fontSize: 10 }}>예약 가능</span>
            <span className="small" style={{ fontSize: 10 }}>{DAYS_AHEAD}일 이내</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
            {Array.from({ length: 7 }, (_, d) => {
              const l = dayLabel(d)
              const open = TIME_SLOTS.filter((h) => isSlotOpen(venue.id, d, h)).length
              return (
                <div key={d} className="stack center" style={{ gap: 2 }}>
                  <span style={{ fontSize: 8, color: l.isWeekend ? 'var(--red)' : 'var(--muted)' }}>
                    {l.isToday ? '오늘' : l.weekday}
                  </span>
                  <div
                    style={{
                      width: '100%', height: 22, borderRadius: 5,
                      display: 'grid', placeItems: 'center',
                      background: open === 0 ? 'var(--surface-2)' : 'var(--court-soft)',
                      border: `1px solid ${open === 0 ? 'var(--line)' : 'rgba(47,125,70,0.4)'}`,
                      fontSize: 9, fontWeight: 800,
                      color: open === 0 ? 'var(--dim)' : 'var(--court)',
                    }}
                  >
                    {open}
                  </div>
                </div>
              )
            })}
          </div>
          {earliest !== null && (
            <span className="small" style={{ fontSize: 10 }}>
              가장 빠른 예약 <strong style={{ color: 'var(--court)' }}>{slotShortLabel(earliest)}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="gpopup-foot">
        <button
          className={`btn ${match ? 'gold' : 'primary'}`}
          style={{ width: '100%', height: 46, fontSize: 14 }}
          onClick={() => nav(match ? activeMatchPath(match.phase) : `/queue/new?venue=${venue.id}&sport=${sport}`)}
        >
          {match ? '⚡ 진행 중인 매칭으로 돌아가기' : '⚡ 이 체육관에서 매칭'}
        </button>
      </div>
    </div>
  )
}
