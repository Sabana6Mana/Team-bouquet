import type { MatchMode, SportId, SportMeta } from '../types'

export const SPORTS: Record<SportId, SportMeta> = {
  // 흰 배경에서 글자로 읽힐 만큼 진한 색으로 맞춘다. 테니스는 브랜드색인 코트 그린.
  tennis: { id: 'tennis', label: '테니스', emoji: '🎾', modes: ['1v1', '2v2'], color: '#2F7D46' },
  badminton: { id: 'badminton', label: '배드민턴', emoji: '🏸', modes: ['1v1', '2v2'], color: '#1E7FA8' },
  tabletennis: { id: 'tabletennis', label: '탁구', emoji: '🏓', modes: ['1v1', '2v2'], color: '#B83C7A' },
  basketball: { id: 'basketball', label: '농구', emoji: '🏀', modes: ['3v3'], color: '#C2610F' },
}

export const SPORT_LIST = Object.values(SPORTS)

export const MODE_LABEL: Record<MatchMode, string> = {
  '1v1': '단식 1 : 1',
  '2v2': '복식 2 : 2',
  '3v3': '3 : 3',
}

export function capacityOf(mode: MatchMode): number {
  return mode === '1v1' ? 2 : mode === '2v2' ? 4 : 6
}

/** 빠른 매칭이 상대를 찾는 반경(m) */
export const QUICK_RADIUS_M = 3000

/** 체육관 운영 시간: 오전 8시 ~ 오후 6시, 1시간 단위 */
export const OPEN_HOUR = 8
export const CLOSE_HOUR = 18
export const TIME_SLOTS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i)

export function hourLabel(h: number): string {
  const fmt = (n: number) => `${n > 12 ? n - 12 : n}:00 ${n >= 12 ? 'PM' : 'AM'}`
  return `${fmt(h)} – ${fmt(h + 1)}`
}

/* ─────────────── 날짜 + 시간 슬롯 ─────────────── */

/** 오늘부터 예약할 수 있는 날짜 수 */
export const DAYS_AHEAD = 14

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export function dateForOffset(offset: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}

export function dayLabel(offset: number) {
  const d = dateForOffset(offset)
  return {
    month: d.getMonth() + 1,
    date: d.getDate(),
    weekday: WEEKDAY[d.getDay()],
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
    isToday: offset === 0,
  }
}

/** (날짜, 시각)을 하나의 정수로 인코딩해 투표 값으로 쓴다. */
export const encodeSlot = (day: number, hour: number) => day * 24 + hour
export const slotDay = (slot: number) => Math.floor(slot / 24)
export const slotHour = (slot: number) => slot % 24

export function slotLabel(slot: number): string {
  const d = dateForOffset(slotDay(slot))
  const day = dayLabel(slotDay(slot))
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${day.weekday}) ${hourLabel(slotHour(slot))}`
}

export function slotShortLabel(slot: number): string {
  const day = dayLabel(slotDay(slot))
  return `${day.month}.${day.date}(${day.weekday}) ${slotHour(slot)}:00`
}

/**
 * 체육관·날짜별로 이미 예약된 시간.
 * 서버가 없으므로 (체육관, 날짜)로 결정적인 의사난수를 만들어
 * 새로고침해도 같은 결과가 나오게 한다.
 */
export function bookedHoursFor(venueId: string, day: number): number[] {
  const key = `${venueId}#${day}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const booked: number[] = []
  for (const hour of TIME_SLOTS) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    if (h % 100 < 33) booked.push(hour)
  }
  return booked
}

/** 오늘 이미 지난 시간은 고를 수 없다. */
export function isPastSlot(day: number, hour: number): boolean {
  if (day > 0) return false
  return hour <= new Date().getHours()
}

export function isSlotOpen(venueId: string, day: number, hour: number): boolean {
  return !bookedHoursFor(venueId, day).includes(hour) && !isPastSlot(day, hour)
}

/** 예약 가능한 가장 빠른 슬롯 */
export function earliestOpenSlot(venueId: string): number | null {
  for (let d = 0; d < DAYS_AHEAD; d++) {
    for (const h of TIME_SLOTS) {
      if (isSlotOpen(venueId, d, h)) return encodeSlot(d, h)
    }
  }
  return null
}

/* ────────────────────────── ELO ────────────────────────── */

const K = 32

/** 두 팀 평균 레이팅으로 기대 승률을 구하고 K=32로 변동폭을 계산한다. */
export function eloDelta(myTeamAvg: number, oppTeamAvg: number, won: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (oppTeamAvg - myTeamAvg) / 400))
  return Math.round(K * ((won ? 1 : 0) - expected))
}

/** 팀의 평균 레이팅 */
export function teamAvg(
  players: { id: string; elo: Record<SportId, number> }[],
  ids: string[],
  sport: SportId,
): number {
  if (ids.length === 0) return 0
  const sum = ids.reduce((s, id) => s + (players.find((p) => p.id === id)?.elo[sport] ?? 1200), 0)
  return Math.round(sum / ids.length)
}

