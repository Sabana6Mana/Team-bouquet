import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import VenueMap, { type MapMarker } from '../components/VenueMap'
import VenueSheet from '../components/VenueSheet'
import RankTicker from '../components/RankTicker'
import { activeMatchPath } from '../components/ui'
import { HOME, HOT_VENUE_IDS, NPCS, REGION, VENUES, leaderboardOf } from '../data/seed'
import { QUICK_RADIUS_M, SPORTS, distanceMeters, tierOf } from '../lib/game'
import { useApp } from '../store/useApp'
import type { SportId } from '../types'

const MAP_SPORTS: SportId[] = ['badminton', 'tennis', 'tabletennis', 'basketball']

export default function MapScreen() {
  const me = useApp((state) => state.me)
  const coords = useApp((state) => state.coords)
  const account = useApp((state) => state.account)
  const match = useApp((state) => state.match)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [sport, setSport] = useState<SportId>('badminton')
  const [filterOpen, setFilterOpen] = useState(false)
  const nav = useNavigate()

  const venues = useMemo(
    () => VENUES.filter((venue) => venue.sports.includes(sport)),
    [sport],
  )

  const markers: MapMarker[] = useMemo(() => {
    const meta = SPORTS[sport]
    const mapped = venues.map((venue) => {
      const top = leaderboardOf(venue.id, sport)[0]
      return {
        id: venue.id,
        lat: venue.lat,
        lng: venue.lng,
        emoji: meta.emoji,
        sportLabel: meta.label,
        color: meta.color,
        label: venue.name.length > 10 ? `${venue.name.slice(0, 9)}…` : venue.name,
        fullLabel: venue.name,
        hot: HOT_VENUE_IDS.includes(venue.id),
        tierColor: top ? tierOf(top.elo[sport]).color : '#8296B4',
        elo: top?.elo[sport] ?? 1200,
        crowned: false,
      }
    })
    const highestElo = Math.max(...mapped.map((marker) => marker.elo))
    return mapped.map((marker) => ({ ...marker, crowned: marker.elo === highestElo }))
  }, [venues, sport])

  const active = venues.find((venue) => venue.id === activeId) ?? null
  const detailVenue = VENUES.find((venue) => venue.id === detailId) ?? null
  const playerTier = tierOf(me.elo[sport])
  const champion = [...NPCS, me].sort((a, b) => b.elo[sport] - a.elo[sport])[0]
  const interests = account?.interests ?? []
  const quickMode = SPORTS[sport].modes[0]

  // 경진대회 지도는 강남 거점을 먼저 보여준다. 실제 위치가 강남 생활권이면
  // 그대로 쓰고, 멀리 있으면 데모 스폰 지점만 지도 연출에 사용한다.
  const mapPosition = distanceMeters(coords, HOME) <= QUICK_RADIUS_M * 2 ? coords : HOME

  const selectSport = (next: SportId) => {
    setSport(next)
    setActiveId(null)
    setDetailId(null)
    setFilterOpen(false)
  }

  const selectVenue = (id: string) => {
    if (activeId === id) {
      setDetailId(id)
      return
    }
    setActiveId(id)
    setDetailId(null)
  }

  const startMatch = () => {
    if (match) {
      nav(activeMatchPath(match.phase))
      return
    }
    if (active) {
      nav(`/queue/new?venue=${active.id}&sport=${sport}`)
      return
    }
    nav(`/queue/new?quick=1&sport=${sport}`)
  }

  return (
    <main className="map-screen">
      <VenueMap
        center={HOME}
        me={mapPosition}
        markers={markers}
        activeId={activeId}
        onMarkerClick={selectVenue}
        focus={active ? { lat: active.lat, lng: active.lng } : null}
      />

      <div className="map-hud-top">
        <div className="map-wordmark" aria-label="MATCHPOINT">MATCHPOINT</div>

        <div className="map-summary-row">
          <div className="map-summary-card">
            <button className="player-summary" onClick={() => nav('/profile')} aria-label="내 프로필 열기">
              <span className="player-summary__avatar" aria-hidden="true">
                <img src="/map/player-dino.webp" alt="" />
              </span>
              <span className="player-summary__identity">
                <strong>{me.nickname}</strong>
                <span className="mono" style={{ color: playerTier.color }}>
                  {playerTier.name} {me.elo[sport]}
                </span>
              </span>
            </button>

            <div className="summary-divider" />

            <div className="local-champion" aria-label={`${REGION} ${SPORTS[sport].label} 1위`}>
              <span className="local-champion__crown" aria-hidden="true">♛</span>
              <span>
                <strong>{REGION} {SPORTS[sport].label} 1위</strong>
                <span className="mono">ELO {champion.elo[sport]}</span>
              </span>
            </div>
          </div>

          <button
            className="sport-filter-trigger"
            onClick={() => setFilterOpen((open) => !open)}
            aria-label="지도 종목 변경"
            aria-expanded={filterOpen}
          >
            <span aria-hidden="true">{SPORTS[sport].emoji}</span>
            <small>{SPORTS[sport].label}</small>
          </button>
        </div>

        <RankTicker sportId={sport} />
      </div>

      {filterOpen && (
        <>
          <button className="map-menu-scrim" onClick={() => setFilterOpen(false)} aria-label="종목 메뉴 닫기" />
          <div className="sport-filter-menu fade-in" role="menu" aria-label="지도 종목">
            {MAP_SPORTS.map((id) => {
              const meta = SPORTS[id]
              const selected = id === sport
              return (
                <button
                  key={id}
                  role="menuitemradio"
                  aria-checked={selected}
                  className={selected ? 'is-selected' : ''}
                  onClick={() => selectSport(id)}
                >
                  <span aria-hidden="true">{meta.emoji}</span>
                  <span>{meta.label}</span>
                  {interests.includes(id) && <small>관심 종목</small>}
                  {selected && <b aria-hidden="true">✓</b>}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="quick-match-dock">
        <button className={`quick-match-button ${match ? 'is-active-match' : ''}`} onClick={startMatch}>
          <span className="quick-match-button__icon" aria-hidden="true">
            {match ? '⚡' : SPORTS[sport].emoji}
          </span>
          <span className="quick-match-button__copy">
            <strong>
              {match
                ? '진행 중인 매칭으로 돌아가기'
                : active
                  ? `${active.name}에서 매칭`
                  : `${SPORTS[sport].label} ${quickMode} 매칭 시작`}
            </strong>
            {!match && (
              <small>
                {active ? '거점을 한 번 더 누르면 상세 정보' : `주변 ${QUICK_RADIUS_M / 1000}km 빠른 매칭`}
              </small>
            )}
          </span>
        </button>
      </div>

      {detailVenue && <VenueSheet venue={detailVenue} onClose={() => setDetailId(null)} />}
    </main>
  )
}
