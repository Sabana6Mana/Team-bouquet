import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import VenueMap, { type MapMarker } from '../components/VenueMap'
import VenueSheet from '../components/VenueSheet'
import RankTicker from '../components/RankTicker'
import { activeMatchPath } from '../components/ui'
import { HOME, HOT_VENUE_IDS, VENUES, leaderboardOf } from '../data/seed'
import { QUICK_RADIUS_M, SPORTS, distanceMeters, tierOf } from '../lib/game'
import { useApp } from '../store/useApp'
import type { MatchMode, SportId } from '../types'

const MAP_SPORTS: SportId[] = ['badminton', 'tennis', 'tabletennis', 'basketball']

/**
 * 매칭 이후 화면을 확인하기 위한 테스트 버튼을 보일지.
 * 개발 서버에서는 늘 보이고, 배포본에서는 주소에 ?test 를 붙였을 때만 나온다.
 * (심사용 데모 화면에 테스트 버튼이 남지 않게 한다.)
 */
function testToolsEnabled() {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('test')
}

export default function MapScreen() {
  const me = useApp((state) => state.me)
  const coords = useApp((state) => state.coords)
  const account = useApp((state) => state.account)
  const match = useApp((state) => state.match)
  const forceDemoMatch = useApp((state) => state.forceDemoMatch)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [sport, setSport] = useState<SportId | 'all'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const nav = useNavigate()

  const isAll = sport === 'all'
  const interests = account?.interests ?? []
  /** '전체'일 때 내 티어·1위 같은 요약에 쓸 대표 종목 */
  const primarySport: SportId = isAll ? (interests[0] ?? 'badminton') : sport

  const venues = useMemo(
    () => (isAll ? VENUES : VENUES.filter((venue) => venue.sports.includes(sport))),
    [sport, isAll],
  )

  const markers: MapMarker[] = useMemo(() => {
    const mapped = venues.map((venue) => {
      // '전체'에서는 그 체육관의 대표 종목으로 아이콘과 순위를 보여준다.
      const shown: SportId = isAll ? venue.sports[0] : sport
      const meta = SPORTS[shown]
      const top = leaderboardOf(venue.id, shown)[0]
      return {
        id: venue.id,
        lat: venue.lat,
        lng: venue.lng,
        emoji: isAll ? '' : meta.emoji,
        sportLabel: meta.label,
        color: meta.color,
        label: venue.name.length > 10 ? `${venue.name.slice(0, 9)}…` : venue.name,
        fullLabel: venue.name,
        hot: HOT_VENUE_IDS.includes(venue.id),
        tierColor: top ? tierOf(top.elo[shown]).color : '#8296B4',
        elo: top?.elo[shown] ?? 1200,
        crowned: false,
        // 필터와 무관한 전체 목록 기준 번호. 3D 건물을 고르게 나눠 준다.
        seat: VENUES.indexOf(venue),
      }
    })
    const highestElo = Math.max(...mapped.map((marker) => marker.elo))
    return mapped.map((marker) => ({ ...marker, crowned: marker.elo === highestElo }))
  }, [venues, sport, isAll])

  const active = venues.find((venue) => venue.id === activeId) ?? null
  const detailVenue = VENUES.find((venue) => venue.id === detailId) ?? null
  const playerTier = tierOf(me.elo[primarySport])
  const quickMode = SPORTS[primarySport].modes[0]

  // 경진대회 지도는 강남 거점을 먼저 보여준다. 실제 위치가 강남 생활권이면
  // 그대로 쓰고, 멀리 있으면 데모 스폰 지점만 지도 연출에 사용한다.
  const mapPosition = distanceMeters(coords, HOME) <= QUICK_RADIUS_M * 2 ? coords : HOME

  const selectSport = (next: SportId | 'all') => {
    setSport(next)
    setActiveId(null)
    setDetailId(null)
    setFilterOpen(false)
  }

  // 한 번 누르면 바로 상세 창이 열린다. 지도는 focus 를 따라 거점을
  // 왼쪽으로 옮기고, 오른쪽에 창이 펼쳐진다.
  const selectVenue = (id: string) => {
    setActiveId(id)
    setDetailId(id)
  }

  const closeVenue = () => {
    setActiveId(null)
    setDetailId(null)
  }

  /**
   * 매칭 이후 화면을 보기 위한 테스트 매치.
   * 진행 중인 매치가 있어도 밀어내고, 서버 대신 NPC가 자리를 채운다.
   * 종목과 인원은 고른 대로 연다(단식은 팀 구성 화면을 건너뛴다).
   */
  const startTestMatch = (target: SportId, mode: MatchMode) => {
    forceDemoMatch(target, mode)
    setTestOpen(false)
    nav('/queue')
  }

  const startMatch = () => {
    if (match) {
      nav(activeMatchPath(match.phase))
      return
    }
    // '전체'에서는 종목을 넘기지 않고 매칭 설정 화면에서 고르게 한다.
    if (active) {
      nav(`/queue/new?venue=${active.id}${isAll ? '' : `&sport=${sport}`}`)
      return
    }
    nav(`/queue/new?quick=1${isAll ? '' : `&sport=${sport}`}`)
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
                {me.title && <small className="player-summary__title">《{me.title}》</small>}
                <span className="mono" style={{ color: playerTier.color }}>
                  {playerTier.name} {me.elo[primarySport]}
                </span>
              </span>
            </button>
          </div>

          <button
            className="sport-filter-trigger"
            onClick={() => setFilterOpen((open) => !open)}
            aria-label="지도 종목 변경"
            aria-expanded={filterOpen}
          >
            <span aria-hidden="true">{isAll ? '🏟️' : SPORTS[sport].emoji}</span>
            <small>{isAll ? '전체' : SPORTS[sport].label}</small>
          </button>
        </div>

        <RankTicker />
      </div>

      {filterOpen && (
        <>
          <button className="map-menu-scrim" onClick={() => setFilterOpen(false)} aria-label="종목 메뉴 닫기" />
          <div className="sport-filter-menu fade-in" role="menu" aria-label="지도 종목">
            <button
              role="menuitemradio"
              aria-checked={isAll}
              className={isAll ? 'is-selected' : ''}
              onClick={() => selectSport('all')}
            >
              <span aria-hidden="true">🏟️</span>
              <span>전체</span>
              {isAll && <b aria-hidden="true">✓</b>}
            </button>

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

      {testToolsEnabled() && (
        <>
          <button
            className={`map-test-button${testOpen ? ' is-open' : ''}`}
            onClick={() => setTestOpen((open) => !open)}
            aria-expanded={testOpen}
          >
            <span aria-hidden="true">🧪</span>
            <span>테스트 매칭</span>
          </button>

          {testOpen && (
            <>
              <button className="map-menu-scrim" onClick={() => setTestOpen(false)} aria-label="테스트 메뉴 닫기" />
              <div className="test-match-menu fade-in" role="menu" aria-label="테스트 매칭 종목">
                <span className="label">종목 · 인원 선택</span>
                {MAP_SPORTS.map((id) => {
                  const meta = SPORTS[id]
                  return (
                    <div key={id} className={`test-match-row${id === sport ? ' is-current' : ''}`}>
                      <span className="test-match-row__name">
                        <span aria-hidden="true">{meta.emoji}</span>
                        {meta.label}
                      </span>
                      <span className="test-match-row__modes">
                        {meta.modes.map((mode) => (
                          <button key={mode} role="menuitem" onClick={() => startTestMatch(id, mode)}>
                            {mode}
                          </button>
                        ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      <div className="quick-match-dock">
        <button className={`quick-match-button ${match ? 'is-active-match' : ''}`} onClick={startMatch}>
          <span className="quick-match-button__icon" aria-hidden="true">
            {match ? '⚡' : isAll ? '🏟️' : SPORTS[sport].emoji}
          </span>
          <span className="quick-match-button__copy">
            <strong>
              {match
                ? '진행 중인 매칭으로 돌아가기'
                : active
                  ? `${active.name}에서 매칭`
                  : `${SPORTS[primarySport].label} ${quickMode} 매칭 시작`}
            </strong>
            {!match && (
              <small>
                {active ? '다른 거점을 눌러 변경' : `주변 ${QUICK_RADIUS_M / 1000}km 빠른 매칭`}
              </small>
            )}
          </span>
        </button>
      </div>

      {detailVenue && <VenueSheet venue={detailVenue} onClose={closeVenue} />}
    </main>
  )
}
