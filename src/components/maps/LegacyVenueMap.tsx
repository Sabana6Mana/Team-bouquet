import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import crosshairUrl from '../../../models/crosshair.png'
import { HOME } from '../../data/seed'
import type { MapMarker, VenueMapProps as Props } from './types'

const KEY_ID = (import.meta.env.VITE_NAVER_MAP_KEY_ID as string | undefined)?.trim()
const TILE = 256

/** Web Mercator: 위경도 → 현재 줌에서의 월드 픽셀 좌표 */
function worldPx(lat: number, lng: number, zoom: number) {
  const scale = TILE * Math.pow(2, zoom)
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  }
}

/* ─────────────── 네이버 지도 로딩 ───────────────
 * 스크립트는 페이지당 한 번만 불러온다. 예전에는 ncpKeyId/ncpClientId를 번갈아
 * 시도하며 스크립트를 지웠다 다시 넣었는데, 그 과정에서 지도가 여러 번 생성되어
 * 오히려 인증이 간헐적으로 실패했다. 이 프로젝트의 키는 ncpKeyId로 확인됐다.
 */
const AUTH_PARAM = 'ncpKeyId'

let scriptPromise: Promise<boolean> | null = null
function loadNaverScript(): Promise<boolean> {
  if (!KEY_ID) return Promise.resolve(false)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve) => {
    if ((window as any).naver?.maps) return resolve(true)
    const s = document.createElement('script')
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${AUTH_PARAM}=${KEY_ID}`
    s.async = true
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
  })
  return scriptPromise
}

/** 요소당 지도는 하나만. StrictMode 재마운트 시 기존 지도를 그대로 재사용한다. */
const mapByEl = new WeakMap<HTMLElement, any>()

/**
 * 지도에 실제 컨테이너 크기를 명시적으로 알려준다.
 * resize 이벤트만 던지면 반영되지 않는 경우가 있어 setSize로 직접 지정한다.
 */
function syncNaverSize(map: any, w: number, h: number) {
  if (!map || !w || !h) return
  const nv = (window as any).naver
  if (!nv?.maps) return
  try {
    map.setSize(new nv.maps.Size(Math.round(w), Math.round(h)))
  } catch {
    try { nv.maps.Event.trigger(map, 'resize') } catch { /* 준비 전이면 무시 */ }
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

/** 네이버 오버레이에 넣을 마커 HTML. 내장 맵 마커와 같은 CSS를 공유한다. */
function markerHtml(m: MapMarker, active: boolean): string {
  return (
    `<div class="mk nmarker${active ? ' on' : ''}" style="color:${m.color};--tier:${m.tierColor}">` +
    '<div class="marker-beam"></div>' +
    (active ? '<div class="marker-halo"></div>' : '') +
    `<div class="marker-pin">${m.emoji}` +
    (m.hot ? '<span class="marker-badge">🔥</span>' : '') +
    '</div>' +
    `<div class="marker-tip">${esc(m.label)}</div>` +
    '</div>'
  )
}

/** 마커 HTML의 고정 너비(160px)의 절반과 핀 아래쪽 지점 */
const ANCHOR = { x: 80, y: 46 }

/** 요소당 한 번만 지도를 만든다. 이미 있으면 그대로 돌려준다. */
function getOrCreateMap(el: HTMLElement, center: { lat: number; lng: number }): any | null {
  const cached = mapByEl.get(el)
  if (cached) return cached

  const nv = (window as any).naver
  if (!nv?.maps) return null

  const map = new nv.maps.Map(el, {
    center: new nv.maps.LatLng(center.lat, center.lng),
    zoom: 15,
    minZoom: 12,
    maxZoom: 18,
    mapDataControl: false,
    scaleControl: false,
    logoControl: true,
    zoomControl: false,
  })
  mapByEl.set(el, map)
  return map
}

/* ─────────────────────── 컴포넌트 ─────────────────────── */

export default function VenueMap({ center, me, markers, activeId, onMarkerClick, focus }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  /** 네이버 지도 전용 컨테이너 — React는 이 안에 절대 렌더링하지 않는다. */
  const naverHostRef = useRef<HTMLDivElement>(null)
  const naverMapRef = useRef<any>(null)

  const [useNaver, setUseNaver] = useState(false)
  const [naverError, setNaverError] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ lat: center.lat, lng: center.lng, zoom: 15 })

  /* 컨테이너 크기 추적 (지도 구현과 무관한 바깥 래퍼 기준) */
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setSize({ w: width, h: height })
      // 크기가 바뀌면 지도에 반드시 알려야 한다. 알리지 않으면 내부 좌표계가
      // 낡은 크기에 머물러 타일 위치와 마우스 조작이 모두 어긋난다.
      syncNaverSize(naverMapRef.current, width, height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* 네이버 지도 초기화.
     컨테이너 크기가 확정된 뒤에 만들어야 한다. 크기가 0이거나 임시 값일 때
     생성하면 지도가 그 크기를 내부 좌표계로 굳혀 타일이 어긋난다. */
  const sizeReady = size.w > 0 && size.h > 0
  useEffect(() => {
    const el = naverHostRef.current
    if (!KEY_ID || !el || !sizeReady) return
    let cancelled = false

    // 인증 실패는 지도 생성 이후 이 전역 콜백으로만 통보된다.
    ;(window as any).navermap_authFailure = () => {
      console.warn(
        '[MATCHPOINT] 네이버 지도 인증 실패 → 내장 맵으로 전환합니다.\n' +
          `  키: ${KEY_ID} / 출처: ${location.origin}\n` +
          '  Client ID(Secret 아님)와 Web 서비스 URL 등록을 확인하세요.',
      )
      naverMapRef.current = null
      setUseNaver(false)
      setNaverError(`인증이 거부되었습니다. 출처 ${location.origin} 등록 여부를 확인하세요.`)
    }

    loadNaverScript().then((ok) => {
      if (cancelled) return
      if (!ok) {
        setUseNaver(false)
        setNaverError('maps.js 스크립트를 불러오지 못했습니다 (네트워크 확인).')
        return
      }

      const map = getOrCreateMap(el, center)
      if (!map) {
        setUseNaver(false)
        setNaverError('naver.maps 전역이 준비되지 않았습니다.')
        return
      }

      naverMapRef.current = map
      setUseNaver(true)

      // 레이어 전환·폰트 로딩 등으로 레이아웃이 늦게 확정될 수 있으므로
      // 여러 시점에 걸쳐 실제 컨테이너 크기를 다시 알려준다.
      ;[0, 120, 400, 1000].forEach((d) =>
        setTimeout(() => {
          const r = wrapRef.current?.getBoundingClientRect()
          if (r) syncNaverSize(map, r.width, r.height)
        }, d),
      )
    })

    return () => { cancelled = true }
  }, [sizeReady])

  /* ── 네이버 오버레이 마커 ──
     React가 좌표를 계산해 배치하면 확대/축소 애니메이션 중간 상태를 따라가지 못해
     마커가 끝에서 튄다. 네이버 Marker로 만들면 지도와 같은 레이어에서 함께 움직인다. */
  const overlaysRef = useRef<Record<string, { marker: any; sig: string }>>({})
  const clickRef = useRef(onMarkerClick)
  clickRef.current = onMarkerClick

  useEffect(() => {
    const map = naverMapRef.current
    if (!useNaver || !map) return
    const nv = (window as any).naver
    if (!nv?.maps) return

    const store = overlaysRef.current
    const alive = new Set<string>()

    markers.forEach((m) => {
      alive.add(m.id)
      const active = m.id === activeId
      // setIcon은 DOM을 새로 만들어 애니메이션을 되감으므로 실제 변화가 있을 때만 호출한다.
      const sig = `${m.emoji}|${m.color}|${m.tierColor}|${m.hot}|${m.label}|${active}`
      const entry = store[m.id]

      if (entry) {
        if (entry.sig !== sig) {
          entry.marker.setIcon({ content: markerHtml(m, active), anchor: new nv.maps.Point(ANCHOR.x, ANCHOR.y) })
          entry.marker.setZIndex(active ? 300 : 100)
          entry.sig = sig
        }
        return
      }

      const marker = new nv.maps.Marker({
        map,
        position: new nv.maps.LatLng(m.lat, m.lng),
        icon: { content: markerHtml(m, active), anchor: new nv.maps.Point(ANCHOR.x, ANCHOR.y) },
        zIndex: active ? 300 : 100,
      })
      // 콜백이 매 렌더마다 새로 만들어지므로 ref로 최신 것을 호출한다.
      nv.maps.Event.addListener(marker, 'click', () => clickRef.current(m.id))
      store[m.id] = { marker, sig }
    })

    // 필터로 걸러진 마커는 지도에서 뗀다.
    Object.keys(store).forEach((id) => {
      if (!alive.has(id)) {
        store[id].marker.setMap(null)
        delete store[id]
      }
    })
  }, [useNaver, markers, activeId])

  /* 내 위치도 오버레이로 올려 지도와 함께 움직이게 한다. */
  const meOverlayRef = useRef<any>(null)
  useEffect(() => {
    const map = naverMapRef.current
    if (!useNaver || !map) return
    const nv = (window as any).naver
    if (!nv?.maps) return

    const pos = new nv.maps.LatLng(me.lat, me.lng)
    if (meOverlayRef.current) {
      meOverlayRef.current.setPosition(pos)
      return
    }
    meOverlayRef.current = new nv.maps.Marker({
      map,
      position: pos,
      zIndex: 200,
      icon: { content: '<div class="nme"></div>', anchor: new nv.maps.Point(9, 9) },
    })
  }, [useNaver, me.lat, me.lng])

  /* 체육관을 고르면 팝업이 오른쪽을 덮으므로 마커를 왼쪽 28% 지점으로 옮긴다. */
  useEffect(() => {
    if (!focus || !size.w) return
    const map = naverMapRef.current
    if (useNaver && map) {
      const nv = (window as any).naver
      try {
        const proj = map.getProjection()
        const p = proj.fromCoordToOffset(new nv.maps.LatLng(focus.lat, focus.lng))
        // 중심을 오른쪽으로 밀면 마커는 상대적으로 왼쪽에 놓인다.
        const shifted = new nv.maps.Point(p.x + size.w * 0.22, p.y)
        map.panTo(proj.fromOffsetToCoord(shifted))
        return
      } catch {
        try { map.panTo(new nv.maps.LatLng(focus.lat, focus.lng)) } catch { /* 무시 */ }
        return
      }
    }
    // 내장 맵: 경도를 화면 폭의 22%만큼 밀어 같은 효과를 낸다.
    setView((v) => {
      const scale = TILE * Math.pow(2, v.zoom)
      return { ...v, lat: focus.lat, lng: focus.lng + ((size.w * 0.22) / scale) * 360 }
    })
  }, [focus?.lat, focus?.lng, useNaver, size.w])

  /* 좌표 → 화면 픽셀. 내장 맵 전용 계산이다. */
  const project = useCallback(
    (lat: number, lng: number): { x: number; y: number } | null => {
      const p = worldPx(lat, lng, view.zoom)
      const c = worldPx(view.lat, view.lng, view.zoom)
      return { x: size.w / 2 + (p.x - c.x), y: size.h / 2 + (p.y - c.y) }
    },
    [size.w, size.h, view.lat, view.lng, view.zoom],
  )

  /* 내장 맵: 드래그 팬 + 휠 줌 */
  const drag = useRef<{ x: number; y: number; lat: number; lng: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, lat: view.lat, lng: view.lng }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const d = drag.current
    const scale = TILE * Math.pow(2, view.zoom)
    const dLng = ((d.x - e.clientX) / scale) * 360
    const start = worldPx(d.lat, d.lng, view.zoom)
    const ny = start.y + (d.y - e.clientY)
    const n = Math.PI - (2 * Math.PI * ny) / scale
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
    setView((v) => ({ ...v, lat, lng: d.lng + dLng }))
  }
  const onPointerUp = () => { drag.current = null }
  const onWheel = (e: React.WheelEvent) => {
    setView((v) => ({ ...v, zoom: Math.min(17, Math.max(13, v.zoom - Math.sign(e.deltaY) * 0.4)) }))
  }

  const recenter = () => {
    if (useNaver && naverMapRef.current) {
      const nv = (window as any).naver
      naverMapRef.current.panTo(new nv.maps.LatLng(me.lat, me.lng))
    } else {
      setView((v) => ({ ...v, lat: me.lat, lng: me.lng }))
    }
  }

  const mePos = size.w ? project(me.lat, me.lng) : null


  return (
    <div className="map-wrap" ref={wrapRef}>
      {/* 네이버 지도 컨테이너 (React가 내용을 건드리지 않음).
          숨긴 채로 초기화하면 타일이 로드되지 않으므로 항상 보이게 두고,
          실패했을 때는 불투명한 내장 맵 레이어로 위를 덮는다. */}
      <div ref={naverHostRef} className="map-canvas" style={{ zIndex: 0 }} />

      {/* 내장 맵 레이어 */}
      {!useNaver && (
        <div
          className="map-canvas"
          style={{ touchAction: 'none', cursor: 'move', zIndex: 1 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <FallbackBase project={project} size={size} zoom={view.zoom} />
        </div>
      )}

      {/* 실제 네이버 타일을 앱 톤에 맞추고 게임 화면처럼 보이게 하는 비네트.
          mix-blend-mode는 합성 결과를 예측하기 어려워 단순 알파로만 처리한다. */}
      {useNaver && <div className="map-vignette" />}

      {/* 마커 — 내장 맵에서만 React가 배치한다.
          네이버 지도에서는 위쪽 effect가 네이버 Marker로 올린다. */}
      {!useNaver && size.w > 0 && markers.map((m, i) => {
        const p = project(m.lat, m.lng)
        if (!p || p.x < -80 || p.y < -120 || p.x > size.w + 80 || p.y > size.h + 80) return null
        const on = activeId === m.id
        return (
          <div
            key={m.id}
            className={`mk marker${on ? ' on' : ''}`}
            style={{
              left: p.x, top: p.y, color: m.color,
              ['--tier' as string]: m.tierColor,
              animationDelay: `${i * 45}ms`,
              zIndex: on ? 30 : 10,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onMarkerClick(m.id)}
          >
            <div className="marker-beam" />
            {on && <div className="marker-halo" />}
            <div className="marker-pin" style={{ animationDelay: `${i * 260}ms` }}>
              {m.emoji}
              {m.hot && <span className="marker-badge">🔥</span>}
            </div>
            <div className="marker-tip">{m.label}</div>
          </div>
        )
      })}

      {/* 내 위치 — 내장 맵에서만. 네이버에서는 오버레이로 올린다. */}
      {!useNaver && mePos && <div className="me-dot" style={{ left: mePos.x, top: mePos.y, zIndex: 20 }} />}

      {/* 현재 위치로 — 빠른 매칭 버튼 바로 위에 붙인다 */}
      <button
        onClick={recenter}
        style={{
          position: 'absolute', right: 14, bottom: 84, zIndex: 35,
          width: 44, height: 44, borderRadius: 14, padding: 0, overflow: 'hidden',
          background: '#ffffff', border: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(18,52,32,0.18)',
        }}
        aria-label="내 위치로 이동"
      >
        {/* 원본에 여백이 넓어 버튼보다 크게 잡아야 십자선이 제 크기로 보인다.
            버튼이 overflow:hidden이라 넘치는 여백은 잘리고 십자선만 가운데 남는다.
            배경이 흰색이든 투명이든 흰 버튼 위에서는 multiply로 자연스럽게 사라진다. */}
        <img
          src={crosshairUrl}
          alt=""
          style={{
            width: 38, height: 38, display: 'block', flexShrink: 0,
            objectFit: 'contain',
            mixBlendMode: 'multiply',
          }}
        />
      </button>

      {/* 필터 칩 아래에 표시한다. 하단은 매칭 버튼과 겹쳐 가려진다. */}
      {!useNaver && (
        <div
          className="small"
          style={{
            position: 'absolute', left: 12, right: 12, top: 108, zIndex: 34,
            background: 'rgba(255,255,255,0.95)', padding: '8px 11px', borderRadius: 10,
            border: `1px solid ${naverError ? 'rgba(207, 64, 64,0.55)' : 'var(--line)'}`,
            fontSize: 10.5, lineHeight: 1.6, backdropFilter: 'blur(10px)',
            maxHeight: 120, overflowY: 'auto',
          }}
        >
          {!KEY_ID ? (
            '내장 맵 · .env에 네이버 지도 키 입력 시 실지도 전환'
          ) : (
            <>
              <strong style={{ color: 'var(--red)' }}>네이버 지도 인증 실패</strong>
              <div style={{ color: 'var(--muted)', marginTop: 3, wordBreak: 'break-all' }}>
                {naverError || '사유 미확인 · 개발자도구 콘솔을 확인하세요.'}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ─────────── 네이버 지도를 쓸 수 없을 때의 스타일 베이스 맵 ─────────── */

/** HOME 주변에 도로/블록/공원을 위경도 공간에 만들어 두고 투영해 그린다. */
const GRID = (() => {
  const base = HOME
  const roads: { a: [number, number]; b: [number, number]; w: number }[] = []
  for (let i = -6; i <= 6; i++) {
    const off = i * 0.0042
    roads.push({ a: [base.lat + off, base.lng - 0.03], b: [base.lat + off, base.lng + 0.03], w: i % 3 === 0 ? 7 : 3 })
    roads.push({ a: [base.lat - 0.028, base.lng + off * 1.25], b: [base.lat + 0.028, base.lng + off * 1.25], w: i % 3 === 0 ? 7 : 3 })
  }
  const parks = [
    { lat: 37.5065, lng: 127.0355, rx: 0.0055, ry: 0.0032 },
    { lat: 37.4862, lng: 127.0395, rx: 0.0072, ry: 0.0026 },
    { lat: 37.4922, lng: 127.0158, rx: 0.0034, ry: 0.0034 },
  ]
  const river = Array.from({ length: 24 }, (_, i) => {
    const t = i / 23
    return [base.lat - 0.021 + Math.sin(t * 3.4) * 0.0028, base.lng - 0.032 + t * 0.066] as [number, number]
  })
  return { roads, parks, river }
})()

function FallbackBase({
  project, size, zoom,
}: {
  project: (lat: number, lng: number) => { x: number; y: number } | null
  size: { w: number; h: number }
  zoom: number
}) {
  if (!size.w) return null
  const k = Math.pow(2, zoom - 15)
  const pt = (c: [number, number]) => project(c[0], c[1])

  return (
    <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, display: 'block' }}>
      <defs>
        <radialGradient id="glow" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e9f2eb" />
        </radialGradient>
      </defs>
      <rect width={size.w} height={size.h} fill="url(#glow)" />

      {/* 공원 */}
      {GRID.parks.map((p, i) => {
        const c = project(p.lat, p.lng)
        const e = project(p.lat + p.ry, p.lng + p.rx)
        if (!c || !e) return null
        return (
          <ellipse key={i} cx={c.x} cy={c.y} rx={Math.abs(e.x - c.x)} ry={Math.abs(e.y - c.y)}
            fill="#cfe6d4" opacity={0.9} />
        )
      })}

      {/* 하천 */}
      <polyline
        points={GRID.river.map(pt).filter(Boolean).map((p) => `${p!.x},${p!.y}`).join(' ')}
        fill="none" stroke="#bcd9e8" strokeWidth={16 * k} strokeLinecap="round" opacity={0.9}
      />

      {/* 도로 */}
      {GRID.roads.map((r, i) => {
        const a = pt(r.a), b = pt(r.b)
        if (!a || !b) return null
        return (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#dde8e0" strokeWidth={r.w * k} strokeLinecap="round" />
        )
      })}
      {GRID.roads.filter((r) => r.w > 5).map((r, i) => {
        const a = pt(r.a), b = pt(r.b)
        if (!a || !b) return null
        return (
          <line key={`c${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#2f7d46" strokeWidth={1} opacity={0.16} />
        )
      })}
    </svg>
  )
}
