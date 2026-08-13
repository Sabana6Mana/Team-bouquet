/**
 * 심사·시연용 휴대폰 인증 흉내.
 *
 * 실제 문자 발송에는 SMS 사업자 계약이 필요해 대회 기간 안에 붙일 수 없다.
 * 그래서 번호 입력과 인증번호 확인 흐름은 그대로 두되, 문자는 보내지 않고
 * 고정된 인증번호로 통과시킨다.
 *
 * 다만 "인증한 척"만 하고 끝내면 백엔드에 세션이 없어 아무 기능도 못 쓴다.
 * 통과 시점에 익명 로그인으로 **진짜 세션**을 만들어 이후 흐름을 정상 동작시킨다.
 *
 * 심사위원이 인증을 통과했다고 오해하지 않도록 화면에 인증번호를 그대로 보여 준다.
 * 실제 SMS 사업자를 붙이면 이 파일과 LoginScreen 의 분기만 걷어내면 된다.
 */

/** 화면에 안내하는 시연용 인증번호. */
export const DEMO_OTP = '123456'

/** 문자를 보내는 척하는 시간(ms). 즉시 넘어가면 가짜 티가 심하게 난다. */
export const DEMO_SEND_DELAY_MS = 700

export function isDemoOtp(token: string) {
  return token.trim() === DEMO_OTP
}

export function delay(ms: number) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/*
 * 인증을 통과했다는 표시.
 *
 * 앱은 Supabase 사용자에게 확인된 전화번호가 있어야 인증된 것으로 본다.
 * 익명 로그인에는 전화번호가 없으므로, 흉내 인증을 통과한 사실을 따로 남겨
 * 로그인 화면에서 무한히 되돌아오지 않게 한다.
 */
const VERIFIED_KEY = 'matchpoint-demo-phone'

export function markDemoVerified(phone: string) {
  try { localStorage.setItem(VERIFIED_KEY, phone) } catch { /* 저장 실패는 무시 */ }
}

export function isDemoVerified() {
  try { return Boolean(localStorage.getItem(VERIFIED_KEY)) } catch { return false }
}

export function clearDemoVerified() {
  try { localStorage.removeItem(VERIFIED_KEY) } catch { /* 삭제 실패는 무시 */ }
}