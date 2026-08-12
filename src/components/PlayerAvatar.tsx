import { useState, type CSSProperties, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { isAvatarImageUrl } from '../data/characters'
import type { Player } from '../types'

type AvatarPlayer = Pick<Player, 'avatar' | 'avatarUrl' | 'nickname'>

interface PlayerAvatarProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** Player를 넘기거나, 온보딩 미리보기처럼 avatarUrl/fallback을 직접 넘길 수 있다. */
  player?: AvatarPlayer | null
  avatarUrl?: string | null
  fallback?: ReactNode
  alt?: string
  imageClassName?: string
  imageStyle?: CSSProperties
  fit?: CSSProperties['objectFit']
}

/** 플레이어 이미지와 기존 이모지 fallback을 한 곳에서 처리한다. */
export default function PlayerAvatar({
  player,
  avatarUrl,
  fallback,
  alt = '',
  imageClassName = 'player-avatar__image',
  imageStyle,
  fit = 'contain',
  ...spanProps
}: PlayerAvatarProps) {
  const source = avatarUrl ?? player?.avatarUrl ?? null
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const imageSource = source && isAvatarImageUrl(source) ? source : null

  return (
    <span {...spanProps}>
      {imageSource && failedSource !== imageSource ? (
        <img
          className={imageClassName}
          src={imageSource}
          alt={alt}
          draggable={false}
          onError={() => setFailedSource(imageSource)}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: fit,
            ...imageStyle,
          }}
        />
      ) : (fallback ?? player?.avatar ?? '🙂')}
    </span>
  )
}
