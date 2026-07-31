import type { Clan, MatchRecord, Player, SportId, Venue } from '../types'

/** 데모 기준 좌표 — 잠실나루역 (위치 권한을 거부하면 이 좌표를 쓴다) */
export const HOME = { lat: 37.5206, lng: 127.1035 }

/** 랭킹이 집계되는 구역 이름 */
export const REGION = '송파구'

export const VENUES: Venue[] = [
  {
    id: 'v1',
    name: '잠실 국민체육센터',
    sports: ['badminton', 'tabletennis', 'basketball'],
    lat: 37.5188,
    lng: 127.1012,
    address: '서울 송파구 올림픽로 240',
    pricePerHour: 24000,
  },
  {
    id: 'v2',
    name: '잠실한강공원 테니스장',
    sports: ['tennis'],
    lat: 37.5171,
    lng: 127.0966,
    address: '서울 송파구 한가람로 65',
    pricePerHour: 40000,
  },
  {
    id: 'v3',
    name: '신천 배드민턴 클럽',
    sports: ['badminton'],
    lat: 37.5148,
    lng: 127.1043,
    address: '서울 송파구 백제고분로 362',
    pricePerHour: 28000,
  },
  {
    id: 'v4',
    name: '성내천 탁구장',
    sports: ['tabletennis'],
    lat: 37.5272,
    lng: 127.1152,
    address: '서울 송파구 성내천로 200',
    pricePerHour: 16000,
  },
  {
    id: 'v5',
    name: '올림픽공원 실내 농구장',
    sports: ['basketball'],
    lat: 37.5215,
    lng: 127.1198,
    address: '서울 송파구 올림픽로 424',
    pricePerHour: 36000,
  },
  {
    id: 'v6',
    name: '아시아공원 시민 체육관',
    sports: ['tennis', 'basketball'],
    lat: 37.5132,
    lng: 127.1082,
    address: '서울 송파구 오금로 62',
    pricePerHour: 20000,
  },
  {
    id: 'v7',
    name: '잠실 스포츠플렉스',
    sports: ['badminton', 'tabletennis', 'tennis'],
    lat: 37.5243,
    lng: 127.0998,
    address: '서울 송파구 올림픽로 269',
    pricePerHour: 32000,
  },
  {
    id: 'v8',
    name: '몽촌토성 커뮤니티 체육관',
    sports: ['basketball', 'badminton'],
    lat: 37.5192,
    lng: 127.1145,
    address: '서울 송파구 위례성대로 51',
    pricePerHour: 22000,
  },
]

const AVATARS = ['🦊', '🐻', '🐯', '🦁', '🐼', '🐨', '🦅', '🐺', '🦉', '🐸', '🦈', '🐲']

function makeElo(base: number): Record<SportId, number> {
  const j = () => base + Math.round((Math.random() - 0.5) * 180)
  return { tennis: j(), badminton: j(), tabletennis: j(), basketball: j() }
}

const NICKS = [
  'Kim_Pro', 'Lee_Smash', 'Park_Ace', 'Choi_Rally', 'Jung_Server', 'Han_Drive',
  'Seo_Spike', 'Oh_Dunk', 'Yoon_Volley', 'Shin_Drop', 'Kang_Slice', 'Lim_Lob',
  'Bae_Block', 'Noh_Rush', 'Ryu_Net', 'Ha_Loop',
]

/** 결정적으로 생성되는 NPC 풀 — 리더보드와 매칭 큐를 모두 이 풀에서 채운다. */
export const NPCS: Player[] = NICKS.map((nickname, i) => ({
  id: `npc-${i}`,
  nickname,
  avatar: AVATARS[i % AVATARS.length],
  elo: makeElo(1500 + ((i * 137) % 600) - 200),
  stickers: (i * 7) % 62,
  wins: 12 + ((i * 5) % 40),
  losses: 8 + ((i * 3) % 30),
  clanId: i % 3 === 0 ? 'c1' : i % 3 === 1 ? 'c2' : undefined,
}))

export function npcById(id: string): Player | undefined {
  return NPCS.find((n) => n.id === id)
}

