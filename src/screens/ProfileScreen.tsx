import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { CLANS, VENUES } from '../data/seed'
import { localGameplaySummary, unavailableGameplaySummary } from '../data/gameplay'
import { HONOR_GRADES, HONOR_TYPES, SPORT_LIST, SPORTS, honorOf, tierOf } from '../lib/game'
import { TopBar } from '../components/ui'
import { useBackend } from '../context/BackendProvider'

const HONOR_SHORT_LABEL = {
  manner: '매너',
  skill: '실력',
  punctual: '시간 약속',
  fun: '분위기',
} as const

export default function ProfileScreen() {
  const nav = useNavigate()
  const me = useApp((s) => s.me)
  const account = useApp((s) => s.account)
  const history = useApp((s) => s.history)
  const clanId = useApp((s) => s.clanId)
  const reset = useApp((s) => s.reset)
  const backend = useBackend()

  const honor = honorOf(me.stickers)
  const clan = CLANS.find((c) => c.id === clanId)
  const best = SPORT_LIST.reduce((a, b) => (me.elo[a.id] >= me.elo[b.id] ? a : b))
  const bestTier = tierOf(me.elo[best.id])
  const total = me.wins + me.losses
  const winRate = total ? Math.round((me.wins / total) * 100) : 0
  const gameplay = backend.liveMatch
    ? backend.gameplay ?? unavailableGameplaySummary()
    : localGameplaySummary(history, me)

  return (
    <div className="overlay">
      <TopBar title="프로필" onBack={() => nav('/')} />
      <div className="screen">
        <div className="pad stack" style={{ gap: 16 }}>
        {/* 프로필 헤더 */}
        <div
          className="card stack"
          style={{ gap: 14, borderColor: `${bestTier.color}44`, background: `linear-gradient(160deg, ${bestTier.color}16, transparent)` }}
        >
          <div className="row" style={{ gap: 14 }}>
            <div className="avatar lg" style={{ borderColor: `${bestTier.color}66`, overflow: 'hidden' }}>
              {me.avatarUrl ? <img src={me.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : me.avatar}
            </div>
            <div className="stack grow" style={{ gap: 6 }}>
              <strong style={{ fontSize: 20 }}>{me.nickname}</strong>
              {me.title && <span className="profile-title">《{me.title}》</span>}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="chip" style={{ color: bestTier.color, borderColor: `${bestTier.color}55`, background: `${bestTier.color}16` }}>
                  {bestTier.name}
                </span>
                {clan && <span className="chip" style={{ color: 'var(--cyan)' }}>{clan.emblem} [{clan.tag}]</span>}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 0 }}>
            {[
              { label: '전적', value: `${me.wins}승 ${me.losses}패` },
              { label: '승률', value: `${winRate}%` },
              { label: '받은 명예', value: `${me.stickers}개` },
            ].map((s, i) => (
              <div key={s.label} className="stack center grow" style={{ gap: 4, borderLeft: i ? '1px solid var(--line)' : 'none' }}>
                <span className="mono" style={{ fontSize: 16, fontWeight: 800 }}>{s.value}</span>
                <span className="small" style={{ fontSize: 10 }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          <button
            className="card stack"
            style={{ gap: 7, minHeight: 104, padding: 14, textAlign: 'left', borderColor: 'rgba(47,125,70,0.28)' }}
            onClick={() => nav('/collection')}
          >
            <span aria-hidden="true" style={{ fontSize: 24 }}>🗺️</span>
            <strong style={{ fontSize: 13 }}>지역 도감</strong>
            <span className="small">강남 {gameplay.region.discovered}/{gameplay.region.total} 발견</span>
          </button>
          <button
            className="card stack"
            style={{ gap: 7, minHeight: 104, padding: 14, textAlign: 'left', borderColor: 'rgba(184,134,11,0.30)' }}
            onClick={() => nav('/achievements')}
          >
            <span aria-hidden="true" style={{ fontSize: 24 }}>🏆</span>
            <strong style={{ fontSize: 13 }}>시즌 · 칭호</strong>
            <span className="small">
              {gameplay.season.completed}/{gameplay.season.total} 완료
              {me.title ? ` · 《${me.title}》` : ''}
            </span>
          </button>
        </div>

        {/* 명예 등급 */}
        <div className="card stack" style={{ gap: 12 }}>
          <div className="row spread">
            <span className="label">명예 등급</span>
            <span className="chip" style={{ color: honor.color, borderColor: `${honor.color}55`, background: `${honor.color}16` }}>
              Lv.{honor.level} {honor.name}
            </span>
          </div>
          <div className="bar">
            <i
              style={{
                width: honor.next ? `${((me.stickers - honor.min) / (honor.next - honor.min)) * 100}%` : '100%',
                background: `linear-gradient(90deg, ${honor.color}88, ${honor.color})`,
              }}
            />
          </div>
          <div className="row spread">
            {HONOR_GRADES.map((g) => (
              <div key={g.level} className="stack center" style={{ gap: 4, opacity: me.stickers >= g.min ? 1 : 0.28, flex: 1 }}>
                <span style={{ fontSize: 16, color: g.color }}>★</span>
                <span style={{ fontSize: 9, textAlign: 'center', color: 'var(--muted)', lineHeight: 1.3 }}>
                  {g.name.split(' ')[0]}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
              paddingTop: 10, borderTop: '1px solid var(--line)',
            }}
          >
            {HONOR_TYPES.map((item) => (
              <div key={item.id} className="row" style={{ gap: 7, minWidth: 0 }}>
                <span aria-hidden="true">{item.emoji}</span>
                <span className="small grow" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {HONOR_SHORT_LABEL[item.id]}
                </span>
                <strong className="mono" style={{ fontSize: 12 }}>{me.honorCounts?.[item.id] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* 종목별 ELO */}
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">종목별 레이팅</span>
          {SPORT_LIST.map((s) => {
            const t = tierOf(me.elo[s.id])
            const fav = account?.interests.includes(s.id)
            return (
              <div key={s.id} className="card row" style={{ gap: 12, padding: 13 }}>
                <div className="avatar" style={{ background: `${s.color}16`, borderColor: `${s.color}40` }}>{s.emoji}</div>
                <div className="stack grow" style={{ gap: 3 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong style={{ fontSize: 14 }}>{s.label}</strong>
                    {fav && <span style={{ fontSize: 11, color: 'var(--gold)' }}>★</span>}
                  </div>
                  <span className="small" style={{ fontSize: 11, color: t.color }}>{t.name}</span>
                </div>
                <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: t.color }}>{me.elo[s.id]}</span>
              </div>
            )
          })}
        </div>

        {/* 최근 경기 */}
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">내 경기 기록</span>
          {history.length === 0 ? (
            <div className="card center" style={{ padding: 22 }}>
              <span className="small">아직 기록된 경기가 없습니다.</span>
            </div>
          ) : (
            history.map((r) => {
              const v = VENUES.find((x) => x.id === r.venueId)
              const won = r.winners.includes(me.id)
              return (
                <div key={r.id} className="card row" style={{ gap: 12, padding: 13 }}>
                  <div
                    className="avatar"
                    style={{
                      background: won ? 'rgba(184, 134, 11,0.16)' : 'var(--surface-2)',
                      borderColor: won ? 'rgba(184, 134, 11,0.4)' : 'var(--line)',
                    }}
                  >
                    {won ? '🏆' : '💪'}
                  </div>
                  <div className="stack grow" style={{ gap: 3 }}>
                    <strong style={{ fontSize: 13.5, color: won ? 'var(--gold)' : 'var(--muted)' }}>
                      {won ? '승리' : '패배'} · {SPORTS[r.sport].label}
                    </strong>
                    <span className="small" style={{ fontSize: 11 }}>{v?.name} · {r.playedAt}</span>
                  </div>
                  <div className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 800 }}>{r.score}</span>
                    <span className="mono small" style={{ fontSize: 10, color: r.eloDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {r.eloDelta >= 0 ? '+' : ''}{r.eloDelta}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* 계정 */}
        <div className="card stack" style={{ gap: 10 }}>
          <span className="label">계정 정보</span>
          {(backend.enabled
            ? [
                ['로그인', backend.user?.is_anonymous ? '게스트 베타' : (backend.user?.email ?? '카카오 계정')],
                ['사용자 ID', backend.user?.id.slice(0, 8) ?? '-'],
              ]
            : [
                ['이름', account?.name ?? '-'],
                ['통신사', account?.carrier ?? '-'],
                ['휴대폰', account?.phone ? account.phone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3') : '-'],
              ]).map(([k, v]) => (
            <div key={k} className="row spread">
              <span className="small">{k}</span>
              <span style={{ fontSize: 13 }}>{v}</span>
            </div>
          ))}
        </div>

        <button
          className="btn ghost"
          style={{ width: '100%', color: 'var(--red)' }}
          onClick={() => {
            if (backend.enabled) {
              void backend.signOut().then(() => nav('/login', { replace: true }))
              return
            }
            reset()
          }}
        >
          {backend.enabled ? '로그아웃' : '데이터 초기화 (데모)'}
        </button>
        </div>
      </div>
    </div>
  )
}
