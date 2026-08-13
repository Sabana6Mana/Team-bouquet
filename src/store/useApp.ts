import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Account, AppNotification, HonorType, Match, MatchMode, MatchRecord, Player, SportId,
} from '../types'
import {
  capacityOf, distanceMeters, eloDelta, encodeSlot, isSlotOpen, QUICK_RADIUS_M,
  recommendTeams, teamAvg, TIME_SLOTS,
} from '../lib/game'
import { BOT_CHATS, HOME, NPCS, VENUES } from '../data/seed'
import { backendApi, backendConfig } from '../backend'
import { forcedDemo, serverMode } from '../lib/forcedDemo'
import { INTRO_TOTAL_MS } from '../lib/matchIntro'
import { localAchievementProgress, titleForAchievement } from '../data/achievements'

/** 데모 시뮬레이션용 타이머. 상태에 넣으면 직렬화가 깨지므로 모듈 레벨에서 관리한다. */
let timers: ReturnType<typeof setTimeout>[] = []
function later(fn: () => void, ms: number) {
  timers.push(setTimeout(fn, ms))
}
function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 테스트용 데모 매치가 끝나면 스위치를 내리고 서버 상태를 다시 읽게 한다.
 * 데모 중이 아니면 아무 일도 하지 않는다.
 */
function endForcedDemo(set: (updater: (state: AppState) => Partial<AppState>) => void) {
  if (!forcedDemo.active) return
  forcedDemo.disable()
  set((state) => ({ testMatch: false, backendRefreshVersion: state.backendRefreshVersion + 1 }))
}

/**
 * 빠른 매칭에서 인원이 모였을 때 쓸 장소를 고른다.
 * 반경 안에서 해당 종목이 가능한 곳 중 가장 가까운 곳,
 * 반경 안에 없으면 종목이 가능한 곳 중 가장 가까운 곳으로 넓힌다.
 */
function pickVenueFor(sport: SportId, coords: { lat: number; lng: number }): string {
  const usable = VENUES.filter((v) => v.sports.includes(sport))
    .map((v) => ({ v, d: distanceMeters(coords, v) }))
    .sort((a, b) => a.d - b.d)
  const inRange = usable.filter((x) => x.d <= QUICK_RADIUS_M)
  return (inRange[0] ?? usable[0]).v.id
}

function emptyMe(): Player {
  return {
    id: 'me',
    nickname: '',
    avatar: '🙂',
    elo: { tennis: 1200, badminton: 1200, tabletennis: 1200, basketball: 1200 },
    stickers: 0,
    honorCounts: { manner: 0, skill: 0, punctual: 0, fun: 0 },
    wins: 0,
    losses: 0,
    isMe: true,
  }
}

interface AppState {
  account: Account | null
  me: Player
  coords: { lat: number; lng: number }
  match: Match | null
  history: MatchRecord[]
  /** 데모 모드에서 장착한 칭호. 라이브 모드는 profiles.equipped_title_code가 원본이다. */
  equippedTitleCode: string | null
  notifications: AppNotification[]
  /** 화면 위에 배너로 띄울 알림 */
  toast: AppNotification | null
  clanId: string | null
  /** Supabase 모드의 초기화/동기화 상태. 환경 변수가 없으면 항상 demo다. */
  backendStatus: 'demo' | 'loading' | 'ready' | 'error'
  backendUserId: string | null
  backendError: string | null
  /** 기존 숫자 슬롯 -> Supabase venue_slots UUID */
  backendSlotIds: Record<number, string>
  /** RPC 성공 뒤 BackendProvider에 즉시 재조회를 요청하는 증가값 */
  backendRefreshVersion: number
  /**
   * 화면 확인용 데모 매치가 도는 중인지.
   * 화면들이 서버 흐름 대신 데모 흐름을 그리도록 이 값을 본다.
   * (같은 상태를 forcedDemo 모듈이 React 밖에서도 읽는다.)
   */
  testMatch: boolean
  /** 명예 저장과 경기 완료 RPC가 경합하지 않도록 완료 버튼을 잠근다. */
  honorSubmitting: boolean

  signUp: (a: Omit<Account, 'interests'>, avatarUrl?: string | null) => void
  setInterests: (ids: SportId[]) => void
  setCoords: (c: { lat: number; lng: number }) => void

