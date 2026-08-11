import type {
  AuthError,
  PostgrestError,
  RealtimePostgresChangesPayload,
  User,
} from '@supabase/supabase-js'
import { backendConfig, requireSupabase, supabase } from './client'
import type { Json, TableInsert, TableRow } from './database.types'
import type { HonorType } from '../types'
import type {
  BackendAchievement,
  BackendAuthState,
  BackendMatchHistory,
  BackendRealtimeStatus,
  ChatMessage,
  CurrentMatch,
  GiveHonorResult,
  JoinQueueInput,
  JoinQueueResult,
  Match,
  MatchHonor,
  MatchMember,
  MatchMutationResult,
  MatchRealtimeHandlers,
  MatchTeam,
  Notification,
  PlayerRating,
  Profile,
  ProfileWithRatings,
  RealtimeRowChange,
  Report,
  ResultVote,
  ResultVoteResult,
  SlotVote,
  SlotVoteResult,
  SportId,
  Venue,
  VenueSlot,
} from './types'

type BackendErrorSource = PostgrestError | AuthError | Error

const VENUE_SLOT_COLUMNS = 'id, venue_id, starts_at, ends_at, status, price, created_at, updated_at' as const

export class BackendRequestError extends Error {
  readonly code?: string
  readonly details?: string
  readonly hint?: string

  constructor(operation: string, cause: BackendErrorSource) {
    super(`${operation}: ${cause.message}`)
    this.name = 'BackendRequestError'
    ;(this as Error & { cause?: unknown }).cause = cause
    if ('code' in cause) this.code = cause.code
    if ('details' in cause) this.details = cause.details ?? undefined
    if ('hint' in cause) this.hint = cause.hint ?? undefined
  }
}

function fail(operation: string, error: BackendErrorSource | null): never {
  throw new BackendRequestError(operation, error ?? new Error('Unknown backend error'))
}

function failProfile(operation: string, error: BackendErrorSource | null): never {
  const message = error?.message ?? ''
  const code = error && 'code' in error ? error.code : undefined
  if (code === '23505' || /duplicate key|nickname.*key|닉네임.*사용 중/i.test(message)) {
    fail(operation, new Error('이미 사용 중인 닉네임입니다. 다른 이름을 골라 주세요.'))
  }
  fail(operation, error)
}

async function requireUser(): Promise<User> {
  const client = requireSupabase()
  const { data, error } = await client.auth.getUser()
  if (error) fail('로그인 사용자 확인 실패', error)
  if (!data.user) fail('로그인이 필요합니다', new Error('No authenticated user'))
  return data.user
}

function jsonObject(value: Json): Record<string, Json | undefined> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function jsonString(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function jsonBoolean(value: Json | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function toRealtimeChange<Row extends Record<string, unknown>>(
  payload: RealtimePostgresChangesPayload<Row>,
): RealtimeRowChange<Row> {
  return {
    eventType: payload.eventType,
    schema: payload.schema,
    table: payload.table,
    commitTimestamp: payload.commit_timestamp,
    new: payload.eventType === 'DELETE' ? null : payload.new,
    old: payload.eventType === 'INSERT' ? null : payload.old,
  }
}

export const authApi = {
  isConfigured: () => backendConfig.configured,

  async getSession() {
    const client = requireSupabase()
    const { data, error } = await client.auth.getSession()
    if (error) fail('세션 조회 실패', error)
    return data.session
  },

  async getUser() {
    return requireUser()
  },

  /** Convenient for local two-browser MVP testing when anonymous auth is enabled. */
  async signInAnonymously() {
    const client = requireSupabase()
    const { data, error } = await client.auth.signInAnonymously()
    if (error) fail('익명 로그인 실패', error)
    return data
  },

  async signInWithKakao(redirectTo?: string) {
    const client = requireSupabase()
    const fallbackRedirect = typeof window === 'undefined'
      ? undefined
      : `${window.location.origin}/auth/callback`
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: redirectTo ?? fallbackRedirect,
        // MATCHPOINT collects its own nickname during onboarding and does not
        // require a Kakao email. Keep Kakao's consent screen to basic profile
        // fields so non-Biz Kakao apps can sign in without account_email.
        queryParams: { scope: 'profile_nickname profile_image' },
      },
    })
    if (error) fail('카카오 로그인 시작 실패', error)
    return data
  },

  /**
   * Sends a Supabase email OTP (or magic link, depending on project settings).
   * This is useful for local MVP verification before the Kakao provider is set up.
   */
  async signInWithEmailOtp(email: string, redirectTo?: string) {
    const client = requireSupabase()
    const fallbackRedirect = typeof window === 'undefined'
      ? undefined
      : `${window.location.origin}/auth/callback`
    const { data, error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: redirectTo ?? fallbackRedirect,
        shouldCreateUser: true,
      },
    })
    if (error) fail('이메일 인증번호 전송 실패', error)
    return data
  },

  /** Verifies the six-digit email OTP when the Supabase template uses `{{ .Token }}`. */
  async verifyEmailOtp(email: string, token: string) {
    const client = requireSupabase()
    const { data, error } = await client.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email',
    })
    if (error) fail('이메일 인증 실패', error)
    return data
  },

  async signOut() {
    const client = requireSupabase()
    const { error } = await client.auth.signOut()
    if (error) fail('로그아웃 실패', error)
  },

  onAuthStateChange(handler: (state: BackendAuthState) => void): () => void {
    if (!supabase) return () => undefined
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      handler({ event, session })
    })
    return () => data.subscription.unsubscribe()
  },
}