/**
 * 양 팀 ELO 합이 최대한 비슷해지도록 나눈 추천 조합.
 * 인원이 최대 6명이라 모든 분할을 다 훑어도 부담이 없다.
 */
export function recommendTeams(
  players: { id: string; elo: Record<SportId, number> }[],
  sport: SportId,
): { a: string[]; b: string[] } {
  const n = players.length
  const half = Math.floor(n / 2)
  let best: { a: string[]; b: string[] } | null = null
  let bestDiff = Infinity

  for (let mask = 0; mask < 1 << n; mask++) {
    let count = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) count++
    if (count !== half) continue

    let sa = 0
    let sb = 0
    for (let i = 0; i < n; i++) {
      const e = players[i].elo[sport]
      if (mask & (1 << i)) sa += e
      else sb += e
    }
    const diff = Math.abs(sa - sb)
    if (diff < bestDiff) {
      bestDiff = diff
      best = {
        a: players.filter((_, i) => mask & (1 << i)).map((p) => p.id),
        b: players.filter((_, i) => !(mask & (1 << i))).map((p) => p.id),
      }
    }
  }

  if (best) return best
  const sorted = [...players].sort((x, y) => y.elo[sport] - x.elo[sport])
  return { a: sorted.slice(0, half).map((p) => p.id), b: sorted.slice(half).map((p) => p.id) }
}

export interface Tier {
  name: string
  short: string
  /** 흰 배경용 */
  color: string
  /** 어두운 전광판 위에서 읽히는 밝은 변형 */
  led: string
  min: number
}

export const TIERS: Tier[] = [
  { name: '브론즈', short: 'B', color: '#9A6B3F', led: '#DCA574', min: 0 },
  { name: '실버', short: 'S', color: '#77868F', led: '#C9D7DF', min: 1200 },
  { name: '골드', short: 'G', color: '#B8860B', led: '#FFCF5C', min: 1400 },
  { name: '플래티넘', short: 'P', color: '#1F8A63', led: '#5FE0A8', min: 1600 },
  { name: '다이아', short: 'D', color: '#2F6FD0', led: '#7FB6FF', min: 1800 },
  { name: '마스터', short: 'M', color: '#7A45C9', led: '#C79BFF', min: 2000 },
]

export function tierOf(elo: number): Tier {
  let found = TIERS[0]
  for (const t of TIERS) if (elo >= t.min) found = t
  return found
}

/* ─────────────────────── 명예 등급 ─────────────────────── */

export interface HonorGrade {
  level: 1 | 2 | 3 | 4 | 5
  name: string
  color: string
  min: number
  next: number | null
}

/** 칭찬 스티커 누적 수에 따른 5단계 명예 등급 */
export const HONOR_GRADES: HonorGrade[] = [
  { level: 1, name: '새싹 플레이어', color: '#6B7F8C', min: 0, next: 5 },
  { level: 2, name: '좋은 이웃', color: '#1F8A63', min: 5, next: 15 },
  { level: 3, name: '매너 플레이어', color: '#1E7FA8', min: 15, next: 30 },
  { level: 4, name: '신뢰의 상징', color: '#7A45C9', min: 30, next: 50 },
  { level: 5, name: '명예의 전당', color: '#B8860B', min: 50, next: null },
]

export function honorOf(stickers: number): HonorGrade {
  let found = HONOR_GRADES[0]
  for (const g of HONOR_GRADES) if (stickers >= g.min) found = g
  return found
}

/** 경기 후 상대에게 줄 수 있는 칭찬 스티커 종류 */
export const STICKERS = [
  { id: 'manner', emoji: '🤝', label: '매너가 좋아요' },
  { id: 'skill', emoji: '🔥', label: '실력이 대단해요' },
  { id: 'punctual', emoji: '⏰', label: '시간 약속을 잘 지켜요' },
  { id: 'fun', emoji: '😄', label: '분위기 메이커예요' },
]

/** 경기 후 비매너 플레이를 신고할 때 고를 수 있는 사유 */
export const REPORT_REASONS = [
  { id: 'noshow', emoji: '🚫', label: '노쇼 / 무단 불참' },
  { id: 'late', emoji: '🕐', label: '지각으로 경기 지연' },
  { id: 'abuse', emoji: '💢', label: '욕설 · 비매너 언행' },
  { id: 'throw', emoji: '🙃', label: '고의 패배 / 불성실 플레이' },
  { id: 'falsify', emoji: '📝', label: '경기 결과 허위 기록' },
  { id: 'payment', emoji: '💸', label: '더치페이 미납' },
]

export function reportReasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? '기타'
}

/* ──────────────────────── 거리 ──────────────────────── */

/** 두 좌표 사이 거리(m). 매칭 시 가장 가까운 장소를 고르는 데 쓴다. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

export function distanceLabel(m: number): string {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`
}

export function won(price: number): string {
  return price.toLocaleString('ko-KR') + '원'
}
