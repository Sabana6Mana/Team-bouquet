import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Account, AppNotification, Match, MatchMode, MatchRecord, Player, SportId,
} from '../types'
import {
  capacityOf, distanceMeters, eloDelta, encodeSlot, isSlotOpen, QUICK_RADIUS_M,
  recommendTeams, teamAvg, TIME_SLOTS,
} from '../lib/game'
import { BOT_CHATS, HOME, NPCS, VENUES } from '../data/seed'

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
  notifications: AppNotification[]
  /** 화면 위에 배너로 띄울 알림 */
  toast: AppNotification | null
  clanId: string | null

  signUp: (a: Omit<Account, 'interests'>) => void
  setInterests: (ids: SportId[]) => void
  setCoords: (c: { lat: number; lng: number }) => void

  /** venueId가 null이면 빠른 매칭 — 인원이 모인 뒤 반경 안에서 장소를 배정한다. */
  startQueue: (venueId: string | null, sport: SportId, mode: MatchMode) => string
  cancelMatch: () => void
  /** slot은 encodeSlot(날짜 offset, 시각) 으로 인코딩된 값 */
  vote: (slot: number) => void
  sendChat: (text: string) => void
  setTeams: (a: string[], b: string[]) => void
  setTeamReady: (ready: boolean) => void
  advanceToPayment: () => void
  reportPlayer: (playerId: string, reason: string) => void
  pay: () => void
  voteResult: (winner: 'a' | 'b') => void
  finalizeResult: (winner: 'a' | 'b') => void
  giveSticker: (playerId: string) => void
  finishMatch: () => void

  notify: (title: string, body: string, link?: string) => void
  dismissToast: () => void
  markAllRead: () => void
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
      notifications: [],
      toast: null,
      clanId: null,

      signUp: (a) => {
        const me: Player = {
          ...emptyMe(),
          nickname: a.nickname,
          avatar: '🦖',
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
          result: null,
          stickersGiven: [],
          createdAt: Date.now(),
        }
        set({ match })

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

      cancelMatch: () => {
        clearTimers()
        set({ match: null })
      },

      /* ─────────────── 일정 조율 ─────────────── */

      vote: (slot) => {
        const m = get().match
        if (!m) return
        const votes = { ...m.votes, [get().me.id]: slot }
        set({ match: { ...m, votes } })

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
      },

      /* ─────────────── 팀 구성 ─────────────── */

      setTeams: (a, b) => {
        const m = get().match
        if (!m) return
        // 구성이 바뀌면 모두의 준비 상태를 초기화하고 상대들이 다시 반응한다.
        set({ match: { ...m, teams: { a, b }, teamReady: {} } })
        scheduleTeamReactions(m.id, get, set)
      },

      setTeamReady: (ready) => {
        const m = get().match
        if (!m || m.phase !== 'teaming') return
        const half = m.capacity / 2
        if (m.teams.a.length !== half || m.teams.b.length !== half) return
        const next = { ...m.teamReady, [get().me.id]: ready }
        set({ match: { ...m, teamReady: next } })
        if (ready && m.players.every((p) => next[p.id])) get().advanceToPayment()
      },

      advanceToPayment: () => {
        const m = get().match
        if (!m || m.phase !== 'teaming') return
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
        get().notify(
          '신고가 접수되었습니다',
          '운영팀이 검토 후 조치합니다. 신고 사실은 상대에게 공개되지 않습니다.',
        )
      },

      /* ─────────────── 결제 ─────────────── */

      pay: () => {
        const m = get().match
        if (!m) return
        const payments = { ...m.payments, [get().me.id]: true }
        set({ match: { ...m, payments } })

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
                get().notify('경기가 끝났어요', '승패를 확정하고 상대에게 칭찬 스티커를 보내주세요.', '/result')
              }, 7000)
            }
          }, 1200 + i * 1000)
        })
      },

      /* ─────────────── 결과 확정 ─────────────── */

      /* ─────────────── 승패 투표 ─────────────── */

      voteResult: (winner) => {
        const m = get().match
        if (!m || m.result) return
        const meId = get().me.id
        const votes = { ...m.resultVotes, [meId]: winner }
        set({ match: { ...m, resultVotes: votes } })

        // 내가 투표하면 상대들이 순차적으로 같은 결과에 동의한다.
        const bots = m.players.filter((p) => !p.isMe)
        bots.forEach((b, i) => {
          later(() => {
            const cur = get().match
            if (!cur || cur.id !== m.id || cur.result) return
            if (cur.resultVotes[meId] !== winner) return // 내가 투표를 바꿨으면 중단
            const v = { ...cur.resultVotes, [b.id]: winner }
            set({ match: { ...cur, resultVotes: v } })
            // 전원이 같은 팀에 투표했을 때만 확정한다.
            if (cur.players.every((p) => v[p.id] === winner)) get().finalizeResult(winner)
          }, 900 + i * 1000)
        })
      },

      finalizeResult: (winner) => {
        const m = get().match
        if (!m || m.result) return
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
        const scoreTable: Record<SportId, string> = {
          tennis: '6-4', badminton: '21-18', tabletennis: '11-8', basketball: '21-17',
        }

        set({
          me: {
            ...me,
            elo: { ...me.elo, [sport]: me.elo[sport] + delta },
            wins: me.wins + (iWon ? 1 : 0),
            losses: me.losses + (iWon ? 0 : 1),
          },
          match: { ...m, result: { winner, score: scoreTable[sport], delta }, phase: 'reporting' },
        })
        get().notify('결과 확정!', iWon ? '승리가 기록되었습니다.' : '결과가 기록되었습니다.', '/result')
      },

      giveSticker: (playerId) => {
        const m = get().match
        if (!m || m.stickersGiven.includes(playerId)) return
        set({ match: { ...m, stickersGiven: [...m.stickersGiven, playerId] } })
        // 데모: 상대도 나에게 스티커를 보내 명예 등급이 오른다.
        const me = get().me
        set({ me: { ...me, stickers: me.stickers + 1 } })
      },

      finishMatch: () => {
        const m = get().match
        if (!m) return
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
        set({ history: [record, ...get().history], match: null })
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
      markAllRead: () => set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) }),
      joinClan: (id) => set({ clanId: get().clanId === id ? null : id }),

      reset: () => {
        clearTimers()
        set({
          account: null, me: emptyMe(), match: null, history: [],
          notifications: [], toast: null, clanId: null, coords: HOME,
        })
      },
    }),
    {
      name: 'matchpoint-v1',
      partialize: (s) => ({
        account: s.account, me: s.me, history: s.history,
        notifications: s.notifications, clanId: s.clanId,
      }),
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
    }, 1500 + i * 1800)
  })
}