export const profileApi = {
  async getMine(): Promise<ProfileWithRatings | null> {
    const client = requireSupabase()
    const user = await requireUser()
    const [profileResult, ratingsResult] = await Promise.all([
      client.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      client.from('player_ratings').select('*').eq('profile_id', user.id).order('sport'),
    ])
    if (profileResult.error) fail('프로필 조회 실패', profileResult.error)
    if (ratingsResult.error) fail('레이팅 조회 실패', ratingsResult.error)
    if (!profileResult.data) return null
    return { profile: profileResult.data, ratings: ratingsResult.data ?? [] }
  },

  async upsert(input: {
    nickname: string
    avatarUrl?: string | null
    interests: SportId[]
  }): Promise<Profile> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('save_my_profile', {
      p_nickname: input.nickname.trim(),
      p_interests: input.interests,
      p_avatar_url: input.avatarUrl ?? null,
    })
    if (error) failProfile('프로필 저장 실패', error)
    return data
  },

  async isNicknameAvailable(nickname: string): Promise<boolean> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('is_nickname_available', {
      p_nickname: nickname.trim(),
    })
    if (error) failProfile('닉네임 확인 실패', error)
    return data
  },

  async update(input: {
    nickname?: string
    avatarUrl?: string | null
    interests?: SportId[]
  }): Promise<Profile> {
    const current = await this.getMine()
    if (!current) fail('프로필 수정 실패', new Error('프로필을 찾을 수 없습니다.'))
    return this.upsert({
      nickname: input.nickname ?? current.profile.nickname,
      avatarUrl: input.avatarUrl,
      interests: input.interests ?? current.profile.interests,
    })
  },
}

export const achievementApi = {
  async listMine(): Promise<BackendAchievement[]> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('get_my_achievements')
    if (error) fail('도전과제 조회 실패', error)
    return (data ?? []).map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      icon: row.icon,
      rewardTitle: row.reward_title,
      rarity: row.rarity,
      target: row.target,
      progress: row.progress,
      unlockedAt: row.unlocked_at,
      equipped: row.equipped,
    }))
  },

  async equip(code: string | null): Promise<string | null> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('equip_my_title', {
      p_achievement_code: code,
    })
    if (error) fail('칭호 장착 실패', error)
    return data
  },
}

