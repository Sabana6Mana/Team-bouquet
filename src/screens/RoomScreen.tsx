import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { VENUES } from '../data/seed'
import type { Match, Player, SportId } from '../types'
import {
  DAYS_AHEAD, MODE_LABEL, SPORTS, TIME_SLOTS, bookedHoursFor, dayLabel,
  encodeSlot, isPastSlot, isSlotOpen, slotDay, slotHour, slotLabel, slotShortLabel,
  tierOf, winStreakOf, won,
} from '../lib/game'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import {
  INTRO_CAST_MS, INTRO_HERO_MS, INTRO_SETTLE_MS, INTRO_TAIL_MS,
} from '../lib/matchIntro'

// three.js 는 무겁다. 매칭 화면에 들어올 때만 따로 받아 첫 화면을 가볍게 둔다.
const CourtStage = lazy(() => import('../components/CourtStage'))

/** 말풍선이 머무는 시간(ms). 대화 흐름은 채팅 로그에서 다시 볼 수 있다. */
const BUBBLE_MS = 3600

/** 한 시간 칸이 지금 어떤 상태인지. 표시와 클릭 가능 여부를 함께 정한다. */
type SlotState = 'open' | 'picked' | 'booked' | 'past'

/**
 * 등장 연출 단계.
 * hero(코트 확대 + 문구) → settle(문구 퇴장) → cast(캐릭터가 차례로 등장) → done
 * cast 까지는 화면이 아직 연출 중이라 채팅을 막는다.
 */
type Intro = 'hero' | 'settle' | 'cast' | 'done'

/**
 * 이미 등장 연출을 보여 준 매치.
 * 지도에 나갔다 돌아올 때마다 다시 트는 것을 막는다.
 */
const introShown = new Set<string>()

/**
 * 선수를 두 편으로 가른다. 내 편이 언제나 home 이다.
 * 팀이 아직 정해지지 않았으면 절반씩 나눠 마주 보게만 해 둔다.
 */
function splitSides(match: Match, meId: string): { home: Player[]; away: Player[] } {
  const byId = new Map(match.players.map((player) => [player.id, player]))
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is Player => Boolean(p))
  const a = pick(match.teams.a)
  const b = pick(match.teams.b)

  if (a.length > 0 && b.length > 0) {
    return match.teams.b.includes(meId) ? { home: b, away: a } : { home: a, away: b }
  }

  // 팀 배정 전. 나를 맨 앞에 두고 반으로 가른다.
  const ordered = [...match.players].sort((x, y) => Number(y.isMe) - Number(x.isMe))
  const half = Math.ceil(ordered.length / 2)
  return { home: ordered.slice(0, half), away: ordered.slice(half) }
}

/** 뷰포트가 가로인지. 기기 방향이 아니라 창 비율을 본다(데스크톱도 가로다). */
function useLandscape() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(orientation: landscape)')
    const sync = () => setWide(query.matches)
    query.addEventListener('change', sync)
    sync()
    return () => query.removeEventListener('change', sync)
  }, [])
  return wide
}

