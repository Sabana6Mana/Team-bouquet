import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import { MODE_LABEL, SPORTS, slotLabel, won } from '../lib/game'
import { TopBar } from '../components/ui'

const METHODS = [
  { id: 'kakao', label: '카카오페이', emoji: '💛' },
  { id: 'naver', label: '네이버페이', emoji: '💚' },
  { id: 'card', label: '신용/체크카드', emoji: '💳' },
]

export default function PaymentScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const pay = useApp((s) => s.pay)
  const nav = useNavigate()
  const [method, setMethod] = useState('kakao')
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    if (!match) { nav('/', { replace: true }); return }
    if (match.phase === 'reporting') nav('/result', { replace: true })
  }, [match?.phase, match])

  if (!match || match.confirmedSlot === null) return null

  const venue = VENUES.find((v) => v.id === match.venueId)!
  const meta = SPORTS[match.sport]
  const perPerson = Math.round(venue.pricePerHour / match.capacity)
  const paidCount = match.players.filter((p) => match.payments[p.id]).length
  const iPaid = !!match.payments[me.id]
  const allPaid = paidCount === match.capacity

  return (
    <div className="overlay">
      <TopBar title="더치페이 결제" onBack={() => nav('/')} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 18 }}>
          {/* 예약 요약 */}
          <div className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <div className="avatar" style={{ background: `${meta.color}18`, borderColor: `${meta.color}44` }}>
                {meta.emoji}
              </div>
              <div className="stack grow" style={{ gap: 3 }}>
                <strong style={{ fontSize: 15 }}>{venue.name}</strong>
                <span className="small">{meta.label} {MODE_LABEL[match.mode]}</span>
              </div>
            </div>
            <div className="divider" />
            <div className="row spread">
              <span className="small">예약 시간</span>
              <strong className="mono" style={{ fontSize: 14, color: 'var(--cyan)' }}>{slotLabel(match.confirmedSlot)}</strong>
            </div>
            <div className="row spread">
              <span className="small">총 대관료</span>
              <span className="mono" style={{ fontSize: 14 }}>{won(venue.pricePerHour)}</span>
            </div>
            <div className="row spread">
              <span className="small">{match.capacity}인 분할</span>
              <strong className="mono" style={{ fontSize: 20, color: 'var(--gold)' }}>{won(perPerson)}</strong>
            </div>
          </div>

          {/* 참여자 결제 현황 */}
          <div className="stack" style={{ gap: 10 }}>
            <div className="row spread">
              <span className="label">참여자 결제 현황</span>
              <span className="mono small" style={{ color: allPaid ? 'var(--green)' : 'var(--gold)' }}>
                {paidCount}/{match.capacity} 완료
              </span>
            </div>
            <div className="bar"><i style={{ width: `${(paidCount / match.capacity) * 100}%` }} /></div>

            <div className="stack" style={{ gap: 8, marginTop: 2 }}>
              {match.players.map((p) => {
                const done = !!match.payments[p.id]
                return (
                  <div
                    key={p.id}
                    className="card row"
                    style={{
                      gap: 11, padding: 12,
                      borderColor: done ? 'rgba(31, 138, 99,0.4)' : 'var(--line)',
                      background: done ? 'rgba(31, 138, 99,0.07)' : 'var(--surface)',
                    }}
                  >
                    <div className="avatar">{p.avatar}</div>
                    <div className="stack grow" style={{ gap: 2 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>{p.nickname}</strong>
                        {p.isMe && <span className="chip" style={{ height: 18, fontSize: 10, color: 'var(--cyan)' }}>나</span>}
                      </div>
                      <span className="mono small">{won(perPerson)}</span>
                    </div>
                    <span
                      className="chip"
                      style={{
                        color: done ? 'var(--green)' : 'var(--muted)',
                        borderColor: done ? 'rgba(31, 138, 99,0.45)' : 'var(--line)',
                        background: done ? 'rgba(31, 138, 99,0.12)' : 'transparent',
                      }}
                    >
                      {done ? '결제 완료!' : '결제 대기중'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 결제 수단 */}
          {!iPaid && (
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">결제 수단</span>
              <div className="stack" style={{ gap: 8 }}>
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className="card row"
                    style={{
                      gap: 11, padding: 13,
                      borderColor: method === m.id ? 'var(--cyan)' : 'var(--line)',
                      background: method === m.id ? 'rgba(47, 125, 70,0.09)' : 'var(--surface)',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{m.emoji}</span>
                    <span className="grow" style={{ textAlign: 'left', fontSize: 14, fontWeight: 600 }}>{m.label}</span>
                    <span style={{ color: method === m.id ? 'var(--cyan)' : 'var(--dim)' }}>
                      {method === m.id ? '◉' : '○'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {allPaid && (
            <div
              className="card stack center fade-in"
              style={{ gap: 8, padding: 22, borderColor: 'rgba(31, 138, 99,0.45)', background: 'rgba(31, 138, 99,0.09)', textAlign: 'center' }}
            >
              <span style={{ fontSize: 38 }}>🎉</span>
              <strong style={{ fontSize: 17, color: 'var(--green)' }}>예약이 확정되었습니다!</strong>
              <p className="small">
                {venue.name} · {slotLabel(match.confirmedSlot)}
                <br />
                경기가 끝나면 승패 확정 알림을 보내드립니다.
              </p>
            </div>
          )}

          <p className="small" style={{ fontSize: 11 }}>
            ※ 데모 버전으로 실제 결제는 이루어지지 않습니다. 전원 결제 완료 시 저희가 체육관과 예약을 대행합니다.
          </p>
        </div>
      </div>

      <div style={{ padding: '12px 18px calc(16px + var(--safe-bottom))', borderTop: '1px solid var(--line)' }}>
        {allPaid ? (
          <button className="btn gold" style={{ width: '100%', height: 56 }} onClick={() => nav('/')}>
            지도로 돌아가기
          </button>
        ) : iPaid ? (
          <button className="btn" style={{ width: '100%', height: 56 }} disabled>
            다른 참여자의 결제를 기다리는 중…
          </button>
        ) : (
          <button
            className="btn primary"
            style={{ width: '100%', height: 56, fontSize: 16 }}
            disabled={paying}
            onClick={() => {
              setPaying(true)
              setTimeout(() => { pay(); setPaying(false) }, 700)
            }}
          >
            {paying ? '결제 처리 중…' : `${won(perPerson)} 결제하기`}
          </button>
        )}
      </div>
    </div>
  )
}
