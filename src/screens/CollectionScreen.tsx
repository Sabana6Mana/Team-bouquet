import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import { useApp } from '../store/useApp'
import { useGameplay } from '../lib/useGameplay'

export default function CollectionScreen() {
  const nav = useNavigate()
  const backend = useBackend()
  const me = useApp((state) => state.me)
  const history = useApp((state) => state.history)
  const gameplay = useGameplay()
  const { region, venues } = gameplay

  return (
    <div className="overlay">
      <TopBar
        title="지역 도감"
        onBack={() => nav(-1)}
        right={backend.enabled && !backend.ready ? <span className="chip">동기화 중</span> : undefined}
      />
      <div className="screen">
        <div
          className="pad stack"
          style={{ gap: 16, paddingBottom: 'calc(28px + var(--safe-bottom))' }}
        >
          <section
            className="card stack"
            style={{
              gap: 14,
              padding: 18,
              overflow: 'hidden',
              borderColor: 'rgba(47, 125, 70, 0.34)',
              background: 'linear-gradient(145deg, rgba(47, 125, 70, 0.14), rgba(255,255,255,0.96) 68%)',
            }}
          >
            <div className="row spread" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 11, minWidth: 0 }}>
                <span
                  className="center"
                  aria-hidden="true"
                  style={{
                    width: 48,
                    height: 48,
                    flexShrink: 0,
                    borderRadius: 15,
                    background: 'var(--surface)',
                    border: '1px solid rgba(47, 125, 70, 0.22)',
                    fontSize: 27,
                    boxShadow: '0 8px 18px rgba(47, 125, 70, 0.12)',
                  }}
                >
                  🗺️
                </span>
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <span className="label">GANGNAM COLLECTION</span>
                  <h1 className="h2">{region.name}</h1>
                  <span className="small">경기를 완료한 체육관이 지도에 선명하게 기록됩니다.</span>
                </div>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
                <span className="mono" style={{ color: 'var(--court)', fontSize: 26, fontWeight: 900 }}>
                  {region.discovered}/{region.total}
                </span>
                <span className="small" style={{ fontSize: 10 }}>{region.completionPercent}% 제패</span>
              </div>
            </div>
            <div
              className="bar"
              role="progressbar"
              aria-label={`${region.name} 수집 진행도`}
              aria-valuemin={0}
              aria-valuemax={region.total}
              aria-valuenow={region.discovered}
              style={{ height: 8 }}
            >
              <i style={{ width: `${region.completionPercent}%` }} />
            </div>
            <div className="row spread" style={{ gap: 10 }}>
              <span className="small" style={{ fontSize: 10.5 }}>
                8개 거점을 모두 밝히면
              </span>
              <span className="chip" style={{ color: 'var(--gold)', borderColor: 'rgba(184, 134, 11, 0.34)' }}>
                👑 《강남의 제패자》
              </span>
            </div>
          </section>

          <div className="row spread" style={{ gap: 12 }}>
            <div className="stack" style={{ gap: 3 }}>
              <h2 className="h3">강남 데모 거점 8</h2>
              <span className="small">발견한 거점을 눌러 지도에서 다시 확인하세요.</span>
            </div>
            <span className="chip" style={{ flexShrink: 0 }}>📍 {region.discovered} 발견</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            {venues.map((venue, index) => (
              <button
                type="button"
                key={venue.id}
                className="card stack"
                onClick={() => nav(`/?venue=${encodeURIComponent(venue.id)}`)}
                aria-label={venue.discovered
                  ? `${venue.name}, 발견 완료, 지도에서 보기`
                  : `${index + 1}번 미발견 체육관, 지도에서 찾기`}
                style={{
                  position: 'relative',
                  minHeight: 174,
                  gap: 10,
                  padding: 13,
                  overflow: 'hidden',
                  textAlign: 'left',
                  opacity: venue.discovered ? 1 : 0.68,
                  borderColor: venue.discovered ? 'rgba(47, 125, 70, 0.32)' : 'var(--line)',
                  background: venue.discovered
                    ? 'linear-gradient(150deg, rgba(47, 125, 70, 0.10), var(--surface) 62%)'
                    : 'linear-gradient(150deg, #eef2ef, #f9fbf9)',
                }}
              >
                <div className="row spread" style={{ width: '100%' }}>
                  <span className="mono small" style={{ fontSize: 10 }}>NO.{String(index + 1).padStart(2, '0')}</span>
                  <span
                    className="chip"
                    style={{
                      height: 23,
                      padding: '0 8px',
                      color: venue.discovered ? 'var(--court)' : 'var(--dim)',
                      background: venue.discovered ? 'var(--court-soft)' : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {venue.discovered ? '발견 ✓' : '미발견'}
                  </span>
                </div>

                <span
                  className="center"
                  aria-hidden="true"
                  style={{
                    width: 56,
                    height: 56,
                    alignSelf: 'center',
                    borderRadius: 18,
                    background: venue.discovered
                      ? 'radial-gradient(circle, #ffffff, var(--court-soft))'
                      : 'linear-gradient(145deg, #dce4df, #f5f7f5)',
                    border: `1px solid ${venue.discovered ? 'rgba(47,125,70,0.22)' : '#d7dfda'}`,
                    boxShadow: venue.discovered ? '0 8px 20px rgba(47,125,70,0.13)' : undefined,
                    fontSize: venue.discovered ? 29 : 26,
                    filter: venue.discovered ? undefined : 'grayscale(1)',
                  }}
                >
                  {venue.discovered ? venue.icon : '❔'}
                </span>

                <div className="stack grow" style={{ gap: 4, width: '100%', justifyContent: 'flex-end' }}>
                  <strong
                    style={{
                      minHeight: 34,
                      overflow: 'hidden',
                      fontSize: 12.5,
                      lineHeight: 1.35,
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 2,
                    }}
                  >
                    {venue.discovered ? venue.name : '미발견 체육관'}
                  </strong>
                  <span className="small" style={{ overflow: 'hidden', fontSize: 10, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {venue.discovered ? `${venue.address} · ${venue.matchCount}경기` : '지도에서 거점을 찾아보세요'}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <p className="small" style={{ margin: '0 10px', textAlign: 'center', lineHeight: 1.6 }}>
            도감과 칭호는 재미를 위한 기록입니다.<br />ELO, 매칭 범위, 경기 능력치에는 영향을 주지 않습니다.
          </p>
        </div>
      </div>
    </div>
  )
}
