import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import {
  MODE_LABEL, QUICK_RADIUS_M, SPORTS, SPORT_LIST,
  capacityOf, distanceLabel, distanceMeters, won,
} from '../lib/game'
import { activeMatchPath, TopBar } from '../components/ui'
import type { MatchMode, SportId } from '../types'
import { useBackend } from '../context/BackendProvider'

export default function MatchSetup() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const startQueue = useApp((s) => s.startQueue)
  const coords = useApp((s) => s.coords)
  const account = useApp((s) => s.account)
  const activeMatch = useApp((s) => s.match)
  const backend = useBackend()

  /** 장소를 고르지 않고 반경 안의 플레이어와 매칭하는 모드 */
  const quick = params.get('quick') === '1'
  const venueParam = params.get('venue')
  const venue = quick ? null : (VENUES.find((v) => v.id === venueParam) ?? VENUES[0])

  // 빠른 매칭은 4개 종목 전부, 장소 매칭은 그 시설이 지원하는 종목만 고를 수 있다.
  const sportOptions: SportId[] = quick ? SPORT_LIST.map((s) => s.id) : venue!.sports
  const initialSport = (params.get('sport') as SportId) ?? sportOptions[0]
  const [sport, setSport] = useState<SportId>(
    sportOptions.includes(initialSport) ? initialSport : sportOptions[0],
  )
  const [mode, setMode] = useState<MatchMode>(SPORTS[sport].modes[0])

  const meta = SPORTS[sport]
  const cap = capacityOf(mode)

  /** 빠른 매칭은 장소가 정해지기 전이라 반경 안 후보들의 금액 범위를 보여준다. */
  const candidates = useMemo(
    () =>
      VENUES.filter((v) => v.sports.includes(sport))
        .map((v) => ({ v, d: distanceMeters(coords, v) }))
        .filter((x) => x.d <= QUICK_RADIUS_M)
        .sort((a, b) => a.d - b.d),
    [sport, coords],
  )
  /** 배정 후보가 되는 시설들 (반경 안이 비면 종목 지원 시설 전체) */
  const venuePool = candidates.length
    ? candidates.map((x) => x.v)
    : VENUES.filter((v) => v.sports.includes(sport))

  /** 인원 c명으로 나눴을 때의 1인당 금액 범위 */
  const perPersonRange = (c: number) => {
    const arr = venuePool.map((v) => Math.round(v.pricePerHour / c))
    return { min: Math.min(...arr), max: Math.max(...arr) }
  }

  const pickSport = (s: SportId) => {
    setSport(s)
    setMode(SPORTS[s].modes[0])
  }

  return (
    <div className="overlay">
      <TopBar title={quick ? '빠른 매칭' : '매칭 설정'} onBack={() => nav(-1)} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 20 }}>
          {/* 매칭 범위 또는 장소 */}
          {quick ? (
            <div
              className="card stack"
              style={{ gap: 11, borderColor: 'rgba(47, 125, 70,0.4)', background: 'rgba(47, 125, 70,0.06)' }}
            >
              <div className="row" style={{ gap: 12 }}>
                <div className="avatar lg" style={{ background: 'var(--court-soft)', borderColor: 'rgba(47, 125, 70,0.4)' }}>
                  📡
                </div>
                <div className="stack grow" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 15 }}>내 주변 {QUICK_RADIUS_M / 1000}km</strong>
                  <span className="small">
                    같은 종목으로 빠른 매칭을 누른 플레이어와 연결됩니다.
                  </span>
                </div>
              </div>
              <div className="divider" />
              <div className="row spread">
                <span className="small">반경 내 이용 가능 체육관</span>
                <strong className="mono" style={{ fontSize: 13, color: 'var(--court)' }}>
                  {candidates.length}곳
                </strong>
              </div>
              <span className="small" style={{ fontSize: 11 }}>
                {candidates.length > 0
                  ? `인원이 모이면 가장 가까운 곳(${candidates[0].v.name}, ${distanceLabel(candidates[0].d)})으로 자동 배정됩니다.`
                  : '반경 내에 해당 종목 시설이 없어 가장 가까운 곳으로 배정됩니다.'}
              </span>
            </div>
          ) : (
            <div className="card row" style={{ gap: 12 }}>
              <div className="avatar lg" style={{ background: `${meta.color}18`, borderColor: `${meta.color}44` }}>
                {meta.emoji}
              </div>
              <div className="stack grow" style={{ gap: 4 }}>
                <strong style={{ fontSize: 15 }}>{venue!.name}</strong>
                <span className="small">{venue!.address}</span>
                <span className="small" style={{ color: 'var(--cyan)' }}>
                  📍 {distanceLabel(distanceMeters(coords, venue!))} · {won(venue!.pricePerHour)}/시간
                </span>
              </div>
            </div>
          )}

          {/* 종목 */}
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">종목 선택</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              {sportOptions.map((s) => {
                const m = SPORTS[s]
                const on = sport === s
                return (
                  <button
                    key={s}
                    onClick={() => pickSport(s)}
                    className="card row"
                    style={{
                      gap: 10, padding: 13,
                      borderColor: on ? m.color : 'var(--line)',
                      background: on ? `${m.color}14` : 'var(--surface)',
                    }}
                  >
                    <span style={{ fontSize: 24 }}>{m.emoji}</span>
                    <div className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <strong style={{ fontSize: 14, color: on ? m.color : 'var(--text)' }}>{m.label}</strong>
                      {account?.interests.includes(s) && (
                        <span className="small" style={{ fontSize: 10, color: 'var(--gold)' }}>★ 관심 종목</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 경기 방식 */}
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">경기 방식</span>
            <div className="stack" style={{ gap: 9 }}>
              {meta.modes.map((m) => {
                const on = mode === m
                const c = capacityOf(m)
                return (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="card row spread"
                    style={{ borderColor: on ? 'var(--cyan)' : 'var(--line)', background: on ? 'rgba(47, 125, 70,0.1)' : 'var(--surface)' }}
                  >
                    <div className="stack" style={{ gap: 3, alignItems: 'flex-start' }}>
                      <strong style={{ fontSize: 15, color: on ? 'var(--cyan)' : 'var(--text)' }}>{MODE_LABEL[m]}</strong>
                      <span className="small">
                        총 {c}명 · 인당{' '}
                        {venue
                          ? won(Math.round(venue.pricePerHour / c))
                          : `${won(perPersonRange(c).min)} ~ ${won(perPersonRange(c).max)}`}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 3 }}>
                      {Array.from({ length: c }, (_, i) => (
                        <span key={i} style={{ fontSize: 14, opacity: on ? 1 : 0.4 }}>
                          {i < c / 2 ? '🔵' : '🔴'}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
            {sport === 'basketball' && (
              <p className="small">농구는 3 대 3 경기만 지원합니다.</p>
            )}
          </div>

          {/* 요약 */}
          <div className="card stack" style={{ gap: 9, borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.06)' }}>
            <div className="row spread">
              <span className="small">모집 인원</span>
              <strong className="mono" style={{ fontSize: 14 }}>{cap}명</strong>
            </div>
            <div className="row spread">
              <span className="small">{backend.enabled ? '예상 1인 비용' : '예상 더치페이 금액'}</span>
              <strong className="mono" style={{ fontSize: 14, color: 'var(--gold)' }}>
                {venue
                  ? won(Math.round(venue.pricePerHour / cap))
                  : `${won(perPersonRange(cap).min)} ~ ${won(perPersonRange(cap).max)}`}
              </strong>
            </div>
            <p className="small" style={{ fontSize: 11 }}>
              {quick
                ? `주변 ${QUICK_RADIUS_M / 1000}km 안에서 같은 종목을 고른 플레이어를 찾습니다. 인원이 모이면 알림과 함께 체육관이 배정되고, 시간 조율 후 전원이 ${backend.enabled ? '참가를 확정하면' : '결제하면'} 예약 단계로 넘어갑니다.`
                : `인원이 모두 모이면 알림을 보내드립니다. 시간 조율 후 전원이 ${backend.enabled ? '참가를 확정하면' : '결제하면'} 예약 단계로 넘어갑니다.`}
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 18px calc(16px + var(--safe-bottom))', borderTop: '1px solid var(--line)' }}>
        <button
          className={`btn ${activeMatch ? 'gold' : 'primary'}`}
          style={{ width: '100%', height: 56, fontSize: 16 }}
          onClick={() => {
            if (activeMatch) {
              nav(activeMatchPath(activeMatch.phase), { replace: true })
              return
            }
            startQueue(venue ? venue.id : null, sport, mode)
            nav('/queue', { replace: true })
          }}
        >
          {activeMatch ? '⚡ 진행 중인 매칭으로 돌아가기' : '⚡ 큐 돌리기'}
        </button>
      </div>
    </div>
  )
}
