import { NavLink } from 'react-router-dom'

// 프로필은 지도 상단의 내 카드에서 들어간다.
const TABS = [
  { to: '/', icon: '🗺️', label: 'MAP', end: true },
  { to: '/ranking', icon: '🏆', label: 'RANKING', end: false },
  { to: '/clan', icon: '🛡️', label: 'CLAN', end: false },
  { to: '/alerts', icon: '🔔', label: 'ALERTS', end: false },
]

export default function BottomNav({ badge }: { badge?: number }) {
  return (
    <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' on' : ''}`}>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <span className="ico">{t.icon}</span>
            {t.to === '/alerts' && !!badge && (
              <span
                style={{
                  position: 'absolute', top: -4, right: -9,
                  minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
                  background: 'var(--red)', color: '#fff',
                  fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center',
                }}
              >
                {badge}
              </span>
            )}
          </span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
