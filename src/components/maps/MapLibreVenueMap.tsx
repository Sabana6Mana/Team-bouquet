import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapMarker, VenueMapProps } from './types'

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright'
const BUILDING_SOURCE_ID = 'matchpoint-openfreemap'
const BUILDING_LAYER_ID = 'matchpoint-3d-buildings'
const ROUTE_SOURCE_ID = 'matchpoint-route'
const ROUTE_GLOW_LAYER_ID = 'matchpoint-route-glow'
const ROUTE_DASH_LAYER_ID = 'matchpoint-route-dash'
const BASE_ZOOM = 15.55
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
  name: HTMLSpanElement
  elo: HTMLSpanElement
  badge: HTMLSpanElement
  image: HTMLImageElement
  click: () => void
}

function firstLabelLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => (
    layer.type === 'symbol' && Boolean(layer.layout?.['text-field'])
  ))?.id
}

/** 지도 스타일이 바뀌어도 게임용 3D 건물과 경로 레이어를 다시 보장한다. */
function ensureGameLayers(map: MapLibreMap) {
  const beforeId = firstLabelLayerId(map)

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
        'fill-extrusion-opacity': 0.84,
      },
    }, beforeId)
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

  const beam = document.createElement('span')
  beam.className = 'venue-beam'

  const platform = document.createElement('span')
  platform.className = 'venue-platform'

  const image = document.createElement('img')
  image.className = 'venue-building'
  image.src = '/map/venue-building.webp'
  image.alt = ''
  image.draggable = false

  const badge = document.createElement('span')
  badge.className = 'venue-sport-badge'
  badge.textContent = marker.emoji

  const crown = document.createElement('span')
  crown.className = 'venue-crown'
  crown.textContent = '♛'
  crown.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = 'venue-label'
  const name = document.createElement('span')
  name.className = 'venue-label__name'
  name.textContent = marker.fullLabel
  const elo = document.createElement('span')
  elo.className = 'venue-label__elo'
  elo.textContent = `ELO ${marker.elo}`
  label.append(name, elo)

  element.append(beam, platform, image, badge, crown, label)
  element.addEventListener('click', onClick)

  const mapMarker = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, 10] })
  return { marker: mapMarker, element, name, elo, badge, image, click: onClick }
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
      })
    } catch (error) {
      fatalRef.current(error instanceof Error ? error.message : '게임 지도를 초기화하지 못했습니다.')
      return
    }

    mapRef.current = map
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

    const loadTimeout = window.setTimeout(() => {
      if (!map.loaded()) fatalRef.current('지도 스타일을 불러오는 데 시간이 너무 오래 걸립니다.')
    }, 12_000)

    const handleLoad = () => {
      window.clearTimeout(loadTimeout)
      try {
        ensureGameLayers(map)
      } catch (error) {
        console.warn('[MATCHPOINT] 3D 건물 레이어를 사용할 수 없어 평면 지도로 계속합니다.', error)
      }
      setReady(true)
    }

    const handleStyleLoad = () => {
      if (!map.loaded()) return
      try { ensureGameLayers(map) } catch { /* 기본 지도는 계속 사용한다. */ }
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
      entry.name.textContent = marker.fullLabel
      entry.elo.textContent = `ELO ${marker.elo}`
      entry.badge.textContent = marker.emoji
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    map.stop()
    const camera = {
      center: [focus.lng, focus.lat] as [number, number],
      zoom: 16.15,
      pitch: BASE_PITCH,
      bearing: BASE_BEARING,
      offset: [0, 76] as [number, number],
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
