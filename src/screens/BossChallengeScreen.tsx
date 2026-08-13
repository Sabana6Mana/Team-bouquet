import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PlayerAvatar from '../components/PlayerAvatar'
import { activeMatchPath, TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import { useApp } from '../store/useApp'
import { useGameplay } from '../lib/useGameplay'

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
  const gameplay = useGameplay()
  const boss = gameplay.boss

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 대전 신청장을 보냈는지. 보스가 받아들이면 그때 매칭이 열린다. */
  const [requested, setRequested] = useState(false)

  /**
   * 보스에게 대전 신청장을 보낸다.
   *
   * 예전에는 누르는 즉시 매칭이 시작됐지만, 지금은 받아들일지를 보스가 정한다.
   * 보스가 수락하면 그때부터 일반 1v1 매칭과 같은 흐름으로 진행된다.
   */
  const requestMatch = async () => {
    if (match) {
      nav(activeMatchPath(match.phase))
      return
    }
    if (!boss.eventId || !boss.canChallenge) return
    setBusy(true)
    setError(null)
    try {
      // 신청 자체는 아직 서버에 보관하지 않는다.
      // 보스가 수락하는 흐름이 붙기 전까지는 접수 사실만 알린다.
      setRequested(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '대전 신청을 보내지 못했습니다.')
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
                <strong>보스전 진행 방식</strong>
                <span className="small">미니게임이 아니라 보스 사용자와 직접 경기합니다.</span>
              </div>
              <span className="chip" style={{ color: 'var(--purple)', flexShrink: 0 }}>한 달 시즌</span>
            </div>
            <div className="stack small" style={{ gap: 9 }}>
              <span>1. 대전 신청장을 보내면 보스에게 전달됩니다.</span>
              <span>2. <b>받아들일지는 보스가 정합니다.</b> 수락하면 알림이 오고, 그때부터 일반 1v1 매칭과 같이 진행됩니다.</span>
              <span>3. 보스는 실력을 인정받아 선정되며, 한 달 동안 <b>주 3회</b> 경기를 치러야 합니다.</span>
              <span>4. 한 달 안에 도전자들이 보스를 <b>5번 이상</b> 이기면 참여자 전원이 보상을 받습니다.</span>
              <span>5. 그러지 못하면 보상은 보스가 가져갑니다.</span>
            </div>
            {requested ? (
              <div
                className="card stack center fade-in"
                style={{
                  gap: 6,
                  padding: 16,
                  textAlign: 'center',
                  borderColor: 'rgba(122, 91, 189, 0.45)',
                  background: 'rgba(122, 91, 189, 0.08)',
                }}
              >
                <span style={{ fontSize: 26 }} aria-hidden="true">📨</span>
                <strong style={{ color: 'var(--purple)' }}>대전 신청이 완료되었습니다</strong>
                <span className="small">
                  보스가 신청을 받아들이면 알림으로 알려드립니다.
                </span>
              </div>
            ) : (
              <button
                className="btn primary"
                disabled={busy || challengeUnavailable}
                onClick={() => { void requestMatch() }}
              >
                {busy
                  ? '대전 신청장 보내는 중…'
                  : match
                    ? '진행 중인 매칭으로 돌아가기'
                    : !boss.eventId
                      ? '다음 보스를 준비 중입니다'
                      : !boss.canChallenge
                        ? '지금은 대전을 신청할 수 없습니다'
                        : '대전 신청장 보내기'}
              </button>
            )}
          </section>
        )}

        {error && <p className="small" style={{ margin: 0, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )
}
