import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import { MODE_LABEL, SPORTS, slotLabel, recommendTeams, teamAvg, tierOf } from '../lib/game'
import { TopBar } from '../components/ui'

const SIDE = {
  a: { key: 'a' as const, label: 'TEAM BLUE', emoji: '🔵', color: '#2F6FD0' },
  b: { key: 'b' as const, label: 'TEAM RED', emoji: '🔴', color: '#CF4040' },
}

export default function TeamScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const setTeams = useApp((s) => s.setTeams)
  const setTeamReady = useApp((s) => s.setTeamReady)
  const nav = useNavigate()

  useEffect(() => {
    if (!match) { nav('/', { replace: true }); return }
    if (match.phase === 'payment' || match.phase === 'confirmed') nav('/payment', { replace: true })
    if (match.phase === 'reporting') nav('/result', { replace: true })
  }, [match?.phase, match])

  if (!match) return null

  const venue = VENUES.find((v) => v.id === match.venueId)!
  const meta = SPORTS[match.sport]
  const half = match.capacity / 2
  const { a, b } = match.teams

  const avgA = teamAvg(match.players, a, match.sport)
  const avgB = teamAvg(match.players, b, match.sport)
  const gap = Math.abs(avgA - avgB)
  const balanced = a.length === half && b.length === half
  const readyCount = match.players.filter((p) => match.teamReady[p.id]).length
  const iAmReady = !!match.teamReady[me.id]
  /** 격차가 작을수록 100에 가까운 균형 점수 */
  const balancePct = Math.max(0, Math.min(100, 100 - (gap / 300) * 100))

  const playerOf = (id: string) => match.players.find((p) => p.id === id)!

  const move = (id: string, to: 'a' | 'b') => {
    const from = to === 'a' ? 'b' : 'a'
    if (!match.teams[from].includes(id)) return
    const nextFrom = match.teams[from].filter((x) => x !== id)
    const nextTo = [...match.teams[to], id]
    if (to === 'a') setTeams(nextTo, nextFrom)
    else setTeams(nextFrom, nextTo)
  }

  const applyRecommended = () => {
    const r = recommendTeams(match.players, match.sport)
    setTeams(r.a, r.b)
  }

  const renderTeam = (side: 'a' | 'b') => {
    const s = SIDE[side]
    const ids = match.teams[side]
    const avg = side === 'a' ? avgA : avgB
    const other = side === 'a' ? 'b' : 'a'
    const full = ids.length >= half

    return (
      <div
        className="card stack"
        style={{ gap: 11, borderColor: `${s.color}55`, background: `${s.color}0d`, flex: 1, minWidth: 0 }}
      >
        <div className="row spread">
          <span className="chip" style={{ color: s.color, borderColor: `${s.color}66`, background: `${s.color}1a` }}>
            {s.emoji} {s.label}
          </span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: ids.length === half ? s.color : 'var(--red)' }}>
            {ids.length}/{half}
          </span>
        </div>

        <div className="stack" style={{ gap: 7 }}>
          {ids.map((id) => {
            const p = playerOf(id)
            const t = tierOf(p.elo[match.sport])
            return (
              <button
                key={id}
                onClick={() => move(id, other)}
                className="card row"
                style={{
                  gap: 9, padding: 9,
                  borderColor: match.teamReady[id]
                    ? 'rgba(31, 138, 99,0.5)'
                    : p.isMe ? 'var(--cyan)' : 'var(--line)',
                  background: match.teamReady[id] ? 'rgba(31, 138, 99,0.07)' : 'var(--surface)',
                }}
              >
                <span className="avatar sm">{p.avatar}</span>
                <div className="stack grow" style={{ gap: 2, alignItems: 'flex-start', minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 12.5, fontWeight: 700, maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {p.nickname}{p.isMe && ' (나)'}
                  </span>
                  <span className="mono" style={{ fontSize: 10.5, color: t.color, fontWeight: 700 }}>
                    {p.elo[match.sport]}
                  </span>
                </div>
                {match.teamReady[id] ? (
                  <span style={{ color: 'var(--green)', fontSize: 13 }}>✓</span>
                ) : (
                  <span className="small" style={{ fontSize: 14, opacity: 0.5 }}>
                    {side === 'a' ? '→' : '←'}
                  </span>
                )}
              </button>
            )
          })}

          {Array.from({ length: Math.max(0, half - ids.length) }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="card center"
              style={{ padding: 11, borderStyle: 'dashed', opacity: 0.5 }}
            >
              <span className="small" style={{ fontSize: 11 }}>빈 자리</span>
            </div>
          ))}
        </div>

        <div className="divider" />
        <div className="row spread">
          <span className="small" style={{ fontSize: 10.5 }}>평균 ELO</span>
          <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: s.color }}>
            {avg || '-'}
          </span>
        </div>
        {full && <span className="small" style={{ fontSize: 10 }}>선수를 눌러 반대 팀으로 이동</span>}
      </div>
    )
  }

  return (
    <div className="overlay">
      <TopBar title="팀 구성" onBack={() => nav('/')} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 16 }}>
          {/* 매치 요약 */}
          <div className="card row" style={{ gap: 11 }}>
            <div className="avatar" style={{ background: `${meta.color}18`, borderColor: `${meta.color}44` }}>
              {meta.emoji}
            </div>
            <div className="stack grow" style={{ gap: 3 }}>
              <strong style={{ fontSize: 14 }}>{venue.name}</strong>
              <span className="small">
                {meta.label} {MODE_LABEL[match.mode]}
                {match.confirmedSlot !== null && ` · ${slotLabel(match.confirmedSlot)}`}
              </span>
            </div>
          </div>

          {/* 밸런스 */}
          <div className="card stack" style={{ gap: 11 }}>
            <div className="row spread">
              <span className="label">팀 밸런스</span>
              <span
                className="chip"
                style={{
                  color: gap <= 60 ? 'var(--green)' : gap <= 150 ? 'var(--gold)' : 'var(--red)',
                  borderColor: 'var(--line)',
                }}
              >
                ELO 격차 <span className="mono">{gap}</span>
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: SIDE.a.color, width: 42 }}>
                {avgA || '-'}
              </span>
              <div className="bar grow">
                <i
                  style={{
                    width: `${balancePct}%`,
                    background:
                      gap <= 60
                        ? 'linear-gradient(90deg,var(--court),var(--court-2))'
                        : gap <= 150
                          ? 'linear-gradient(90deg,#d99a1f,#f0b53f)'
                          : 'linear-gradient(90deg,#cf4040,#e06565)',
                  }}
                />
              </div>
              <span
                className="mono"
                style={{ fontSize: 13, fontWeight: 800, color: SIDE.b.color, width: 42, textAlign: 'right' }}
              >
                {avgB || '-'}
              </span>
            </div>
            <div className="row spread">
              <span className="small" style={{ fontSize: 11 }}>
                {gap <= 60 ? '균형이 좋습니다' : gap <= 150 ? '조금 기울어 있습니다' : '격차가 큽니다'}
              </span>
              <button className="btn sm" onClick={applyRecommended}>
                ⚖️ 추천 팀 적용
              </button>
            </div>
          </div>

          {/* 팀 패널 */}
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            {renderTeam('a')}
            {renderTeam('b')}
          </div>

          {/* 준비 현황 */}
          <div className="card stack" style={{ gap: 9 }}>
            <div className="row spread">
              <span className="label">준비 현황</span>
              <span
                className="mono small"
                style={{ color: readyCount === match.capacity ? 'var(--green)' : 'var(--gold)' }}
              >
                {readyCount}/{match.capacity}
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${(readyCount / match.capacity) * 100}%` }} />
            </div>
            <span className="small" style={{ fontSize: 11 }}>
              {!balanced
                ? '정원이 맞지 않으면 준비할 수 없습니다. 상대들도 정원을 맞추려 팀을 옮깁니다.'
                : iAmReady
                  ? '전원이 준비를 완료하면 결제로 넘어갑니다.'
                  : '팀 구성에 동의하면 준비를 완료해 주세요.'}
            </span>
          </div>

          <p className="small" style={{ fontSize: 11 }}>
            선수를 눌러 원하는 팀으로 옮길 수 있습니다. 팀을 바꾸면 모두의 준비 상태가 초기화되고
            상대들이 다시 검토합니다. ELO 격차가 작을수록 경기 결과에 따른 레이팅 변동이 커집니다.
          </p>
        </div>
      </div>

      <div style={{ padding: '12px 18px calc(16px + var(--safe-bottom))', borderTop: '1px solid var(--line)' }}>
        <button
          className={`btn${iAmReady ? '' : ' primary'}`}
          style={{ width: '100%', height: 56, fontSize: 16 }}
          disabled={!balanced}
          onClick={() => setTeamReady(!iAmReady)}
        >
          {!balanced
            ? `양 팀을 ${half}명씩 맞춰주세요`
            : iAmReady
              ? `준비 완료 취소 · 다른 참여자 대기 중 (${readyCount}/${match.capacity})`
              : '이 팀으로 준비 완료'}
        </button>
      </div>
    </div>
  )
}
