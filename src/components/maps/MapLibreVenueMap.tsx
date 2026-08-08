import { useEffect, useRef, useState } from 'react'
import maplibregl, { type CustomLayerInterface, type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapMarker, VenueMapProps } from './types'
import { VENUE_MODEL_LAYER_ID, createVenueModelLayer, type VenueModelPlacement } from './venueModelLayer'

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright'
const BUILDING_SOURCE_ID = 'matchpoint-openfreemap'
const BUILDING_LAYER_ID = 'matchpoint-3d-buildings'
const ROUTE_SOURCE_ID = 'matchpoint-route'
const ROUTE_GLOW_LAYER_ID = 'matchpoint-route-glow'
const ROUTE_DASH_LAYER_ID = 'matchpoint-route-dash'
const BASE_ZOOM = 14.85
const BASE_PITCH = 58
const BASE_BEARING = -18

const EMPTY_ROUTE = {
  type: 'FeatureCollection' as const,
  features: [],
}

interface Props extends VenueMapProps {
  onFatalError: (message: string) => void
}

interface VenueMarkerEntry {
  marker: Marker
  element: HTMLButtonElement
  badge: HTMLSpanElement
  image: HTMLImageElement
  click: () => void
}

let labelFontReady: Promise<boolean> | null = null

/**
 * 지도 라벨용 둥근 웹폰트를 기다린다.
 *
 * 한글 글리프는 localIdeographFontFamily 로 브라우저가 직접 그리는데,
 * 웹폰트가 늦게 도착하면 대체 글꼴로 그려진 결과가 캐시돼 버린다.
 * 이미 준비돼 있었으면 false, 새로 기다렸으면 true를 돌려준다.
 * (true일 때만 다시 그리면 되므로 불필요한 재로딩을 막는다.)
 */
function ensureLabelFont(): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve(false)
  const spec = "16px 'Jua'"

  // 이미 준비된 뒤라면 다시 그릴 필요가 없다. 캐시된 결과를 그대로 돌려주면
  // 탭을 옮겼다 돌아올 때마다 새 지도에 setStyle 을 걸어 로딩이 끝나지 않는다.
  if (document.fonts.check(spec)) return Promise.resolve(false)

  if (!labelFontReady) {
    labelFontReady = document.fonts.load(spec)
      .then(() => document.fonts.ready)
      .then(() => true)
      .catch(() => false)
  }
  return labelFontReady
}

function firstLabelLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => (
    layer.type === 'symbol' && Boolean(layer.layout?.['text-field'])
  ))?.id
}

/**
 * 지도에 남길 POI 종류.
 * 편의점·식당·상점 같은 생활 POI는 빼고, 역과 눈에 띄는 랜드마크만 남긴다.
 */
const LANDMARK_POI_CLASSES = [
  // 역. 버스정류장은 이름이 길고 개수가 많아 지도를 덮으므로 제외한다.
  'railway', 'airport',
  // 랜드마크
  'park', 'stadium', 'attraction', 'monument', 'castle', 'historic',
  'town_hall', 'university', 'museum', 'zoo', 'aquarium',
]

/**
 * 도로명·건물번호·생활 POI를 걷어내 지도를 게임 배경처럼 단순하게 만든다.
 * 역 이름, 랜드마크, 지역명(동·구), 하천명은 방향 감각을 위해 남긴다.
 */
