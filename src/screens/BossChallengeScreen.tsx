import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PlayerAvatar from '../components/PlayerAvatar'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import {
  localGameplaySummary,
  unavailableGameplaySummary,
  type BossChallengeResult,
} from '../data/gameplay'
import { useApp } from '../store/useApp'

const SHOTS = [
  { icon: '💥', label: '스매시' },
  { icon: '🪶', label: '드롭' },
  { icon: '🌙', label: '클리어' },
] as const

/**
 * 일반 매칭과 분리된 배드민턴 NPC 보스전.
 * 세 번의 랠리 연출 뒤 서버가 결과를 한 번만 판정하며 ELO/전적은 바꾸지 않는다.
 */
export default function BossChallengeScreen() {
  const nav = useNavigate()
  const backend = useBackend()
  const me = useApp((state) => state.me)
  const match = useApp((state) => state.match)
  const history = useApp((state) => state.history)
  const recordBossVictory = useApp((state) => state.recordBossVictory)
  const gameplay = backend.liveMatch
    ? backend.gameplay ?? unavailableGameplaySummary()
    : localGameplaySummary(history, me)
  const boss = gameplay.boss

  const [challenge, setChallenge] = useState<BossChallengeResult | null>(null)
  const [rallies, setRallies] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const alreadyWon = Boolean(challenge?.won ?? boss.defeated)
  const score = challenge?.score ?? (alreadyWon ? '21-17 · 21-19' : null)
  const statusLabel = useMemo(() => {
    if (alreadyWon) return 'BOSS DEFEATED'
    if (challenge?.status === 'lost') return 'CHALLENGE FAILED'
    if (rallies > 0) return `RALLY ${rallies}/3`
    return 'READY'
  }, [alreadyWon, challenge?.status, rallies])

  const begin = async () => {
    if (!boss.eventId || match) return
    setBusy(true)
    setError(null)
    try {
      if (backend.liveMatch) {
        const started = await backend.startBossChallenge(boss.eventId)
        setChallenge(started)
        if (started.won) setRallies(3)
      } else {
        setChallenge({
          challengeId: 'demo-boss-challenge',
          eventId: boss.eventId,
          venueId: boss.venueId,
          sport: 'badminton',
          bossName: boss.opponent.nickname,
          bossAvatarUrl: boss.opponent.avatarUrl,
          bossRating: boss.opponent.rating,
          status: 'active',
          won: null,
          score: null,
          titleCode: null,
          titleUnlocked: false,
          newlyUnlocked: false,
        })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '보스전을 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const playShot = async () => {
    if (!challenge || challenge.status !== 'active' || busy) return
    const next = rallies + 1
    setRallies(next)
    if (next < 3) return

    setBusy(true)
    setError(null)
    try {
      if (backend.liveMatch) {
        const resolved = await backend.resolveBossChallenge(challenge.challengeId)
        setChallenge(resolved)
      } else {
        recordBossVictory()
        setChallenge({
          ...challenge,
          status: 'won',
          won: true,
          score: '21-17,21-19',
          titleCode: 'boss_raider',
          titleUnlocked: true,
          newlyUnlocked: true,
        })
      }
    } catch (caught) {
      setRallies(2)
      setError(caught instanceof Error ? caught.message : '보스전 결과를 확인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const resetAttempt = () => {
    setChallenge(null)
    setRallies(0)
    setError(null)
  }

  return (
    <div className="screen">
      <TopBar title="배드민턴 보스전" onBack={() => nav(-1)} />
      <div className="pad stack" style={{ gap: 16 }}>
        <section
          className="card stack"
          style={{
            gap: 15,
            padding: 18,
            overflow: 'hidden',
            borderColor: 'rgba(122, 91, 189, 0.42)',
            background: 'radial-gradient(circle at 50% 8%, rgba(155,93,229,.22), transparent 42%), var(--surface)',
          }}
        >
          <div className="row spread">
            <span className="label">🏸 WEEKLY BADMINTON BOSS</span>
            <span className="chip" style={{ color: alreadyWon ? 'var(--court)' : 'var(--purple)' }}>
              {statusLabel}
            </span>
          </div>

          <div className="row" style={{ justifyContent: 'space-around', gap: 12, minHeight: 132 }}>
            <div className="stack center" style={{ gap: 7, minWidth: 0 }}>
              <PlayerAvatar player={me} className="avatar lg" style={{ width: 78, height: 78 }} />
              <strong style={{ maxWidth: 112, overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.nickname}</strong>
              <span className="mono small">ELO {me.elo.badminton}</span>
            </div>
            <strong className="mono" style={{ color: 'var(--red)', fontSize: 22 }}>VS</strong>
            <div className="stack center" style={{ gap: 7, minWidth: 0 }}>
              <span className="avatar lg center" style={{ width: 78, height: 78, fontSize: 44 }} aria-hidden="true">
                {boss.opponent.avatar}
              </span>
              <strong>{boss.opponent.nickname}</strong>
              <span className="mono small">ELO {boss.opponent.rating}</span>
            </div>
          </div>

          <div className="stack center" style={{ gap: 5 }}>
            <strong>{boss.venueName}</strong>
            <span className="small">배드민턴 1v1 · 일반 매칭/ELO와 완전 분리</span>
            <span className="small" style={{ color: 'var(--gold)' }}>승리 보상 《{boss.rewardTitle}》</span>
          </div>
        </section>

        {alreadyWon ? (
          <section className="card stack center fade-in" style={{ gap: 12, padding: 20, borderColor: 'rgba(47,125,70,.4)' }}>
            <span aria-hidden="true" style={{ fontSize: 48 }}>🏸</span>
            <h2 className="h2">셔틀콕 가디언 격파!</h2>
            {score && <strong className="mono" style={{ color: 'var(--court)', fontSize: 20 }}>{score.replace(',', ' · ')}</strong>}
            <span className="profile-title">《{boss.rewardTitle}》 칭호 획득</span>
            <p className="small" style={{ margin: 0, textAlign: 'center' }}>
              보스전은 일반 전적과 ELO를 바꾸지 않습니다. 획득한 칭호만 프로필에 장착할 수 있어요.
            </p>
            <div className="row" style={{ width: '100%', gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => nav(`/?venue=${boss.venueId}`)}>지도로</button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => nav('/achievements')}>칭호 장착</button>
            </div>
          </section>
        ) : challenge?.status === 'active' ? (
          <section className="card stack fade-in" style={{ gap: 14, padding: 17 }}>
            <div className="row spread">
              <strong>랠리 {rallies + 1}/3</strong>
              <span className="small">샷을 골라 보스와 맞붙으세요</span>
            </div>
            <div className="bar"><i style={{ width: `${(rallies / 3) * 100}%`, background: 'var(--purple)' }} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {SHOTS.map((shot) => (
                <button
                  key={shot.label}
                  type="button"
                  className="card stack center"
                  disabled={busy}
                  onClick={() => { void playShot() }}
                  style={{ gap: 6, padding: '15px 6px', borderColor: 'rgba(122,91,189,.28)' }}
                >
                  <span aria-hidden="true" style={{ fontSize: 28 }}>{shot.icon}</span>
                  <strong style={{ fontSize: 12 }}>{shot.label}</strong>
                </button>
              ))}
            </div>
            {busy && <span className="small center">서버가 마지막 랠리를 판정하는 중…</span>}
          </section>
        ) : challenge?.status === 'lost' ? (
          <section className="card stack center fade-in" style={{ gap: 12, padding: 20 }}>
            <span aria-hidden="true" style={{ fontSize: 42 }}>💨</span>
            <h2 className="h2">이번 도전은 아쉬웠어요</h2>
            <strong className="mono" style={{ color: 'var(--red)' }}>{challenge.score?.replace(',', ' · ')}</strong>
            <p className="small" style={{ margin: 0 }}>일반 경기에는 아무 영향이 없습니다. 다시 도전할 수 있어요.</p>
            <button className="btn primary" style={{ width: '100%' }} onClick={resetAttempt}>다시 도전</button>
          </section>
        ) : (
          <section className="card stack" style={{ gap: 12, padding: 17 }}>
            <strong>보스전 규칙</strong>
            <div className="stack small" style={{ gap: 8 }}>
              <span>1. 배드민턴 보스전 버튼으로 직접 입장해야 합니다.</span>
              <span>2. 체육관의 일반 경기 승패로는 보스 진행도나 칭호가 오르지 않습니다.</span>
              <span>3. 보스를 이겼을 때만 《{boss.rewardTitle}》 칭호가 해금됩니다.</span>
            </div>
            <button
              className="btn primary"
              disabled={busy || !boss.eventId || Boolean(match)}
              onClick={() => { void begin() }}
            >
              {busy ? '보스전 준비 중…' : match ? '진행 중인 매치를 먼저 완료해 주세요' : '보스전 시작'}
            </button>
          </section>
        )}

        {error && <p className="small" style={{ margin: 0, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )
}
