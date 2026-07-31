import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'

export default function ToastHost() {
  const toast = useApp((s) => s.toast)
  const dismiss = useApp((s) => s.dismissToast)
  const nav = useNavigate()
  if (!toast) return null

  return (
    <div
      className="toast"
      onClick={() => {
        dismiss()
        if (toast.link) nav(toast.link)
      }}
    >
      <div
        style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          display: 'grid', placeItems: 'center', fontSize: 17,
          background: 'linear-gradient(135deg,var(--court),var(--court-2))',
        }}
      >
        🔔
      </div>
      <div className="grow">
        <div className="row spread" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13.5 }}>{toast.title}</strong>
          <span className="small" style={{ fontSize: 10 }}>지금</span>
        </div>
        <div className="small" style={{ marginTop: 2, color: 'var(--muted)' }}>{toast.body}</div>
      </div>
    </div>
  )
}