function simplifyLabels(map: MapLibreMap) {
  const classFilter: unknown = [
    'in', ['get', 'class'], ['literal', LANDMARK_POI_CLASSES],
  ]

  // 기본 스타일은 로마자 이름을 함께 적는다. 한국어 이름만 남기고,
  // 한국어가 없는 곳만 원래 이름으로 대체한다.
  const koreanOnly: unknown = [
    'coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name:latin'],
  ]

  map.getStyle().layers.forEach((layer) => {
    if (layer.type !== 'symbol') return
    const sourceLayer = (layer as { 'source-layer'?: string })['source-layer']

    // 도로명과 건물번호는 통째로 숨긴다.
    if (sourceLayer === 'transportation_name' || sourceLayer === 'housenumber') {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none') } catch { /* 스타일 차이 무시 */ }
      return
    }

    // 남는 라벨은 모두 한국어로 통일하고, 지도가 기울어져도 똑바로 서게 한다.
    // (지면에 눕는 정렬이면 pitch 58도에서 글자가 비스듬히 찌그러져 보인다.)
    if (layer.layout?.['text-field'] !== undefined) {
      try { map.setLayoutProperty(layer.id, 'text-field', koreanOnly as never) } catch { /* 스타일 차이 무시 */ }
      try { map.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport') } catch { /* 무시 */ }
      try { map.setLayoutProperty(layer.id, 'text-rotation-alignment', 'viewport') } catch { /* 무시 */ }
      try { map.setLayoutProperty(layer.id, 'icon-pitch-alignment', 'viewport') } catch { /* 무시 */ }
      try { map.setLayoutProperty(layer.id, 'icon-rotation-alignment', 'viewport') } catch { /* 무시 */ }
    }

    if (sourceLayer !== 'poi') return

    // 원래 필터에는 줌·순위 조건이 들어 있으므로 함께 유지한다.
    // 표현식이 아닌 구형 필터라 결합에 실패하면 종류 조건만 적용한다.
    try {
      const existing = map.getFilter(layer.id)
      map.setFilter(layer.id, (existing ? ['all', existing, classFilter] : classFilter) as never)
    } catch {
      try { map.setFilter(layer.id, classFilter as never) } catch { /* 스타일 차이 무시 */ }
    }
  })
}

/** 기본 지도 건물 바닥도 옅게 만들어 체육관 거점만 또렷하게 남긴다. */
function softenBaseBuildingLayers(map: MapLibreMap) {
  map.getStyle().layers.forEach((layer) => {
    const sourceLayer = (layer as { 'source-layer'?: string })['source-layer']
    if (sourceLayer !== 'building' || layer.type !== 'fill') return
    try { map.setPaintProperty(layer.id, 'fill-opacity', 0.1) } catch { /* 스타일별 차이는 무시한다. */ }
  })
}

/** 지도 스타일이 바뀌어도 게임용 3D 건물과 경로 레이어를 다시 보장한다. */
function ensureGameLayers(map: MapLibreMap, venueLayer?: CustomLayerInterface) {
  const beforeId = firstLabelLayerId(map)
  softenBaseBuildingLayers(map)
  simplifyLabels(map)

  if (!map.getSource(BUILDING_SOURCE_ID)) {
    map.addSource(BUILDING_SOURCE_ID, {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    })
  }

  if (!map.getLayer(BUILDING_LAYER_ID)) {
    map.addLayer({
      id: BUILDING_LAYER_ID,
      source: BUILDING_SOURCE_ID,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14.4,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
          0, '#f5f7f8',
          80, '#e7ecef',
          240, '#d9e2e7',
        ],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          14.4, 0,
          15.4, ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        // 일반 도시는 유리 모형처럼 비치게 하고 DOM 체육관 거점은 불투명하게 둔다.
        'fill-extrusion-opacity': 0.26,
      },
    }, beforeId)
  }

  // 체육관 3D 모델. 주변 도시 건물보다 나중에, 라벨보다는 먼저 그린다.
  // (도시 건물 뒤에 그리면 반투명 유리에 거점이 덮여 지저분해진다.)
  if (venueLayer && !map.getLayer(VENUE_MODEL_LAYER_ID)) {
    try { map.addLayer(venueLayer, beforeId) } catch (error) {
      console.warn('[MATCHPOINT] 체육관 3D 레이어를 추가하지 못했습니다.', error)
    }
  }

  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_ROUTE })
  }

  if (!map.getLayer(ROUTE_GLOW_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_GLOW_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#28ddf5',
        'line-width': 8,
        'line-opacity': 0.24,
        'line-blur': 5,
      },
    })
  }

  if (!map.getLayer(ROUTE_DASH_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_DASH_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#3fe8f6',
        'line-width': 3,
        'line-opacity': 0.92,
        'line-dasharray': [0.15, 2.1],
      },
    })
  }
}

