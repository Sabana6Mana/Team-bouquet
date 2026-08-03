import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import {
  HONOR_GRADES, MODE_LABEL, REPORT_REASONS, SPORTS, STICKERS,
  honorOf, reportReasonLabel, tierOf,
} from '../lib/game'
import { TopBar } from '../components/ui'
import EloBar from '../components/EloBar'

export default function ResultScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const voteResult = useApp((s) => s.voteResult)
  const giveSticker = useApp((s) => s.giveSticker)
  const reportPlayer = useApp((s) => s.reportPlayer)
  const finishMatch = useApp((s) => s.finishMatch)
  const nav = useNavigate()

  const [stickerFor, setStickerFor] = useState<string | null>(null)
  const [reportFor, setReportFor] = useState<string | null>(null)
  /** ELO 연출이 끝나야 세부 내용을 펼친다 */
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!match) nav('/', { replace: true })
  }, [match])

  if (!match) return null

  const venue = VENUES.find((v) => v.id === match.venueId)
  const venueName = venue?.name ?? match.venueName ?? '매칭 장소'
  const meta = SPORTS[match.sport]
  const myTeam: 'a' | 'b' = match.teams.a.includes(me.id) ? 'a' : 'b'
  const reported = !!match.result
  const iWon = match.result?.winner === myTeam
  const delta = match.result?.delta ?? 0
  const eloBefore = me.elo[match.sport] - delta
  const honor = honorOf(me.stickers)

  const playerOf = (id: string) => match.players.find((p) => p.id === id)!
  const opponents = match.players.filter((p) => !p.isMe)

  /* ── 1단계: 승패 투표 (전원 일치해야 확정) ── */
  if (!reported) {
    const myVote = match.resultVotes[me.id]
    const votedCount = Object.keys(match.resultVotes).length
    const countFor = (side: 'a' | 'b') =>
      match.players.filter((p) => match.resultVotes[p.id] === side).length
    const conflict =
      votedCount === match.capacity && countFor('a') > 0 && countFor('b') > 0

    return (
      <div className="overlay">
        <TopBar
          title="승패 투표"
          right={
            <span
              className="chip"
              style={{ color: votedCount === match.capacity ? 'var(--green)' : 'var(--gold)' }}
            >
              {votedCount}/{match.capacity}
            </span>
          }
        />
        <div className="screen">
          <div className="pad stack" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 7 }}>
              <h1 className="h1">어느 팀이<br />이겼나요?</h1>
              <p className="body">
                {venueName} · {meta.label} {MODE_LABEL[match.mode]}
                <br />
                <strong style={{ color: 'var(--cyan)' }}>참여자 전원이 같은 팀을 선택해야 결과가 확정됩니다.</strong>
              </p>
            </div>

            {/* 투표 현황 + 신고 */}
            <div className="card stack" style={{ gap: 10 }}>
              <span className="label">투표 현황</span>
              {match.players.map((p) => {
                const v = match.resultVotes[p.id]
                const color = v === 'a' ? 'var(--blue)' : v === 'b' ? 'var(--red)' : 'var(--muted)'
                const reported = match.reports[p.id]
                return (
                  <div key={p.id} className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="avatar sm">{p.avatar}</span>
                      <span className="grow" style={{ fontSize: 13 }}>
                        {p.nickname}{p.isMe && ' (나)'}
                      </span>
                      <span
                        className="chip"
                        style={{
                          height: 24, fontSize: 11, color,
                          borderColor: v && color !== 'var(--muted)' ? color : 'var(--line)',
                        }}
                      >
                        {v === 'a' ? '🔵 A팀' : v === 'b' ? '🔴 B팀' : '대기중'}
                      </span>
                      {!p.isMe && (
                        reported ? (
                          <span
                            className="chip"
                            style={{ height: 24, fontSize: 10, color: 'var(--red)', borderColor: 'rgba(207, 64, 64,0.45)' }}
                          >
                            🚩 신고됨
                          </span>
                        ) : (
                          <button
                            onClick={() => setReportFor(reportFor === p.id ? null : p.id)}
                            className="chip"
                            style={{
                              height: 24, fontSize: 11,
                              color: reportFor === p.id ? 'var(--red)' : 'var(--muted)',
                              borderColor: reportFor === p.id ? 'rgba(207, 64, 64,0.5)' : 'var(--line)',
                            }}
                            aria-label={`${p.nickname} 신고`}
                          >
                            🚩
                          </button>
                        )
                      )}
                    </div>

                    {reportFor === p.id && !reported && (
                      <div className="stack fade-in" style={{ gap: 6, paddingLeft: 42 }}>
                        <span className="small" style={{ fontSize: 10.5 }}>
                          {p.nickname} 님을 신고할 사유를 선택하세요.
                        </span>
                        {REPORT_REASONS.map((r) => (
                          <button
                            key={r.id}
                            className="card row"
                            style={{ gap: 8, padding: 9 }}
                            onClick={() => { reportPlayer(p.id, r.id); setReportFor(null) }}
                          >
                            <span style={{ fontSize: 15 }}>{r.emoji}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'left' }}>{r.label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {reported && (
                      <span className="small" style={{ fontSize: 10.5, paddingLeft: 42, color: 'var(--red)' }}>
                        사유: {reportReasonLabel(reported)} · 운영팀 검토 중
                      </span>
                    )}
                  </div>
                )
              })}
              <div className="bar">
                <i style={{ width: `${(votedCount / match.capacity) * 100}%` }} />
              </div>
            </div>

            {conflict && (
              <div
                className="card row fade-in"
                style={{ gap: 10, borderColor: 'rgba(207, 64, 64,0.5)', background: 'rgba(207, 64, 64,0.08)' }}
              >
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div className="stack grow" style={{ gap: 2 }}>
                  <strong style={{ fontSize: 13.5, color: 'var(--red)' }}>투표가 일치하지 않습니다</strong>
                  <span className="small" style={{ fontSize: 11 }}>
                    서로 결과를 확인한 뒤 다시 투표해 주세요. 전원이 같은 팀을 고를 때까지 확정되지 않습니다.
                  </span>
                </div>
              </div>
            )}

            {(['a', 'b'] as const).map((side) => {
              const isMine = side === myTeam
              const color = side === 'a' ? 'var(--blue)' : 'var(--red)'
              const picked = myVote === side
              const n = countFor(side)
              return (
                <button
                  key={side}
                  onClick={() => voteResult(side)}
                  className="card stack"
                  style={{
                    gap: 12, padding: 16, textAlign: 'left',
                    borderColor: picked ? color : `${color}44`,
                    background: picked ? `${color}1f` : `${color}0a`,
                    boxShadow: picked ? `0 0 0 1px ${color}` : undefined,
                  }}
                >
                  <div className="row spread">
                    <span className="chip" style={{ color, borderColor: `${color}66`, background: `${color}1a` }}>
                      {side === 'a' ? '🔵 A팀' : '🔴 B팀'}
                      {isMine && ' · 내 팀'}
                    </span>
                    <span className="small" style={{ color }}>
                      {picked ? '내 선택 ✓' : '승리 선택 →'}
                      {n > 0 && <span className="mono"> · {n}표</span>}
                    </span>
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {match.teams[side].map((id) => {
                      const p = playerOf(id)
                      const t = tierOf(p.elo[match.sport])
                      return (
                        <div key={id} className="row" style={{ gap: 10 }}>
                          <span className="avatar sm">{p.avatar}</span>
                          <span className="grow" style={{ fontSize: 13.5, fontWeight: 600 }}>{p.nickname}</span>
                          <span className="mono small" style={{ color: t.color, fontWeight: 700 }}>
                            {p.elo[match.sport]}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </button>
              )
            })}

            <p className="small" style={{ fontSize: 11 }}>
              {myVote
                ? '투표를 완료했습니다. 다른 팀을 눌러 변경할 수 있습니다.'
                : '이긴 팀을 선택해 투표하세요.'}
              <br />
              ※ 허위 기록 시 명예 등급이 하락하고 매칭이 제한될 수 있습니다.
            </p>
          </div>
        </div>
      </div>
    )
  }

  /* ── 2단계: ELO 변동 + 칭찬 스티커 ── */
  return (
    <div className="overlay">
      <TopBar title="경기 종료" />
      <div className="screen">
        <div className="pad stack" style={{ gap: 20 }}>
          {/* 1막: 점수와 막대만 화면 가운데에서 움직인다 */}
          <div className={`result-stage${revealed ? ' revealed' : ''}`}>
            <EloBar
              before={eloBefore}
              after={me.elo[match.sport]}
              won={!!iWon}
              onFinish={() => setRevealed(true)}
            />
          </div>

          {/* 2막: 연출이 끝나면 세부 내용이 아래에서 올라온다 */}
          {revealed && (
          <div className="result-details stack" style={{ gap: 20 }}>
          {/* 승패 배너 */}
          <div
            className="card stack center"
            style={{
              gap: 9, padding: 22, textAlign: 'center',
              borderColor: iWon ? 'rgba(184, 134, 11,0.5)' : 'var(--line)',
              background: iWon
                ? 'linear-gradient(160deg, rgba(184, 134, 11,0.16), rgba(184, 134, 11,0.04))'
                : 'var(--surface)',
            }}
          >
            <span style={{ fontSize: 44 }}>{iWon ? '🏆' : '💪'}</span>
            <h1 className="h1" style={{ color: iWon ? 'var(--gold)' : 'var(--text)' }}>
              {iWon ? 'VICTORY' : 'DEFEAT'}
            </h1>
            <span className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{match.result!.score}</span>
          </div>

          {/* 칭찬 스티커 */}
          <div className="stack" style={{ gap: 11 }}>
            <div className="stack" style={{ gap: 5 }}>
              <span className="label">칭찬 스티커 보내기</span>
              <p className="small" style={{ fontSize: 11.5 }}>
                함께한 플레이어에게 스티커를 보내세요. 받은 스티커가 쌓이면 명예 등급이 올라갑니다.
              </p>
            </div>

            {opponents.map((p) => {
              const sent = match.stickersGiven.includes(p.id)
              const reported = match.reports[p.id]
              const h = honorOf(p.stickers)
              return (
                <div
                  key={p.id}
                  className="card stack"
                  style={{
                    gap: 11,
                    borderColor: reported
                      ? 'rgba(207, 64, 64,0.45)'
                      : sent ? 'rgba(184, 134, 11,0.4)' : 'var(--line)',
                  }}
                >
                  <div className="row" style={{ gap: 11 }}>
                    <div className="avatar">{p.avatar}</div>
                    <div className="stack grow" style={{ gap: 3 }}>
                      <strong style={{ fontSize: 14 }}>{p.nickname}</strong>
                      <span className="small" style={{ fontSize: 11, color: h.color }}>
                        {'★'.repeat(h.level)} {h.name}
                      </span>
                    </div>
                    {sent ? (
                      <span className="chip" style={{ color: 'var(--gold)', borderColor: 'rgba(184, 134, 11,0.5)' }}>
                        전달 완료 ✓
                      </span>
                    ) : (
                      <button
                        className="btn sm"
                        disabled={!!reported}
                        onClick={() => { setReportFor(null); setStickerFor(stickerFor === p.id ? null : p.id) }}
                      >
                        스티커 주기
                      </button>
                    )}
                    {!reported && (
                      <button
                        className="chip"
                        style={{ height: 30, fontSize: 12, color: 'var(--muted)' }}
                        onClick={() => { setStickerFor(null); setReportFor(reportFor === p.id ? null : p.id) }}
                        aria-label={`${p.nickname} 신고`}
                      >
                        🚩
                      </button>
                    )}
                  </div>

                  {reported && (
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 14 }}>🚩</span>
                      <span className="small" style={{ fontSize: 11, color: 'var(--red)' }}>
                        신고 접수 · {reportReasonLabel(reported)}
                      </span>
                    </div>
                  )}

                  {stickerFor === p.id && !sent && !reported && (
                    <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                      {STICKERS.map((s) => (
                        <button
                          key={s.id}
                          className="card row"
                          style={{ gap: 8, padding: 11 }}
                          onClick={() => { giveSticker(p.id); setStickerFor(null) }}
                        >
                          <span style={{ fontSize: 19 }}>{s.emoji}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'left' }}>{s.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {reportFor === p.id && !reported && (
                    <div className="stack fade-in" style={{ gap: 6 }}>
                      <span className="small" style={{ fontSize: 10.5 }}>비매너 신고 사유를 선택하세요.</span>
                      {REPORT_REASONS.map((r) => (
                        <button
                          key={r.id}
                          className="card row"
                          style={{ gap: 8, padding: 9 }}
                          onClick={() => { reportPlayer(p.id, r.id); setReportFor(null) }}
                        >
                          <span style={{ fontSize: 15 }}>{r.emoji}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'left' }}>{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 내 명예 등급 */}
          <div className="card stack" style={{ gap: 11 }}>
            <div className="row spread">
              <span className="label">내 명예 등급</span>
              <span className="chip" style={{ color: honor.color, borderColor: `${honor.color}55`, background: `${honor.color}16` }}>
                Lv.{honor.level} {honor.name}
              </span>
            </div>
            <div className="bar">
              <i
                style={{
                  width: honor.next ? `${((me.stickers - honor.min) / (honor.next - honor.min)) * 100}%` : '100%',
                  background: `linear-gradient(90deg, ${honor.color}88, ${honor.color})`,
                }}
              />
            </div>
            <div className="row spread">
              <span className="small mono">스티커 {me.stickers}개</span>
              <span className="small">
                {honor.next ? `다음 등급까지 ${honor.next - me.stickers}개` : '최고 등급 달성 🎉'}
              </span>
            </div>
            <div className="row spread" style={{ marginTop: 2 }}>
              {HONOR_GRADES.map((g) => (
                <div key={g.level} className="stack center" style={{ gap: 3, opacity: me.stickers >= g.min ? 1 : 0.3 }}>
                  <span style={{ fontSize: 15, color: g.color }}>★</span>
                  <span style={{ fontSize: 9, color: 'var(--muted)' }}>{g.min}</span>
                </div>
              ))}
            </div>
          </div>
          </div>
          )}
        </div>
      </div>

      {/* 연출이 끝나기 전에는 하단 버튼도 숨겨 화면에 점수만 남긴다 */}
      {revealed && (
        <div
          className="result-details"
          style={{ padding: '12px 18px calc(16px + var(--safe-bottom))', borderTop: '1px solid var(--line)' }}
        >
          <button
            className="btn primary"
            style={{ width: '100%', height: 56, fontSize: 16 }}
            onClick={() => { finishMatch(); nav('/', { replace: true }) }}
          >
            완료
          </button>
        </div>
      )}
    </div>
  )
}
