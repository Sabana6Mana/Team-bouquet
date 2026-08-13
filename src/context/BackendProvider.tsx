import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import {
  authApi, backendApi, backendConfig,
  type BackendMatchHistory, type BossMatchStartResult, type CurrentMatch, type Notification,
  type ProfileWithRatings, type QueueEntry, type VenueSlot,
} from '../backend'
import { encodeSlot } from '../lib/game'
import { forcedDemo } from '../lib/forcedDemo'
import { titleForAchievement } from '../data/achievements'
import type { GameplayOutcome, GameplaySummary } from '../data/gameplay'
import { isAvatarImageUrl } from '../data/characters'
import { useApp } from '../store/useApp'
import type {
  AchievementProgress, Account, AppNotification, HonorCounts, Match, MatchPhase, MatchRecord, Player, SportId,
} from '../types'

interface BackendRuntime {
  /** Supabase 가 설정돼 있는지. 로그인·프로필 흐름이 이 값을 본다. */
  enabled: boolean
  /** 카카오 콘솔과 Supabase Provider 설정까지 끝났는지 나타내는 공개 플래그. */
  kakaoEnabled: boolean
  /** 현재 세션이 SMS OTP로 전화번호 소유 확인을 마쳤는지. */
  phoneVerified: boolean
  /**
   * 지금 매치를 서버가 굴리고 있는지.
   * 화면 확인용 테스트 매치 중에는 false 가 되어, 매칭 화면들이 NPC 데모 흐름을 그린다.
   */
  liveMatch: boolean
  ready: boolean
  user: User | null
  profileReady: boolean
  achievements: AchievementProgress[]
  achievementsReady: boolean
  /** 경기 완료로 갱신되는 지역 도감·주간 보스·시즌 퀘스트 읽기 모델. */
  gameplay: GameplaySummary | null
  /** 현재 결과 화면에서 보여 줄 이번 경기의 게임 보상 변화량. */
  gameplayOutcome: GameplayOutcome | null
  error: string | null
  signInAnonymously: () => Promise<void>
  signInWithKakao: () => Promise<void>
  sendEmailOtp: (email: string) => Promise<void>
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  sendPhoneOtp: (phone: string) => Promise<void>
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>
  signOut: () => Promise<void>
  checkNickname: (nickname: string) => Promise<boolean>
  saveProfile: (nickname: string, interests: SportId[], avatarUrl?: string | null) => Promise<void>
  startBossMatch: (eventId: string) => Promise<BossMatchStartResult>
  equipTitle: (achievementCode: string | null) => Promise<void>
  refresh: () => Promise<void>
}

const BackendContext = createContext<BackendRuntime | null>(null)

