import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { Empty } from '../components/ui'

function ago(at: number) {
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 60) return '방금 전'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}

export default function AlertsScreen() {
  const notifications = useApp((s) => s.notifications)
  const markAllRead = useApp((s) => s.markAllRead)
  const nav = useNavigate()

  useEffect(() => { markAllRead() }, [])

  return (
    <div className="screen">
      <div className="pad stack" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="h1">알림</h1>
          <p className="body">매칭 완료, 시간 확정, 결제, 경기 결과 알림이 여기에 모입니다.</p>
        </div>

        {notifications.length === 0 ? (
          <Empty icon="🔔" title="알림이 없습니다" body="매칭을 시작하면 인원이 모였을 때 알림을 보내드립니다." />
        ) : (
          <div className="stack" style={{ gap: 9 }}>
            {notifications.map((n) => (
              <button
                key={n.id}
                className="card row"
                style={{ gap: 12, textAlign: 'left', alignItems: 'flex-start' }}
                onClick={() => n.link && nav(n.link)}
              >
                <div
                  style={{
                    width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                    display: 'grid', placeItems: 'center', fontSize: 17,
                    background: 'linear-gradient(135deg,var(--court),var(--court-2))',
                  }}
                >
                  🔔
                </div>
                <div className="stack grow" style={{ gap: 3 }}>
                  <div className="row spread" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{n.title}</strong>
                    <span className="small" style={{ fontSize: 10, flexShrink: 0 }}>{ago(n.at)}</span>
                  </div>
                  <span className="small" style={{ lineHeight: 1.5 }}>{n.body}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
