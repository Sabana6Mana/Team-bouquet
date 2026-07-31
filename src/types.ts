export type SportId = 'tennis' | 'badminton' | 'tabletennis' | 'basketball'
export type MatchMode = '1v1' | '2v2' | '3v3'

export interface SportMeta {
  id: SportId
  label: string
  emoji: string
  /** 이 종목이 지원하는 경기 방식 */
  modes: MatchMode[]
  color: string
}

export interface Venue {
  id: string
  name: string
  /** 이 시설에서 가능한 종목 */
  sports: SportId[]
  lat: number
  lng: number
  address: string
  /** 1시간 대관료(원). 참가 인원으로 나누어 더치페이한다. */
  pricePerHour: number
}

export interface Player {
  id: string
  nickname: string
  avatar: string
  elo: Record<SportId, number>
  /** 받은 칭찬 스티커 누적 수 */
  stickers: number
  wins: number
  losses: number
  isMe?: boolean
  clanId?: string
}

export interface MatchRecord {
  id: string
  venueId: string
  sport: SportId
  mode: MatchMode
  playedAt: string
  winners: string[]
  losers: string[]
  score: string
  eloDelta: number
}

export type MatchPhase =
  | 'queue'        // 인원 모집 중
  | 'scheduling'   // 채팅 + 타임테이블 투표
  | 'teaming'      // 팀 구성 (단식은 건너뛴다)
  | 'payment'      // 더치페이 결제 대기
  | 'confirmed'    // 예약 확정, 경기 대기
  | 'reporting'    // 경기 종료, 승패 투표
  | 'done'

export interface ChatMessage {
  id: string
  playerId: string
  text: string
  at: number
  system?: boolean
}

export interface Match {
  id: string
  /** 빠른 매칭은 인원이 모인 뒤 배정되므로 큐 단계에서는 비어 있다. */
  venueId: string
  /** 장소를 고르지 않고 반경 안의 플레이어와 매칭한 경우 */
  quick: boolean
  sport: SportId
  mode: MatchMode
  capacity: number
  hostId: string
  players: Player[]
  phase: MatchPhase
  /** playerId -> 투표한 슬롯 (encodeSlot 으로 날짜+시각을 인코딩) */
  votes: Record<string, number>
  confirmedSlot: number | null
  /** playerId -> 결제 완료 여부 */
  payments: Record<string, boolean>
  chat: ChatMessage[]
  teams: { a: string[]; b: string[] }
  /** 팀 구성 단계에서 준비를 완료한 플레이어 */
  teamReady: Record<string, boolean>
  /** 내가 신고한 플레이어. playerId -> 신고 사유 id */
  reports: Record<string, string>
  /** 경기 후 승패 투표. playerId -> 이겼다고 본 팀 */
  resultVotes: Record<string, 'a' | 'b'>
  /** 전원이 같은 팀에 투표했을 때만 채워진다. delta는 내 ELO 변동값. */
  result: { winner: 'a' | 'b'; score: string; delta: number } | null
  /** 칭찬 스티커를 준 상대 playerId 목록 */
  stickersGiven: string[]
  createdAt: number
}

export interface Clan {
  id: string
  name: string
  tag: string
  emblem: string
  memberCount: number
  points: number
  sport: SportId
  region: string
  notice: string
}

export interface AppNotification {
  id: string
  title: string
  body: string
  at: number
  read: boolean
  /** 탭했을 때 이동할 경로 */
  link?: string
}

export interface Account {
  name: string
  birth: string
  carrier: string
  phone: string
  nickname: string
  interests: SportId[]
}