export const venueApi = {
  async list(options: { sport?: SportId; includeInactive?: boolean } = {}): Promise<Venue[]> {
    const client = requireSupabase()
    let query = client.from('venues').select('*').order('name')
    if (!options.includeInactive) query = query.eq('active', true)
    if (options.sport) query = query.contains('sports', [options.sport])
    const { data, error } = await query
    if (error) fail('체육관 조회 실패', error)
    return data ?? []
  },

  async get(id: string): Promise<Venue | null> {
    const client = requireSupabase()
    const { data, error } = await client.from('venues').select('*').eq('id', id).maybeSingle()
    if (error) fail('체육관 상세 조회 실패', error)
    return data
  },

  async listOpenSlots(
    venueId: string,
    options: { from?: Date | string; to?: Date | string } = {},
  ): Promise<VenueSlot[]> {
    const client = requireSupabase()
    const asIso = (value: Date | string) => value instanceof Date ? value.toISOString() : value
    let query = client
      .from('venue_slots')
      .select(VENUE_SLOT_COLUMNS)
      .eq('venue_id', venueId)
      .eq('status', 'open')
      .order('starts_at')
    query = query.gte('starts_at', options.from ? asIso(options.from) : new Date().toISOString())
    if (options.to) query = query.lte('starts_at', asIso(options.to))
    const { data, error } = await query
    if (error) fail('예약 가능 시간 조회 실패', error)
    return data ?? []
  },
}