/** 코트에 선 선수 한 명. 말할 때만 말풍선이 뜬다. */
function ArenaPlayer({
  player, voted, says, delay = 0,
}: { player: Player; voted: boolean; says?: string; delay?: number }) {
  return (
    <div
      className={`arena-player${voted ? ' is-voted' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {says && <span className="arena-bubble fade-in">{says}</span>}
      {/* 아바타는 도트 그래픽이 준비될 때까지 이모지로 대신한다. */}
      <span className="arena-player__avatar" aria-hidden="true">{player.avatar}</span>
      <span className="arena-player__name">{player.isMe ? '나' : player.nickname}</span>
    </div>
  )
}

/**
 * 가로 무대에 서는 선수. 아이콘이 아니라 발판 위에 선 캐릭터로 그린다.
 * 크기는 부모가 --figure 로 정한다(인원이 많을수록 작아진다).
 */
function StagePlayer({
  player, voted, says, side, onOpen, delay = 0, ablaze = false, children,
}: {
  player: Player; voted: boolean; says?: string
  side: 'home' | 'away'; delay?: number
  /** 연승 중이면 등 뒤에서 불길이 타오른다. */
  ablaze?: boolean
  /** 없으면 누를 수 없는 캐릭터가 된다(전적이 이미 아래에 펼쳐진 경우). */
  onOpen?: () => void
  /** 전적 창. 이 캐릭터 안에 두어야 아바타에서 자라나는 것처럼 보인다. */
  children?: React.ReactNode
}) {
  const figure = (
    <>
      <span className="stage-player__pad" aria-hidden="true" />
      {/* 불길은 아바타보다 뒤에 깔려 후광처럼 보인다. */}
      {ablaze && <span className="stage-player__blaze" aria-hidden="true" />}
      {/* 아바타는 도트 그래픽이 준비될 때까지 이모지로 대신한다. */}
      <span className="stage-player__body" aria-hidden="true">{player.avatar}</span>
    </>
  )

  return (
    <div
      className={`stage-player is-${side}${voted ? ' is-voted' : ''}${ablaze ? ' is-ablaze' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {says && <span className="arena-bubble fade-in">{says}</span>}
      {onOpen ? (
        <button
          className="stage-player__stand"
          onClick={onOpen}
          aria-label={`${player.isMe ? '나' : player.nickname} 전적 보기`}
        >
          {figure}
        </button>
      ) : (
        <span className="stage-player__stand">{figure}</span>
      )}
      <span className="stage-player__name">{player.isMe ? '나' : player.nickname}</span>
      {children}
    </div>
  )
}

/**
 * 개인 전적.
 * placement 가 'inline' 이면 캐릭터 아래에 그대로 펼쳐지고(1대1처럼 자리가 넉넉할 때),
 * 아니면 누른 아바타 옆에서 자라나는 창이 된다.
 */
function PlayerProfile({
  player, sport, streak, placement, onClose,
}: {
  player: Player; sport: SportId; streak: number
  placement: 'home' | 'away' | 'inline'; onClose?: () => void
}) {
  const elo = player.elo[sport]
  const tier = tierOf(elo)
  const played = player.wins + player.losses
  const rate = played === 0 ? null : Math.round((player.wins / played) * 100)
  const inline = placement === 'inline'

  return (
    <div
      className={`wide-pop is-${placement}`}
      role={inline ? undefined : 'dialog'}
      aria-label={inline ? undefined : '선수 전적'}
    >
      {onClose && (
        <button className="wide-pop__close" onClick={onClose} aria-label="닫기">✕</button>
      )}
      {!inline && <span className="wide-pop__face" aria-hidden="true">{player.avatar}</span>}
      <strong className="wide-pop__name">{player.isMe ? `${player.nickname} (나)` : player.nickname}</strong>
      <span className="wide-pop__tier mono" style={{ color: tier.color }}>
        {tier.name} · {elo} ELO
      </span>

      {/* 연승 중일 때만. 불씨가 옆에서 이글거린다. */}
      {streak >= 2 && (
        <span className="streak-flag">
          <span className="streak-flag__fire" aria-hidden="true">🔥</span>
          {streak}연승중
        </span>
      )}

      <div className="wide-pop__stats">
        <span><small>승리</small><b>{player.wins}</b></span>
        <span><small>패배</small><b>{player.losses}</b></span>
        <span><small>승률</small><b>{rate === null ? '-' : `${rate}%`}</b></span>
      </div>
      <span className="wide-pop__foot">✨ 명예 {player.stickers}개</span>
    </div>
  )
}

export default function RoomScreen() {
  const match = useApp((s) => s.match)
  const me = useApp((s) => s.me)
  const vote = useApp((s) => s.vote)
  const sendChat = useApp((s) => s.sendChat)
  const openReporting = useApp((s) => s.openReporting)
  const cancelMatch = useApp((s) => s.cancelMatch)
  const backendSlotIds = useApp((s) => s.backendSlotIds)
  const history = useApp((s) => s.history)
  const backend = useBackend()
  const nav = useNavigate()
  const wide = useLandscape()
  const [text, setText] = useState('')
  const [day, setDay] = useState(0)
  const [logOpen, setLogOpen] = useState(false)
  /** 전적 창을 연 선수. 없으면 닫힌 상태다. */
  const [profileId, setProfileId] = useState<string | null>(null)
  const [intro, setIntro] = useState<Intro>('done')
  /** 지금 머리 위에 떠 있는 말풍선. playerId → 내용 */
  const [bubbles, setBubbles] = useState<Record<string, string>>({})
  const chatEnd = useRef<HTMLDivElement>(null)
  const seenRef = useRef(-1)
  const bubbleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // 새로 도착한 말만 말풍선으로 띄운다.
  // 화면에 처음 들어왔을 때 지난 대화가 한꺼번에 터지지 않도록 첫 회는 건너뛴다.
  useEffect(() => {
    const chat = match?.chat ?? []
    // 연출 중에는 캐릭터가 아직 없거나 등장하는 중이라 말풍선을 띄우지 않는다.
    // 지나간 말이 나중에 한꺼번에 터지지 않도록 읽음 위치만 맞춰 둔다.
    if (seenRef.current < 0 || chat.length < seenRef.current || intro !== 'done') {
      seenRef.current = chat.length
      return
    }
    const fresh = chat.slice(seenRef.current)
    seenRef.current = chat.length

    fresh.forEach((message) => {
      if (message.system) return
      const speaker = message.playerId
      setBubbles((prev) => ({ ...prev, [speaker]: message.text }))
      clearTimeout(bubbleTimers.current[speaker])
      bubbleTimers.current[speaker] = setTimeout(() => {
        setBubbles((prev) => {
          const next = { ...prev }
          delete next[speaker]
          return next
        })
      }, BUBBLE_MS)
    })
  }, [match?.chat.length, intro])

  useEffect(() => () => {
    Object.values(bubbleTimers.current).forEach(clearTimeout)
  }, [])

  // 매칭이 성사된 직후 한 번만 등장 연출을 튼다.
  // 코트가 코앞까지 다가와 문구가 뜨고, 물러나면서 선수와 UI가 튀어나온다.
  useEffect(() => {
    const id = match?.id
    if (!id) return
    if (introShown.has(id) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      introShown.add(id)
      setIntro('done')
      return
    }
    setIntro('hero')
    const toSettle = setTimeout(() => setIntro('settle'), INTRO_HERO_MS)
    const toCast = setTimeout(() => setIntro('cast'), INTRO_HERO_MS + INTRO_SETTLE_MS)
    const toDone = setTimeout(() => {
      // 끝까지 재생한 뒤에야 "봤음"으로 남긴다.
      // 시작하자마자 기록하면 StrictMode 가 effect 를 두 번 돌릴 때
      // 두 번째 실행이 스스로 남긴 기록을 보고 연출을 건너뛴다.
      introShown.add(id)
      setIntro('done')
    }, INTRO_HERO_MS + INTRO_SETTLE_MS + INTRO_CAST_MS + INTRO_TAIL_MS)
    return () => { clearTimeout(toSettle); clearTimeout(toCast); clearTimeout(toDone) }
  }, [match?.id])

  // 매칭 화면만은 셸의 휴대폰 폭을 풀어 준다.
  // 가로일 때 무대를 화면 끝까지 쓰기 위해서다(스타일은 CSS 가 판단한다).
  useEffect(() => {
    document.body.classList.add('arena-wide')
    return () => document.body.classList.remove('arena-wide')
  }, [])

  useEffect(() => {
    // 가로에서는 채팅이 늘 떠 있고, 세로에서는 로그를 펼쳤을 때만 따라간다.
    if (wide || logOpen) chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [match?.chat.length, logOpen, wide])

  useEffect(() => {
    if (!match) { nav('/', { replace: true }); return }
    if (match.phase === 'teaming') nav('/teams', { replace: true })
    if (match.phase === 'payment') nav('/payment', { replace: true })
    if (match.phase === 'reporting') nav('/result', { replace: true })
  }, [match?.phase, match])

  if (!match) return null

  const venue = VENUES.find((v) => v.id === match.venueId)
  const venueName = venue?.name ?? match.venueName ?? '매칭 장소'
  const meta = SPORTS[match.sport]
  const myVote = match.votes[me.id]
  const pricePerHour = venue?.pricePerHour ?? match.venuePricePerHour
  const perPerson = pricePerHour === undefined ? null : Math.round(pricePerHour / match.capacity)
  const votedCount = Object.keys(match.votes).length
  const confirmed = match.phase === 'confirmed'
  const { home, away } = splitSides(match, me.id)
  const profile = match.players.find((p) => p.id === profileId) ?? null

  const votersOf = (slot: number) =>
    match.players.filter((p) => match.votes[p.id] === slot)

  /** 이 슬롯이 아예 잡을 수 없는 자리인지. 서버 모드면 열린 슬롯 목록을 따른다. */
  const isBooked = (slot: number) => (backend.liveMatch
    ? !backendSlotIds[slot] && match.confirmedSlot !== slot
    : bookedHoursFor(match.venueId, slotDay(slot)).includes(slotHour(slot)))

  /** 특정 선수 기준으로 본 칸 상태. */
  const slotStateFor = (playerId: string, day: number, hour: number): SlotState => {
    const slot = encodeSlot(day, hour)
    if (isPastSlot(day, hour)) return 'past'
    if (isBooked(slot)) return 'booked'
    return match.votes[playerId] === slot ? 'picked' : 'open'
  }

  const reportingAvailable = !backend.liveMatch
    || (match.confirmedSlotEndsAt !== undefined && Date.now() >= match.confirmedSlotEndsAt)

  const cancelActiveMatch = () => {
    if (!window.confirm('이 매칭을 취소할까요? 확정된 장소와 시간도 다시 예약 가능 상태로 돌아갑니다.')) return
    cancelMatch()
    nav('/', { replace: true })
  }

  const submitChat = (event: React.FormEvent) => {
    event.preventDefault()
    sendChat(text)
    setText('')
  }

  /* ─────────────── 공통 조각 ─────────────── */

  const dayStrip = (compact: boolean) => (
    <div className={compact ? 'wide-days' : ''} style={compact ? undefined : { display: 'flex', gap: 7, overflowX: 'auto', padding: '0 16px 2px' }}>
      {Array.from({ length: DAYS_AHEAD }, (_, d) => {
        const l = dayLabel(d)
        const on = day === d
        const voters = match.players.filter((p) => match.votes[p.id] !== undefined && slotDay(match.votes[p.id]) === d)
        const openCount = TIME_SLOTS.filter((h) => backend.liveMatch
          ? Boolean(backendSlotIds[encodeSlot(d, h)])
          : isSlotOpen(match.venueId, d, h)).length
        return (
          <button
            key={d}
            onClick={() => setDay(d)}
            className={compact ? `wide-day${on ? ' is-on' : ''}` : undefined}
            style={compact ? { opacity: openCount === 0 ? 0.4 : 1 } : {
              flexShrink: 0, width: 52, padding: '7px 0', borderRadius: 11,
              border: `1px solid ${on ? 'var(--court)' : 'var(--line)'}`,
              background: on ? 'var(--court)' : 'var(--surface)',
              color: on ? '#fff' : l.isWeekend ? 'var(--red)' : 'var(--text)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              opacity: openCount === 0 ? 0.4 : 1,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700 }}>{l.isToday ? '오늘' : l.weekday}</span>
            <span className="mono" style={{ fontSize: compact ? 12 : 14, fontWeight: 800 }}>{l.date}</span>
            {!compact && (
              <span style={{ fontSize: 9, opacity: 0.85 }}>
                {voters.length > 0 ? voters.map((v) => v.avatar).join('') : `${openCount}칸`}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  /**
   * 한 편에 한 명뿐이면(1대1) 아래가 널널하니 전적을 캐릭터 밑에 바로 펼친다.
   * 여럿이면 자리가 없어 아바타를 눌러 보는 방식으로 둔다.
   */
  const inlineInfo = Math.max(home.length, away.length) === 1
  const streakOf = (player: Player) => winStreakOf(player, history)

  /** 무대 요소가 들어오기 시작하는 시점(캐릭터 등장 포함). */
  const staged = intro === 'cast' || intro === 'done'
  /** 연출이 완전히 끝나 대화를 주고받을 수 있는 시점. */
  const ready = intro === 'done'

  /**
   * 캐릭터 등장 순서. 양 진영을 번갈아 세워 마주 보며 채워지게 한다.
   * 전체가 INTRO_CAST_MS 안에 다 나오도록 간격을 나눈다.
   */
  const castDelay = (() => {
    const order = new Map<string, number>()
    const rounds = Math.max(home.length, away.length)
    let index = 0
    for (let round = 0; round < rounds; round += 1) {
      if (home[round]) order.set(home[round].id, index++)
      if (away[round]) order.set(away[round].id, index++)
    }
    const step = INTRO_CAST_MS / Math.max(order.size, 1)
    return (id: string) => (staged ? (order.get(id) ?? 0) * step : 0)
  })()

  /**
   * 매칭 성사 순간 화면을 덮는 문구. 종목 이름을 넣어 판을 알린다.
   *
   * hero·settle 두 단계에서만 그린다. cast 까지 남겨 두면 is-leaving 이 떨어지면서
   * 등장 애니메이션이 처음부터 다시 돌아, 사라진 문구가 곧바로 되살아난다.
   */
  const heroBanner = (intro === 'hero' || intro === 'settle') && (
    <div className={`arena-hero${intro === 'settle' ? ' is-leaving' : ''}`}>
      <span className="arena-hero__sub">매칭 성사</span>
      <strong className="arena-hero__title">{meta.label} 한판 뜨자!</strong>
      <span className="arena-hero__where">{venueName}</span>
    </div>
  )

  /** 시간 투표 칸. 가로·세로가 같은 방식을 쓰고 배치만 다르다. */
  const slotGrid = TIME_SLOTS.map((h) => {
    const slot = encodeSlot(day, h)
    const state = slotStateFor(me.id, day, h)
    const voters = votersOf(slot)
    const isFinal = match.confirmedSlot === slot
    return (
      <button
        key={h}
        disabled={state === 'booked' || state === 'past' || confirmed}
        onClick={() => vote(slot)}
        className={`slot${state === 'picked' || isFinal ? ' picked' : ''}`}
        style={isFinal ? { borderColor: 'var(--green)', background: 'rgba(31, 138, 99,0.16)', color: 'var(--green)' } : undefined}
      >
        <span className="mono" style={{ fontSize: 13, fontWeight: 800 }}>{h}:00</span>
        {state === 'past' ? (
          <span style={{ fontSize: 9, color: 'var(--dim)' }}>지남</span>
        ) : state === 'booked' ? (
          <span style={{ fontSize: 9, color: 'var(--dim)' }}>예약됨</span>
        ) : voters.length > 0 ? (
          <span style={{ fontSize: 11 }}>{voters.map((v) => v.avatar).join('')}</span>
        ) : (
          <span style={{ fontSize: 9, color: 'var(--dim)' }}>가능</span>
        )}
      </button>
    )
  })

  const chatList = (
    <div className="stack" style={{ gap: 12 }}>
      {match.chat.map((c) => {
        if (c.system) {
          return (
            <div key={c.id} className="center">
              <span className="chip" style={{ height: 'auto', padding: '6px 12px', fontWeight: 500, fontSize: 11, textAlign: 'center', lineHeight: 1.5, color: 'var(--muted)' }}>
                {c.text}
              </span>
            </div>
          )
        }
        const mine = c.playerId === me.id
        const p = match.players.find((x) => x.id === c.playerId)
        return (
          <div key={c.id} className="row fade-in" style={{ gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
            {!mine && <span className="avatar sm">{p?.avatar}</span>}
            <div className="stack" style={{ gap: 3, alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '74%' }}>
              {!mine && <span className="small" style={{ fontSize: 10 }}>{p?.nickname}</span>}
              <div
                style={{
                  padding: '9px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5,
                  background: mine ? 'linear-gradient(135deg,var(--court),var(--court-2))' : 'var(--surface)',
                  color: mine ? '#ffffff' : 'var(--text)',
                  border: mine ? 'none' : '1px solid var(--line)',
                  borderBottomRightRadius: mine ? 4 : 14,
                  borderBottomLeftRadius: mine ? 14 : 4,
                  fontWeight: mine ? 600 : 400,
                }}
              >
                {c.text}
              </div>
            </div>
          </div>
        )
      })}
      <div ref={chatEnd} />
    </div>
  )

  const actionButtons = confirmed ? (
    <>
      <button className="btn ghost sm grow" onClick={() => nav('/')}>지도로</button>
      {backend.liveMatch ? (
        <button className="btn gold sm grow" disabled={!reportingAvailable} onClick={openReporting}>
          {reportingAvailable ? '결과 입력' : '경기 후 입력'}
        </button>
      ) : (
        <button className="btn gold sm grow" onClick={() => nav('/')}>예약 완료</button>
      )}
    </>
  ) : (
    <button className="btn ghost sm grow" style={{ color: 'var(--red)' }} onClick={cancelActiveMatch}>
      매칭 취소
    </button>
  )

  /* ─────────────── 가로: 대치 구도 ─────────────── */

  if (wide) {
    /**
     * 한쪽 진영. 선수가 위에서 아래로 늘어선다.
     * 캐릭터마다 머리 위 말풍선 자리를 비워 두므로 인원이 늘면 조금씩 작아진다.
     *
     * 팀 이름표는 두지 않는다. 이 화면은 아직 시간을 정하는 단계라
     * BLUE/RED 편성 자체가 없다(팀은 다음 화면에서 짠다).
     */
    const side = (players: Player[], at: 'home' | 'away') => (
      <aside className={`wide-side is-${at}${players.some((p) => p.id === profileId) ? ' is-front' : ''}`}>
        <div
          className={`wide-cast is-${at}${inlineInfo ? ' has-info' : ''}`}
          style={{ ['--figure' as string]: players.length > 2 ? '68px' : players.length > 1 ? '82px' : '96px' }}
        >
          {players.map((player) => (
            <StagePlayer
              key={player.id}
              player={player}
              side={at}
              voted={match.votes[player.id] !== undefined}
              ablaze={streakOf(player) >= 2}
              says={bubbles[player.id]}
              // 전적이 이미 아래 펼쳐져 있으면 누를 이유가 없다.
              onOpen={inlineInfo ? undefined : () => setProfileId(player.id === profileId ? null : player.id)}
              delay={castDelay(player.id)}
            >
              {inlineInfo ? (
                <PlayerProfile
                  player={player}
                  sport={match.sport}
                  streak={streakOf(player)}
                  placement="inline"
                />
              ) : player.id === profileId && (
                <PlayerProfile
                  player={player}
                  sport={match.sport}
                  streak={streakOf(player)}
                  placement={at}
                  onClose={() => setProfileId(null)}
                />
              )}
            </StagePlayer>
          ))}
        </div>
      </aside>
    )

    return (
      <div className={`overlay arena arena--wide${staged ? ' is-staged' : ''}`}>
        <Suspense fallback={null}>
          <CourtStage sport={match.sport} wide hero={intro === 'hero'} />
        </Suspense>

        {heroBanner}

        <button className="wide-back" onClick={() => nav('/')} aria-label="지도로 돌아가기">←</button>

        <div className="wide-grid">
          {side(home, 'home')}

          {/* 가운데 — 선택 창 */}
          <section className="wide-panel">
            <header className="wide-panel__head">
              <span className="wide-panel__icon" aria-hidden="true">{meta.emoji}</span>
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: 16 }}>{venueName}</strong>
                <span className="small">📍 {venue?.address ?? '위치 정보 없음'}</span>
              </div>
              <span className="chip">{meta.label}</span>
              <span className="chip">{MODE_LABEL[match.mode]}</span>
              <div className="wide-price">
                <small>인당 요금</small>
                <b>{perPerson === null ? '확인 중' : won(perPerson)}</b>
              </div>
            </header>

            <div className="wide-panel__bar">
              <span className="label">예약 가능한 시간 · {dayLabel(day).isToday ? '오늘' : `${dayLabel(day).date}일`}</span>
              <div className="wide-legend">
                <span><i className="is-open" />선택 가능</span>
                <span><i className="is-picked" />선택됨</span>
                <span><i className="is-booked" />예약됨</span>
                <span><i className="is-past" />지남</span>
              </div>
            </div>

            {dayStrip(true)}

            {/* 세로와 같은 투표 방식. 시간을 누르면 그 칸에 투표한 사람이 모인다. */}
            <div className="wide-slots">{slotGrid}</div>

            <footer className="wide-panel__foot">
              <span aria-hidden="true">👥</span>
              {match.confirmedSlot !== null
                ? `${slotLabel(match.confirmedSlot)} 확정 — 전원이 같은 시간에 투표했습니다.`
                : myVote !== undefined
                  ? `${slotShortLabel(myVote)}에 투표했습니다. 모든 참가자가 같은 시간을 선택해야 확정됩니다. (${votedCount}/${match.capacity})`
                  : `모든 참가자가 같은 시간에 선택해야 확정됩니다. (${votedCount}/${match.capacity})`}
            </footer>
          </section>

          {side(away, 'away')}
        </div>

        {/* 왼쪽 아래 — 매칭 조작 */}
        <div className="wide-actions">{actionButtons}</div>

        {/* 오른쪽 아래 — 채팅. 평소엔 접혀 있어 무대를 가리지 않는다. */}
        {logOpen && (
          <div className="wide-chat fade-in">
            <div className="wide-chat__head">
              <span className="label">매칭 채팅</span>
              <span className="chip" style={{ color: 'var(--cyan)' }}>👥 {match.players.length}</span>
            </div>
            <div className="wide-chat__body">{chatList}</div>
            <form className="wide-chat__form" onSubmit={submitChat}>
              <input
                className="field grow"
                placeholder={ready ? '메시지를 입력하세요…' : '입장 중…'}
                value={text}
                disabled={!ready}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn primary" disabled={!ready || !text.trim()}>➤</button>
            </form>
          </div>
        )}
        <button
          className={`wide-chat-toggle${logOpen ? ' is-open' : ''}`}
          onClick={() => setLogOpen((open) => !open)}
          aria-expanded={logOpen}
        >
          <span aria-hidden="true">💬</span>
          <span>{logOpen ? '채팅 닫기' : '채팅 기록'}</span>
        </button>

        {/* 선수를 누르면 그 사람의 전적만 따로 본다. */}
        {/* 전적 창은 해당 캐릭터 안에서 자라난다. 바깥은 닫기용 막이다. */}
        {profile && (
          <button className="wide-pop-scrim" onClick={() => setProfileId(null)} aria-label="닫기" />
        )}
      </div>
    )
  }

  /* ─────────────── 세로: 위아래 구도 ─────────────── */

  const playerRow = (players: Player[], side: 'home' | 'away') => (
    <div className={`arena-row is-${side}`}>
      {players.map((player) => (
        <ArenaPlayer
          key={player.id}
          player={player}
          voted={match.votes[player.id] !== undefined}
          says={bubbles[player.id]}
          delay={castDelay(player.id)}
        />
      ))}
    </div>
  )

  return (
    <div className={`overlay arena${staged ? ' is-staged' : ''}`}>
      <Suspense fallback={null}>
        <CourtStage sport={match.sport} hero={intro === 'hero'} />
      </Suspense>

      {heroBanner}

      <TopBar
        title={confirmed ? '예약 확정' : '일정 조율'}
        onBack={() => nav('/')}
        right={
          <span className="chip mono" style={{ color: confirmed ? 'var(--green)' : 'var(--gold)' }}>
            {match.confirmedSlot !== null ? slotShortLabel(match.confirmedSlot) : `${votedCount}/${match.capacity}`}
          </span>
        }
      />

      {/* 세로에서만 보이고 잠시 뒤 사라진다. 세로로도 쓸 수는 있다. */}
      <div className="arena-rotate-hint">🔄 가로로 돌리면 대치 화면으로 바뀌어요</div>

      <div className="arena-stage">
        {playerRow(away, 'away')}

        <div className="arena-panel">
          <div className="arena-panel__head">
            <div className="avatar" style={{ background: `${meta.color}18`, borderColor: `${meta.color}44` }}>
              {meta.emoji}
            </div>
            <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{venueName}</strong>
              <span className="small">
                {meta.label} {MODE_LABEL[match.mode]} · 인당 {perPerson === null ? '비용 확인 중' : won(perPerson)}
              </span>
            </div>
          </div>

          <div style={{ padding: '12px 0 14px' }}>
            <div className="row spread" style={{ padding: '0 16px', marginBottom: 9 }}>
              <span className="label">날짜 선택 · 앞으로 {DAYS_AHEAD}일</span>
              <span className="small mono" style={{ color: votedCount === match.capacity ? 'var(--green)' : 'var(--gold)' }}>
                {votedCount}/{match.capacity} 투표
              </span>
            </div>

            {dayStrip(false)}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7, padding: '11px 16px 0' }}>
              {slotGrid}
            </div>

            <div style={{ padding: '0 16px' }}>
              {match.confirmedSlot !== null ? (
                <div
                  className="card row"
                  style={{ marginTop: 11, gap: 10, borderColor: 'rgba(31, 138, 99,0.4)', background: 'rgba(31, 138, 99,0.08)' }}
                >
                  <span style={{ fontSize: 20 }}>✅</span>
                  <div className="stack grow" style={{ gap: 2 }}>
                    <strong style={{ fontSize: 13.5, color: 'var(--green)' }}>{slotLabel(match.confirmedSlot)} 확정</strong>
                    <span className="small" style={{ fontSize: 11 }}>전원이 같은 시간에 투표했습니다.</span>
                  </div>
                </div>
              ) : (
                <p className="small" style={{ marginTop: 10, fontSize: 11 }}>
                  {myVote !== undefined
                    ? `${slotShortLabel(myVote)}에 투표했습니다. 전원이 같은 시간을 고르면 확정됩니다.`
                    : '날짜를 고른 뒤 원하는 시간을 눌러 투표하세요.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {playerRow(home, 'home')}
      </div>

      {logOpen && (
        <>
          <button className="arena-log-scrim" onClick={() => setLogOpen(false)} aria-label="채팅 로그 닫기" />
          <div className="arena-log fade-in">
            <div className="arena-log__head">
              <span className="label">매칭 채팅</span>
              <span className="chip" style={{ color: 'var(--cyan)' }}>{match.players.length}명</span>
            </div>
            <div className="arena-log__body">{chatList}</div>
          </div>
        </>
      )}

      <div className="arena-dock">
        {confirmed ? (
          <div className="stack" style={{ gap: 8 }}>
            {backend.liveMatch && (
              <button className="btn ghost" style={{ width: '100%', color: 'var(--red)' }} onClick={cancelActiveMatch}>
                매칭 취소 · 예약 시간 해제
              </button>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost grow" onClick={() => nav('/')}>지도로 돌아가기</button>
              {backend.liveMatch ? (
                <button className="btn gold grow" disabled={!reportingAvailable} onClick={openReporting}>
                  {reportingAvailable ? '경기 종료 · 결과 입력' : '경기 종료 후 결과 입력 가능'}
                </button>
              ) : (
                <button className="btn gold grow" onClick={() => nav('/')}>예약 완료</button>
              )}
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {backend.liveMatch && (
              <button className="btn ghost" style={{ width: '100%', color: 'var(--red)' }} onClick={cancelActiveMatch}>
                매칭 취소
              </button>
            )}
            <form className="row" style={{ gap: 8 }} onSubmit={submitChat}>
              <input
                className="field grow"
                placeholder={ready ? '메시지 입력' : '입장 중…'}
                value={text}
                disabled={!ready}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn primary" style={{ width: 52, padding: 0 }} disabled={!ready || !text.trim()}>↑</button>
              <button
                type="button"
                className={`arena-log-toggle${logOpen ? ' is-open' : ''}`}
                onClick={() => setLogOpen((open) => !open)}
                aria-expanded={logOpen}
                aria-label="채팅 로그 보기"
              >
                💬
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
