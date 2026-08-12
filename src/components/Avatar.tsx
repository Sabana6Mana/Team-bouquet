import { useEffect, useState } from 'react'
import type { Player } from '../types'

/**
 * 전신은 무대·시상식처럼 크게 보이는 자리에, 얼굴은 채팅·목록처럼
 * 작게 보이는 자리에 쓴다. 전신 그림을 32px로 줄이면 뭉개진다.
 */
type Kind = 'full' | 'face'

function sourceOf(key: string, kind: Kind) {
  return `/avatars/${key}${kind === 'face' ? '-face' : ''}.webp`
}

/**
 * 플레이어 아바타.
 *
 * 그림 파일이 있으면 그림을, 없으면 이모지를 그린다. 파일 존재 여부를
 * 따로 관리하지 않고 이미지 로딩 실패를 신호로 삼으므로, 그림을
 * `public/avatars/` 에 떨어뜨리기만 하면 그때부터 반영된다.
 *
 * 크기는 부모의 font-size 를 따른다. 이모지든 그림이든 같은 자리를
 * 차지하도록 em 단위로 잡아 기존 배치를 건드리지 않는다.
 */
export default function Avatar({
  player, kind = 'face',
}: { player: Player; kind?: Kind }) {
  const key = player.avatarKey
  const [broken, setBroken] = useState(false)

  // 다른 캐릭터로 바뀌면 실패 기록을 지운다.
  useEffect(() => setBroken(false), [key, kind])

  if (!key || broken) return <>{player.avatar}</>

  return (
    <img
      className={`avatar-img is-${kind}`}
      src={sourceOf(key, kind)}
      alt=""
      draggable={false}
      onError={() => setBroken(true)}
    />
  )
}
