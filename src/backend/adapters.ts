import { encodeSlot } from '../lib/game'
import type {
  Account as AppAccount,
  ChatMessage as AppChatMessage,
  Match as AppMatch,
  MatchMode as AppMatchMode,
  MatchPhase as AppMatchPhase,
  Player as AppPlayer,
  SportId as AppSportId,
} from '../types'
import type {
  CurrentMatch,
  MatchPlayer,
  ProfileWithRatings,
  VenueSlot,
} from './types'
import { titleForAchievement } from '../data/achievements'

const SPORTS: AppSportId[] = ['tennis', 'badminton', 'tabletennis', 'basketball']
const MODES: AppMatchMode[] = ['1v1', '2v2', '3v3']
const PHASES: AppMatchPhase[] = [
  'queue',
  'scheduling',
  'teaming',
  'payment',
  'confirmed',
  'reporting',
  'done',
]

const DEFAULT_ELO: Record<AppSportId, number> = {
  tennis: 1200,
  badminton: 1200,
  tabletennis: 1200,
  basketball: 1200,
}

function isSport(value: string): value is AppSportId {
  return SPORTS.includes(value as AppSportId)
}

function asSport(value: string): AppSportId {
  return isSport(value) ? value : 'badminton'
}

function asMode(value: string): AppMatchMode {
  return MODES.includes(value as AppMatchMode) ? value as AppMatchMode : '1v1'
}

function asPhase(value: string): AppMatchPhase {
  if (value === 'canceled') return 'done'
  return PHASES.includes(value as AppMatchPhase) ? value as AppMatchPhase : 'queue'
}

function asTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function localMidnight(value: Date): Date {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  return result
}

/**
 * Converts an ISO venue-slot start to the integer format used by the demo UI.
 * Both the slot and `now` are interpreted in the browser's current timezone.
 */
export function isoStartToEncodedSlot(startsAt: string, now = new Date()): number {
  const starts = new Date(startsAt)
  if (Number.isNaN(starts.getTime())) throw new Error(`Invalid venue slot start: ${startsAt}`)
  const dayOffset = Math.round(
    (localMidnight(starts).getTime() - localMidnight(now).getTime()) / 86_400_000,
  )
  return encodeSlot(dayOffset, starts.getHours())
}

/** UI slot integer -> Supabase venue_slots UUID. */
export function venueSlotIdsByEncodedSlot(
  venueSlots: VenueSlot[],
  now = new Date(),
): Record<number, string> {
  return Object.fromEntries(
    venueSlots.map((slot) => [isoStartToEncodedSlot(slot.starts_at, now), slot.id]),
  )
}

/** Supabase venue_slots UUID -> UI slot integer. */
export function encodedSlotsByVenueSlotId(
  venueSlots: VenueSlot[],
  now = new Date(),
): Record<string, number> {
  return Object.fromEntries(
    venueSlots.map((slot) => [slot.id, isoStartToEncodedSlot(slot.starts_at, now)]),
  )
}

export function profileToAccount(value: ProfileWithRatings): AppAccount {
  return {
    // The MVP schema deliberately does not store legal identity or phone data.
    name: value.profile.nickname,
    birth: '',
    carrier: '',
    phone: '',
    nickname: value.profile.nickname,
    interests: value.profile.interests.filter(isSport),
  }
}

