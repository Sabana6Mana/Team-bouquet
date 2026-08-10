/**
 * 매칭 성사 등장 연출의 길이.
 *
 * 화면(RoomScreen)과 시뮬레이션(useApp)이 같은 값을 봐야 한다.
 * 연출이 도는 동안 NPC 가 말을 걸면 말풍선이 아직 없는 캐릭터 위에서
 * 소리 없이 사라져 대화가 통째로 씹히기 때문이다.
 */

/** 문구 세 줄이 1초 간격으로 뜨고(=2초), 마지막 줄을 2초 머금는다. */
export const INTRO_HERO_MS = 4000
/**
 * 문구가 사라지며 코트가 제자리로 물러나는 시간.
 * 카메라는 지수적으로 다가가 앞쪽에서 크게 움직이고 금방 잦아든다.
 * 문구도 같은 박자로 빠지도록 짧게 잡는다.
 */
export const INTRO_SETTLE_MS = 450
/** 캐릭터가 처음부터 끝까지 순서대로 다 나오는 데 걸리는 시간. */
export const INTRO_CAST_MS = 3000
/** 마지막 캐릭터의 튀어나오는 동작이 끝날 때까지의 여유. */
export const INTRO_TAIL_MS = 500

/** 연출 시작부터 화면을 실제로 쓸 수 있게 되기까지. */
export const INTRO_TOTAL_MS =
  INTRO_HERO_MS + INTRO_SETTLE_MS + INTRO_CAST_MS + INTRO_TAIL_MS