export const queueApi = {
  async join(input: JoinQueueInput): Promise<JoinQueueResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('join_match_queue', {
      p_sport: input.sport,
      p_mode: input.mode,
      p_venue_id: input.venueId ?? null,
      p_lat: input.location?.lat ?? null,
      p_lng: input.location?.lng ?? null,
    })
    if (error) fail('매칭 큐 참가 실패', error)
    const raw = data ?? null
    const value = jsonObject(raw)
    const queueEntry = value ? jsonObject(value.queue_entry ?? null) : null
    return {
      queueEntryId:
        jsonString(queueEntry?.id)
        ?? jsonString(value?.queue_entry_id)
        ?? jsonString(value?.queueEntryId),
      matchId: jsonString(value?.match_id) ?? jsonString(value?.matchId) ?? null,
      status: jsonString(value?.status),
      raw,
    }
  },

  async cancel(): Promise<boolean> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('cancel_match_queue')
    if (error) fail('매칭 큐 취소 실패', error)
    return data
  },

  async getLatestMine(): Promise<TableRow<'queue_entries'> | null> {
    const client = requireSupabase()
    const user = await requireUser()
    const { data, error } = await client
      .from('queue_entries')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) fail('내 매칭 큐 조회 실패', error)
    return data
  },

  subscribeMine(
    userId: string,
    onChange: (change: RealtimeRowChange<TableRow<'queue_entries'>>) => void,
    onStatus?: (status: BackendRealtimeStatus) => void,
  ): () => void {
    if (!supabase) {
      onStatus?.('DISABLED')
      return () => undefined
    }
    const client = supabase
    const channel = client
      .channel(`queue:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queue_entries', filter: `user_id=eq.${userId}` },
        (payload) => onChange(toRealtimeChange<TableRow<'queue_entries'>>(
          payload as RealtimePostgresChangesPayload<TableRow<'queue_entries'>>,
        )),
      )
      .subscribe((status) => onStatus?.(status))
    return () => { void client.removeChannel(channel) }
  },
}

async function findCurrentMatch(userId: string): Promise<Match | null> {
  const client = requireSupabase()
  const memberships = await client
    .from('match_members')
    .select('match_id, joined_at, completed_at')
    .eq('user_id', userId)
    .is('completed_at', null)
    .order('joined_at', { ascending: false })
    .limit(20)
  if (memberships.error) fail('매칭 참가 정보 조회 실패', memberships.error)
  const ids = [...new Set((memberships.data ?? []).map((row) => row.match_id))]
  if (ids.length === 0) return null
  const result = await client
    .from('matches')
    .select('*')
    .in('id', ids)
    .neq('phase', 'canceled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) fail('현재 매칭 조회 실패', result.error)
  return result.data
}

async function hydrateMatch(match: Match): Promise<CurrentMatch> {
  const client = requireSupabase()
  const [membersResult, messagesResult, slotVotesResult, resultVotesResult, honorsResult] = await Promise.all([
    client.from('match_members').select('*').eq('match_id', match.id).order('joined_at'),
    client.from('chat_messages').select('*').eq('match_id', match.id).order('created_at'),
    client.from('slot_votes').select('*').eq('match_id', match.id),
    client.from('result_votes').select('*').eq('match_id', match.id),
    client.from('match_honors').select('*').eq('match_id', match.id),
  ])
  if (membersResult.error) fail('매칭 참가자 조회 실패', membersResult.error)
  if (messagesResult.error) fail('채팅 조회 실패', messagesResult.error)
  if (slotVotesResult.error) fail('시간 투표 조회 실패', slotVotesResult.error)
  if (resultVotesResult.error) fail('결과 투표 조회 실패', resultVotesResult.error)
  if (honorsResult.error) fail('경기 명예 조회 실패', honorsResult.error)

  const members = membersResult.data ?? []
  const userIds = members.map((member) => member.user_id)
  const [profilesResult, ratingsResult, venueResult, slotResult] = await Promise.all([
    userIds.length
      ? client.from('profiles').select('*').in('id', userIds)
      : Promise.resolve({ data: [] as Profile[], error: null }),
    userIds.length
      ? client.from('player_ratings').select('*').in('profile_id', userIds)
      : Promise.resolve({ data: [] as PlayerRating[], error: null }),
    match.venue_id
      ? client.from('venues').select('*').eq('id', match.venue_id).maybeSingle()
      : Promise.resolve({ data: null as Venue | null, error: null }),
    match.confirmed_slot_id
      ? client.from('venue_slots').select(VENUE_SLOT_COLUMNS).eq('id', match.confirmed_slot_id).maybeSingle()
      : Promise.resolve({ data: null as VenueSlot | null, error: null }),
  ])
  if (profilesResult.error) fail('참가자 프로필 조회 실패', profilesResult.error)
  if (ratingsResult.error) fail('참가자 레이팅 조회 실패', ratingsResult.error)
  if (venueResult.error) fail('매칭 체육관 조회 실패', venueResult.error)
  if (slotResult.error) fail('확정 시간 조회 실패', slotResult.error)

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]))
  const ratings = ratingsResult.data ?? []
  return {
    match,
    venue: venueResult.data,
    confirmedSlot: slotResult.data,
    players: members.map((member) => ({
      ...member,
      profile: profiles.get(member.user_id) ?? null,
      ratings: ratings.filter((rating) => rating.profile_id === member.user_id),
    })),
    messages: messagesResult.data ?? [],
    slotVotes: slotVotesResult.data ?? [],
    resultVotes: resultVotesResult.data ?? [],
    honors: honorsResult.data ?? [],
  }
}

export const matchApi = {
  async getCurrent(): Promise<CurrentMatch | null> {
    const user = await requireUser()
    const match = await findCurrentMatch(user.id)
    return match ? hydrateMatch(match) : null
  },

  async get(id: string): Promise<CurrentMatch | null> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.from('matches').select('*').eq('id', id).maybeSingle()
    if (error) fail('매칭 조회 실패', error)
    return data ? hydrateMatch(data) : null
  },

  async setTeams(matchId: string, teamA: string[], teamB: string[]): Promise<MatchMutationResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('set_match_teams', {
      p_match_id: matchId,
      p_team_a: teamA,
      p_team_b: teamB,
    })
    if (error) fail('팀 구성 저장 실패', error)
    const raw = data ?? null
    return { matchId, phase: jsonString(jsonObject(raw)?.phase), raw }
  },

  async setReady(matchId: string, ready: boolean): Promise<MatchMutationResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('set_match_ready', {
      p_match_id: matchId,
      p_ready: ready,
    })
    if (error) fail('준비 상태 저장 실패', error)
    const raw = data ?? null
    return { matchId, phase: jsonString(jsonObject(raw)?.phase), raw }
  },

  async confirmAttendance(matchId: string): Promise<MatchMutationResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('confirm_match_attendance', {
      p_match_id: matchId,
    })
    if (error) fail('참가 확정 실패', error)
    const raw = data ?? null
    return { matchId, phase: jsonString(jsonObject(raw)?.phase), raw }
  },

  async openReporting(matchId: string): Promise<MatchMutationResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('open_match_reporting', {
      p_match_id: matchId,
    })
    if (error) fail('결과 입력 시작 실패', error)
    const raw = data ?? null
    return { matchId, phase: jsonString(jsonObject(raw)?.phase), raw }
  },

  async complete(matchId: string): Promise<MatchMutationResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('complete_match', {
      p_match_id: matchId,
    })
    if (error) fail('경기 종료 실패', error)
    const raw = data ?? null
    return { matchId, phase: jsonString(jsonObject(raw)?.phase), raw }
  },

  subscribe(matchId: string, handlers: MatchRealtimeHandlers): () => void {
    if (!supabase) {
      handlers.onStatus?.('DISABLED')
      return () => undefined
    }
    const client = supabase
    const channel = client
      .channel(`match:${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => handlers.onMatch?.(toRealtimeChange<Match>(
          payload as RealtimePostgresChangesPayload<Match>,
        )),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_members', filter: `match_id=eq.${matchId}` },
        (payload) => handlers.onMember?.(toRealtimeChange<MatchMember>(
          payload as RealtimePostgresChangesPayload<MatchMember>,
        )),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `match_id=eq.${matchId}` },
        (payload) => handlers.onMessage?.(toRealtimeChange<ChatMessage>(
          payload as RealtimePostgresChangesPayload<ChatMessage>,
        )),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slot_votes', filter: `match_id=eq.${matchId}` },
        (payload) => handlers.onSlotVote?.(toRealtimeChange<SlotVote>(
          payload as RealtimePostgresChangesPayload<SlotVote>,
        )),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'result_votes', filter: `match_id=eq.${matchId}` },
        (payload) => handlers.onResultVote?.(toRealtimeChange<ResultVote>(
          payload as RealtimePostgresChangesPayload<ResultVote>,
        )),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_honors', filter: `match_id=eq.${matchId}` },
        (payload) => handlers.onHonor?.(toRealtimeChange<MatchHonor>(
          payload as RealtimePostgresChangesPayload<MatchHonor>,
        )),
      )
      .subscribe((status) => handlers.onStatus?.(status))
    return () => { void client.removeChannel(channel) }
  },
}