const SPORTS: SportId[] = ['tennis', 'badminton', 'tabletennis', 'basketball']
const EMPTY_HONORS: HonorCounts = { manner: 0, skill: 0, punctual: 0, fun: 0 }
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
    honorCounts: { ...EMPTY_HONORS },
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
  const avatarUrl = isAvatarImageUrl(value.profile.avatar_url)
    ? value.profile.avatar_url
    : null
  const titleCode = value.profile.equipped_title_code
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
      avatar: avatarUrl ? '🦖' : value.profile.avatar_url || '🦖',
      avatarUrl,
      elo,
      stickers: value.profile.honor_total,
      honorCounts: {
        manner: value.profile.honor_manner,
        skill: value.profile.honor_skill,
        punctual: value.profile.honor_punctual,
        fun: value.profile.honor_fun,
      },
      wins: value.ratings.reduce((sum, rating) => sum + rating.wins, 0),
      losses: value.ratings.reduce((sum, rating) => sum + rating.losses, 0),
      streak: Math.max(0, ...value.ratings.map((rating) => rating.current_streak)),
      bestStreak: Math.max(0, ...value.ratings.map((rating) => rating.best_streak)),
      titleCode,
      title: titleForAchievement(titleCode),
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
    const rawAvatar = member.profile?.avatar_url
    const avatarUrl = isAvatarImageUrl(rawAvatar) ? rawAvatar : null
    const titleCode = member.profile?.equipped_title_code ?? null
    return {
      id: member.user_id,
      nickname: member.profile?.nickname ?? '플레이어',
      avatar: avatarUrl ? '🦖' : rawAvatar || '🦖',
      avatarUrl,
      elo,
      stickers: member.profile?.honor_total ?? 0,
      honorCounts: member.profile
        ? {
            manner: member.profile.honor_manner,
            skill: member.profile.honor_skill,
            punctual: member.profile.honor_punctual,
            fun: member.profile.honor_fun,
          }
        : { ...EMPTY_HONORS },
      wins: member.ratings.reduce((sum, rating) => sum + rating.wins, 0),
      losses: member.ratings.reduce((sum, rating) => sum + rating.losses, 0),
      streak: Math.max(0, ...member.ratings.map((rating) => rating.current_streak)),
      bestStreak: Math.max(0, ...member.ratings.map((rating) => rating.best_streak)),
      titleCode,
      title: titleForAchievement(titleCode),
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
  const resultVoteScores: Record<string, string> = {}
  for (const vote of snapshot.resultVotes) {
    if (vote.winner_team === 'a' || vote.winner_team === 'b') {
      resultVotes[vote.user_id] = vote.winner_team
      resultVoteScores[vote.user_id] = vote.score ?? ''
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
      bossEventId: snapshot.match.boss_event_id ?? undefined,
      bossPlayerId: snapshot.match.boss_profile_id ?? undefined,
      sport: snapshot.match.sport as SportId,
      mode: snapshot.match.mode as Match['mode'],
      capacity: snapshot.match.capacity,
      hostId: snapshot.match.host_id,
      players,
      phase,
      acceptanceDeadline: snapshot.match.acceptance_deadline
        ? new Date(snapshot.match.acceptance_deadline).getTime()
        : undefined,
      accepted: Object.fromEntries(
        members.map((member) => [member.user_id, Boolean(member.accepted_at)]),
      ),
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
      resultVoteScores,
      result: winner
        ? {
            winner,
            score: snapshot.match.score ?? '-',
            delta: meMember?.rating_delta ?? 0,
          }
        : null,
      honorGiven: (() => {
        const honor = snapshot.honors.find((item) => item.giver_id === currentUserId)
        return honor ? { playerId: honor.receiver_id, type: honor.honor_type } : null
      })(),
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
    resultVoteScores: {},
    result: null,
    honorGiven: null,
    createdAt: new Date(entry.created_at).getTime(),
  }
}

function historyFromBackend(entries: BackendMatchHistory[], userId: string): MatchRecord[] {
  return entries.flatMap(({ match, members }) => {
    if (!match.winner_team || !match.finalized_at) return []
    const mine = members.find((member) => member.user_id === userId)
    return [{
      id: match.id,
      venueId: match.venue_id,
      sport: match.sport as SportId,
      mode: match.mode as MatchRecord['mode'],
      playedAt: new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' })
        .format(new Date(match.finalized_at)),
      winners: members.filter((member) => member.team === match.winner_team).map((member) => member.user_id),
      losers: members.filter((member) => member.team !== match.winner_team).map((member) => member.user_id),
      score: match.score ?? '-',
      eloDelta: mine?.rating_delta ?? 0,
      bossEventId: match.boss_event_id ?? undefined,
      bossPlayerId: match.boss_profile_id ?? undefined,
    }]
  })
}

function notificationsFromBackend(rows: Notification[]): AppNotification[] {
  return rows.map((notification) => ({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    at: new Date(notification.created_at).getTime(),
    read: Boolean(notification.read_at),
    link: notification.link ?? undefined,
  }))
}

export function BackendProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!backendConfig.configured)
  const [profileReady, setProfileReady] = useState(!backendConfig.configured)
  const [error, setError] = useState<string | null>(null)
  const [achievements, setAchievements] = useState<AchievementProgress[]>([])
  const [achievementsReady, setAchievementsReady] = useState(!backendConfig.configured)
  const [gameplay, setGameplay] = useState<GameplaySummary | null>(null)
  const [gameplayOutcome, setGameplayOutcome] = useState<GameplayOutcome | null>(null)
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null)
  const sessionUserId = useRef<string | null>(null)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const refreshQueued = useRef(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousUnlocks = useRef<Set<string> | null>(null)
  const backendRefreshVersion = useApp((state) => state.backendRefreshVersion)
  const testMatch = useApp((state) => state.testMatch)

  const refresh = useCallback(async () => {
    if (!backendConfig.configured || !session?.user) return
    // 테스트용 강제 데모 매치 중에는 서버 상태로 덮어쓰지 않는다.
    // 서버에는 없는 매치라, 한 번만 동기화돼도 테스트 매치가 사라진다.
    if (forcedDemo.active) return
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
            setAchievements([])
            setAchievementsReady(true)
            setGameplay(null)
            setGameplayOutcome(null)
            setError(null)
            continue
          }

          const mapped = playerFromProfile(profile, userId)
          const snapshot = await backendApi.matches.getCurrent()
          if (snapshot?.match.finalized_at) {
            // 선택 기능 오류가 경기/ELO 확정을 막지는 않으며, 다음 refresh에서 다시 시도한다.
            await backendApi.gameplay.syncMatch(snapshot.match.id).catch(() => null)
          }
          const [achievementList, historyList, notificationList, gameplaySummary] = await Promise.all([
            backendApi.achievements.listMine(),
            backendApi.history.listMine(),
            backendApi.notifications.listMine(),
            backendApi.gameplay.getSummary().catch(() => null),
          ])
          const currentGameplayOutcome = snapshot?.match.finalized_at
            ? await backendApi.gameplay.getMatchOutcome(snapshot.match.id, gameplaySummary).catch(() => null)
            : null
          if (sessionUserId.current !== userId) return
          const unlocked = new Set(
            achievementList.filter((achievement) => achievement.unlockedAt).map((achievement) => achievement.code),
          )
          if (previousUnlocks.current) {
            for (const achievement of achievementList) {
              if (achievement.unlockedAt && !previousUnlocks.current.has(achievement.code)) {
                useApp.getState().notify(
                  `도전과제 달성! ${achievement.icon}`,
                  `《${achievement.rewardTitle}》 칭호를 획득했습니다.`,
                  '/achievements',
                )
              }
            }
          }
          previousUnlocks.current = unlocked
          setAchievements(achievementList)
          setAchievementsReady(true)
          setGameplay(gameplaySummary)
          setGameplayOutcome(currentGameplayOutcome)
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
              history: historyFromBackend(historyList, userId),
              notifications: notificationsFromBackend(notificationList),
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
              history: historyFromBackend(historyList, userId),
              notifications: notificationsFromBackend(notificationList),
            })
            setCurrentMatchId(null)
          }
          setProfileReady(Boolean(profile.profile.onboarding_completed_at))
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
        setAchievements([])
        setAchievementsReady(true)
        setGameplay(null)
        setGameplayOutcome(null)
        previousUnlocks.current = null
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
        setGameplay(null)
        setGameplayOutcome(null)
        useApp.getState().reset()
        useApp.setState({ backendStatus: 'ready', backendUserId: null })
      } else if (userChanged) {
        setReady(false)
        setProfileReady(false)
        setAchievements([])
        setAchievementsReady(false)
        setGameplay(null)
        setGameplayOutcome(null)
        previousUnlocks.current = null
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
    if (!session?.user || currentMatchId) return
    return backendApi.queue.subscribeMine(session.user.id, scheduleRefresh, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        useApp.setState({ backendError: `매칭 실시간 연결 상태: ${status}` })
      }
    })
  }, [session?.user?.id, currentMatchId, scheduleRefresh])

  useEffect(() => {
    if (!session?.user) return
    return backendApi.notifications.subscribeMine(session.user.id, scheduleRefresh)
  }, [session?.user?.id, scheduleRefresh])

  useEffect(() => {
    if (!currentMatchId) return
    // Realtime 변경은 관련 테이블을 함께 다시 읽어 원자적인 화면 스냅샷으로 교체한다.
    return backendApi.matches.subscribe(currentMatchId, {
      onMatch: scheduleRefresh,
      onMember: scheduleRefresh,
      onMessage: scheduleRefresh,
      onSlotVote: scheduleRefresh,
      onResultVote: scheduleRefresh,
      onHonor: scheduleRefresh,
      onStatus: (status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          useApp.setState({ backendError: `실시간 연결 상태: ${status}` })
        }
      },
    })
  }, [currentMatchId, scheduleRefresh])

  const value = useMemo<BackendRuntime>(() => ({
    enabled: backendConfig.configured,
    kakaoEnabled: backendConfig.kakaoEnabled,
    phoneVerified: Boolean(session?.user.phone && session.user.phone_confirmed_at),
    liveMatch: backendConfig.configured && !testMatch,
    ready,
    user: session?.user ?? null,
    profileReady,
    achievements,
    achievementsReady,
    gameplay,
    gameplayOutcome,
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
    sendPhoneOtp: async (phone) => {
      setError(null)
      await authApi.sendPhoneOtp(phone)
    },
    verifyPhoneOtp: async (phone, token) => {
      setError(null)
      const data = await authApi.verifyPhoneOtp(phone, token)
      sessionUserId.current = data.session?.user.id ?? null
      setSession(data.session)
    },
    signOut: async () => {
      await authApi.signOut()
      sessionUserId.current = null
      setSession(null)
      setProfileReady(false)
      setAchievements([])
      setAchievementsReady(true)
      setGameplay(null)
      setGameplayOutcome(null)
      previousUnlocks.current = null
      useApp.getState().reset()
    },
    checkNickname: (nickname) => backendApi.profile.isNicknameAvailable(nickname),
    saveProfile: async (nickname, interests, avatarUrl) => {
      await backendApi.profile.upsert({ nickname, interests, avatarUrl })
      await refresh()
    },
    startBossMatch: async (eventId) => {
      setError(null)
      try {
        const result = await backendApi.gameplay.startBossMatch(eventId)
        await refresh()
        return result
      } catch (caught) {
        setError(messageOf(caught))
        throw caught
      }
    },
    equipTitle: async (achievementCode) => {
      setError(null)
      try {
        await backendApi.achievements.equip(achievementCode)
        await refresh()
      } catch (caught) {
        const message = messageOf(caught)
        setError(message)
        throw caught
      }
    },
    refresh,
  }), [ready, session, profileReady, achievements, achievementsReady, gameplay, gameplayOutcome, error, refresh, testMatch])

  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
}

export function useBackend(): BackendRuntime {
  const value = useContext(BackendContext)
  if (!value) throw new Error('useBackend must be used inside BackendProvider')
  return value
}
