import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import {
  authApi, backendApi, backendConfig,
  type CurrentMatch, type ProfileWithRatings, type QueueEntry, type VenueSlot,
} from '../backend'
import { encodeSlot } from '../lib/game'
import { useApp } from '../store/useApp'
import type { Account, Match, MatchPhase, Player, SportId } from '../types'

interface BackendRuntime {
  enabled: boolean
  ready: boolean
  user: User | null
  profileReady: boolean
  error: string | null
  signInAnonymously: () => Promise<void>
  signInWithKakao: () => Promise<void>
  sendEmailOtp: (email: string) => Promise<void>
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  signOut: () => Promise<void>
  saveProfile: (nickname: string, interests: SportId[]) => Promise<void>
  refresh: () => Promise<void>
}

const BackendContext = createContext<BackendRuntime | null>(null)

const SPORTS: SportId[] = ['tennis', 'badminton', 'tabletennis', 'basketball']
const MATCH_PHASES: MatchPhase[] = [
  'queue', 'scheduling', 'teaming', 'payment', 'confirmed', 'reporting', 'done',
]

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '백엔드 요청 중 오류가 발생했습니다.'
}

function emptyPlayer(id: string): Player {
  return {
    id,
    nickname: '',
    avatar: '🦖',
    elo: { tennis: 1200, badminton: 1200, tabletennis: 1200, basketball: 1200 },
    stickers: 0,
    wins: 0,
    losses: 0,
    isMe: true,
  }
}

function playerFromProfile(
  value: ProfileWithRatings,
  currentUserId: string,
): { account: Account; player: Player } {
  const elo: Player['elo'] = {
    tennis: 1200,
    badminton: 1200,
    tabletennis: 1200,
    basketball: 1200,
  }
  for (const rating of value.ratings) {
    if (SPORTS.includes(rating.sport as SportId)) elo[rating.sport as SportId] = rating.rating
  }
  const interests = value.profile.interests.filter((sport): sport is SportId =>
    SPORTS.includes(sport as SportId),
  )
  return {
    account: {
      name: '', birth: '', carrier: '', phone: '',
      nickname: value.profile.nickname,
      interests,
    },
    player: {
      id: value.profile.id,
      nickname: value.profile.nickname,
      // MVP에서는 avatar_url 컬럼을 이모지 문자열로도 사용한다.
      avatar: value.profile.avatar_url || '🦖',
      elo,
      stickers: 0,
      wins: value.ratings.reduce((sum, rating) => sum + rating.wins, 0),
      losses: value.ratings.reduce((sum, rating) => sum + rating.losses, 0),
      isMe: value.profile.id === currentUserId,
    },
  }
}

function numericSlot(iso: string): number | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  const offset = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (offset < 0 || offset > 30) return null
  return encodeSlot(offset, at.getHours())
}

function slotMaps(slots: VenueSlot[], confirmed: VenueSlot | null) {
  const slotIds: Record<number, string> = {}
  const idToSlot = new Map<string, number>()
  for (const slot of confirmed ? [...slots, confirmed] : slots) {
    const value = numericSlot(slot.starts_at)
    if (value === null) continue
    slotIds[value] = slot.id
    idToSlot.set(slot.id, value)
  }
  return { slotIds, idToSlot }
}

