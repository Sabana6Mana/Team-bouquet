import { useEffect, useRef, useState } from 'react'
import { TIERS, tierOf } from '../lib/game'

interface Props {
  before: number
  after: number
  won: boolean
  /** 연출이 끝나 세부 내용을 펼쳐도 되는 시점 */
  onFinish?: () => void
}

/** 막대와 숫자의 색 상태 */
type Tone = 'base' | 'hot' | 'cold'

/**
 * 경기 결과에 따라 ELO 막대가 움직이는 연출.
 * 승리: 푸르게 빛나며 떨리다가 파바박 차오른 뒤 초록으로 돌아온다.
 * 패배: 붉게 경고하며 오르는 척하다 부들부들 떨린 뒤 확 떨어지고 초록으로 돌아온다.
 */
export default function EloBar({ before, after, won, onFinish }: Props) {
  const tier = tierOf(after)
  const next = TIERS.find((t) => t.min > after)
  const span = next ? next.min - tier.min : 400
  const pctOf = (elo: number) => Math.max(0, Math.min(100, ((elo - tier.min) / span) * 100))

  const beforePct = pctOf(before)
  const afterPct = pctOf(after)
  const delta = after - before

  const [pct, setPct] = useState(beforePct)
  const [shown, setShown] = useState(before)
  const [tone, setTone] = useState<Tone>('base')
  const [motion, setMotion] = useState<'' | 'shake-s' | 'shake-l'>('')
  const [speed, setSpeed] = useState<'' | 'burst' | 'drop'>('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const at = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)) }

    if (won) {
      at(() => { setTone('hot'); setMotion('shake-s') }, 700)   // 달아오르기 시작
      at(() => { setMotion('shake-l'); setSpeed('burst') }, 1500)

      const steps = 8
      for (let i = 1; i <= steps; i++) {
        at(() => {
          const t = i / steps
          setPct(beforePct + (afterPct - beforePct) * t)
          setShown(Math.round(before + delta * t))
        }, 1550 + i * 110)                                      // 파바박
      }
      at(() => { setMotion(''); setSpeed('') }, 2500)
      at(() => setTone('base'), 2750)                            // 초록으로 복귀
      at(() => onFinish?.(), 3300)
    } else {
      at(() => { setTone('cold'); setMotion('shake-s') }, 700)   // 붉게 경고하며
      at(() => setPct(Math.min(100, beforePct + 4)), 1000)       // 오르는 척
      at(() => setMotion('shake-l'), 1600)                       // 부들부들

      at(() => { setSpeed('drop'); setPct(afterPct); setMotion('') }, 2500)
      const steps = 6
      for (let i = 1; i <= steps; i++) {
        at(() => setShown(Math.round(before + delta * (i / steps))), 2500 + i * 70)
      }
      at(() => setSpeed(''), 3050)
      at(() => setTone('base'), 3200)                            // 초록으로 복귀
      at(() => onFinish?.(), 3750)
    }

    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
  }, [])

  const toneColor = tone === 'hot' ? '#2f6fd0' : tone === 'cold' ? '#d3372b' : 'var(--court)'
  const toneGlow =
    tone === 'hot' ? 'rgba(47,111,208,0.5)'
    : tone === 'cold' ? 'rgba(211,55,43,0.5)'
    : 'rgba(47,125,70,0.35)'

  return (
    <div className="stack" style={{ gap: 10, width: '100%' }}>
      <div className="row spread">
        <span className="mono small">{before}</span>
        <span
          className={`mono ${motion}`}
          style={{
            fontSize: 40, fontWeight: 900, lineHeight: 1,
            color: toneColor,
            textShadow: `0 0 18px ${toneGlow}`,
            transition: 'color 0.4s ease, text-shadow 0.4s ease',
          }}
        >
          {shown}
        </span>
        <span
          className="mono small"
          style={{ color: delta >= 0 ? 'var(--court)' : 'var(--red)', fontWeight: 800 }}
        >
          {delta >= 0 ? '+' : ''}{delta}
        </span>
      </div>

      <div className={`elobar ${tone} ${speed} ${motion}`}>
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="row spread">
        <span className="small" style={{ fontSize: 11, color: tier.color, fontWeight: 700 }}>
          {tier.name}
        </span>
        <span className="small" style={{ fontSize: 11 }}>
          {next ? `${next.name}까지 ${Math.max(0, next.min - after)}점` : '최고 티어'}
        </span>
      </div>
    </div>
  )
}