function profileAvatar(value: string | null): string {
  // Existing components render Player.avatar as text. Preserve emoji/text values,
  // but do not accidentally print a full avatar URL into the UI.
  if (!value || /^https?:\/\//i.test(value)) return '🙂'
  return value.length <= 12 ? value : '🙂'
}

export function profileToPlayer(
  value: ProfileWithRatings,
  currentUserId?: string | null,
): AppPlayer {
  const elo = { ...DEFAULT_ELO }
  for (const rating of value.ratings) {
    if (isSport(rating.sport)) elo[rating.sport] = rating.rating
  }
  return {
    id: value.profile.id,
    nickname: value.profile.nickname,
    avatar: profileAvatar(value.profile.avatar_url),
    avatarUrl: value.profile.avatar_url && /^https?:\/\//i.test(value.profile.avatar_url)
      ? value.profile.avatar_url
      : null,
    elo,
    stickers: value.profile.honor_total,
    honorCounts: {
      manner: value.profile.honor_manner,
      skill: value.profile.honor_skill,
      punctual: value.profile.honor_punctual,
      fun: value.profile.honor_fun,
    },
    wins: value.ratings.reduce((total, rating) => total + rating.wins, 0),
    losses: value.ratings.reduce((total, rating) => total + rating.losses, 0),
    streak: Math.max(0, ...value.ratings.map((rating) => rating.current_streak)),
    bestStreak: Math.max(0, ...value.ratings.map((rating) => rating.best_streak)),
    titleCode: value.profile.equipped_title_code,
    title: titleForAchievement(value.profile.equipped_title_code),
    isMe: currentUserId === value.profile.id,
  }
}

function matchPlayerToApp(player: MatchPlayer, currentUserId: string): AppPlayer {
  if (player.profile) {
    return profileToPlayer(
      { profile: player.profile, ratings: player.ratings },
      currentUserId,
    )
  }
  const elo = { ...DEFAULT_ELO }
  return {
    id: player.user_id,
    nickname: '알 수 없는 선수',
    avatar: '🙂',
    elo,
    stickers: 0,
    honorCounts: { manner: 0, skill: 0, punctual: 0, fun: 0 },
    wins: 0,
    losses: 0,
    isMe: currentUserId === player.user_id,
  }
}

function messageToApp(message: CurrentMatch['messages'][number]): AppChatMessage {
  return {
    id: message.id,
    playerId: message.sender_id ?? 'system',
    text: message.body,
    at: asTimestamp(message.created_at),
    system: message.system,
  }
}

/**
 * Hydrates the existing synchronous UI model from one Supabase match snapshot.
 * Reports remain local UI state; post-match honors are hydrated from the server.
 */
export function currentMatchToAppMatch(
  current: CurrentMatch,
  currentUserId: string,
  venueSlots: VenueSlot[],
  now = new Date(),
): AppMatch {
  const { match } = current
  const allSlots = current.confirmedSlot
    && !venueSlots.some((slot) => slot.id === current.confirmedSlot?.id)
    ? [...venueSlots, current.confirmedSlot]
    : venueSlots
  const encodedById = encodedSlotsByVenueSlotId(allSlots, now)
  const votes: Record<string, number> = {}
  for (const vote of current.slotVotes) {
    const encoded = encodedById[vote.venue_slot_id]
    if (encoded !== undefined) votes[vote.user_id] = encoded
  }

  const resultVotes: Record<string, 'a' | 'b'> = {}
  const resultVoteScores: Record<string, string> = {}
  for (const vote of current.resultVotes) {
    if (vote.winner_team === 'a' || vote.winner_team === 'b') {
      resultVotes[vote.user_id] = vote.winner_team
      resultVoteScores[vote.user_id] = vote.score ?? ''
    }
  }

  const teams = { a: [] as string[], b: [] as string[] }
  const teamReady: Record<string, boolean> = {}
  const payments: Record<string, boolean> = {}
  for (const member of current.players) {
    if (member.team === 'a' || member.team === 'b') teams[member.team].push(member.user_id)
    teamReady[member.user_id] = member.ready
    // The database keeps the legacy column name `paid`; in the MVP it means
    // attendance/participation confirmation rather than a real payment.
    payments[member.user_id] = member.paid
  }

  const myMember = current.players.find((member) => member.user_id === currentUserId)
  const winner = match.winner_team === 'a' || match.winner_team === 'b'
    ? match.winner_team
    : null

  return {
    id: match.id,
    venueId: match.venue_id ?? '',
    quick: match.quick,
    sport: asSport(match.sport),
    mode: asMode(match.mode),
    capacity: match.capacity,
    hostId: match.host_id,
    players: current.players.map((player) => matchPlayerToApp(player, currentUserId)),
    phase: asPhase(match.phase),
    acceptanceDeadline: match.acceptance_deadline
      ? new Date(match.acceptance_deadline).getTime()
      : undefined,
    accepted: Object.fromEntries(
      current.players.map((member) => [member.user_id, Boolean(member.accepted_at)]),
    ),
    votes,
    confirmedSlot: match.confirmed_slot_id
      ? encodedById[match.confirmed_slot_id] ?? null
      : null,
    payments,
    chat: current.messages.map(messageToApp),
    teams,
    teamReady,
    reports: {},
    resultVotes,
    resultVoteScores,
    result: winner
      ? {
          winner,
          score: match.score ?? '-',
          delta: myMember?.rating_delta ?? 0,
        }
      : null,
    honorGiven: (() => {
      const honor = current.honors.find((item) => item.giver_id === currentUserId)
      return honor ? { playerId: honor.receiver_id, type: honor.honor_type } : null
    })(),
    createdAt: asTimestamp(match.created_at),
  }
}