function matchFromBackend(
  snapshot: CurrentMatch,
  currentUserId: string,
  slots: VenueSlot[],
  previous: Match | null,
): { match: Match; slotIds: Record<number, string> } {
  const { slotIds, idToSlot } = slotMaps(slots, snapshot.confirmedSlot)
  const players: Player[] = snapshot.players.map((member) => {
    const elo: Player['elo'] = {
      tennis: 1200,
      badminton: 1200,
      tabletennis: 1200,
      basketball: 1200,
    }
    for (const rating of member.ratings) {
      if (SPORTS.includes(rating.sport as SportId)) elo[rating.sport as SportId] = rating.rating
    }
    return {
      id: member.user_id,
      nickname: member.profile?.nickname ?? '플레이어',
      avatar: member.profile?.avatar_url || '🦖',
      elo,
      stickers: 0,
      wins: member.ratings.reduce((sum, rating) => sum + rating.wins, 0),
      losses: member.ratings.reduce((sum, rating) => sum + rating.losses, 0),
      isMe: member.user_id === currentUserId,
    }
  })
  const phase = MATCH_PHASES.includes(snapshot.match.phase as MatchPhase)
    ? snapshot.match.phase as MatchPhase
    : 'scheduling'
  const votes: Record<string, number> = {}
  for (const vote of snapshot.slotVotes) {
    const value = idToSlot.get(vote.venue_slot_id)
    if (value !== undefined) votes[vote.user_id] = value
  }
  const resultVotes: Record<string, 'a' | 'b'> = {}
  for (const vote of snapshot.resultVotes) {
    if (vote.winner_team === 'a' || vote.winner_team === 'b') {
      resultVotes[vote.user_id] = vote.winner_team
    }
  }
  const members = snapshot.players
  const meMember = members.find((member) => member.user_id === currentUserId)
  const winner = snapshot.match.winner_team === 'a' || snapshot.match.winner_team === 'b'
    ? snapshot.match.winner_team
    : null
  const confirmedSlot = snapshot.match.confirmed_slot_id
    ? idToSlot.get(snapshot.match.confirmed_slot_id) ?? null
    : null

  return {
    slotIds,
    match: {
      id: snapshot.match.id,
      venueId: snapshot.match.venue_id ?? '',
      quick: snapshot.match.quick,
      venueName: snapshot.venue?.name,
      venuePricePerHour: snapshot.venue?.price_per_hour,
      sport: snapshot.match.sport as SportId,
      mode: snapshot.match.mode as Match['mode'],
      capacity: snapshot.match.capacity,
      hostId: snapshot.match.host_id,
      players,
      phase,
      votes,
      confirmedSlot,
      confirmedSlotEndsAt: snapshot.confirmedSlot
        ? new Date(snapshot.confirmedSlot.ends_at).getTime()
        : undefined,
      payments: Object.fromEntries(members.map((member) => [member.user_id, member.paid])),
      chat: snapshot.messages.map((message) => ({
        id: message.id,
        playerId: message.sender_id ?? 'system',
        text: message.body,
        at: new Date(message.created_at).getTime(),
        system: message.system,
      })),
      teams: {
        a: members.filter((member) => member.team === 'a').map((member) => member.user_id),
        b: members.filter((member) => member.team === 'b').map((member) => member.user_id),
      },
      teamReady: Object.fromEntries(members.map((member) => [member.user_id, member.ready])),
      reports: previous?.id === snapshot.match.id ? previous.reports : {},
      resultVotes,
      result: winner
        ? {
            winner,
            score: snapshot.match.score ?? '-',
            delta: meMember?.rating_delta ?? 0,
          }
        : null,
      stickersGiven: previous?.id === snapshot.match.id ? previous.stickersGiven : [],
      createdAt: new Date(snapshot.match.created_at).getTime(),
    },
  }
}

function queuePlaceholder(entry: QueueEntry, me: Player): Match {
  return {
    id: `queue:${entry.id}`,
    venueId: entry.venue_id ?? '',
    quick: entry.quick,
    sport: entry.sport as SportId,
    mode: entry.mode as Match['mode'],
    capacity: entry.capacity,
    hostId: me.id,
    players: [me],
    phase: 'queue',
    votes: {},
    confirmedSlot: null,
    payments: {},
    chat: [],
    teams: { a: [], b: [] },
    teamReady: {},
    reports: {},
    resultVotes: {},
    result: null,
    stickersGiven: [],
    createdAt: new Date(entry.created_at).getTime(),
  }
}

