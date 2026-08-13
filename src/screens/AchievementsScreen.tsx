import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RARITY_META, localAchievementProgress } from '../data/achievements'
import { SeasonQuestPanel } from '../components/gameplay/GameplayWidgets'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'
import { useApp } from '../store/useApp'
import { winStreakOf } from '../lib/game'
import { useGameplay } from '../lib/useGameplay'

type Filter = 'all' | 'unlocked' | 'locked'

export default function AchievementsScreen() {
  const nav = useNavigate()
  const location = useLocation()
  const backend = useBackend()
  const me = useApp((state) => state.me)
  const history = useApp((state) => state.history)
  const equippedTitleCode = useApp((state) => state.equippedTitleCode)
  const equipLocalTitle = useApp((state) => state.equipLocalTitle)
  const demoHistory = useApp((state) => state.demoHistory)
  const demoTitleCode = useApp((state) => state.demoTitleCode)
  const equipDemoTitle = useApp((state) => state.equipDemoTitle)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * 체험 매칭으로 얻은 기록이 있으면 도전과제를 직접 계산한다.
   *
   * 체험 경기는 서버에 저장되지 않아 서버가 내려주는 도전과제에는 잡히지 않는다.
   * 서버 기록과 체험 기록을 합쳐서 세면 두 경로가 모두 반영된다.
   */
  const hasDemoProgress = demoHistory.length > 0
  const useLocalAchievements = !backend.enabled || hasDemoProgress
  const combinedHistory = useMemo(
    () => (hasDemoProgress ? [...demoHistory, ...history] : history),
    [hasDemoProgress, demoHistory, history],
  )
  // 서버에서 온 me 에는 체험 연승이 없다. 합친 기록으로 다시 센다.
  const localMe = useMemo(() => {
    if (!hasDemoProgress) return me
    const streak = winStreakOf({ ...me, isMe: true }, combinedHistory)
    return { ...me, bestStreak: Math.max(me.bestStreak ?? 0, streak) }
  }, [hasDemoProgress, me, combinedHistory])

  const achievements = useLocalAchievements
    ? localAchievementProgress(localMe, combinedHistory, hasDemoProgress ? demoTitleCode : equippedTitleCode)
    : backend.achievements
  const gameplay = useGameplay()
  const unlockedCount = achievements.filter((achievement) => achievement.unlockedAt).length
  const equipped = achievements.find((achievement) => achievement.equipped)
  const shown = useMemo(() => achievements.filter((achievement) => {
    if (filter === 'unlocked') return Boolean(achievement.unlockedAt)
    if (filter === 'locked') return !achievement.unlockedAt
    return true
  }), [achievements, filter])

  useEffect(() => {
    if (location.hash !== '#season-quests') return
    const target = document.getElementById('season-quests')
    if (!target) return
    const frame = requestAnimationFrame(() => {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [location.hash])

  const equip = async (code: string | null) => {
    setBusy(code ?? 'none')
    setError(null)
    try {
      // 체험 진행 중에는 서버에 없는 도전과제라 로컬에만 장착한다.
      if (hasDemoProgress) equipDemoTitle(code)
      else if (backend.enabled) await backend.equipTitle(code)
      else equipLocalTitle(code)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '칭호를 장착하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overlay achievement-screen">
      <TopBar title="도전과제 · 칭호" onBack={() => nav('/profile')} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 16 }}>
          <section className="achievement-hero">
            <div className="achievement-hero__crest" aria-hidden="true">🏆</div>
            <div className="stack grow" style={{ gap: 5 }}>
              <span className="small">현재 장착 칭호</span>
              <strong>{equipped ? `《${equipped.rewardTitle}》` : '아직 장착한 칭호가 없습니다'}</strong>
              <span className="small">도전과제 {unlockedCount}/{achievements.length} 달성</span>
            </div>
            {equipped && (
              <button className="chip" disabled={busy !== null} onClick={() => void equip(null)}>
                칭호 해제
              </button>
            )}
          </section>

          <section id="season-quests" tabIndex={-1} aria-label="시즌 퀘스트">
            <SeasonQuestPanel gameplay={gameplay} />
          </section>

          <div className="achievement-progress-summary">
            <i style={{ width: `${achievements.length ? (unlockedCount / achievements.length) * 100 : 0}%` }} />
          </div>

          <div className="row" style={{ gap: 7 }}>
            {([
              ['all', `전체 ${achievements.length}`],
              ['unlocked', `달성 ${unlockedCount}`],
              ['locked', `도전 중 ${achievements.length - unlockedCount}`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={`chip achievement-filter${filter === value ? ' is-active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {!backend.achievementsReady && backend.enabled ? (
            <div className="card center" style={{ padding: 28 }}><div className="spinner" /></div>
          ) : (
            <div className="stack" style={{ gap: 11 }}>
              {shown.map((achievement) => {
                const unlocked = Boolean(achievement.unlockedAt)
                const rarity = RARITY_META[achievement.rarity]
                const percent = Math.min(100, (achievement.progress / achievement.target) * 100)
                return (
                  <article
                    key={achievement.code}
                    className={`achievement-card rarity-${achievement.rarity}${unlocked ? ' is-unlocked' : ' is-locked'}${achievement.equipped ? ' is-equipped' : ''}`}
                    style={{ '--rarity-color': rarity.color } as CSSProperties}
                  >
                    <div className="achievement-card__icon" aria-hidden="true">
                      {unlocked ? achievement.icon : '🔒'}
                    </div>
                    <div className="stack grow" style={{ gap: 6, minWidth: 0 }}>
                      <div className="row spread" style={{ gap: 8 }}>
                        <strong>{achievement.name}</strong>
                        <span className="achievement-rarity">{rarity.label}</span>
                      </div>
                      <p className="small">{achievement.description}</p>
                      <div className="achievement-card__reward">
                        <span>칭호 보상</span>
                        <b>《{achievement.rewardTitle}》</b>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="bar grow"><i style={{ width: `${percent}%`, background: rarity.color }} /></div>
                        <span className="mono small">{Math.min(achievement.progress, achievement.target)}/{achievement.target}</span>
                      </div>
                    </div>
                    {unlocked && (
                      <button
                        className={`btn sm achievement-equip${achievement.equipped ? ' is-equipped' : ''}`}
                        disabled={busy !== null || achievement.equipped}
                        onClick={() => void equip(achievement.code)}
                      >
                        {achievement.equipped ? '장착 중' : busy === achievement.code ? '장착 중…' : '장착'}
                      </button>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {error && <div className="card" style={{ color: 'var(--red)' }}>{error}</div>}
          <p className="small" style={{ textAlign: 'center', lineHeight: 1.6 }}>
            칭호는 꾸미기 보상이며 매칭이나 ELO에 능력치 효과를 주지 않습니다.
          </p>
        </div>
      </div>
    </div>
  )
}