  /** venueId가 null이면 빠른 매칭 — 인원이 모인 뒤 반경 안에서 장소를 배정한다. */
  startQueue: (venueId: string | null, sport: SportId, mode: MatchMode) => string
  /**
   * 화면 확인용. 서버를 거치지 않고 NPC 로 채우는 데모 매치를 강제로 시작한다.
   * 진행 중이던 매치가 있어도 밀어내고 새로 연다.
   */
  forceDemoMatch: (sport: SportId, mode: MatchMode) => void
  cancelMatch: () => void
  acceptMatch: () => void
  expireMatchAcceptance: () => void
  /** slot은 encodeSlot(날짜 offset, 시각) 으로 인코딩된 값 */
  vote: (slot: number) => void
  sendChat: (text: string) => void
  setTeams: (a: string[], b: string[]) => void
  setTeamReady: (ready: boolean) => void
  advanceToPayment: () => void
  reportPlayer: (playerId: string, reason: string) => void
  pay: () => void
  voteResult: (winner: 'a' | 'b', score: string) => void
  finalizeResult: (winner: 'a' | 'b', score: string) => void
  giveHonor: (playerId: string, honorType: HonorType) => void
  finishMatch: () => void
  openReporting: () => void
  /** 데모 보스전 승리만 기록한다. 일반 경기 기록/ELO와 완전히 분리된다. */
  recordBossVictory: () => void

  notify: (title: string, body: string, link?: string) => void
  dismissToast: () => void
  markAllRead: () => void
  equipLocalTitle: (achievementCode: string | null) => void
  joinClan: (id: string) => void
  reset: () => void
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      account: null,
      me: emptyMe(),
      coords: HOME,
      match: null,
      history: [],
      equippedTitleCode: null,
      notifications: [],
      toast: null,
      clanId: null,
      backendStatus: backendConfig.configured ? 'loading' : 'demo',
      backendUserId: null,
      backendError: null,
      backendSlotIds: {},
      backendRefreshVersion: 0,
      testMatch: false,
      honorSubmitting: false,

      signUp: (a, avatarUrl) => {
        const me: Player = {
          ...emptyMe(),
          nickname: a.nickname,
          avatar: '🦖',
          avatarUrl: avatarUrl ?? null,
        }
        set({ account: { ...a, interests: [] }, me })
      },

      setInterests: (ids) => {
        const acc = get().account
        if (acc) set({ account: { ...acc, interests: ids } })
      },

      setCoords: (c) => set({ coords: c }),

      /* ─────────────── 매칭 큐 ─────────────── */