export function BackendProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!backendConfig.configured)
  const [profileReady, setProfileReady] = useState(!backendConfig.configured)
  const [error, setError] = useState<string | null>(null)
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null)
  const sessionUserId = useRef<string | null>(null)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const refreshQueued = useRef(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backendRefreshVersion = useApp((state) => state.backendRefreshVersion)

  const refresh = useCallback(async () => {
    if (!backendConfig.configured || !session?.user) return
    refreshQueued.current = true
    if (refreshInFlight.current) return refreshInFlight.current

    const userId = session.user.id

    const task = (async () => {
      while (refreshQueued.current && sessionUserId.current === userId) {
        refreshQueued.current = false
        try {
          const profile = await backendApi.profile.getMine()
          if (sessionUserId.current !== userId) return
          if (!profile) {
            const me = emptyPlayer(userId)
            useApp.setState({
              account: null,
              me,
              match: null,
              backendUserId: userId,
              backendStatus: 'ready',
              backendError: null,
              backendSlotIds: {},
            })
            setCurrentMatchId(null)
            setProfileReady(false)
            setError(null)
            continue
          }

          const mapped = playerFromProfile(profile, userId)
          const snapshot = await backendApi.matches.getCurrent()
          if (sessionUserId.current !== userId) return
          if (snapshot) {
            const slots = snapshot.match.venue_id
              ? await backendApi.venues.listOpenSlots(snapshot.match.venue_id)
              : []
            if (sessionUserId.current !== userId) return
            const current = useApp.getState().match
            const live = matchFromBackend(snapshot, userId, slots, current)
            useApp.setState({
              account: mapped.account,
              me: mapped.player,
              match: live.match,
              backendUserId: userId,
              backendStatus: 'ready',
              backendError: null,
              backendSlotIds: live.slotIds,
            })
            setCurrentMatchId(snapshot.match.id)
          } else {
            const queue = await backendApi.queue.getLatestMine()
            if (sessionUserId.current !== userId) return
            const waiting = queue && ['waiting', 'matching'].includes(queue.status)
            useApp.setState({
              account: mapped.account,
              me: mapped.player,
              match: waiting ? queuePlaceholder(queue, mapped.player) : null,
              backendUserId: userId,
              backendStatus: 'ready',
              backendError: null,
              backendSlotIds: {},
            })
            setCurrentMatchId(null)
          }
          setProfileReady(true)
          setError(null)
        } catch (caught) {
          if (sessionUserId.current !== userId) return
          const message = messageOf(caught)
          setError(message)
          useApp.setState({ backendStatus: 'error', backendError: message })
        } finally {
          if (sessionUserId.current === userId) setReady(true)
        }
      }
    })()
    refreshInFlight.current = task
    try {
      await task
    } finally {
      if (refreshInFlight.current === task) refreshInFlight.current = null
    }
    // 마지막 요청이 끝나는 경계에서 들어온 이벤트도 한 번 더 서버 상태로 수렴시킨다.
    if (refreshQueued.current && sessionUserId.current === userId) await refresh()
  }, [session?.user?.id])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { void refresh() }, 80)
  }, [refresh])

  useEffect(() => {
    if (!backendConfig.configured) {
      useApp.setState({ backendStatus: 'demo' })
      return
    }
    let active = true
    useApp.setState({ backendStatus: 'loading' })
    void authApi.getSession().then((next) => {
      if (!active) return
      sessionUserId.current = next?.user.id ?? null
      setSession(next)
      if (!next) {
        setReady(true)
        setProfileReady(false)
        useApp.setState({
          account: null,
          match: null,
          backendUserId: null,
          backendStatus: 'ready',
          backendSlotIds: {},
        })
      }
    }).catch((caught) => {
      if (!active) return
      const message = messageOf(caught)
      setError(message)
      setReady(true)
      useApp.setState({ backendStatus: 'error', backendError: message })
    })
    const unsubscribe = authApi.onAuthStateChange(({ session: next }) => {
      if (!active) return
      const nextUserId = next?.user.id ?? null
      const userChanged = sessionUserId.current !== nextUserId
      sessionUserId.current = nextUserId
      setSession(next)
      if (!next) {
        refreshQueued.current = false
        setReady(true)
        setProfileReady(false)
        useApp.getState().reset()
        useApp.setState({ backendStatus: 'ready', backendUserId: null })
      } else if (userChanged) {
        setReady(false)
        setProfileReady(false)
        useApp.setState({ backendStatus: 'loading', backendError: null })
      }
    })
    return () => {
      active = false
      unsubscribe()
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!session?.user) return
    void refresh()
  }, [session?.user?.id, backendRefreshVersion, refresh])

  useEffect(() => {
    if (!session?.user) return
    // Realtime 연결이 잠시 끊겨도 큐와 진행 중 매치가 결국 서버 상태로 수렴한다.
    //
    // 매치 밖에서는 Realtime 구독이 이미 변경을 즉시 받아오므로 폴링은 보험일 뿐이다.
    // 2.5초로 두면 앱을 켜 두기만 해도 탭당 시간당 수천 건이 쌓여 무료 플랜 전송량을
    // 갉아먹기 때문에, 유휴 상태는 30초로 늦추고 매치 중에만 5초를 유지한다.
    // 또한 탭이 백그라운드일 때는 폴링을 멈추고, 다시 보일 때 한 번 따라잡는다.
    const period = currentMatchId ? 5_000 : 30_000
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) return
      timer = setInterval(() => { void refresh() }, period)
    }
    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        start()
      } else {
        stop()
      }
    }

    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [session?.user?.id, currentMatchId, refresh])

  useEffect(() => {
    if (!currentMatchId) return
    // Realtime 변경은 관련 테이블을 함께 다시 읽어 원자적인 화면 스냅샷으로 교체한다.
    return backendApi.matches.subscribe(currentMatchId, {
      onMatch: scheduleRefresh,
      onMember: scheduleRefresh,
      onMessage: scheduleRefresh,
      onSlotVote: scheduleRefresh,
      onResultVote: scheduleRefresh,
      onStatus: (status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          useApp.setState({ backendError: `실시간 연결 상태: ${status}` })
        }
      },
    })
  }, [currentMatchId, scheduleRefresh])

  const value = useMemo<BackendRuntime>(() => ({
    enabled: backendConfig.configured,
    ready,
    user: session?.user ?? null,
    profileReady,
    error,
    signInAnonymously: async () => {
      setError(null)
      const data = await authApi.signInAnonymously()
      sessionUserId.current = data.session?.user.id ?? null
      setSession(data.session)
    },
    signInWithKakao: async () => {
      setError(null)
      await authApi.signInWithKakao()
    },
    sendEmailOtp: async (email) => {
      setError(null)
      await authApi.signInWithEmailOtp(email)
    },
    verifyEmailOtp: async (email, token) => {
      setError(null)
      const data = await authApi.verifyEmailOtp(email, token)
      sessionUserId.current = data.session?.user.id ?? null
      setSession(data.session)
    },
    signOut: async () => {
      await authApi.signOut()
      sessionUserId.current = null
      setSession(null)
      setProfileReady(false)
      useApp.getState().reset()
    },
    saveProfile: async (nickname, interests) => {
      await backendApi.profile.upsert({ nickname, interests, avatarUrl: '🦖' })
      await refresh()
    },
    refresh,
  }), [ready, session, profileReady, error, refresh])

  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
}

export function useBackend(): BackendRuntime {
  const value = useContext(BackendContext)
  if (!value) throw new Error('useBackend must be used inside BackendProvider')
  return value
}
