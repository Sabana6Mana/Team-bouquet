import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SportId } from '../types'

/** 종목별 경기장 모델. 파일 이름을 종목 id 로 맞춰 두면 분기가 필요 없다. */
const COURT_URL: Record<SportId, string> = {
  tennis: '/court/tennis.glb',
  badminton: '/court/badminton.glb',
  tabletennis: '/court/tabletennis.glb',
  basketball: '/court/basketball.glb',
}

/**
 * 카메라를 코트에서 얼마나 떨어뜨릴지. 작을수록 코트가 크게 잡힌다.
 * 가로 무대는 선수와 창이 화면을 덜 덮으므로 코트를 더 가까이 당긴다.
 */
const CAMERA_DISTANCE = 2.3
const CAMERA_DISTANCE_WIDE = 1.45
/** 매칭 성사 순간. 코트를 코앞까지 당겨 한 판 붙는다는 느낌을 준다. */
const CAMERA_DISTANCE_HERO = 0.9
/** 내려다보는 각도(도). 너무 크면 지도처럼 보이고 작으면 코트가 눌린다. */
const CAMERA_PITCH = 21
/** 한 바퀴 도는 데 걸리는 시간(초). 배경이라 눈에 거슬리지 않을 만큼 느리게. */
const SPIN_SECONDS = 64
/** 목표 거리로 다가가는 속도. 1에 가까울수록 즉시 도달한다. */
const CAMERA_EASE = 0.055

/**
 * 매칭 화면 뒤에 깔리는 경기장 무대.
 *
 * 흰 배경 위에 그 종목의 코트만 옅게 띄운다. 조작할 수 없는 배경이라
 * 포인터 이벤트를 받지 않고, 화면이 안 보일 때는 프레임을 돌리지 않는다.
 */
export default function CourtStage({
  sport, wide = false, hero = false,
}: { sport: SportId; wide?: boolean; hero?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)

  // 목표 거리는 ref 로 넘긴다. prop 이 바뀔 때마다 렌더러를 새로 만들지 않고
  // 애니메이션 루프가 이 값을 향해 부드럽게 다가가게 하기 위해서다.
  const targetRef = useRef(CAMERA_DISTANCE)
  targetRef.current = hero
    ? CAMERA_DISTANCE_HERO
    : wide ? CAMERA_DISTANCE_WIDE : CAMERA_DISTANCE

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    const pitch = (CAMERA_PITCH * Math.PI) / 180
    let distance = targetRef.current
    const placeCamera = () => {
      camera.position.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance)
      camera.lookAt(0, 0, 0)
    }
    placeCamera()

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // WebGL 을 못 쓰는 환경에서는 흰 배경만 남기고 조용히 넘어간다.
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearAlpha(0)
    host.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 2.4))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(-1.2, 2, 1.4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xe8f0ff, 1)
    fill.position.set(1.4, 0.8, -1)
    scene.add(fill)

    // 모델을 담는 그릇. 좌우 흔들림은 이 그릇만 돌린다.
    const pivot = new THREE.Group()
    scene.add(pivot)

    let disposed = false
    new GLTFLoader().load(
      COURT_URL[sport],
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        // 모델마다 단위와 원점이 달라, 실제 크기를 재서 "가장 긴 변이 1" 로 맞춘다.
        const box = new THREE.Box3().setFromObject(model)
        const size = new THREE.Vector3()
        const center = new THREE.Vector3()
        box.getSize(size)
        box.getCenter(center)
        const longest = Math.max(size.x, size.y, size.z) || 1
        model.position.set(-center.x, -center.y, -center.z)
        pivot.scale.setScalar(1 / longest)
        pivot.add(model)
        renderer.render(scene, camera)
      },
      undefined,
      (error) => console.warn(`[MATCHPOINT] 경기장 모델을 불러오지 못했습니다: ${sport}`, error),
    )

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const startedAt = performance.now()

    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (!reducedMotion) {
        const turns = (performance.now() - startedAt) / (SPIN_SECONDS * 1000)
        pivot.rotation.y = turns * Math.PI * 2
      }
      // 목표 거리로 천천히 다가간다. 등장 연출에서 코앞의 코트가
      // 제자리로 물러나는 움직임이 여기서 나온다.
      const gap = targetRef.current - distance
      if (Math.abs(gap) > 0.0005) {
        distance += gap * (reducedMotion ? 1 : CAMERA_EASE)
        placeCamera()
      }
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [sport])

  return <div ref={hostRef} className="court-stage" aria-hidden="true" />
}