      startQueue: (venueId, sport, mode) => {
        clearTimers()
        const previousMatch = get().match
        if (serverMode() && previousMatch) {
          get().notify('진행 중인 매치가 있어요', '현재 매치를 먼저 완료하거나 취소해 주세요.')
          set((state) => ({ backendRefreshVersion: state.backendRefreshVersion + 1 }))
          return previousMatch.id
        }
        const capacity = capacityOf(mode)
        const me = get().me
        const id = uid('match')
        const match: Match = {
          id,
          venueId: venueId ?? '',
          quick: venueId === null,
          sport,
          mode,
          capacity,
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
          createdAt: Date.now(),
        }
        set({ match })

        if (serverMode()) {
          void backendApi.queue.join({
            venueId,
            sport,
            mode,
            location: venueId === null ? get().coords : null,
          }).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '매칭 큐 참가에 실패했습니다.'
            set((state) => ({
              match: state.match?.id === id ? previousMatch : state.match,
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('매칭 시작 실패', message)
          })
          return id
        }

        // 비슷한 ELO의 상대를 순차적으로 큐에 채운다.
        const myElo = me.elo[sport]
        const pool = [...NPCS]
          .sort((x, y) => Math.abs(x.elo[sport] - myElo) - Math.abs(y.elo[sport] - myElo))
          .slice(0, capacity - 1)

        pool.forEach((npc, i) => {
          later(() => {
            const m = get().match
            if (!m || m.id !== id || m.phase !== 'queue') return
            const players = [...m.players, npc]
            const full = players.length >= capacity

            if (!full) {
              set({ match: { ...m, players } })
              return
            }

            // 인원 충족 → ELO 균형 추천 팀을 기본값으로 잡고 일정 조율 단계로
            const teams = recommendTeams(players, sport)
            // 빠른 매칭은 이 시점에 반경 안의 체육관을 배정한다.
            const venueId = m.venueId || pickVenueFor(sport, get().coords)
            const venue = VENUES.find((v) => v.id === venueId)!
            set({
              match: {
                ...m,
                venueId,
                players,
                teams,
                phase: 'scheduling',
                chat: [
                  {
                    id: uid('c'),
                    playerId: 'system',
                    system: true,
                    at: Date.now(),
                    text: m.quick
                      ? `주변 ${QUICK_RADIUS_M / 1000}km 안에서 ${players.length}명이 모였습니다. 가장 가까운 ${venue.name}(으)로 배정되었어요. 예약 가능한 시간을 골라 투표해 주세요.`
                      : `매칭이 완료되었습니다. ${venue.name}의 예약 가능한 시간을 골라 투표해 주세요.`,
                  },
                ],
              },
            })
            get().notify('매칭 완료!', `${players.length}명이 모두 모였어요. 시간을 조율해 주세요.`, '/room')
            scheduleBotBehaviour(id, get, set)
          }, 1400 + i * 1300)
        })

        return id
      },

      forceDemoMatch: (sport, mode) => {
        clearTimers()
        forcedDemo.enable()
        // 서버 큐에 남아 있던 참가 기록은 정리해 둔다.
        // 실패하더라도 테스트 매치는 로컬에서 도니 막지 않는다.
        if (backendConfig.configured) void backendApi.queue.cancel().catch(() => {})
        set({ match: null, backendError: null, testMatch: true })
        // 장소를 비워 두면 인원이 찼을 때 주변 체육관이 배정된다(빠른 매칭과 같은 경로).
        get().startQueue(null, sport, mode)
        get().notify('테스트 매칭 시작', '서버 대신 NPC로 채우는 데모 매치입니다.', '/queue')
      },

      cancelMatch: () => {
        clearTimers()
        if (serverMode()) {
          const matchId = get().match?.id
          void backendApi.queue.cancel().then((cancelled) => {
            set((state) => ({
              match: cancelled && state.match?.id === matchId ? null : state.match,
              backendError: cancelled ? null : '취소할 매칭을 찾지 못했습니다.',
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            if (!cancelled) get().notify('취소할 매칭이 없어요', '서버 상태를 다시 확인하고 있습니다.')
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '매칭 큐 취소에 실패했습니다.'
            set((state) => ({
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('큐 취소 실패', message)
          })
          return
        }
        set({ match: null })
        endForcedDemo(set)
      },

      acceptMatch: () => {
        const m = get().match
        if (!m || m.phase !== 'queue' || !m.acceptanceDeadline || !serverMode()) return
        const meId = get().me.id
        const previous = m.accepted?.[meId] ?? false
        set({ match: { ...m, accepted: { ...m.accepted, [meId]: true } } })
        void backendApi.matches.accept(m.id).then((result) => {
          set((state) => ({
            match: result.phase === 'canceled' && state.match?.id === m.id ? null : state.match,
            backendError: null,
            backendRefreshVersion: state.backendRefreshVersion + 1,
          }))
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '매칭 수락에 실패했습니다.'
          set((state) => ({
            match: state.match?.id === m.id
              ? { ...state.match, accepted: { ...state.match.accepted, [meId]: previous } }
              : state.match,
            backendError: message,
            backendRefreshVersion: state.backendRefreshVersion + 1,
          }))
          get().notify('매칭 수락 실패', message)
        })
      },

      expireMatchAcceptance: () => {
        const m = get().match
        if (!m || m.phase !== 'queue' || !m.acceptanceDeadline || !serverMode()) return
        void backendApi.matches.expireAcceptance(m.id).then((result) => {
          set((state) => ({
            match: result.phase === 'canceled' && state.match?.id === m.id ? null : state.match,
            backendError: null,
            backendRefreshVersion: state.backendRefreshVersion + 1,
          }))
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '매칭 수락 만료 처리에 실패했습니다.'
          set({ backendError: message })
        })
      },

      /* ─────────────── 일정 조율 ─────────────── */

      vote: (slot) => {
        const m = get().match
        if (!m) return
        const votes = { ...m.votes, [get().me.id]: slot }
        set({ match: { ...m, votes } })

        if (serverMode()) {
          const venueSlotId = get().backendSlotIds[slot]
          if (!venueSlotId) {
            const message = '서버의 예약 가능 시간과 연결되지 않은 슬롯입니다. 새로고침 후 다시 시도해 주세요.'
            set({ backendError: message })
            get().notify('시간 투표 실패', message)
            return
          }
          void backendApi.votes.slot(m.id, venueSlotId).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '시간 투표에 실패했습니다.'
            set({ backendError: message })
            get().notify('시간 투표 실패', message)
          })
          return
        }

        // 내가 투표하면 상대들이 순차적으로 동의하며 시간이 수렴한다.
        const bots = m.players.filter((p) => !p.isMe)
        bots.forEach((b, i) => {
          later(() => {
            const cur = get().match
            if (!cur || cur.id !== m.id || cur.phase !== 'scheduling') return
            if (cur.votes[get().me.id] !== slot) return // 내가 투표를 바꿨으면 중단
            const v = { ...cur.votes, [b.id]: slot }
            const everyone = cur.players.every((p) => v[p.id] === slot)
            const chat = [
              ...cur.chat,
              { id: uid('c'), playerId: b.id, at: Date.now(), text: i === 0 ? '저도 그 시간 좋아요!' : '동의합니다 👍' },
            ]
            if (!everyone) {
              set({ match: { ...cur, votes: v, chat } })
              return
            }
            // 단식은 팀을 나눌 필요가 없으니 곧바로 결제로 넘어간다.
            const solo = cur.mode === '1v1'
            set({
              match: {
                ...cur,
                votes: v,
                chat,
                confirmedSlot: slot,
                phase: solo ? 'payment' : 'teaming',
                payments: solo ? Object.fromEntries(cur.players.map((p) => [p.id, false])) : {},
              },
            })
            if (solo) {
              get().notify('시간 확정!', '전원이 같은 시간에 투표했어요. 결제를 진행해 주세요.', '/payment')
            } else {
              get().notify('시간 확정!', '이제 팀을 구성해 주세요.', '/teams')
              // 추천 팀에 대해 상대들이 준비를 완료하기 시작한다.
              scheduleTeamReactions(m.id, get, set)
            }
          }, 900 + i * 1100)
        })
      },

      sendChat: (text) => {
        const m = get().match
        if (!m || !text.trim()) return
        set({
          match: {
            ...m,
            chat: [...m.chat, { id: uid('c'), playerId: get().me.id, at: Date.now(), text: text.trim() }],
          },
        })
        if (serverMode()) {
          void backendApi.messages.send(m.id, text).then(() => {
            set((state) => ({ backendRefreshVersion: state.backendRefreshVersion + 1 }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '메시지 전송에 실패했습니다.'
            set({ backendError: message })
            get().notify('채팅 전송 실패', message)
          })
        }
      },

      /* ─────────────── 팀 구성 ─────────────── */

      setTeams: (a, b) => {
        const m = get().match
        if (!m) return
        if (serverMode()) {
          if (m.hostId !== get().me.id) {
            get().notify('호스트만 팀을 바꿀 수 있어요', '호스트의 팀 확정을 기다려 주세요.')
            set((state) => ({ backendRefreshVersion: state.backendRefreshVersion + 1 }))
            return
          }
          void backendApi.matches.setTeams(m.id, a, b).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '팀 구성 저장에 실패했습니다.'
            set((state) => ({
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('팀 구성 실패', message)
          })
          return
        }
        // 데모에서는 구성이 바뀌면 준비 상태를 초기화하고 NPC들이 다시 반응한다.
        set({ match: { ...m, teams: { a, b }, teamReady: {} } })
        scheduleTeamReactions(m.id, get, set)
      },

      setTeamReady: (ready) => {
        const m = get().match
        if (!m || m.phase !== 'teaming') return
        const half = m.capacity / 2
        if (m.teams.a.length !== half || m.teams.b.length !== half) return
        if (serverMode()) {
          void backendApi.matches.setReady(m.id, ready).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '준비 상태 저장에 실패했습니다.'
            set((state) => ({
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('준비 상태 저장 실패', message)
          })
          return
        }
        const next = { ...m.teamReady, [get().me.id]: ready }
        set({ match: { ...m, teamReady: next } })
        if (ready && m.players.every((p) => next[p.id])) get().advanceToPayment()
      },

      advanceToPayment: () => {
        const m = get().match
        if (!m || m.phase !== 'teaming') return
        if (serverMode()) {
          set((state) => ({ backendRefreshVersion: state.backendRefreshVersion + 1 }))
          return
        }
        set({
          match: {
            ...m,
            phase: 'payment',
            payments: Object.fromEntries(m.players.map((p) => [p.id, false])),
          },
        })
        get().notify('팀 확정!', '전원이 준비를 완료했어요. 결제를 진행해 주세요.', '/payment')
      },

      /* ─────────────── 신고 ─────────────── */

      reportPlayer: (playerId, reason) => {
        const m = get().match
        if (!m || m.reports[playerId]) return
        set({ match: { ...m, reports: { ...m.reports, [playerId]: reason } } })
        if (serverMode()) {
          void backendApi.reports.create({
            reportedId: playerId,
            matchId: m.id,
            reason,
          }).then(() => {
            get().notify(
              '신고가 접수되었습니다',
              '운영팀이 검토 후 조치합니다. 신고 사실은 상대에게 공개되지 않습니다.',
            )
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '신고 접수에 실패했습니다.'
            set((state) => ({
              match: state.match?.id === m.id
                ? {
                    ...state.match,
                    reports: Object.fromEntries(
                      Object.entries(state.match.reports).filter(([id]) => id !== playerId),
                    ),
                  }
                : state.match,
              backendError: message,
            }))
            get().notify('신고 접수 실패', message)
          })
          return
        }
        get().notify(
          '신고가 접수되었습니다',
          '운영팀이 검토 후 조치합니다. 신고 사실은 상대에게 공개되지 않습니다.',
        )
      },

      /* ─────────────── 결제 ─────────────── */

      pay: () => {
        const m = get().match
        if (!m) return
        const meId = get().me.id
        const previousPayment = m.payments[meId] ?? false
        const payments = { ...m.payments, [meId]: true }
        set({ match: { ...m, payments } })

        if (serverMode()) {
          void backendApi.matches.confirmAttendance(m.id).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '참가 확정에 실패했습니다.'
            set((state) => ({
              match: state.match?.id === m.id
                ? {
                    ...state.match,
                    payments: { ...state.match.payments, [meId]: previousPayment },
                  }
                : state.match,
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('참가 확정 실패', message)
          })
          return
        }

        const bots = m.players.filter((p) => !p.isMe)
        bots.forEach((b, i) => {
          later(() => {
            const cur = get().match
            if (!cur || cur.id !== m.id || cur.phase !== 'payment') return
            const p = { ...cur.payments, [b.id]: true }
            const allPaid = cur.players.every((pl) => p[pl.id])
            set({ match: { ...cur, payments: p, phase: allPaid ? 'confirmed' : 'payment' } })
            if (allPaid) {
              get().notify('예약 확정 🎉', '전원 결제가 완료되어 예약이 확정되었습니다.', '/room')
              // 데모: 이용 시간이 끝나면 승패 확정 알림이 온다.
              later(() => {
                const c2 = get().match
                if (!c2 || c2.id !== m.id || c2.phase !== 'confirmed') return
                set({ match: { ...c2, phase: 'reporting' } })
                get().notify('경기가 끝났어요', '승패를 확정하고 좋은 상대에게 명예를 보내주세요.', '/result')
              }, 7000)
            }
          }, 1200 + i * 1000)
        })
      },

      /* ─────────────── 결과 확정 ─────────────── */

      /* ─────────────── 승패 투표 ─────────────── */

      voteResult: (winner, score) => {
        const m = get().match
        if (!m || m.result) return
        const meId = get().me.id
        const normalizedScore = score.replace(/\s+/g, '')
        if (!normalizedScore) {
          get().notify('점수를 입력해 주세요', '참가자 모두 같은 승자와 점수에 동의해야 합니다.')
          return
        }
        const votes = { ...m.resultVotes, [meId]: winner }
        const scores = { ...m.resultVoteScores, [meId]: normalizedScore }
        set({ match: { ...m, resultVotes: votes, resultVoteScores: scores } })

        if (serverMode()) {
          void backendApi.votes.result(m.id, winner, normalizedScore).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '경기 결과 투표에 실패했습니다.'
            set((state) => ({
              match: state.match?.id === m.id
                ? {
                    ...state.match,
                    resultVotes: Object.fromEntries(
                      Object.entries(state.match.resultVotes).filter(([id]) => id !== meId),
                    ),
                    resultVoteScores: Object.fromEntries(
                      Object.entries(state.match.resultVoteScores).filter(([id]) => id !== meId),
                    ),
                  }
                : state.match,
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('결과 투표 실패', message)
          })
          return
        }

        // 내가 투표하면 상대들이 순차적으로 같은 결과에 동의한다.
        const bots = m.players.filter((p) => !p.isMe)
        bots.forEach((b, i) => {
          later(() => {
            const cur = get().match
            if (!cur || cur.id !== m.id || cur.result) return
            if (cur.resultVotes[meId] !== winner || cur.resultVoteScores[meId] !== normalizedScore) return
            const v = { ...cur.resultVotes, [b.id]: winner }
            const nextScores = { ...cur.resultVoteScores, [b.id]: normalizedScore }
            set({ match: { ...cur, resultVotes: v, resultVoteScores: nextScores } })
            // 전원이 같은 팀과 같은 점수에 투표했을 때만 확정한다.
            if (cur.players.every((p) => v[p.id] === winner && nextScores[p.id] === normalizedScore)) {
              get().finalizeResult(winner, normalizedScore)
            }
          }, 900 + i * 1000)
        })
      },

      finalizeResult: (winner, score) => {
        const m = get().match
        if (!m || m.result) return
        if (serverMode()) return
        const sport = m.sport
        const meId = get().me.id
        const myTeam = m.teams.a.includes(meId) ? 'a' : 'b'
        const iWon = myTeam === winner

        const delta = eloDelta(
          teamAvg(m.players, m.teams[myTeam], sport),
          teamAvg(m.players, m.teams[myTeam === 'a' ? 'b' : 'a'], sport),
          iWon,
        )
        const me = get().me
        const nextStreak = iWon ? (me.streak ?? 0) + 1 : 0
        set({
          me: {
            ...me,
            elo: { ...me.elo, [sport]: me.elo[sport] + delta },
            wins: me.wins + (iWon ? 1 : 0),
            losses: me.losses + (iWon ? 0 : 1),
            streak: nextStreak,
            bestStreak: Math.max(me.bestStreak ?? me.streak ?? 0, nextStreak),
          },
          match: { ...m, result: { winner, score, delta }, phase: 'reporting' },
        })
        get().notify('결과 확정!', iWon ? '승리가 기록되었습니다.' : '결과가 기록되었습니다.', '/result')
      },

      giveHonor: (playerId, honorType) => {
        const m = get().match
        if (!m || m.honorGiven || m.reports[playerId]) return
        const myTeam = m.teams.a.includes(get().me.id) ? 'a' : 'b'
        const opponentTeam = myTeam === 'a' ? 'b' : 'a'
        if (!m.teams[opponentTeam].includes(playerId)) {
          get().notify('명예 전달 불가', '상대 팀 선수에게만 명예를 보낼 수 있습니다.')
          return
        }
        const honorGiven = { playerId, type: honorType }
        set({ match: { ...m, honorGiven }, honorSubmitting: serverMode() })

        if (serverMode()) {
          void backendApi.honors.give(m.id, playerId, honorType).then(() => {
            set((state) => ({
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
              honorSubmitting: false,
            }))
            get().notify('명예 전달 완료 ✨', '좋은 승부를 만든 상대에게 명예가 전달되었습니다.')
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '명예 전달에 실패했습니다.'
            set((state) => ({
              match: state.match?.id === m.id && state.match.honorGiven?.playerId === playerId
                ? { ...state.match, honorGiven: null }
                : state.match,
              backendError: message,
              honorSubmitting: false,
            }))
            get().notify('명예 전달 실패', message)
          })
          return
        }

        set((state) => ({
          honorSubmitting: false,
          match: state.match?.id === m.id
            ? {
                ...state.match,
                players: state.match.players.map((player) => {
                  if (player.id !== playerId) return player
                  const honorCounts = player.honorCounts
                    ?? { manner: 0, skill: 0, punctual: 0, fun: 0 }
                  return {
                    ...player,
                    stickers: player.stickers + 1,
                    honorCounts: {
                      ...honorCounts,
                      [honorType]: honorCounts[honorType] + 1,
                    },
                  }
                }),
              }
            : state.match,
        }))
        get().notify('명예 전달 완료 ✨', '상대의 프로필 명예 등급에 반영되었습니다.')
      },

      finishMatch: () => {
        const m = get().match
        if (!m) return
        if (get().honorSubmitting) {
          get().notify('잠시만 기다려 주세요', '명예를 안전하게 저장하고 있습니다.')
          return
        }
        const meId = get().me.id
        const myTeam = m.teams.a.includes(meId) ? 'a' : 'b'
        const iWon = m.result?.winner === myTeam
        const delta = m.result?.delta ?? 0
        const record: MatchRecord = {
          id: m.id,
          venueId: m.venueId,
          sport: m.sport,
          mode: m.mode,
          playedAt: '방금 전',
          winners: m.teams[m.result?.winner ?? 'a'],
          losers: m.teams[(m.result?.winner ?? 'a') === 'a' ? 'b' : 'a'],
          score: m.result?.score ?? '-',
          eloDelta: delta,
        }
        clearTimers()
        if (serverMode()) {
          void backendApi.matches.complete(m.id).then(() => {
            clearTimers()
            set((state) => ({
              history: state.history.some((item) => item.id === record.id)
                ? state.history
                : [record, ...state.history],
              match: state.match?.id === m.id ? null : state.match,
              backendError: null,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '경기 완료 처리에 실패했습니다.'
            set((state) => ({
              backendError: message,
              backendRefreshVersion: state.backendRefreshVersion + 1,
            }))
            get().notify('경기 완료 처리 실패', message)
          })
          return
        }
        set({ history: [record, ...get().history], match: null })
        endForcedDemo(set)
      },

      openReporting: () => {
        const m = get().match
        if (!m) return
        if (!serverMode()) {
          set({ match: { ...m, phase: 'reporting' } })
          return
        }
        void backendApi.matches.openReporting(m.id).then(() => {
          set((state) => ({
            match: state.match ? { ...state.match, phase: 'reporting' } : null,
            backendRefreshVersion: state.backendRefreshVersion + 1,
          }))
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '결과 입력을 시작하지 못했습니다.'
          set({ backendError: message })
          get().notify('결과 입력 시작 실패', message)
        })
      },

      recordBossVictory: () => {
        if (serverMode()) return
        const me = get().me
        if ((me.bossVictories ?? 0) > 0) return
        set({ me: { ...me, bossVictories: 1 } })
        get().notify(
          '배드민턴 보스 격파! 🏸',
          '《보스의 천적》 칭호를 획득했습니다. 도전과제에서 장착해 보세요.',
          '/achievements',
        )
      },

      /* ─────────────── 알림 ─────────────── */

      notify: (title, body, link) => {
        const n: AppNotification = { id: uid('n'), title, body, at: Date.now(), read: false, link }
        set({ notifications: [n, ...get().notifications].slice(0, 30), toast: n })
        later(() => {
          if (get().toast?.id === n.id) set({ toast: null })
        }, 4500)
      },

      dismissToast: () => set({ toast: null }),
      markAllRead: () => {
        set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) })
        if (serverMode()) {
          void backendApi.notifications.markAllRead().then(() => {
            set((state) => ({ backendRefreshVersion: state.backendRefreshVersion + 1 }))
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '알림 읽음 처리에 실패했습니다.'
            set({ backendError: message })
          })
        }
      },
      equipLocalTitle: (achievementCode) => {
        if (achievementCode) {
          const unlocked = localAchievementProgress(get().me, get().history, get().equippedTitleCode)
            .some((achievement) => achievement.code === achievementCode && achievement.unlockedAt)
          if (!unlocked) {
            get().notify('아직 잠긴 칭호예요', '도전과제를 달성한 뒤 장착할 수 있습니다.')
            return
          }
        }
        const title = titleForAchievement(achievementCode)
        set({
          equippedTitleCode: achievementCode,
          me: { ...get().me, titleCode: achievementCode, title },
        })
        get().notify(
          achievementCode ? '칭호 장착 완료' : '칭호를 해제했습니다',
          achievementCode ? `《${title}》 칭호를 장착했습니다.` : '기본 프로필로 돌아갑니다.',
        )
      },
      joinClan: (id) => set({ clanId: get().clanId === id ? null : id }),

      reset: () => {
        clearTimers()
        forcedDemo.disable()
        set({
          account: null, me: emptyMe(), match: null, history: [], equippedTitleCode: null,
          notifications: [], toast: null, clanId: null, coords: HOME,
          backendSlotIds: {}, backendError: null, testMatch: false, honorSubmitting: false,
        })
      },
    }),
    {
      name: backendConfig.configured ? 'matchpoint-backend-v1' : 'matchpoint-v1',
      partialize: (s) => backendConfig.configured
        ? { coords: s.coords }
        : {
            account: s.account, me: s.me, history: s.history, equippedTitleCode: s.equippedTitleCode,
            notifications: s.notifications, clanId: s.clanId,
          },
    },
  ),
)

/**
 * 팀 구성에 대한 상대들의 반응.
 * 정원이 어긋나면 넘치는 팀의 상대가 스스로 반대 팀으로 옮기고,
 * 정원이 맞으면 순서대로 준비를 완료한다.
 */
function scheduleTeamReactions(
  matchId: string,
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
) {
  const m = get().match
  if (!m || m.id !== matchId || m.phase !== 'teaming') return
  const half = m.capacity / 2

  const over = m.teams.a.length > half ? 'a' : m.teams.b.length > half ? 'b' : null
  if (over) {
    const to: 'a' | 'b' = over === 'a' ? 'b' : 'a'
    // 옮길 상대를 고른다. 방금 내가 넣은 선수는 배열 끝에 붙으므로 후보에서 빼
    // 사용자의 배치를 되돌리지 않게 한다.
    const ids = m.teams[over]
    const toPlayer = (id: string) => m.players.find((p) => p.id === id)
    const bot =
      ids.slice(0, -1).map(toPlayer).find((p) => p && !p.isMe) ??
      ids.map(toPlayer).find((p) => p && !p.isMe)
    if (!bot) return

    later(() => {
      const cur = get().match
      if (!cur || cur.id !== matchId || cur.phase !== 'teaming') return
      if (cur.teams[over].length <= half || !cur.teams[over].includes(bot.id)) return

      const rest = cur.teams[over].filter((x) => x !== bot.id)
      const moved = [...cur.teams[to], bot.id]
      const teams = over === 'a' ? { a: rest, b: moved } : { a: moved, b: rest }
      set({ match: { ...cur, teams, teamReady: {} } })
      get().notify(
        `${bot.nickname} 님이 팀을 옮겼어요`,
        `정원을 맞추려고 ${to === 'a' ? 'TEAM BLUE' : 'TEAM RED'}로 이동했습니다.`,
        '/teams',
      )
      scheduleTeamReactions(matchId, get, set) // 정원이 맞을 때까지 이어서 조정
    }, 1800) // 사용자가 선수를 맞바꾸는 중이라면 끝낼 시간을 준다
    return
  }

  if (m.teams.a.length !== half || m.teams.b.length !== half) return

  const bots = m.players.filter((p) => !p.isMe)
  bots.forEach((b, i) => {
    later(() => {
      const cur = get().match
      if (!cur || cur.id !== matchId || cur.phase !== 'teaming') return
      if (cur.teams.a.length !== half || cur.teams.b.length !== half) return
      if (cur.teamReady[b.id]) return
      const ready = { ...cur.teamReady, [b.id]: true }
      set({ match: { ...cur, teamReady: ready } })
      if (cur.players.every((p) => ready[p.id])) get().advanceToPayment()
    }, 1000 + i * 850)
  })
}

/** 일정 조율 단계에 들어가면 상대들이 먼저 선호 시간에 투표하고 대화를 시작한다. */
function scheduleBotBehaviour(
  matchId: string,
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
) {
  const m = get().match
  if (!m) return
  // 앞으로 며칠 안에서 비어 있는 슬롯들을 후보로 삼는다.
  const open: number[] = []
  for (let d = 0; d < 5; d++) {
    for (const h of TIME_SLOTS) {
      if (isSlotOpen(m.venueId, d, h)) open.push(encodeSlot(d, h))
    }
  }
  if (open.length === 0) return
  const bots = m.players.filter((p) => !p.isMe)

  bots.forEach((b, i) => {
    later(() => {
      const cur = get().match
      if (!cur || cur.id !== matchId || cur.phase !== 'scheduling') return
      if (cur.votes[b.id] !== undefined) return
      const pick = open[(i * 7 + 3) % open.length]
      set({
        match: {
          ...cur,
          votes: { ...cur.votes, [b.id]: pick },
          chat: [...cur.chat, { id: uid('c'), playerId: b.id, at: Date.now(), text: BOT_CHATS[i % BOT_CHATS.length] }],
        },
      })
      // 등장 연출이 끝난 뒤에 말을 건다. 연출 중에 말하면 아직 서 있지도 않은
      // 캐릭터 위에서 말풍선이 떴다 사라져 대화가 통째로 씹힌다.
    }, INTRO_TOTAL_MS + i * 1800)
  })
}
