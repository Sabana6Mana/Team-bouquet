import { useApp } from '../store/useApp'
import { CLANS, NPCS } from '../data/seed'
import { SPORTS, tierOf } from '../lib/game'
import { Jumbotron } from '../components/ui'
import Avatar from '../components/Avatar'

export default function ClanScreen() {
  const clanId = useApp((s) => s.clanId)
  const joinClan = useApp((s) => s.joinClan)
  const me = useApp((s) => s.me)

  const myClan = CLANS.find((c) => c.id === clanId) ?? null
  const ranked = [...CLANS].sort((a, b) => b.points - a.points)

  return (
    <div className="screen">
      <div className="pad stack" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="h1">클랜</h1>
          <p className="body">동네 팀에 들어가 함께 랭킹을 올려보세요.</p>
        </div>

        {myClan ? (
          <div
            className="card stack"
            style={{ gap: 14, borderColor: 'rgba(47, 125, 70,0.45)', background: 'linear-gradient(160deg, rgba(47, 125, 70,0.14), transparent)' }}
          >
            <div className="row" style={{ gap: 13 }}>
              <div className="avatar lg" style={{ fontSize: 30 }}>{myClan.emblem}</div>
              <div className="stack grow" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 7 }}>
                  <strong style={{ fontSize: 17 }}>{myClan.name}</strong>
                  <span className="chip" style={{ height: 20, fontSize: 10, color: 'var(--cyan)' }}>[{myClan.tag}]</span>
                </div>
                <span className="small">
                  {SPORTS[myClan.sport].emoji} {myClan.region} · 멤버 {myClan.memberCount}명
                </span>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end' }}>
                <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)' }}>
                  {myClan.points.toLocaleString()}
                </span>
                <span className="small" style={{ fontSize: 10 }}>클랜 점수</span>
              </div>
            </div>
            <div className="divider" />
            <div className="row" style={{ gap: 9 }}>
              <span style={{ fontSize: 15 }}>📢</span>
              <span className="small" style={{ color: 'var(--text)' }}>{myClan.notice}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm grow">클랜 채팅</button>
              <button className="btn sm grow">클랜 매치 잡기</button>
              <button className="btn sm ghost" style={{ color: 'var(--red)' }} onClick={() => joinClan(myClan.id)}>
                탈퇴
              </button>
            </div>
          </div>
        ) : (
          <div className="card stack center" style={{ gap: 10, padding: 24, textAlign: 'center' }}>
            <span style={{ fontSize: 38 }}>🛡️</span>
            <strong style={{ fontSize: 16 }}>아직 소속된 클랜이 없어요</strong>
            <p className="small">클랜에 가입하면 정기 모임과 클랜 대항전에 참여할 수 있습니다.</p>
          </div>
        )}

        {/* 클랜 멤버 (가입 시) */}
        {myClan && (
          <Jumbotron title="클랜 멤버">
            {[me, ...NPCS.filter((n) => n.clanId === myClan.id)].slice(0, 6).map((p, i) => {
              const t = tierOf(p.elo[myClan.sport])
              return (
                <div key={p.id} className="lb-row">
                  <span className={`rank${i < 3 ? ` g${i + 1}` : ''}`}>{i + 1}</span>
                  <div className="row grow" style={{ gap: 9 }}>
                    <span style={{ fontSize: 16 }}><Avatar player={p} kind="face" /></span>
                    <span
                      style={{
                        fontSize: 13, fontWeight: p.isMe ? 800 : 600,
                        color: p.isMe ? '#7fe0a0' : '#eef8f0',
                        textShadow: p.isMe ? '0 0 8px rgba(127,224,160,0.7)' : undefined,
                      }}
                    >
                      {p.nickname}{p.isMe && ' (나)'}
                    </span>
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: t.led }}>{p.elo[myClan.sport]}</span>
                </div>
              )
            })}
          </Jumbotron>
        )}

        {/* 클랜 랭킹 / 모집 */}
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">우리 동네 클랜 랭킹</span>
          {ranked.map((c, i) => {
            const joined = c.id === clanId
            return (
              <div key={c.id} className="card row" style={{ gap: 12, borderColor: joined ? 'rgba(47, 125, 70,0.4)' : 'var(--line)' }}>
                <span className={`rank${i < 3 ? ` g${i + 1}` : ''}`} style={{ width: 24, height: 24 }}>{i + 1}</span>
                <div className="avatar">{c.emblem}</div>
                <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong style={{ fontSize: 14 }}>{c.name}</strong>
                    <span className="small" style={{ fontSize: 10 }}>[{c.tag}]</span>
                  </div>
                  <span className="small" style={{ fontSize: 11 }}>
                    {SPORTS[c.sport].emoji} {c.region} · {c.memberCount}명 · <span className="mono">{c.points.toLocaleString()}p</span>
                  </span>
                </div>
                <button
                  className={`btn sm${joined ? '' : ' primary'}`}
                  onClick={() => joinClan(c.id)}
                  disabled={!!clanId && !joined}
                >
                  {joined ? '가입됨' : '가입'}
                </button>
              </div>
            )
          })}
        </div>

        <button className="btn" style={{ width: '100%' }}>+ 새 클랜 만들기</button>
      </div>
    </div>
  )
}
