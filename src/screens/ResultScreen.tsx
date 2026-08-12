import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import { localGameplayOutcome } from '../data/gameplay'
import {
  HONOR_GRADES, HONOR_TYPES, MODE_LABEL, REPORT_REASONS, SPORTS,
  honorOf, reportReasonLabel, tierOf,
} from '../lib/game'
import { TopBar } from '../components/ui'
import EloBar from '../components/EloBar'
import { MatchGameplayRewards } from '../components/gameplay/GameplayWidgets'
import { useBackend } from '../context/BackendProvider'

const DEFAULT_SCORE: Record<'tennis' | 'badminton' | 'tabletennis' | 'basketball', string> = {
  tennis: '6-4',
  badminton: '21-18',
  tabletennis: '11-8',
  basketball: '21-17',
}

export default function ResultScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const voteResult = useApp((s) => s.voteResult)
  const giveHonor = useApp((s) => s.giveHonor)
  const honorSubmitting = useApp((s) => s.honorSubmitting)
  const reportPlayer = useApp((s) => s.reportPlayer)
  const finishMatch = useApp((s) => s.finishMatch)
  const history = useApp((s) => s.history)
  const backend = useBackend()
  const nav = useNavigate()

  const [honorFor, setHonorFor] = useState<string | null>(null)
  const [reportFor, setReportFor] = useState<string | null>(null)
  const [score, setScore] = useState(match ? DEFAULT_SCORE[match.sport] : '')
  /** ELO 연출이 끝나야 세부 내용을 펼친다 */
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!match) nav('/', { replace: true })
  }, [match])

  useEffect(() => {
    if (match && !score) setScore(DEFAULT_SCORE[match.sport])
  }, [match, score])

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
  const localOutcome = localGameplayOutcome(match, history, me)
  const gameplayOutcome = backend.liveMatch
    ? backend.gameplayOutcome?.matchId === match.id ? backend.gameplayOutcome : null
    : localOutcome

  const playerOf = (id: string) => match.players.find((p) => p.id === id)!
  const opponentTeam: 'a' | 'b' = myTeam === 'a' ? 'b' : 'a'
  const opponents = match.players.filter((p) => match.teams[opponentTeam].includes(p.id))

  /* ── 1단계: 승패 투표 (전원 일치해야 확정) ── */
  if (!reported) {
    const myVote = match.resultVotes[me.id]
    const myVoteScore = match.resultVoteScores[me.id]
    const votedCount = Object.keys(match.resultVotes).length
    const countFor = (side: 'a' | 'b') =>
      match.players.filter((p) => match.resultVotes[p.id] === side).length
    const voteSignatures = match.players
      .map((player) => {
        const winner = match.resultVotes[player.id]
        return winner ? `${winner}:${match.resultVoteScores[player.id] ?? ''}` : null
      })
      .filter((value): value is string => Boolean(value))
    const conflict = votedCount === match.capacity && new Set(voteSignatures).size > 1

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
                const submittedScore = match.resultVoteScores[p.id]
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
                        {v === 'a' ? `🔵 A팀 · ${submittedScore}` : v === 'b' ? `🔴 B팀 · ${submittedScore}` : '대기중'}
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
                    서로 결과를 확인한 뒤 다시 투표해 주세요. 승리 팀과 점수가 모두 같아야 확정됩니다.
                  </span>
                </div>
              </div>
            )}

            <div className="card stack" style={{ gap: 9 }}>
              <label className="label" htmlFor="result-score">최종 점수</label>
              <input
                id="result-score"
                className="field mono"
                value={score}
                maxLength={40}
                placeholder={DEFAULT_SCORE[match.sport]}
                onChange={(event) => setScore(event.target.value)}
                aria-describedby="result-score-help"
              />
              <span id="result-score-help" className="small" style={{ fontSize: 11 }}>
                예: {DEFAULT_SCORE[match.sport]} · 참가자 모두 같은 점수를 입력해야 합니다.
              </span>
            </div>

            {(['a', 'b'] as const).map((side) => {
              const isMine = side === myTeam
              const color = side === 'a' ? 'var(--blue)' : 'var(--red)'
              const picked = myVote === side && myVoteScore === score.trim()
              const n = countFor(side)
              return (
                <button
                  key={side}
                  onClick={() => voteResult(side, score)}
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

  /* ── 2단계: ELO 변동 + 경기 명예 ── */
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

          <MatchGameplayRewards outcome={gameplayOutcome} />

          {/* 경기 명예 */}
          <div className="stack" style={{ gap: 11 }}>
            <div className="stack" style={{ gap: 5 }}>
              <span className="label">상대에게 명예 보내기</span>
              <p className="small" style={{ fontSize: 11.5 }}>
                좋은 승부를 만든 상대 한 명을 골라 명예를 보내세요. 경기당 한 번만 보낼 수 있습니다.
              </p>
            </div>

            {opponents.map((p) => {
              const sent = match.honorGiven?.playerId === p.id
              const chanceUsed = !!match.honorGiven && !sent
              const selectedHonor = sent
                ? HONOR_TYPES.find((item) => item.id === match.honorGiven?.type)
                : null
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
                        {selectedHonor?.emoji} 전달 완료 ✓
                      </span>
                    ) : chanceUsed ? (
                      <span className="chip" style={{ color: 'var(--muted)' }}>명예 전달 완료</span>
                    ) : (
                      <button
                        className="btn sm"
                        disabled={!!reported || honorSubmitting}
                        onClick={() => { setReportFor(null); setHonorFor(honorFor === p.id ? null : p.id) }}
                      >
                        명예 보내기
                      </button>
                    )}
                    {!reported && !sent && (
                      <button
                        className="chip"
                        style={{ height: 30, fontSize: 12, color: 'var(--muted)' }}
                        disabled={honorSubmitting}
                        onClick={() => { setHonorFor(null); setReportFor(reportFor === p.id ? null : p.id) }}
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

                  {honorFor === p.id && !match.honorGiven && !reported && (
                    <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                      {HONOR_TYPES.map((item) => (
                        <button
                          key={item.id}
                          className="card row"
                          style={{ gap: 8, padding: 11 }}
                          disabled={honorSubmitting}
                          onClick={() => { giveHonor(p.id, item.id); setHonorFor(null) }}
                        >
                          <span style={{ fontSize: 19 }}>{item.emoji}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'left' }}>{item.label}</span>
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
              <span className="small mono">받은 명예 {me.stickers}개</span>
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
            disabled={honorSubmitting}
            onClick={() => { finishMatch(); nav('/', { replace: true }) }}
          >
            {honorSubmitting ? '명예 저장 중…' : '완료'}
          </button>
        </div>
      )}
    </div>
  )
}
