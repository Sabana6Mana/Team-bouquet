import { Suspense, lazy, useEffect, useState } from 'react'
import type { Match, Player } from '../types'
import PlayerAvatar from './PlayerAvatar'

// 매칭 화면과 같은 코트 무대를 배경으로 쓴다. three.js 는 따로 받아 온다.
const CourtStage = lazy(() => import('./CourtStage'))

/** 시상식 전체 길이(ms). 매칭 등장 연출과 비슷한 호흡으로 맞춘다. */
export const CEREMONY_MS = 7800
/** 승패가 갈리는 시점(ms). 배지·스포트라이트·크기 변화가 여기서 함께 터진다. */
const VERDICT_MS = 1100

/** 이미 시상식을 보여 준 매치. 결과 화면에 다시 들어와도 되풀이하지 않는다. */
const shown = new Set<string>()

/** 이 매치의 시상식을 아직 보여 주지 않았는가. */
export function ceremonyPending(matchId: string): boolean {
  if (typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return !shown.has(matchId)
}

function Team({
  players, verdict, delay,
}: { players: Player[]; verdict: 'win' | 'lose'; delay: number }) {
  return (
    <div className={`ceremony-team is-${verdict}`}>
      <div className="ceremony-team__cast">
        {players.map((player, index) => (
          <span
            key={player.id}
            className="ceremony-figure"
            style={{ animationDelay: `${delay + index * 140}ms` }}
          >
            {/* public/avatars 에 그림이 있으면 그림을, 없으면 이모지를 그린다. */}
            <PlayerAvatar player={player} className="ceremony-figure__body" aria-hidden="true" />
            <span className="ceremony-figure__name">
              {player.isMe ? '나' : player.nickname}
            </span>
          </span>
        ))}
      </div>

      {/* 이긴 팀 발밑에만 스포트라이트가 내린다. */}
      {verdict === 'win' && <span className="ceremony-light" aria-hidden="true" />}

      <strong className="ceremony-verdict">{verdict === 'win' ? 'WIN' : 'LOSE'}</strong>
    </div>
  )
}

/**
 * 경기 결과 시상식.
 *
 * 화면을 좌우로 갈라 두 팀을 세우고, 이긴 팀은 커지며 스포트라이트를 받고
 * 진 팀은 작아진다. 끝나면 onDone 으로 ELO 막대 연출에 바통을 넘긴다.
 * 세로 구성 하나로 통일한다(가로에서도 같은 화면을 쓴다).
 */
export default function AwardCeremony({
  match, meId, onDone,
}: { match: Match; meId: string; onDone: () => void }) {
  /**
   * 승패가 갈리는 순간. 두 팀 다 같은 크기로 서 있다가 이때 커지고 작아진다.
   * 처음부터 크기를 정해 두면 변화가 없어 "커진다"는 느낌이 나지 않는다.
   */
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const toReveal = setTimeout(() => setRevealed(true), VERDICT_MS)
    const toEnd = setTimeout(() => {
      // 끝까지 재생한 뒤에 기록한다. 시작하자마자 남기면 StrictMode 가
      // effect 를 두 번 돌릴 때 두 번째 실행이 스스로 남긴 기록을 보고 건너뛴다.
      shown.add(match.id)
      onDone()
    }, CEREMONY_MS)
    return () => { clearTimeout(toReveal); clearTimeout(toEnd) }
  }, [match.id])

  const byId = new Map(match.players.map((player) => [player.id, player]))
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is Player => Boolean(p))
  const winner = match.result?.winner ?? 'a'
  const myTeam: 'a' | 'b' = match.teams.b.includes(meId) ? 'b' : 'a'

  // 매칭 무대와 같게 내 편을 왼쪽에 둔다. 승패는 배지가 말해 준다.
  const mine = pick(match.teams[myTeam])
  const theirs = pick(match.teams[myTeam === 'a' ? 'b' : 'a'])
  const iWon = myTeam === winner

  return (
    <div className={`overlay ceremony${revealed ? ' is-revealed' : ''}`}>
      <Suspense fallback={null}>
        <CourtStage sport={match.sport} />
      </Suspense>

      {/* 점수는 어디서도 입력받지 않으므로 띄우지 않는다. 승패만 가른다. */}
      <div className="ceremony-stage">
        <Team players={mine} verdict={iWon ? 'win' : 'lose'} delay={200} />
        <Team players={theirs} verdict={iWon ? 'lose' : 'win'} delay={340} />
      </div>
    </div>
  )
}