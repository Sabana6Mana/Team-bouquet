const KOREAN_MOBILE_NATIONAL_PATTERN = /^10\d{8}$/

/**
 * Converts a Korean 010 mobile number to the E.164 form expected by Supabase.
 *
 * Accepted examples:
 * - 010-1234-5678
 * - 010 1234 5678
 * - +82 10 1234 5678
 * - 821012345678
 */
export function normalizeKoreanPhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '')
  let national = compact

  if (national.startsWith('+82')) national = national.slice(3)
  else if (national.startsWith('0082')) national = national.slice(4)
  else if (national.startsWith('82')) national = national.slice(2)

  if (national.startsWith('0')) national = national.slice(1)

  if (!KOREAN_MOBILE_NATIONAL_PATTERN.test(national)) {
    throw new Error('010으로 시작하는 휴대폰 번호 11자리를 입력해 주세요.')
  }

  return `+82${national}`
}

export function isValidKoreanPhone(value: string): boolean {
  try {
    normalizeKoreanPhone(value)
    return true
  } catch {
    return false
  }
}
