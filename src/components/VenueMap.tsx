import { useEffect, useState, type ComponentType } from 'react'
import LegacyVenueMap from './maps/LegacyVenueMap'
import type { VenueMapProps } from './maps/types'

export type { MapMarker } from './maps/types'

type MapEngine = 'maplibre' | 'naver'

function configuredEngine(): MapEngine {
  return (import.meta.env.VITE_MAP_ENGINE as string | undefined)?.trim().toLowerCase() === 'naver'
    ? 'naver'
    : 'maplibre'
}

/**
 * 지도 화면의 공통 입구. MapLibre가 치명적으로 실패할 때만 기존
 * 네이버 지도(키가 없으면 내장 지도)로 내려가 매칭 화면 자체는 보존한다.
 */
export default function VenueMap(props: VenueMapProps) {
  const preferred = configuredEngine()
  const [engine, setEngine] = useState<MapEngine>(preferred)
  const [MapLibreMap, setMapLibreMap] = useState<ComponentType<
    VenueMapProps & { onFatalError: (message: string) => void }
  > | null>(null)

  useEffect(() => setEngine(preferred), [preferred])

  useEffect(() => {
    if (engine !== 'maplibre' || MapLibreMap) return
    let alive = true
    import('./maps/MapLibreVenueMap')
      .then((module) => {
        if (alive) setMapLibreMap(() => module.default)
      })
      .catch((error) => {
        console.warn('[MATCHPOINT] MapLibre 모듈 로딩 실패 → 기존 지도 전환', error)
        if (alive) setEngine('naver')
      })
    return () => { alive = false }
  }, [engine, MapLibreMap])

  if (engine === 'maplibre') {
    if (!MapLibreMap) {
      return (
        <div className="map-wrap">
          <div className="map-loading" role="status">
            <span className="spinner" />
            <span>게임 지도를 준비하는 중…</span>
          </div>
        </div>
      )
    }
    return (
      <MapLibreMap
        {...props}
        onFatalError={(message) => {
          console.warn(`[MATCHPOINT] MapLibre 실패 → 기존 지도 전환: ${message}`)
          setEngine('naver')
        }}
      />
    )
  }

  return <LegacyVenueMap {...props} />
}