function buildVenueElement(marker: MapMarker, onClick: () => void): VenueMarkerEntry {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'venue-entity'
  element.style.setProperty('--venue-color', marker.color)
  element.style.setProperty('--tier-color', marker.tierColor)
  element.setAttribute('aria-label', `${marker.fullLabel}, ${marker.sportLabel}, ELO ${marker.elo}`)

  // 빛기둥과 바닥 원은 3D 레이어가 대신 그린다. 화면에 붙어 있는 CSS 도형은
  // 기울어진 지도에서 혼자 정면을 향해 어색하므로 만들지 않는다.
  const image = document.createElement('img')
  image.className = 'venue-building'
  image.src = '/map/venue-building.webp'
  image.alt = ''
  image.draggable = false
  image.hidden = true // 3D 모델이 대신 그린다

  // '전체' 필터에서는 emoji 가 비어 오고, 그때는 종목 배지를 감춘다.
  const badge = document.createElement('span')
  badge.className = 'venue-sport-badge'
  badge.textContent = marker.emoji
  badge.hidden = !marker.emoji

  const crown = document.createElement('span')
  crown.className = 'venue-crown'
  crown.textContent = '♛'
  crown.setAttribute('aria-hidden', 'true')

  // 지도 위에는 이름표를 두지 않는다. 이름과 ELO는 상세 팝업에서 본다.
  // (읽어 주는 이름은 위 aria-label 에 남아 있다.)
  element.append(image, badge, crown)
  element.addEventListener('click', onClick)

  const mapMarker = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, 10] })
  return { marker: mapMarker, element, badge, image, click: onClick }
}

function createPlayerElement() {
  const element = document.createElement('div')
  element.className = 'player-map-marker'
  element.setAttribute('aria-label', '내 위치')

  const platform = document.createElement('span')
  platform.className = 'player-platform'
  const direction = document.createElement('span')
  direction.className = 'player-direction'
  const image = document.createElement('img')
  image.className = 'player-dino'
  image.src = '/map/player-dino.webp'
  image.alt = ''
  image.draggable = false
  image.hidden = true // 3D 모델이 대신 그린다

  element.append(platform, direction, image)
  return element
}

function routeData(me: Props['me'], target?: MapMarker) {
  if (!target) return EMPTY_ROUTE
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [[me.lng, me.lat], [target.lng, target.lat]],
      },
    }],
  }
}

