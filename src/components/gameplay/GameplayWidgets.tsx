import type {
  GameplayOutcome,
  GameplaySeasonQuest,
  GameplaySummary,
} from '../../data/gameplay'

function percent(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
}

function ProgressBar({
  value,
  total,
  color = 'var(--court)',
  label,
}: {
  value: number
  total: number
  color?: string
  label: string
}) {
  const width = percent(value, total)
  return (
    <div
      className="bar grow"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(value, total)}
    >
      <i style={{ width: `${width}%`, background: color }} />
    </div>
  )
}

/** 지도 상단의 비어 있던 보조 칸에 들어가는 한 번 탭 가능한 진행 요약이다. */
export function MapProgressSummary({
  gameplay,
  onOpen,
}: {
  gameplay: GameplaySummary
  onOpen?: () => void
}) {
  const { region, season } = gameplay
  return (
    <button
      type="button"
      className="local-champion"
      onClick={onOpen}
      aria-label={`${region.name} ${region.discovered}/${region.total}, 시즌 퀘스트 ${season.completed}/${season.total}`}
      style={{
        width: '100%',
        height: '100%',
        padding: '6px 8px',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: 5,
        cursor: onOpen ? 'pointer' : 'default',
        textAlign: 'left',
      }}
    >
      <span className="row spread" style={{ gap: 5, minWidth: 0, flexDirection: 'row' }}>
        <span className="row" style={{ gap: 4, minWidth: 0 }}>
          <span aria-hidden="true">🗺️</span>
          <strong style={{ overflow: 'hidden', fontSize: 10.5, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            강남 도감
          </strong>
        </span>
        <span className="mono" style={{ color: 'var(--court)', fontSize: 11, fontWeight: 900 }}>
          {region.discovered}/{region.total}
        </span>
      </span>
      <span className="row spread" style={{ gap: 5, minWidth: 0, flexDirection: 'row' }}>
        <span className="row" style={{ gap: 4, minWidth: 0 }}>
          <span aria-hidden="true">🎯</span>
          <strong style={{ overflow: 'hidden', fontSize: 10.5, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            시즌 퀘스트
          </strong>
        </span>
        <span className="mono" style={{ color: 'var(--purple)', fontSize: 11, fontWeight: 900 }}>
          {season.completed}/{season.total}
        </span>
      </span>
    </button>
  )
}

/** 체육관 상세 시트 안에서 도감과 보스 상태를 한 장으로 묶어 보여 준다. */
export function VenueGameplayCard({
  venueId,
  gameplay,
  onOpenCollection,
}: {
  venueId: string
  gameplay: GameplaySummary
  onOpenCollection?: () => void
}) {
  const venue = gameplay.venues.find((item) => item.id === venueId)
  if (!venue) return null

  const isBossVenue = gameplay.boss.venueId === venueId
  const boss = gameplay.boss
  return (
    <section
      className="card stack"
      style={{
        gap: 9,
        padding: 12,
        borderColor: isBossVenue ? 'rgba(122, 91, 189, 0.34)' : 'var(--line)',
        background: isBossVenue
          ? 'linear-gradient(145deg, rgba(122, 91, 189, 0.10), var(--surface))'
          : 'var(--surface)',
      }}
      aria-label={`${venue.name} 게임 진행 상태`}
    >
      <div className="row spread" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 7, minWidth: 0 }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>{venue.discovered ? '🗺️' : '🔒'}</span>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <strong style={{ fontSize: 12.5 }}>
              {venue.discovered ? '도감 등록 완료' : '아직 발견하지 않은 거점'}
            </strong>
            <span className="small" style={{ fontSize: 10.5 }}>
              {venue.discovered
                ? `완료 경기 ${venue.matchCount}회`
                : '이곳에서 경기를 완료하면 공개됩니다.'}
            </span>
          </div>
        </div>
        {onOpenCollection && (
          <button type="button" className="chip" onClick={onOpenCollection} style={{ flexShrink: 0 }}>
            도감 ›
          </button>
        )}
      </div>

      {isBossVenue && (
        <div className="stack" style={{ gap: 6, paddingTop: 8, borderTop: '1px solid rgba(122, 91, 189, 0.18)' }}>
          <div className="row spread" style={{ gap: 8 }}>
            <span className="row" style={{ gap: 5, fontSize: 11.5, fontWeight: 800 }}>
              <span aria-hidden="true">{boss.icon}</span> {boss.name}
            </span>
            <span className="mono" style={{ color: 'var(--purple)', fontSize: 11, fontWeight: 900 }}>
              HP {boss.remainingHp}/{boss.maxHp}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <ProgressBar
              value={boss.maxHp - boss.remainingHp}
              total={boss.maxHp}
              color="linear-gradient(90deg, var(--purple), #cf6fc8)"
              label={`${boss.name} 공략 진행도`}
            />
            <span className="small" style={{ flexShrink: 0, fontSize: 10 }}>
              내 기여 {boss.myContribution}
            </span>
          </div>
          <span className="small" style={{ fontSize: 10 }}>
            👑 {boss.throne.nickname} · {boss.throne.contribution}타격 · ELO와 별도
          </span>
        </div>
      )}
    </section>
  )
}

function QuestRow({ quest }: { quest: GameplaySeasonQuest }) {
  return (
    <div
      className="row"
      style={{
        gap: 10,
        padding: '10px 0',
        borderTop: '1px solid var(--line)',
        opacity: quest.completed ? 0.72 : 1,
      }}
    >
      <span
        className="center"
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 11,
          background: quest.completed ? 'var(--court-soft)' : 'var(--surface-2)',
          fontSize: 18,
        }}
      >
        {quest.completed ? '✓' : quest.icon}
      </span>
      <div className="stack grow" style={{ gap: 5 }}>
        <div className="row spread" style={{ gap: 8 }}>
          <strong style={{ fontSize: 12.5 }}>{quest.name}</strong>
          <span className="mono small" style={{ flexShrink: 0, color: quest.completed ? 'var(--court)' : 'var(--muted)' }}>
            {quest.progress}/{quest.target}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <ProgressBar value={quest.progress} total={quest.target} label={`${quest.name} 진행도`} />
          <span className="small" style={{ flexShrink: 0, fontSize: 9.5 }}>《{quest.rewardTitle}》</span>
        </div>
      </div>
    </div>
  )
}

/** 기존 도전과제 화면 상단에 붙일 시즌 집중 퀘스트 묶음이다. */
export function SeasonQuestPanel({
  gameplay,
  compact = false,
  onOpenAll,
}: {
  gameplay: GameplaySummary
  compact?: boolean
  onOpenAll?: () => void
}) {
  const { season } = gameplay
  const shown = compact
    ? season.quests.filter((quest) => !quest.completed).slice(0, 1)
    : season.quests
  const quests = shown.length > 0 ? shown : season.quests.slice(-1)

  return (
    <section
      className="card stack"
      style={{
        gap: 10,
        padding: 15,
        overflow: 'hidden',
        borderColor: 'rgba(47, 125, 70, 0.30)',
        background: 'linear-gradient(145deg, rgba(47, 125, 70, 0.10), var(--surface) 62%)',
      }}
    >
      <div className="row spread" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span aria-hidden="true" style={{ fontSize: 24 }}>🧭</span>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="label">SEASON QUEST</span>
            <strong style={{ fontSize: 15 }}>{season.name}</strong>
          </div>
        </div>
        <span className="chip" style={{ flexShrink: 0, color: 'var(--court)' }}>
          {season.completed}/{season.total}
        </span>
      </div>

      {!compact && <p className="small" style={{ margin: 0 }}>{season.subtitle}</p>}
      <div>
        {quests.length > 0
          ? quests.map((quest) => <QuestRow key={quest.code} quest={quest} />)
          : <p className="small" style={{ margin: '8px 0' }}>다음 시즌 퀘스트를 준비하고 있습니다.</p>}
      </div>
      <div className="row spread" style={{ gap: 10 }}>
        <span className="small" style={{ fontSize: 10.5 }}>{season.endsLabel} · 능력치 효과 없음</span>
        {onOpenAll && compact && (
          <button type="button" className="chip" onClick={onOpenAll}>전체 보기 ›</button>
        )}
      </div>
    </section>
  )
}

/** 경기 결과 배너 바로 아래에 노출하는 최대 세 줄의 게임 보상 요약이다. */
export function MatchGameplayRewards({ outcome }: { outcome: GameplayOutcome | null | undefined }) {
  if (!outcome) return null

  const rewards: Array<{ icon: string; title: string; body: string; color: string }> = [
    {
      icon: outcome.newVenue ? '✨' : '🗺️',
      title: outcome.newVenue ? `${outcome.venueName} 발견!` : `${outcome.venueName} 재방문`,
      body: `강남 도감 ${outcome.discovered}/${outcome.totalVenues}`,
      color: 'var(--court)',
    },
  ]
  if (outcome.bossDamage > 0) {
    rewards.push({
      icon: '👾',
      title: `주간 보스 HP -${outcome.bossDamage}`,
      body: `남은 HP ${outcome.bossRemainingHp}/${outcome.bossMaxHp}`,
      color: 'var(--purple)',
    })
  }
  if (outcome.unlockedQuests.length > 0) {
    rewards.push({
      icon: '🏷️',
      title: outcome.unlockedQuests.map((quest) => quest.name).join(' · '),
      body: `칭호 ${outcome.unlockedQuests.map((quest) => `《${quest.rewardTitle}》`).join(', ')} 해금`,
      color: 'var(--gold)',
    })
  } else if (rewards.length < 3) {
    rewards.push({
      icon: '🎯',
      title: '강남 원정대 진행',
      body: `시즌 퀘스트 ${outcome.seasonCompleted}/${outcome.seasonTotal}`,
      color: 'var(--court)',
    })
  }

  return (
    <section
      className="card stack"
      style={{ gap: 4, padding: 14, borderColor: 'rgba(184, 134, 11, 0.34)', background: 'linear-gradient(145deg, #fffdf5, var(--surface))' }}
      aria-label="이번 경기 게임 보상"
    >
      <div className="row spread" style={{ marginBottom: 3 }}>
        <span className="label">MATCH REWARDS</span>
        <span className="small" style={{ fontSize: 9.5 }}>ELO와 별도</span>
      </div>
      {rewards.slice(0, 3).map((reward) => (
        <div key={`${reward.title}-${reward.body}`} className="row" style={{ gap: 9, padding: '7px 0' }}>
          <span aria-hidden="true" style={{ width: 24, textAlign: 'center', fontSize: 18 }}>{reward.icon}</span>
          <div className="stack grow" style={{ gap: 1 }}>
            <strong style={{ color: reward.color, fontSize: 12.5 }}>{reward.title}</strong>
            <span className="small" style={{ fontSize: 10.5 }}>{reward.body}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

/** ELO 순위표와 섞지 않고 그 위에 독립적으로 두는 주간 기여도 카드다. */
export function WeeklyThroneCard({
  gameplay,
  onOpenVenue,
}: {
  gameplay: GameplaySummary
  onOpenVenue?: (venueId: string) => void
}) {
  const { boss } = gameplay
  if (!boss.venueId) {
    return (
      <section className="card row" style={{ gap: 12, padding: 16 }}>
        <span aria-hidden="true" style={{ fontSize: 28 }}>👾</span>
        <div className="stack grow" style={{ gap: 4 }}>
          <span className="label">WEEKLY GYM BOSS</span>
          <strong>{boss.name}</strong>
          <span className="small">{boss.endsLabel}</span>
        </div>
      </section>
    )
  }
  const dealt = boss.maxHp - boss.remainingHp
  return (
    <section
      className="card stack"
      style={{
        gap: 12,
        padding: 16,
        borderColor: 'rgba(122, 91, 189, 0.38)',
        background: 'linear-gradient(145deg, rgba(122, 91, 189, 0.13), rgba(184, 134, 11, 0.06), var(--surface))',
      }}
    >
      <div className="row spread" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 3, minWidth: 0 }}>
          <span className="label">WEEKLY GYM BOSS</span>
          <strong style={{ fontSize: 15 }}>{boss.icon} {boss.name}</strong>
          <span className="small" style={{ fontSize: 10.5 }}>{boss.venueName} · {boss.endsLabel}</span>
        </div>
        {onOpenVenue && (
          <button type="button" className="chip" onClick={() => onOpenVenue(boss.venueId)} style={{ flexShrink: 0 }}>
            지도 ›
          </button>
        )}
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="row spread">
          <span className="small">공동 공략 진행도</span>
          <span className="mono" style={{ color: 'var(--purple)', fontSize: 12, fontWeight: 900 }}>
            HP {boss.remainingHp}/{boss.maxHp}
          </span>
        </div>
        <ProgressBar
          value={dealt}
          total={boss.maxHp}
          color="linear-gradient(90deg, var(--purple), #d19a31)"
          label={`${boss.name} 공동 공략 진행도`}
        />
      </div>

      <div
        className="row"
        style={{ gap: 11, padding: 11, borderRadius: 13, background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(184,134,11,0.22)' }}
      >
        <span aria-hidden="true" style={{ fontSize: 28 }}>👑</span>
        <span aria-hidden="true" style={{ fontSize: 22 }}>{boss.throne.avatar}</span>
        <div className="stack grow" style={{ gap: 2 }}>
          <strong style={{ fontSize: 13 }}>{boss.throne.nickname}{boss.throne.isMe ? ' (나)' : ''}</strong>
          <span className="small" style={{ fontSize: 10.5 }}>이번 주 왕좌 · {boss.throne.contribution}타격</span>
        </div>
        <span className="chip" style={{ color: 'var(--purple)' }}>내 기여 {boss.myContribution}</span>
      </div>
      <span className="small" style={{ fontSize: 10, textAlign: 'center' }}>
        경기 기여도 순위이며 매칭 범위·ELO·승패 판정에는 영향을 주지 않습니다.
      </span>
    </section>
  )
}