export const historyApi = {
  async listMine(limit = 30): Promise<BackendMatchHistory[]> {
    const client = requireSupabase()
    const user = await requireUser()
    const memberships = await client
      .from('match_members')
      .select('match_id')
      .eq('user_id', user.id)
      .limit(Math.max(limit * 3, 60))
    if (memberships.error) fail('내 경기 참가 기록 조회 실패', memberships.error)
    const ids = [...new Set((memberships.data ?? []).map((row) => row.match_id))]
    if (ids.length === 0) return []

    const matchesResult = await client
      .from('matches')
      .select('*')
      .in('id', ids)
      .not('finalized_at', 'is', null)
      .not('winner_team', 'is', null)
      .order('finalized_at', { ascending: false })
      .limit(limit)
    if (matchesResult.error) fail('완료 경기 조회 실패', matchesResult.error)
    const matches = matchesResult.data ?? []
    if (matches.length === 0) return []

    const matchIds = matches.map((match) => match.id)
    const membersResult = await client
      .from('match_members')
      .select('*')
      .in('match_id', matchIds)
      .order('joined_at')
    if (membersResult.error) fail('완료 경기 참가자 조회 실패', membersResult.error)
    const members = membersResult.data ?? []
    return matches.map((match) => ({
      match,
      members: members.filter((member) => member.match_id === match.id),
    }))
  },
}

export const notificationApi = {
  async listMine(limit = 50): Promise<Notification[]> {
    const client = requireSupabase()
    const user = await requireUser()
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) fail('알림 조회 실패', error)
    return data ?? []
  },

  async markAllRead(): Promise<void> {
    const client = requireSupabase()
    const user = await requireUser()
    const { error } = await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null)
    if (error) fail('알림 읽음 처리 실패', error)
  },

  subscribeMine(
    userId: string,
    onChange: (change: RealtimeRowChange<Notification>) => void,
    onStatus?: (status: BackendRealtimeStatus) => void,
  ): () => void {
    if (!supabase) {
      onStatus?.('DISABLED')
      return () => undefined
    }
    const client = supabase
    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => onChange(toRealtimeChange<Notification>(
          payload as RealtimePostgresChangesPayload<Notification>,
        )),
      )
      .subscribe((status) => onStatus?.(status))
    return () => { void client.removeChannel(channel) }
  },
}

