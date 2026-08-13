import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import { MODE_LABEL, QUICK_RADIUS_M, SPORTS, tierOf } from '../lib/game'
import { TopBar } from '../components/ui'
import PlayerAvatar from '../components/PlayerAvatar'

export default function QueueScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const cancel = useApp((s) => s.cancelMatch)
  const accept = useApp((s) => s.acceptMatch)
  const expireAcceptance = useApp((s) => s.expireMatchAcceptance)
  const nav = useNavigate()
  const [sec, setSec] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 인원이 다 모이면 자동으로 일정 조율 화면으로 넘어간다.
  useEffect(() => {
    if (match && match.phase !== 'queue') nav('/room', { replace: true })
    if (!match) nav('/', { replace: true })
  }, [match?.phase, match])

  const awaitingAcceptance = Boolean(
    match
      && match.players.length === match.capacity
      && match.acceptanceDeadline !== undefined,
  )
  const remaining = awaitingAcceptance
    ? Math.max(0, Math.ceil(((match?.acceptanceDeadline ?? Date.now()) - Date.now()) / 1000))
    : sec

  const acceptanceExpired = awaitingAcceptance && remaining <= 0

  useEffect(() => {
    if (!acceptanceExpired) return
    expireAcceptance()
    const retry = setInterval(expireAcceptance, 5000)
    return () => clearInterval(retry)
  }, [acceptanceExpired, expireAcceptance])

  if (!match) return null

  // 빠른 매칭은 인원이 모인 뒤에야 장소가 정해진다.
  const venue = VENUES.find((v) => v.id === match.venueId) ?? null
  const meta = SPORTS[match.sport]
  const acceptedCount = match.players.filter((player) => match.accepted?.[player.id]).length
  const myAccepted = Boolean(match.accepted?.[me.id])
  const pct = awaitingAcceptance
    ? (acceptedCount / match.capacity) * 100
    : (match.players.length / match.capacity) * 100
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  return (
    <div className="overlay">
      <TopBar title={awaitingAcceptance ? '매칭 수락' : '매칭 대기 중'} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 24, alignItems: 'center', paddingTop: 34 }}>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            <div className="spinner" />
            <div style={{ position: 'absolute', fontSize: 38 }}>{meta.emoji}</div>
          </div>

          <div className="stack center" style={{ gap: 7, textAlign: 'center' }}>
            <h1 className="h1">{awaitingAcceptance ? '매칭이 성사됐어요!' : '상대를 찾는 중…'}</h1>
            <p className="body">
              {venue?.name ?? match.venueName ?? `주변 ${QUICK_RADIUS_M / 1000}km`} · {meta.label} {MODE_LABEL[match.mode]}
            </p>
            {!venue && (
              <span className="small" style={{ fontSize: 11 }}>
                인원이 모이면 가까운 체육관이 자동 배정됩니다.
              </span>
            )}
            {awaitingAcceptance && (
              <span className="small" style={{ maxWidth: 270 }}>
                5분 안에 전원이 수락해야 일정 조율을 시작합니다.
              </span>
            )}
            <span className="mono" style={{ fontSize: 30, fontWeight: 800, color: awaitingAcceptance ? 'var(--gold)' : 'var(--cyan)', letterSpacing: 2 }}>
              {mm}:{ss}
            </span>
          </div>

          <div style={{ width: '100%' }}>
            <div className="row spread" style={{ marginBottom: 8 }}>
              <span className="label">{awaitingAcceptance ? '수락 현황' : '모집 현황'}</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800 }}>
                {awaitingAcceptance ? acceptedCount : match.players.length} / {match.capacity}
              </span>
            </div>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          </div>

          <div className="stack" style={{ gap: 9, width: '100%' }}>
            {Array.from({ length: match.capacity }, (_, i) => {
              const p = match.players[i]
              if (!p) {
                return (
                  <div key={i} className="card row" style={{ gap: 12, opacity: 0.45, borderStyle: 'dashed' }}>
                    <div className="avatar" style={{ background: 'transparent' }}>·</div>
                    <span className="small">플레이어를 찾는 중…</span>
                  </div>
                )
              }
              const t = tierOf(p.elo[match.sport])
              return (
                <div key={p.id} className="card row fade-in" style={{ gap: 12, borderColor: p.isMe ? 'var(--cyan)' : 'var(--line)' }}>
                  <PlayerAvatar player={p} className="avatar" />
                  <div className="stack grow" style={{ gap: 3 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong style={{ fontSize: 14 }}>{p.nickname}</strong>
                      {p.isMe && <span className="chip" style={{ height: 19, fontSize: 10, color: 'var(--cyan)' }}>나</span>}
                    </div>
                    <span className="mono small" style={{ color: t.color, fontWeight: 700 }}>
                      {t.name} {p.elo[match.sport]}
                    </span>
                  </div>
                  {awaitingAcceptance ? (
                    <span className="chip" style={{ color: match.accepted?.[p.id] ? 'var(--green)' : 'var(--gold)', fontSize: 10 }}>
                      {match.accepted?.[p.id] ? '수락 완료' : '수락 대기'}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--green)', fontSize: 18 }}>✓</span>
                  )}
                </div>
              )
            })}
          </div>

          <p className="small" style={{ textAlign: 'center', maxWidth: 280 }}>
            {awaitingAcceptance
              ? '한 명이라도 거절하거나 시간이 끝나면 이번 매칭은 취소됩니다.'
              : `내 ELO ${match.players[0].elo[match.sport]} 기준으로 실력이 비슷한 상대를 우선 매칭합니다.`}
          </p>
        </div>
      </div>

      <div className="stack" style={{ gap: 8, padding: '12px 18px calc(16px + var(--safe-bottom))', borderTop: '1px solid var(--line)' }}>
        {awaitingAcceptance && (
          <button className="btn primary" style={{ width: '100%' }} disabled={myAccepted || remaining <= 0} onClick={accept}>
            {myAccepted ? '수락 완료 · 다른 참가자를 기다리는 중' : '이 매칭 수락하기'}
          </button>
        )}
        <button
          className="btn ghost"
          style={{ width: '100%', color: 'var(--red)' }}
          onClick={() => {
            if (!window.confirm(awaitingAcceptance ? '매칭을 거절하고 취소할까요?' : '대기 중인 매칭을 취소할까요?')) return
            cancel()
            nav('/', { replace: true })
          }}
        >
          {awaitingAcceptance ? '거절하고 매칭 취소' : '매칭 취소'}
        </button>
      </div>
    </div>
  )
}
