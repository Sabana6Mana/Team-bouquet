import type { Session, User } from '@supabase/supabase-js'
import type { Json, TableRow } from './database.types'

export type SportId = 'tennis' | 'badminton' | 'tabletennis' | 'basketball'
export type MatchMode = '1v1' | '2v2' | '3v3'
export type MatchTeam = 'a' | 'b'

export type Profile = TableRow<'profiles'>
export type PlayerRating = TableRow<'player_ratings'>
export type Venue = TableRow<'venues'>
/**
 * Browser-safe venue slot shape. `reserved_match_id` is deliberately omitted:
 * it is internal reservation metadata and is not granted through PostgREST.
 */
export type VenueSlot = Omit<TableRow<'venue_slots'>, 'reserved_match_id'>
export type QueueEntry = TableRow<'queue_entries'>
export type Match = TableRow<'matches'>
export type MatchMember = TableRow<'match_members'>
export type ChatMessage = TableRow<'chat_messages'>
export type SlotVote = TableRow<'slot_votes'>
export type ResultVote = TableRow<'result_votes'>
export type Report = TableRow<'reports'>

export interface ProfileWithRatings {
  profile: Profile
  ratings: PlayerRating[]
}

export interface MatchPlayer extends MatchMember {
  profile: Profile | null
  ratings: PlayerRating[]
}

/** One backend snapshot suitable for hydrating the existing client store. */
export interface CurrentMatch {
  match: Match
  venue: Venue | null
  confirmedSlot: VenueSlot | null
  players: MatchPlayer[]
  messages: ChatMessage[]
  slotVotes: SlotVote[]
  resultVotes: ResultVote[]
}

export interface JoinQueueInput {
  sport: SportId
  mode: MatchMode
  /** Omit for quick matching. */
  venueId?: string | null
  /** Used only for quick matching. */
  location?: { lat: number; lng: number } | null
}

export interface JoinQueueResult {
  queueEntryId?: string
  matchId?: string | null
  status?: string
  raw: Json
}

export interface SlotVoteResult {
  matchId: string
  confirmedSlotId?: string | null
  consensus?: boolean
  phase?: string
  raw: Json
}

export interface ResultVoteResult {
  matchId: string
  winnerTeam?: MatchTeam | null
  consensus?: boolean
  finalized?: boolean
  raw: Json
}

export interface MatchMutationResult {
  matchId: string
  phase?: string
  raw: Json
}

export interface BackendAuthState {
  event: string
  session: Session | null
}

export type BackendUser = User

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export interface RealtimeRowChange<Row> {
  eventType: RealtimeEvent
  schema: string
  table: string
  commitTimestamp: string
  new: Row | null
  old: Partial<Row> | null
}

export type BackendRealtimeStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR'
  | 'DISABLED'

export interface MatchRealtimeHandlers {
  onMatch?: (change: RealtimeRowChange<Match>) => void
  onMember?: (change: RealtimeRowChange<MatchMember>) => void
  onMessage?: (change: RealtimeRowChange<ChatMessage>) => void
  onSlotVote?: (change: RealtimeRowChange<SlotVote>) => void
  onResultVote?: (change: RealtimeRowChange<ResultVote>) => void
  onStatus?: (status: BackendRealtimeStatus) => void
}
