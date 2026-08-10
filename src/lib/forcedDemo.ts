import { backendConfig } from '../backend'

/**
 * 화면 확인용 강제 데모 매치 스위치.
 *
 * Supabase 를 붙이면 매칭이 실제 상대를 기다린다. 그래서 혼자서는 대기열 화면에
 * 멈춰 있게 되고 일정 조율·팀 구성·결제·결과 화면을 볼 방법이 없다.
 * 이 스위치를 켜는 동안에는 서버를 건드리지 않고 NPC 시뮬레이션으로 매칭을 돌려
 * 처음부터 끝까지 화면을 확인할 수 있다.
 *
 * 매치가 끝나거나 취소되면 스스로 꺼지고, 앱은 다시 서버 상태를 따른다.
 */
let forced = false

export const forcedDemo = {
  get active() { return forced },
  enable() { forced = true },
  disable() { forced = false },
}

/**
 * 지금 이 동작을 서버로 보내야 하는가.
 * 강제 데모 중에는 서버에 없는 매치를 다루므로 모든 처리를 로컬에서 끝낸다.
 */
export function serverMode() {
  return backendConfig.configured && !forced
}