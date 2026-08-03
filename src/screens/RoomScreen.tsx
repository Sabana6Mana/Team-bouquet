import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import {
  DAYS_AHEAD, MODE_LABEL, SPORTS, TIME_SLOTS, bookedHoursFor, dayLabel,
  encodeSlot, isPastSlot, isSlotOpen, slotDay, slotLabel, slotShortLabel, won,
} from '../lib/game'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'

export default function RoomScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const vote = useApp((s) => s.vote)
  const sendChat = useApp((s) => s.sendChat)
  const openReporting = useApp((s) => s.openReporting)
  const cancelMatch = useApp((s) => s.cancelMatch)
  const backendSlotIds = useApp((s) => s.backendSlotIds)
  const backend = useBackend()
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [day, setDay] = useState(0)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [match?.chat.length])

  useEffect(() => {
    if (!match) { nav('/', { replace: true }); return }
    if (match.phase === 'teaming') nav('/teams', { replace: true })
    if (match.phase === 'payment') nav('/payment', { replace: true })
    if (match.phase === 'reporting') nav('/result', { replace: true })
  }, [match?.phase, match])

  if (!match) return null

  const venue = VENUES.find((v) => v.id === match.venueId)
  const venueName = venue?.name ?? match.venueName ?? '매칭 장소'
  const meta = SPORTS[match.sport]
  const myVote = match.votes[me.id]
  const pricePerHour = venue?.pricePerHour ?? match.venuePricePerHour
  const perPerson = pricePerHour === undefined ? null : Math.round(pricePerHour / match.capacity)
  const votedCount = Object.keys(match.votes).length

  const votersOf = (slot: number) =>
    match.players.filter((p) => match.votes[p.id] === slot)

  const confirmed = match.phase === 'confirmed'
  const reportingAvailable = !backend.enabled
    || (match.confirmedSlotEndsAt !== undefined && Date.now() >= match.confirmedSlotEndsAt)

  const cancelActiveMatch = () => {
    if (!window.confirm('이 매칭을 취소할까요? 확정된 장소와 시간도 다시 예약 가능 상태로 돌아갑니다.')) return
    cancelMatch()
    nav('/', { replace: true })
  }

  return (
    <div className="overlay">
      <TopBar
        title={confirmed ? '예약 확정' : '일정 조율'}
        onBack={() => nav('/')}
        right={
          <span className="chip" style={{ color: 'var(--cyan)' }}>
            {match.players.length}명
          </span>
        }
      />

      {/* 매치 요약 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="avatar" style={{ background: `${meta.color}18`, borderColor: `${meta.color}44` }}>
            {meta.emoji}
          </div>
          <div className="stack grow" style={{ gap: 3 }}>
            <strong style={{ fontSize: 14 }}>{venueName}</strong>
            <span className="small">
              {meta.label} {MODE_LABEL[match.mode]} · 인당 {perPerson === null ? '비용 확인 중' : won(perPerson)}
            </span>
          </div>
          <div className="row">
            {match.players.slice(0, 4).map((p, i) => (
              <span
                key={p.id}
                className="avatar sm"
                style={{ marginLeft: i ? -10 : 0, zIndex: 10 - i, borderColor: match.votes[p.id] !== undefined ? 'var(--green)' : 'var(--line)' }}
              >
                {p.avatar}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 타임테이블 — 날짜(14일) + 시간 */}
      <div style={{ padding: '12px 0 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div className="row spread" style={{ padding: '0 16px', marginBottom: 9 }}>
          <span className="label">날짜 선택 · 앞으로 {DAYS_AHEAD}일</span>
          <span className="small mono" style={{ color: votedCount === match.capacity ? 'var(--green)' : 'var(--gold)' }}>
            {votedCount}/{match.capacity} 투표
          </span>
        </div>

        {/* 날짜 스트립 */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '0 16px 2px' }}>
          {Array.from({ length: DAYS_AHEAD }, (_, d) => {
            const l = dayLabel(d)
            const on = day === d
            // 이 날짜에 투표한 사람이 있으면 표시한다.
            const voters = match.players.filter((p) => match.votes[p.id] !== undefined && slotDay(match.votes[p.id]) === d)
            const openCount = TIME_SLOTS.filter((h) => backend.enabled
              ? Boolean(backendSlotIds[encodeSlot(d, h)])
              : isSlotOpen(match.venueId, d, h)).length
            return (
              <button
                key={d}
                onClick={() => setDay(d)}
                style={{
                  flexShrink: 0, width: 52, padding: '7px 0', borderRadius: 11,
                  border: `1px solid ${on ? 'var(--court)' : 'var(--line)'}`,
                  background: on ? 'var(--court)' : 'var(--surface)',
                  color: on ? '#fff' : l.isWeekend ? 'var(--red)' : 'var(--text)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  opacity: openCount === 0 ? 0.4 : 1,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700 }}>
                  {l.isToday ? '오늘' : l.weekday}
                </span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 800 }}>{l.date}</span>
                <span style={{ fontSize: 9, opacity: 0.85 }}>
                  {voters.length > 0 ? voters.map((v) => v.avatar).join('') : `${openCount}칸`}
                </span>
              </button>
            )
          })}
        </div>

        {/* 시간 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7, padding: '11px 16px 0' }}>
          {TIME_SLOTS.map((h) => {
            const slot = encodeSlot(day, h)
            const booked = backend.enabled
              ? !backendSlotIds[slot] && match.confirmedSlot !== slot
              : bookedHoursFor(match.venueId, day).includes(h)
            const past = isPastSlot(day, h)
            const voters = votersOf(slot)
            const picked = myVote === slot
            const isFinal = match.confirmedSlot === slot
            return (
              <button
                key={h}
                disabled={booked || past || confirmed}
                onClick={() => vote(slot)}
                className={`slot${picked || isFinal ? ' picked' : ''}`}
                style={isFinal ? { borderColor: 'var(--green)', background: 'rgba(31, 138, 99,0.16)', color: 'var(--green)' } : undefined}
              >
                <span className="mono" style={{ fontSize: 13, fontWeight: 800 }}>
                  {h}:00
                </span>
                {past ? (
                  <span style={{ fontSize: 9, color: 'var(--dim)' }}>지남</span>
                ) : booked ? (
                  <span style={{ fontSize: 9, color: 'var(--dim)' }}>예약됨</span>
                ) : voters.length > 0 ? (
                  <span style={{ fontSize: 11 }}>{voters.map((v) => v.avatar).join('')}</span>
                ) : (
                  <span style={{ fontSize: 9, color: 'var(--dim)' }}>가능</span>
                )}
              </button>
            )
          })}
        </div>

        <div style={{ padding: '0 16px' }}>
          {match.confirmedSlot !== null ? (
            <div
              className="card row"
              style={{ marginTop: 11, gap: 10, borderColor: 'rgba(31, 138, 99,0.4)', background: 'rgba(31, 138, 99,0.08)' }}
            >
              <span style={{ fontSize: 20 }}>✅</span>
              <div className="stack grow" style={{ gap: 2 }}>
                <strong style={{ fontSize: 13.5, color: 'var(--green)' }}>{slotLabel(match.confirmedSlot)} 확정</strong>
                <span className="small" style={{ fontSize: 11 }}>전원이 같은 시간에 투표했습니다.</span>
              </div>
            </div>
          ) : (
            <p className="small" style={{ marginTop: 10, fontSize: 11 }}>
              {myVote !== undefined
                ? `${slotShortLabel(myVote)}에 투표했습니다. 전원이 같은 시간을 고르면 확정됩니다.`
                : '날짜를 고른 뒤 원하는 시간을 눌러 투표하세요.'}
            </p>
          )}
        </div>
      </div>

      {/* 채팅 */}
      <div className="screen" style={{ padding: '14px 16px' }}>
        <div className="stack" style={{ gap: 12 }}>
          {match.chat.map((c) => {
            if (c.system) {
              return (
                <div key={c.id} className="center">
                  <span className="chip" style={{ height: 'auto', padding: '6px 12px', fontWeight: 500, fontSize: 11, textAlign: 'center', lineHeight: 1.5, color: 'var(--muted)' }}>
                    {c.text}
                  </span>
                </div>
              )
            }
            const mine = c.playerId === me.id
            const p = match.players.find((x) => x.id === c.playerId)
            return (
              <div key={c.id} className="row fade-in" style={{ gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                {!mine && <span className="avatar sm">{p?.avatar}</span>}
                <div className="stack" style={{ gap: 3, alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '74%' }}>
                  {!mine && <span className="small" style={{ fontSize: 10 }}>{p?.nickname}</span>}
                  <div
                    style={{
                      padding: '9px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5,
                      background: mine ? 'linear-gradient(135deg,var(--court),var(--court-2))' : 'var(--surface)',
                      color: mine ? '#ffffff' : 'var(--text)',
                      border: mine ? 'none' : '1px solid var(--line)',
                      borderBottomRightRadius: mine ? 4 : 14,
                      borderBottomLeftRadius: mine ? 14 : 4,
                      fontWeight: mine ? 600 : 400,
                    }}
                  >
                    {c.text}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={chatEnd} />
        </div>
      </div>

      {/* 입력 / 액션 */}
      <div style={{ padding: '10px 14px calc(12px + var(--safe-bottom))', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
        {confirmed ? (
          <div className="stack" style={{ gap: 8 }}>
            {backend.enabled && (
              <button className="btn ghost" style={{ width: '100%', color: 'var(--red)' }} onClick={cancelActiveMatch}>
                매칭 취소 · 예약 시간 해제
              </button>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost grow" onClick={() => nav('/')}>
                지도로 돌아가기
              </button>
              {backend.enabled && (
                <button className="btn gold grow" disabled={!reportingAvailable} onClick={openReporting}>
                  {reportingAvailable ? '경기 종료 · 결과 입력' : '경기 종료 후 결과 입력 가능'}
                </button>
              )}
              {!backend.enabled && (
                <button className="btn gold grow" onClick={() => nav('/')}>
                  예약 완료
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {backend.enabled && (
              <button className="btn ghost" style={{ width: '100%', color: 'var(--red)' }} onClick={cancelActiveMatch}>
                매칭 취소
              </button>
            )}
            <form
              className="row"
              style={{ gap: 8 }}
              onSubmit={(e) => { e.preventDefault(); sendChat(text); setText('') }}
            >
              <input
                className="field grow"
                placeholder="메시지 입력"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn primary" style={{ width: 60, padding: 0 }} disabled={!text.trim()}>
                ↑
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
