import { titleForAchievement } from '../data/achievements'
import { useApp } from '../store/useApp'

/**
 * 지금 장착한 칭호 이름.
 *
 * 평소에는 서버 프로필의 값(me.title)을 그대로 쓴다.
 * 다만 체험 매칭으로 얻은 도전과제는 서버에 없어 me.title 에 실리지 않으므로,
 * 체험 진행이 있으면 로컬에 장착한 칭호를 우선한다.
 */
export function useEquippedTitle(): string | null {
  const me = useApp((state) => state.me)
  const demoHistory = useApp((state) => state.demoHistory)
  const demoTitleCode = useApp((state) => state.demoTitleCode)

  if (demoHistory.length > 0 && demoTitleCode) {
    return titleForAchievement(demoTitleCode) ?? me.title ?? null
  }
  return me.title ?? null
}