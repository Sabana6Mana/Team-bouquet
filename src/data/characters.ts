/**
 * 앱에 함께 배포되는 선택형 플레이어 캐릭터 목록.
 *
 * 새 캐릭터를 추가할 때는 이미지를 `public` 아래에 두고 이 목록에만 등록한다.
 * 프로필에는 이 경로가 `profiles.avatar_url`로 저장되므로, 파일명을 바꾸면 기존
 * 사용자의 선택도 함께 깨진다는 점에 유의한다.
 */
export const CHARACTERS = [
  {
    id: 'dino',
    label: '초록 공룡',
    avatarUrl: '/map/player-dino.webp',
    fallback: '🦖',
  },
] as const

export type CharacterId = (typeof CHARACTERS)[number]['id']
export type Character = (typeof CHARACTERS)[number]

export const DEFAULT_CHARACTER: Character = CHARACTERS[0]

export function characterById(id: string | null | undefined): Character {
  return CHARACTERS.find((character) => character.id === id) ?? DEFAULT_CHARACTER
}

/**
 * `avatar_url`은 카카오가 제공한 원격 URL과 앱 번들 캐릭터 경로를 함께 담는다.
 * 번들 경로는 카탈로그에 등록된 값만 이미지로 인정해 임의 문자열을 src로 쓰지 않는다.
 */
export function isAvatarImageUrl(value: string | null | undefined): boolean {
  if (!value) return false
  if (/^https?:\/\//i.test(value)) return true
  return CHARACTERS.some((character) => character.avatarUrl === value)
}