export default function MapLibreVenueMap({
  center,
  me,
  markers,
  activeId,
  onMarkerClick,
  focus,
  onFatalError,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerEntriesRef = useRef(new Map<string, VenueMarkerEntry>())
  const playerMarkerRef = useRef<Marker | null>(null)
  const clickRef = useRef(onMarkerClick)
  const fatalRef = useRef(onFatalError)
  const [ready, setReady] = useState(false)

  // 3D 체육관 레이어. 최신 마커 목록을 ref 로 읽어 매번 레이어를 다시 만들지 않는다.
  const placementsRef = useRef<VenueModelPlacement[]>([])
  const venueLayerRef = useRef<ReturnType<typeof createVenueModelLayer> | null>(null)
  placementsRef.current = markers.map((marker) => ({
    id: marker.id,
    lat: marker.lat,
    lng: marker.lng,
    color: marker.color,
    seat: marker.seat,
    selected: marker.id === activeId,
  }))

  clickRef.current = onMarkerClick
  fatalRef.current = onFatalError

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let map: MapLibreMap
    try {
      map = new maplibregl.Map({
        container: host,
        style: (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim() || DEFAULT_STYLE_URL,
        center: [center.lng, center.lat],
        zoom: BASE_ZOOM,
        pitch: BASE_PITCH,
        bearing: BASE_BEARING,
        minZoom: 13,
        maxZoom: 18,
        maxPitch: 68,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        // 한글·한자 글리프는 타일에서 받지 않고 브라우저 글꼴로 직접 그린다.
        // 덕분에 지도 라벨에도 둥근 게임체를 쓸 수 있다.
        localIdeographFontFamily: "'Jua', 'Gaegu', 'Apple SD Gothic Neo', sans-serif",
      })
    } catch (error) {
      fatalRef.current(error instanceof Error ? error.message : '게임 지도를 초기화하지 못했습니다.')
      return
    }

    mapRef.current = map
    venueLayerRef.current = createVenueModelLayer(map, () => placementsRef.current)
    map.setPadding({ top: 145, right: 28, bottom: 92, left: 28 })
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

    // 스타일이 이미 붙었으면 조금 느리게 끝나더라도 폴백하지 않는다.
    // (탭을 옮겼다 돌아올 때 잠깐 느려진 것만으로 네이버 지도로 떨어지면 안 된다.)
    const loadTimeout = window.setTimeout(() => {
      if (mapRef.current !== map) return
      if (map.loaded() || map.isStyleLoaded()) return
      fatalRef.current('지도 스타일을 불러오는 데 시간이 너무 오래 걸립니다.')
    }, 12_000)

    const handleLoad = () => {
      window.clearTimeout(loadTimeout)
      try {
        ensureGameLayers(map, venueLayerRef.current ?? undefined)
      } catch (error) {
        console.warn('[MATCHPOINT] 3D 건물 레이어를 사용할 수 없어 평면 지도로 계속합니다.', error)
      }
      setReady(true)
    }

    // 한글 글리프는 브라우저 글꼴로 직접 그리는데, 웹폰트가 늦게 도착하면
    // 대체 글꼴로 그려진 뒤 캐시된다. 폰트가 준비되면 한 번 다시 그린다.
    // 스타일 로드가 끝난 뒤에만 건드려야 초기 로딩이 중단되지 않는다.
    void ensureLabelFont().then((changed) => {
      if (!changed || mapRef.current !== map) return
      const reapply = () => {
        if (mapRef.current !== map) return
        try { map.setStyle(map.getStyle()) } catch { /* 스타일 재적용 실패는 무시 */ }
      }
      if (map.loaded()) reapply()
      else map.once('load', reapply)
    })

    const handleStyleLoad = () => {
      if (!map.loaded()) return
      try { ensureGameLayers(map, venueLayerRef.current ?? undefined) } catch { /* 기본 지도는 계속 사용한다. */ }
    }

    const handleContextLost = (event: Event) => {
      event.preventDefault()
      fatalRef.current('지도 그래픽 연결이 끊어져 안전한 지도로 전환합니다.')
    }

    map.on('load', handleLoad)
    map.on('style.load', handleStyleLoad)
    map.getCanvas().addEventListener('webglcontextlost', handleContextLost)

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(host)

    return () => {
      window.clearTimeout(loadTimeout)
      observer.disconnect()
      map.getCanvas().removeEventListener('webglcontextlost', handleContextLost)
      map.off('load', handleLoad)
      map.off('style.load', handleStyleLoad)
      markerEntriesRef.current.forEach((entry) => {
        entry.element.removeEventListener('click', entry.click)
        entry.marker.remove()
      })
      markerEntriesRef.current.clear()
      playerMarkerRef.current?.remove()
      playerMarkerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const alive = new Set(markers.map((marker) => marker.id))

    markers.forEach((marker) => {
      let entry = markerEntriesRef.current.get(marker.id)
      if (!entry) {
        const click = () => clickRef.current(marker.id)
        entry = buildVenueElement(marker, click)
        entry.marker.setLngLat([marker.lng, marker.lat]).addTo(map)
        markerEntriesRef.current.set(marker.id, entry)
      }

      const selected = marker.id === activeId
      entry.marker.setLngLat([marker.lng, marker.lat])
      entry.element.classList.toggle('is-selected', selected)
      entry.element.classList.toggle('is-crowned', marker.crowned)
      entry.element.classList.toggle('is-hot', marker.hot)
      entry.element.style.setProperty('--venue-color', marker.color)
      entry.element.style.setProperty('--tier-color', marker.tierColor)
      entry.element.style.zIndex = selected ? '8' : marker.crowned ? '6' : '2'
      entry.element.setAttribute('aria-pressed', String(selected))
      entry.element.setAttribute('aria-label', `${marker.fullLabel}, ${marker.sportLabel}, ELO ${marker.elo}`)
      entry.badge.textContent = marker.emoji
      entry.badge.hidden = !marker.emoji
      // 건물은 3D 레이어가 그리므로 평면 스프라이트는 감춘다.
      entry.image.hidden = true
    })

    markerEntriesRef.current.forEach((entry, id) => {
      if (alive.has(id)) return
      entry.element.removeEventListener('click', entry.click)
      entry.marker.remove()
      markerEntriesRef.current.delete(id)
    })
  }, [markers, activeId, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (!playerMarkerRef.current) {
      const element = createPlayerElement()
      playerMarkerRef.current = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, 8] })
        .setLngLat([me.lng, me.lat])
        .addTo(map)
    } else {
      playerMarkerRef.current.setLngLat([me.lng, me.lat])
    }

    const selected = markers.find((marker) => marker.id === activeId)
    const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(routeData(me, selected))
  }, [me.lat, me.lng, markers, activeId, ready])

  // 거점 목록이나 선택이 바뀌면 3D 모델 배치도 다시 맞춘다.
  useEffect(() => {
    if (!ready) return
    venueLayerRef.current?.refresh()
  }, [markers, activeId, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    map.stop()

    // 상세 팝업이 오른쪽을 덮는다. 거점이 그 뒤로 숨지 않도록 팝업 폭의 절반만큼
    // 카메라를 밀어, 거점이 왼쪽 빈 영역 가운데에 놓이게 한다.
    // (offset 은 "지정한 중심이 화면 중앙에서 얼마나 벗어날지"라 음수가 왼쪽이다.)
    const width = map.getContainer().clientWidth
    const popupWidth = Math.min(width * 0.64, 286) + 10
    const offsetX = -Math.round(popupWidth / 2)

    const camera = {
      center: [focus.lng, focus.lat] as [number, number],
      zoom: 16.15,
      pitch: BASE_PITCH,
      bearing: BASE_BEARING,
      offset: [offsetX, 76] as [number, number],
    }
    if (reducedMotion) map.jumpTo(camera)
    else map.easeTo({ ...camera, duration: 720 })
  }, [focus?.lat, focus?.lng, ready])

  const recenter = () => {
    const map = mapRef.current
    if (!map) return
    map.stop()
    map.easeTo({
      center: [me.lng, me.lat],
      zoom: BASE_ZOOM,
      pitch: BASE_PITCH,
      bearing: BASE_BEARING,
      duration: 650,
    })
  }

  return (
    <div className="map-wrap maplibre-map-wrap">
      <div ref={hostRef} className="map-canvas maplibre-canvas" aria-label="강남 체육관 게임 지도" />
      <div className="map-atmosphere" />

      {!ready && (
        <div className="map-loading" role="status">
          <span className="spinner" />
          <span>강남 경기장을 불러오는 중…</span>
        </div>
      )}

      <button className="map-location-control" onClick={recenter} aria-label="내 위치로 이동">
        <span className="location-reticle" aria-hidden="true" />
      </button>
    </div>
  )
}
