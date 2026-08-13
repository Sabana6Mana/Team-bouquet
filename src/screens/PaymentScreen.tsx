import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import { MODE_LABEL, SPORTS, slotLabel, won } from '../lib/game'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import PlayerAvatar from '../components/PlayerAvatar'

const METHODS = [
  { id: 'kakao', label: '카카오페이', emoji: '💛' },
  { id: 'naver', label: '네이버페이', emoji: '💚' },
  { id: 'card', label: '신용/체크카드', emoji: '💳' },
]

export default function PaymentScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const pay = useApp((s) => s.pay)
  const cancelMatch = useApp((s) => s.cancelMatch)
  const nav = useNavigate()
  const backend = useBackend()
  const [method, setMethod] = useState('kakao')
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    if (!match) { nav('/', { replace: true }); return }
    if (match.phase === 'reporting') nav('/result', { replace: true })
  }, [match?.phase, match])

  if (!match || match.confirmedSlot === null) return null

  const venue = VENUES.find((v) => v.id === match.venueId)
  const venueName = venue?.name ?? match.venueName ?? '매칭 장소'
  const meta = SPORTS[match.sport]
  const pricePerHour = venue?.pricePerHour ?? match.venuePricePerHour
  const perPerson = pricePerHour === undefined ? null : Math.round(pricePerHour / match.capacity)
  const paidCount = match.players.filter((p) => match.payments[p.id]).length
  const iPaid = !!match.payments[me.id]
  const allPaid = paidCount === match.capacity

  const cancelActiveMatch = () => {
    if (!window.confirm('이 매칭을 취소할까요? 확정된 장소와 시간도 다시 예약 가능 상태로 돌아갑니다.')) return
    cancelMatch()
    nav('/', { replace: true })
  }

  return (
    <div className="overlay">
      <TopBar title={backend.liveMatch ? '참가 확정' : '더치페이 결제'} onBack={() => nav('/')} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 18 }}>
          {/* 예약 요약 */}
          <div className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <div className="avatar" style={{ background: `${meta.color}18`, borderColor: `${meta.color}44` }}>
                {meta.emoji}
              </div>
              <div className="stack grow" style={{ gap: 3 }}>
                <strong style={{ fontSize: 15 }}>{venueName}</strong>
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
              <span className="mono" style={{ fontSize: 14 }}>
                {pricePerHour === undefined ? '비용 확인 중' : won(pricePerHour)}
              </span>
            </div>
            <div className="row spread">
              <span className="small">{match.capacity}인 분할</span>
              <strong className="mono" style={{ fontSize: 20, color: 'var(--gold)' }}>
                {perPerson === null ? '비용 확인 중' : won(perPerson)}
              </strong>
            </div>
          </div>

          {/* 참여자 결제 현황 */}
          <div className="stack" style={{ gap: 10 }}>
            <div className="row spread">
              <span className="label">참여자 {backend.liveMatch ? '확정' : '결제'} 현황</span>
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
                    <PlayerAvatar player={p} className="avatar" />
                    <div className="stack grow" style={{ gap: 2 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>{p.nickname}</strong>
                        {p.isMe && <span className="chip" style={{ height: 18, fontSize: 10, color: 'var(--cyan)' }}>나</span>}
                      </div>
                      <span className="mono small">{perPerson === null ? '비용 확인 중' : won(perPerson)}</span>
                    </div>
                    <span
                      className="chip"
                      style={{
                        color: done ? 'var(--green)' : 'var(--muted)',
                        borderColor: done ? 'rgba(31, 138, 99,0.45)' : 'var(--line)',
                        background: done ? 'rgba(31, 138, 99,0.12)' : 'transparent',
                      }}
                    >
                      {backend.liveMatch
                        ? (done ? '참가 확정!' : '확정 대기중')
                        : (done ? '결제 완료!' : '결제 대기중')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 결제 수단 */}
          {!backend.liveMatch && !iPaid && (
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
              <strong style={{ fontSize: 17, color: 'var(--green)' }}>
                {backend.liveMatch ? '전원 참가가 확정되었습니다!' : '예약이 확정되었습니다!'}
              </strong>
              <p className="small">
                {venueName} · {slotLabel(match.confirmedSlot)}
                <br />
                경기가 끝나면 승패 확정 알림을 보내드립니다.
              </p>
            </div>
          )}

          <p className="small" style={{ fontSize: 11 }}>
            {backend.liveMatch
              ? '※ MVP에서는 실제 결제 없이 참가 의사만 확정합니다. 체육관 예약은 운영자가 별도로 확인합니다.'
              : '※ 데모 버전으로 실제 결제는 이루어지지 않습니다. 전원 결제 완료 시 저희가 체육관과 예약을 대행합니다.'}
          </p>
        </div>
      </div>

      <div className="stack" style={{ gap: 8, padding: '12px 18px calc(16px + var(--safe-bottom))', borderTop: '1px solid var(--line)' }}>
        {backend.liveMatch && (
          <button className="btn ghost" style={{ width: '100%', color: 'var(--red)' }} onClick={cancelActiveMatch}>
            매칭 취소 · 예약 시간 해제
          </button>
        )}
        {allPaid ? (
          <button className="btn gold" style={{ width: '100%', height: 56 }} onClick={() => nav('/')}>
            지도로 돌아가기
          </button>
        ) : iPaid ? (
          <button className="btn" style={{ width: '100%', height: 56 }} disabled>
            다른 참여자의 {backend.liveMatch ? '참가 확정을' : '결제를'} 기다리는 중…
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
            {paying
              ? (backend.liveMatch ? '참가 확정 중…' : '결제 처리 중…')
              : (backend.liveMatch
                ? '이 경기에 참가 확정'
                : perPerson === null ? '금액 확인 후 결제' : `${won(perPerson)} 결제하기`)}
          </button>
        )}
      </div>
    </div>
  )
}