export const messageApi = {
  async list(matchId: string, options: { limit?: number; before?: string } = {}): Promise<ChatMessage[]> {
    const client = requireSupabase()
    let query = client
      .from('chat_messages')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(options.limit ?? 100)
    if (options.before) query = query.lt('created_at', options.before)
    const { data, error } = await query
    if (error) fail('채팅 조회 실패', error)
    return (data ?? []).reverse()
  },

  async send(matchId: string, body: string): Promise<ChatMessage> {
    const client = requireSupabase()
    const user = await requireUser()
    const trimmed = body.trim()
    if (!trimmed) throw new Error('메시지를 입력해 주세요.')
    const row: TableInsert<'chat_messages'> = {
      match_id: matchId,
      sender_id: user.id,
      body: trimmed,
    }
    const { data, error } = await client.from('chat_messages').insert(row).select('*').single()
    if (error) fail('메시지 전송 실패', error)
    return data
  },
}

export const voteApi = {
  async slot(matchId: string, venueSlotId: string): Promise<SlotVoteResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('vote_match_slot', {
      p_match_id: matchId,
      p_venue_slot_id: venueSlotId,
    })
    if (error) fail('시간 투표 실패', error)
    const raw = data ?? null
    const value = jsonObject(raw)
    const consensus = jsonBoolean(value?.consensus)
    return {
      matchId,
      confirmedSlotId:
        consensus
          ? jsonString(value?.venue_slot_id)
            ?? jsonString(value?.confirmed_slot_id)
            ?? jsonString(value?.confirmedSlotId)
            ?? null
          : null,
      consensus,
      phase: jsonString(value?.phase),
      raw,
    }
  },

  async result(
    matchId: string,
    winnerTeam: MatchTeam,
    score: string,
  ): Promise<ResultVoteResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('vote_match_result', {
      p_match_id: matchId,
      p_winner_team: winnerTeam,
      p_score: score,
    })
    if (error) fail('경기 결과 투표 실패', error)
    const raw = data ?? null
    const value = jsonObject(raw)
    const rawWinner = jsonString(value?.winner_team) ?? jsonString(value?.winnerTeam)
    return {
      matchId,
      winnerTeam: rawWinner === 'a' || rawWinner === 'b' ? rawWinner : null,
      consensus: jsonBoolean(value?.consensus),
      finalized: jsonBoolean(value?.finalized) ?? jsonBoolean(value?.consensus),
      raw,
    }
  },
}

export const reportApi = {
  async create(input: {
    reportedId: string
    matchId: string
    reason: string
    details?: string | null
  }): Promise<Report> {
    const client = requireSupabase()
    const user = await requireUser()
    if (user.id === input.reportedId) throw new Error('본인은 신고할 수 없습니다.')
    const row: TableInsert<'reports'> = {
      reporter_id: user.id,
      reported_id: input.reportedId,
      match_id: input.matchId,
      reason: input.reason,
      details: input.details?.trim() || null,
    }
    const { data, error } = await client.from('reports').insert(row).select('*').single()
    if (error) fail('신고 접수 실패', error)
    return data
  },
}

export const honorApi = {
  async give(matchId: string, receiverId: string, honorType: HonorType): Promise<GiveHonorResult> {
    const client = requireSupabase()
    await requireUser()
    const { data, error } = await client.rpc('give_match_honor', {
      p_match_id: matchId,
      p_receiver_id: receiverId,
      p_honor_type: honorType,
    })
    if (error) fail('명예 전달 실패', error)
    const raw = data ?? null
    const value = jsonObject(raw)
    return {
      matchId: jsonString(value?.match_id) ?? matchId,
      receiverId: jsonString(value?.receiver_id) ?? receiverId,
      honorType: (jsonString(value?.honor_type) as HonorType | undefined) ?? honorType,
      created: jsonBoolean(value?.created) ?? false,
      raw,
    }
  },
}

/** Single import point for feature/store integration. */
export const backendApi = {
  auth: authApi,
  profile: profileApi,
  venues: venueApi,
  queue: queueApi,
  matches: matchApi,
  history: historyApi,
  notifications: notificationApi,
  messages: messageApi,
  votes: voteApi,
  reports: reportApi,
  honors: honorApi,
  achievements: achievementApi,
}

export type { ChatMessage, CurrentMatch, Match, MatchHonor, MatchMember, ResultVote, SlotVote }
