import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import BottomNav from './components/BottomNav'
import ToastHost from './components/ToastHost'
import { useApp } from './store/useApp'

import Onboarding from './screens/Onboarding'
import MapScreen from './screens/MapScreen'
import RankingScreen from './screens/RankingScreen'
import ClanScreen from './screens/ClanScreen'
import AlertsScreen from './screens/AlertsScreen'
import ProfileScreen from './screens/ProfileScreen'
import MatchSetup from './screens/MatchSetup'
import QueueScreen from './screens/QueueScreen'
import RoomScreen from './screens/RoomScreen'
import TeamScreen from './screens/TeamScreen'
import PaymentScreen from './screens/PaymentScreen'
import ResultScreen from './screens/ResultScreen'

function TabLayout() {
  const unread = useApp((s) => s.notifications.filter((n) => !n.read).length)
  return (
    <>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
      <BottomNav badge={unread} />
    </>
  )
}

/** 온보딩을 마치지 않았으면 어떤 경로로 들어와도 온보딩으로 보낸다. */
function Guard({ children }: { children: React.ReactNode }) {
  const account = useApp((s) => s.account)
  const loc = useLocation()
  if (!account || account.interests.length === 0) {
    return loc.pathname === '/onboarding' ? <>{children}</> : <Navigate to="/onboarding" replace />
  }
  if (loc.pathname === '/onboarding') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const setCoords = useApp((s) => s.setCoords)

  // 실제 사용자 위치를 받아오되, 거부/실패 시 기본 좌표(강남)를 유지한다.
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [])

  return (
    <div className="shell">
      <Guard>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />

          <Route element={<TabLayout />}>
            <Route path="/" element={<MapScreen />} />
            <Route path="/ranking" element={<RankingScreen />} />
            <Route path="/clan" element={<ClanScreen />} />
            <Route path="/alerts" element={<AlertsScreen />} />
          </Route>

          {/* 프로필은 탭이 아니라 지도 상단 카드에서 들어가는 상세 화면 */}
          <Route path="/profile" element={<ProfileScreen />} />

          <Route path="/queue/new" element={<MatchSetup />} />
          <Route path="/queue" element={<QueueScreen />} />
          <Route path="/room" element={<RoomScreen />} />
          <Route path="/teams" element={<TeamScreen />} />
          <Route path="/payment" element={<PaymentScreen />} />
          <Route path="/result" element={<ResultScreen />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Guard>
      <ToastHost />
    </div>
  )
}
