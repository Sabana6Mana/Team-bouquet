import type { ReactNode } from 'react'
import { honorOf, tierOf } from '../lib/game'
import type { MatchPhase } from '../types'

/** 진행 중인 매칭의 현재 단계로 안전하게 복귀할 화면. */
export function activeMatchPath(phase: MatchPhase): string {
  if (phase === 'queue') return '/queue'
  if (phase === 'teaming') return '/teams'
  if (phase === 'payment') return '/payment'
  if (phase === 'reporting' || phase === 'done') return '/result'
  return '/room'
}

export function TierBadge({ elo, size = 'md' }: { elo: number; size?: 'sm' | 'md' }) {
  const t = tierOf(elo)
  return (
    <span
      className="chip"
      style={{
        color: t.color,
        borderColor: `${t.color}55`,
        background: `${t.color}18`,
        height: size === 'sm' ? 22 : 28,
        fontSize: size === 'sm' ? 11 : 12,
      }}
    >
      {t.name} · <span className="mono">{elo}</span>
    </span>
  )
}

export function HonorBadge({ stickers }: { stickers: number }) {
  const h = honorOf(stickers)
  return (
    <span className="chip" style={{ color: h.color, borderColor: `${h.color}55`, background: `${h.color}16` }}>
      {'★'.repeat(h.level)}
      <span style={{ opacity: 0.35 }}>{'★'.repeat(5 - h.level)}</span>
      <span style={{ marginLeft: 2 }}>{h.name}</span>
    </span>
  )
}

export function Jumbotron({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="jumbo">
      <div className="jumbo-head">
        <span className="led" />
        <span className="grow">{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      {onBack && (
        <button onClick={onBack} style={{ fontSize: 22, lineHeight: 1, width: 28 }} aria-label="뒤로">
          ‹
        </button>
      )}
      <h2 className="h2 grow">{title}</h2>
      {right}
    </div>
  )
}

export function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="center stack" style={{ padding: '64px 24px', textAlign: 'center', gap: 10 }}>
      <div style={{ fontSize: 46, opacity: 0.55 }}>{icon}</div>
      <h3 className="h3">{title}</h3>
      <p className="body" style={{ maxWidth: 260 }}>{body}</p>
    </div>
  )
}

export function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: i === current ? 22 : 7, height: 7, borderRadius: 4,
            background: i <= current ? 'var(--cyan)' : 'var(--line)',
            transition: 'all 0.25s ease',
          }}
        />
      ))}
    </div>
  )
}
