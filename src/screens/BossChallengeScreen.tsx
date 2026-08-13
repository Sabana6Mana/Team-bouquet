import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PlayerAvatar from '../components/PlayerAvatar'
import { activeMatchPath, TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import { localGameplaySummary, unavailableGameplaySummary } from '../data/gameplay'
import { useApp } from '../store/useApp'

/**
 * 지정된 실제 사용자 보스에게 도전하는 진입 화면.
 * 도전 뒤에는 일반 매칭과 같은 5분 수락 → 일정 조율 → 경기 결과 흐름을 사용한다.
 */
export default function BossChallengeScreen() {
  const nav = useNavigate()
  const backend = useBackend()
  const me = useApp((state) => state.me)
  const match = useApp((state) => state.match)
  const history = useApp((state) => state.history)
  const startLocalBossMatch = useApp((state) => state.startBossMatch)
  const gameplay = backend.liveMatch
    ? backend.gameplay ?? unavailableGameplaySummary()
    : localGameplaySummary(history, me)
  const boss = gameplay.boss

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const begin = async () => {
    if (match) {
      nav(activeMatchPath(match.phase))
      return
    }
    if (!boss.eventId || !boss.canChallenge) return
    setBusy(true)
    setError(null)
    try {
      if (backend.liveMatch) await backend.startBossMatch(boss.eventId)
      else startLocalBossMatch()
      nav('/queue', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '보스 매칭을 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const bossPlayer = {
    nickname: boss.opponent.nickname,
    avatar: boss.opponent.avatar,
    avatarUrl: boss.opponent.avatarUrl,
  }
  // 칭호 보유 여부는 과거 시즌 승리까지 포함한다. 현재 이벤트를 실제로
  // 격파했는지는 서버가 내려준 이번 이벤트 challenge 결과만 사용한다.
  const alreadyWon = boss.defeated
  const challengeUnavailable = !match && (!boss.eventId || !boss.canChallenge)

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
              {alreadyWon ? 'BOSS DEFEATED' : '실제 플레이어'}
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
              <PlayerAvatar
                player={bossPlayer}
                className="avatar lg"
                style={{ width: 78, height: 78 }}
                alt={`${boss.opponent.nickname} 아바타`}
              />
              <strong style={{ maxWidth: 132, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {boss.opponent.nickname}
              </strong>
              <span className="mono small">ELO {boss.opponent.rating}</span>
            </div>
          </div>

          <div className="stack center" style={{ gap: 5, textAlign: 'center' }}>
            <strong>{boss.venueName}</strong>
            <span className="small">배드민턴 1v1 · 지정된 보스와 실제 경기</span>
            <span className="small" style={{ color: 'var(--gold)' }}>
              승리 보상 《{boss.rewardTitle}》{boss.titleUnlocked && !alreadyWon ? ' · 보유 중' : ''}
            </span>
            <span className="small">{boss.endsLabel}</span>
          </div>
        </section>

        {alreadyWon ? (
          <section className="card stack center fade-in" style={{ gap: 12, padding: 20, borderColor: 'rgba(47,125,70,.4)' }}>
            <span aria-hidden="true" style={{ fontSize: 48 }}>🏸</span>
            <h2 className="h2">주간 보스를 꺾었어요!</h2>
            <span className="profile-title">《{boss.rewardTitle}》 칭호 획득</span>
            <p className="small" style={{ margin: 0, textAlign: 'center' }}>
              지정된 보스와의 경기 결과가 확정되어 칭호가 해금됐습니다.
            </p>
            <div className="row" style={{ width: '100%', gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => nav(`/?venue=${boss.venueId}`)}>지도로</button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => nav('/achievements')}>칭호 장착</button>
            </div>
          </section>
        ) : (
          <section className="card stack" style={{ gap: 13, padding: 17 }}>
            <div className="row spread" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div className="stack" style={{ gap: 4 }}>
                <strong>실제 보스전 진행 방식</strong>
                <span className="small">미니게임이 아니라 보스 사용자와 직접 경기합니다.</span>
              </div>
              <span className="chip" style={{ color: 'var(--gold)', flexShrink: 0 }}>5분 수락</span>
            </div>
            <div className="stack small" style={{ gap: 9 }}>
              <span>1. 도전하면 지정된 보스에게만 매칭 요청이 전달됩니다.</span>
              <span>2. 두 사람이 5분 안에 수락한 뒤 채팅으로 경기 시간을 맞춥니다.</span>
              <span>3. 실제 경기 결과가 확정되고 도전자가 이겼을 때만 칭호를 얻습니다.</span>
              <span>4. 같은 체육관의 일반 경기 승리는 보스 격파로 인정되지 않습니다.</span>
            </div>
            <button
              className="btn primary"
              disabled={busy || challengeUnavailable}
              onClick={() => { void begin() }}
            >
              {busy
                ? '보스에게 도전장 보내는 중…'
                : match
                  ? '진행 중인 매칭으로 돌아가기'
                  : !boss.eventId
                    ? '다음 보스를 준비 중입니다'
                    : !boss.canChallenge
                      ? '현재 보스에게 도전할 수 없습니다'
                      : '보스에게 도전하기'}
            </button>
          </section>
        )}

        {error && <p className="small" style={{ margin: 0, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )
}