const SCORES: Record<string, string[]> = {
  tennis: ['6-4', '6-3', '7-5', '6-2'],
  badminton: ['21-18', '21-15', '21-19', '2-1'],
  tabletennis: ['11-8', '11-6', '3-1', '11-9'],
  basketball: ['21-17', '21-14', '21-19'],
}

/** 체육관마다 최근 경기 수가 다르다. 활발한 곳은 지도에서 🔥로 표시된다. */
const RECORD_COUNTS: Record<string, number> = {
  v1: 8, v2: 3, v3: 9, v4: 2, v5: 4, v6: 3, v7: 6, v8: 2,
}

/** 각 체육관의 "최근 경기" 전광판을 채우는 기록 */
export const RECORDS: MatchRecord[] = VENUES.flatMap((v, vi) =>
  Array.from({ length: RECORD_COUNTS[v.id] ?? 4 }, (_, i) => {
    const sport = v.sports[i % v.sports.length]
    const a = NPCS[(vi * 3 + i) % NPCS.length]
    const b = NPCS[(vi * 3 + i + 5) % NPCS.length]
    return {
      id: `${v.id}-r${i}`,
      venueId: v.id,
      sport,
      mode: sport === 'basketball' ? ('3v3' as const) : i % 2 === 0 ? ('1v1' as const) : ('2v2' as const),
      playedAt: `${i + 1}일 전`,
      winners: [a.id],
      losers: [b.id],
      score: SCORES[sport][i % SCORES[sport].length],
      eloDelta: 12 + ((vi + i) % 14),
    }
  }),
)

export function recordsOf(venueId: string): MatchRecord[] {
  return RECORDS.filter((r) => r.venueId === venueId)
}

/** 최근 경기가 가장 많았던 두 곳 — 지도에 🔥로 표시한다. */
export const HOT_VENUE_IDS: string[] = [...VENUES]
  .sort((a, b) => (RECORD_COUNTS[b.id] ?? 0) - (RECORD_COUNTS[a.id] ?? 0))
  .slice(0, 2)
  .map((v) => v.id)

/** 해당 체육관에서 경기한 유저들의 ELO 리더보드 */
export function leaderboardOf(venueId: string, sport: SportId): Player[] {
  const ids = new Set(recordsOf(venueId).flatMap((r) => [...r.winners, ...r.losers]))
  const pool = NPCS.filter((n) => ids.has(n.id))
  const list = pool.length >= 3 ? pool : NPCS.slice(0, 6)
  return [...list].sort((a, b) => b.elo[sport] - a.elo[sport]).slice(0, 5)
}

export const CLANS: Clan[] = [
  {
    id: 'c1',
    name: '강남 스매셔즈',
    tag: 'GNS',
    emblem: '⚡',
    memberCount: 24,
    points: 8420,
    sport: 'badminton',
    region: '강남구',
    notice: '주 2회 정기 모임! 초보 환영합니다 🏸',
  },
  {
    id: 'c2',
    name: '테헤란로 에이스',
    tag: 'THA',
    emblem: '🎾',
    memberCount: 18,
    points: 7150,
    sport: 'tennis',
    region: '역삼동',
    notice: '평일 저녁 코트 대관 상시 진행 중',
  },
  {
    id: 'c3',
    name: '한강 덩커스',
    tag: 'HGD',
    emblem: '🏀',
    memberCount: 31,
    points: 6890,
    sport: 'basketball',
    region: '서초구',
    notice: '주말 3대3 리그 참가팀 모집',
  },
  {
    id: 'c4',
    name: '핑퐁 마스터즈',
    tag: 'PPM',
    emblem: '🏓',
    memberCount: 12,
    points: 5240,
    sport: 'tabletennis',
    region: '선릉',
    notice: '매주 화/목 저녁 8시 정모',
  },
]

/** 큐 대기 중 상대가 보내는 채팅 (데모용 자동 대화) */
export const BOT_CHATS = [
  '안녕하세요! 잘 부탁드립니다 🙌',
  '저는 오후 시간대가 편한데 다들 어떠세요?',
  '좋아요, 저도 그 시간 괜찮습니다!',
  '그럼 그 시간으로 투표할게요 👍',
]
