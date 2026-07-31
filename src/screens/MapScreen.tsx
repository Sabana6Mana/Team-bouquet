import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import VenueMap, { type MapMarker } from '../components/VenueMap'
import VenueSheet from '../components/VenueSheet'
import RankTicker from '../components/RankTicker'
import { useApp } from '../store/useApp'
import { HOT_VENUE_IDS, VENUES, leaderboardOf } from '../data/seed'
import { QUICK_RADIUS_M, SPORTS, tierOf } from '../lib/game'
import type { SportId } from '../types'

export default function MapScreen() {
  const me = useApp((s) => s.me)
  const coords = useApp((s) => s.coords)
  const account = useApp((s) => s.account)
  const match = useApp((s) => s.match)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter, setFilter] = useState<SportId | 'all'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const nav = useNavigate()

  const interests = account?.interests ?? []

  const venues = useMemo(
    () => (filter === 'all' ? VENUES : VENUES.filter((v) => v.sports.includes(filter))),
    [filter],
  )

  // 네이버 오버레이 동기화 effect가 이 배열을 의존하므로 참조를 고정한다.
  const markers: MapMarker[] = useMemo(
    () =>
      venues.map((v) => {
        const primary = (filter !== 'all' ? filter : v.sports[0]) as SportId
        const s = SPORTS[primary]
        const top = leaderboardOf(v.id, primary)[0]
        return {
          id: v.id, lat: v.lat, lng: v.lng,
          emoji: s.emoji, color: s.color,
          label: v.name.length > 10 ? v.name.slice(0, 9) + '…' : v.name,
          hot: HOT_VENUE_IDS.includes(v.id),
          tierColor: top ? tierOf(top.elo[primary]).color : '#8296B4',
        }
      }),
    [venues, filter],
  )

  const active = VENUES.find((v) => v.id === activeId) ?? null
  const bestElo = Math.max(...Object.values(me.elo))
  const tier = tierOf(bestElo)

  return (
    <>
      {/* 상단 바 — 플레이어 요약(축소) + 종목 필터 버튼 */}
      <div
        style={{
          position: 'absolute', top: 10, left: 12, right: 12, zIndex: 36,
          display: 'flex', gap: 8, alignItems: 'stretch',
        }}
      >
        <button
          onClick={() => nav('/profile')}
          aria-label="내 프로필 열기"
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)',
            border: '1px solid var(--line)', borderRadius: 12,
            boxShadow: '0 3px 10px rgba(18,52,32,0.1)',
            textAlign: 'left',
          }}
        >
          <div className="avatar sm">{me.avatar}</div>
          <div className="stack grow" style={{ gap: 1, minWidth: 0 }}>
            <strong
              style={{
                fontSize: 12.5, lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {me.nickname}
            </strong>
            <span className="mono" style={{ fontSize: 10, color: tier.color, fontWeight: 800 }}>
              {tier.name} {bestElo}
              <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · {me.wins}승 {me.losses}패</span>
            </span>
          </div>
          <span style={{ fontSize: 14, color: 'var(--dim)', flexShrink: 0 }}>›</span>
        </button>

        <button
          onClick={() => setFilterOpen((o) => !o)}
          aria-label="종목 필터"
          aria-expanded={filterOpen}
          style={{
            width: 50, flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
            background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)',
            border: `1px solid ${filter === 'all' ? 'var(--line)' : SPORTS[filter].color}`,
            borderRadius: 12,
            boxShadow: '0 3px 10px rgba(18,52,32,0.1)',
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>
            {filter === 'all' ? '🏟️' : SPORTS[filter].emoji}
          </span>
          <span
            style={{
              fontSize: 8, lineHeight: 1,
              color: filter === 'all' ? 'var(--muted)' : SPORTS[filter].color,
              transform: filterOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.18s ease',
            }}
          >
            ▼
          </span>
        </button>
      </div>

      {/* 종목별 1위 전광판 */}
      {!active && <RankTicker />}

      {/* 필터 드롭다운 */}
      {filterOpen && (
        <>
          <div
            onClick={() => setFilterOpen(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 35 }}
          />
          <div
            className="fade-in"
            style={{
              position: 'absolute', top: 60, right: 12, width: 172, zIndex: 38,
              background: '#fff', border: '1px solid var(--line)', borderRadius: 14,
              boxShadow: '0 12px 28px rgba(18,52,32,0.22)', overflow: 'hidden',
            }}
          >
            {(['all', 'tennis', 'badminton', 'tabletennis', 'basketball'] as const).map((f, i) => {
              const on = filter === f
              const s = f === 'all' ? null : SPORTS[f]
              const rec = f !== 'all' && interests.includes(f)
              return (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setActiveId(null); setFilterOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '11px 12px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                    background: on ? (s ? `${s.color}16` : 'var(--court-soft)') : 'transparent',
                    color: on ? (s?.color ?? 'var(--court)') : 'var(--text)',
                    fontWeight: on ? 800 : 600, fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{s ? s.emoji : '🏟️'}</span>
                  <span className="grow" style={{ textAlign: 'left' }}>{s ? s.label : '전체'}</span>
                  {rec && <span style={{ color: 'var(--gold)', fontSize: 10 }}>★</span>}
                  {on && <span style={{ fontSize: 12 }}>✓</span>}
                </button>
              )
            })}
          </div>
        </>
      )}

      <VenueMap
        center={coords}
        me={coords}
        markers={markers}
        activeId={activeId}
        onMarkerClick={(id) => setActiveId(id)}
        focus={active ? { lat: active.lat, lng: active.lng } : null}
      />

      {/* 진행 중인 매칭이 있으면 복귀 배너, 없으면 빠른 매칭 버튼 */}
      {!active && (
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 16, zIndex: 35 }}>
          {match ? (
            <button
              className="btn gold"
              style={{ width: '100%' }}
              onClick={() =>
                nav(
                  match.phase === 'queue' ? '/queue'
                  : match.phase === 'scheduling' ? '/room'
                  : match.phase === 'teaming' ? '/teams'
                  : match.phase === 'payment' ? '/payment'
                  : match.phase === 'reporting' ? '/result'
                  : '/room',
                )
              }
            >
              ⚡ 진행 중인 매칭으로 돌아가기
            </button>
          ) : (
            <button
              className="btn primary"
              style={{ width: '100%', height: 58, fontSize: 16 }}
              onClick={() => nav('/queue/new?quick=1')}
            >
              ⚡ 빠른 매칭 시작
              <span style={{ fontWeight: 600, opacity: 0.85, fontSize: 12.5 }}>
                · 주변 {QUICK_RADIUS_M / 1000}km 플레이어와 매칭
              </span>
            </button>
          )}
        </div>
      )}

      {active && <VenueSheet venue={active} onClose={() => setActiveId(null)} />}
    </>
  )
}
