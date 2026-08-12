import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from 'maplibre-gl'

export const VENUE_MODEL_LAYER_ID = 'matchpoint-venue-models'

/**
 * 거점 건물 후보. 체육관마다 하나씩 골라 붙여 지도가 단조로워지지 않게 한다.
 * 순서를 바꾸면 어느 체육관이 어떤 건물을 받는지도 함께 바뀐다.
 */
const MODEL_URLS = [
  '/map/venue-gym.glb',
  '/map/venue-modern-03.glb',
  '/map/venue-modern-05.glb',
  '/map/venue-modern-11.glb',
]

/** 지구 둘레(m). 줌 값을 "1픽셀이 몇 m인지"로 바꿀 때 쓴다. */
const EARTH_CIRCUMFERENCE = 40075016.686
/** MapLibre는 512px 타일 기준이라 줌 z에서 세계 폭이 512 × 2^z 픽셀이다. */
const TILE_SIZE = 512

/**
 * 체육관이 화면에서 차지할 목표 가로 픽셀.
 * 줌을 바꿔도 이 크기를 지키므로 멀리 축소해도 거점이 또렷하게 남는다.
 */
const TARGET_SCREEN_PX = 74
/** 다만 실제 크기가 터무니없어지지 않도록 위아래를 막아 둔다. */
const MIN_WIDTH_METERS = 45
const MAX_WIDTH_METERS = 420

/** 건물 높이는 가로폭의 이 배수를 넘지 않는다. 홀쭉한 타워가 튀지 않게 막는다. */
const MAX_HEIGHT_RATIO = 1.7

/** 빛기둥 크기. 모두 "건물 가로폭"을 1로 본 배수라 줌이 바뀌어도 비율이 같다. */
const BEAM_HEIGHT = 4.8
const BEAM_CORE_RADIUS = 0.075
const BEAM_GLOW_RADIUS = 0.2
/**
 * 바닥에 퍼지는 파동이 닿는 최대 반경(건물 가로폭 배수).
 * 크게 잡으면 이웃 거점의 파동과 겹쳐 지도가 지저분해진다.
 */
const RIPPLE_RADIUS = 1.5

/** 왕관(구역 1위) 거점의 금빛. */
const CROWN_TONE = '#f0bd33'
/** 최근 경기가 많은 인기 거점의 불빛. */
const HOT_TONE = '#ff7a2f'
/** 주간 공동 목표가 진행 중인 보스 거점의 보랏빛. */
const BOSS_TONE = '#a855f7'
/** 아직 내 도감에 등록하지 않은 거점의 실루엣 빛. */
const UNDISCOVERED_TONE = '#8b9a94'

export interface VenueModelPlacement {
  id: string
  lat: number
  lng: number
  /** 빛기둥 색. 종목 색을 그대로 받는다. */
  color?: string
  /** 전체 목록 기준 자리 번호. 건물 종류를 돌아가며 배정할 때 쓴다. */
  seat?: number
  /** 선택된 거점은 살짝 키워 강조한다. */
  selected?: boolean
  /** 최근 경기가 몰린 거점. 빛이 빠르고 진해진다. */
  hot?: boolean
  /** 내 지역 도감에 등록된 거점인지. */
  discovered?: boolean
  /** 이번 주 공동 보스 거점. */
  boss?: boolean
  /** 주간 기여도 왕좌가 표시되는 거점. */
  throne?: boolean
}

/** 거점 상태에 따른 빛의 색·속도·세기. 지도가 곧 정보가 되도록 묶는다. */
function beamTone(place: VenueModelPlacement) {
  const color = place.throne
    ? CROWN_TONE
    : place.boss
      ? BOSS_TONE
      : place.discovered === false
        ? UNDISCOVERED_TONE
        : place.hot ? HOT_TONE : place.color
  // 보스는 빠르게 요동치고, 왕좌는 느긋하고 묵직하게 흐른다.
  const speed = place.boss ? 2.25 : place.hot ? 1.9 : place.throne ? 0.85 : 1.2
  const strength = (place.selected ? 1.3 : 0.82)
    * (place.hot ? 1.25 : 1)
    * (place.boss ? 1.35 : 1)
    * (place.throne ? 1.15 : 1)
    * (place.discovered === false ? 0.48 : 1)
  return { color, speed, strength }
}

/** 지금 줌에서 체육관 한 채가 가질 실제 가로 크기(m). */
function venueWidthMeters(lat: number, zoom: number) {
  const metersPerPixel = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom)
  const wanted = TARGET_SCREEN_PX * metersPerPixel
  return Math.min(MAX_WIDTH_METERS, Math.max(MIN_WIDTH_METERS, wanted))
}

/**
 * 거점 id 로 만든 고정 난수. 같은 체육관은 새로고침해도 늘 같은 값을 받는다.
 *
 * 뒤쪽 뒤섞기 단계가 꼭 필요하다. 없으면 'v1'·'v2'처럼 한 글자만 다른 id 가
 * 나란한 숫자로 나와, 모든 거점이 같은 방향·같은 크기로 서 버린다.
 */
function seedOf(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619)
  }
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  return (hash ^ (hash >>> 16)) >>> 0
}

/**
 * 거점 하나의 겉모습. 같은 거점은 언제 봐도 같은 모습이다.
 *
 * 건물은 자리 번호로 돌아가며 나눠 준다. 해시로 뽑으면 여덟 곳뿐인 지금은
 * 한 모델에 다섯 곳이 몰리는 일이 생겨, 섞으려던 목적이 무색해진다.
 */
function styleOf(place: VenueModelPlacement, variantCount: number) {
  const seat = place.seat ?? seedOf(place.id)
  return {
    variant: ((seat % variantCount) + variantCount) % variantCount,
    // 90도 단위로만 돌려 같은 건물이 이웃해도 다른 면을 보여 준다.
    yaw: (seedOf(`${place.id}/yaw`) % 4) * (Math.PI / 2),
    // 0.88~1.12배. 줄지어 선 건물의 키를 흩뜨린다.
    scale: 0.88 + (seedOf(`${place.id}/scale`) % 5) * 0.06,
  }
}

/**
 * CSS 색을 그대로 화면에 쓸 0~1 값으로 바꾼다.
 * three 의 색 관리는 sRGB 를 선형 공간으로 옮기는데, 빛기둥은 조명 계산 없이
 * 직접 화면에 쓰므로 변환 없이 원래 색 그대로 넘겨야 종목 색과 일치한다.
 */
function rawColor(hex: string | undefined, target: THREE.Color) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!value) return target.setRGB(0.18, 0.49, 0.27, THREE.LinearSRGBColorSpace)
  const packed = parseInt(value[1], 16)
  return target.setRGB(
    ((packed >> 16) & 255) / 255,
    ((packed >> 8) & 255) / 255,
    (packed & 255) / 255,
    THREE.LinearSRGBColorSpace,
  )
}

/**
 * 하늘로 곧게 뻗는 빛기둥.
 *
 * 원기둥 옆면만 남겨 어느 방향에서 봐도 같은 굵기로 서 있고,
 * 위로 갈수록 옅어지며 맥동이 위로 흘러 레이저처럼 보인다.
 */
const BEAM_VERTEX = `
varying float vHeight;
void main() {
  vHeight = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const BEAM_FRAGMENT = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uSpeed;
varying float vHeight;

void main() {
  float fade = pow(1.0 - vHeight, 1.5);
  float root = smoothstep(0.0, 0.05, vHeight);

  // 위로 흘러 올라가는 에너지 띠.
  // sin 을 그대로 쓰면 두루뭉술하니 세제곱해 마디를 또렷하게 세운다.
  float phase = vHeight * 3.2 - uTime * uSpeed;
  float crest = pow(sin(phase * 6.2831853) * 0.5 + 0.5, 3.0);
  float flow = 0.42 + 0.9 * crest;

  gl_FragColor = vec4(uColor, fade * root * flow * uStrength);
}
`

/**
 * 바닥에 퍼지는 파동.
 * 원판 하나에 두 겹의 링을 그려 끊김 없이 이어지게 한다.
 */
const RIPPLE_VERTEX = `
varying vec2 vUvw;
void main() {
  vUvw = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const RIPPLE_FRAGMENT = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uSpeed;
varying vec2 vUvw;

/** 반지름 r 인 링 하나. 퍼질수록 옅어지고 얇아진다. */
float ringAt(float dist, float t) {
  float width = mix(0.09, 0.028, t);
  float band = smoothstep(width, 0.0, abs(dist - t));
  return band * (1.0 - t) * (1.0 - t);
}

void main() {
  float dist = length(vUvw - 0.5) * 2.0;
  if (dist > 1.0) discard;

  float cycle = uTime * uSpeed * 0.45;
  // 반 주기 어긋난 링을 겹쳐 물결이 끊기지 않게 한다.
  float wave = ringAt(dist, fract(cycle)) + ringAt(dist, fract(cycle + 0.5));

  gl_FragColor = vec4(uColor, wave * uStrength * 0.75);
}
`

function beamGeometry(radius: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius, BEAM_HEIGHT, 20, 1, true)
  // 원기둥은 중심이 원점이다. 바닥이 지면에 닿도록 절반만큼 올린다.
  geometry.translate(0, BEAM_HEIGHT / 2, 0)
  return geometry
}

function rippleGeometry() {
  const geometry = new THREE.CircleGeometry(RIPPLE_RADIUS, 48)
  // 원판은 XY 평면에 서 있다. 눕혀서 지면(XZ)에 깔고 살짝 띄운다.
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, 0.012, 0)
  return geometry
}

/**
 * 불러온 모델을 "가로 1, 바닥이 원점" 상태로 정규화한다.
 *
 * 내보내기 도구마다 단위(cm/m)와 원점이 달라 파일만 봐서는 알 수 없다.
 * 실제 경계 상자를 재서 맞추면 어떤 모델이 와도 같은 크기로 놓인다.
 */
function normalizeModel(root: THREE.Object3D): { holder: THREE.Group; info: string } {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)

  // glTF는 Y축이 위다. 바닥 중심이 원점에 오도록 옮긴다.
  root.position.set(-center.x, -box.min.y, -center.z)

  // 지도 좌표계는 남쪽으로 y가 커져 화면 행렬에 좌우 반전이 들어간다.
  // 반전이 걸리면 앞뒤 면 판정이 뒤집혀 벽이 뚫려 보이므로 양면으로 그린다.
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => { material.side = THREE.DoubleSide })
  })

  const holder = new THREE.Group()
  holder.add(root)

  // 가로 1 이 기준이지만, 홀쭉하고 높은 건물은 화면을 뚫고 올라간다.
  // 높이도 함께 봐서 어떤 모델이 와도 비슷한 덩치로 서게 한다.
  const footprint = Math.max(size.x, size.z) || 1
  const basis = Math.max(footprint, size.y / MAX_HEIGHT_RATIO)
  holder.scale.setScalar(1 / basis)

  return {
    holder,
    info: `크기 ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} → 가로 ${(footprint / basis).toFixed(2)} · 높이 ${(size.y / basis).toFixed(2)}`,
  }
}

/** 거점 하나(건물 + 빛기둥). 색과 세기는 프레임마다 다시 맞춘다. */
interface VenueInstance {
  group: THREE.Group
  /** 건물만 담는 칸. 모델을 갈아 끼울 때 이 칸만 비운다. */
  shell: THREE.Group
  beams: THREE.ShaderMaterial[]
  /** 바닥에 퍼지는 파동. */
  ripple: THREE.ShaderMaterial
  /** 어떤 건물을 붙였는지. 모델이 늦게 도착하면 이 값을 보고 갈아 끼운다. */
  variant: number
}

/**
 * MapLibre 위에 three.js 로 체육관 3D 모델을 얹는 커스텀 레이어.
 * 지도와 같은 WebGL 컨텍스트를 쓰므로 기울이거나 돌려도 건물이 함께 움직인다.
 *
 * 좌표계는 "화면 중심에서 몇 m 떨어졌는가"를 쓴다. 지도 전체 좌표(0~1)를
 * 모델 행렬에 그대로 넣으면 셰이더의 32비트 실수로는 60m짜리 건물이
 * 소수점 아래에 파묻혀, 정점이 성긴 격자에 눌어붙어 부서지고 떨린다.
 * 큰 자리수는 CPU에서 64비트로 카메라 행렬에 미리 접어 넣는다.
 */
export function createVenueModelLayer(
  map: MapLibreMap,
  getPlacements: () => VenueModelPlacement[],
): CustomLayerInterface & { refresh: () => void } {
  let renderer: THREE.WebGLRenderer | null = null
  // 모델은 각자 도착한다. 먼저 온 것으로 세워 두고, 제 건물이 도착하면 갈아 낀다.
  const templates: (THREE.Group | null)[] = MODEL_URLS.map(() => null)
  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  const instances = new Map<string, VenueInstance>()

  // 빛기둥은 거점마다 색이 다르지만 맥동은 같이 흐른다. 시간 uniform 을
  // 한 객체로 공유해 프레임마다 한 번만 갱신한다.
  const beamTime = { value: 0 }
  const coreGeometry = beamGeometry(BEAM_CORE_RADIUS)
  const glowGeometry = beamGeometry(BEAM_GLOW_RADIUS)
  const rippleMesh = rippleGeometry()
  const startedAt = typeof performance === 'undefined' ? 0 : performance.now()
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 텍스처가 없는 모델이라 조명이 없으면 새까맣게 보인다.
  scene.add(new THREE.AmbientLight(0xffffff, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 2.6)
  key.position.set(-0.5, 1.2, 0.8)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xdfe9ff, 1.2)
  fill.position.set(1, 0.4, -0.6)
  scene.add(fill)

  /**
   * 기준점(화면 중심) 기준 미터 좌표계 → 지도 좌표계 행렬.
   * 이 행렬을 카메라 쪽에 곱해 두면 모델은 작은 미터 값만 갖게 된다.
   */
  function worldMatrix(ref: MercatorCoordinate, unit: number) {
    return new THREE.Matrix4()
      .makeTranslation(ref.x, ref.y, ref.z)
      // 지도 좌표계는 남쪽으로 갈수록 y가 커져 Y를 뒤집는다.
      .scale(new THREE.Vector3(unit, -unit, unit))
      // glTF(Y축이 위) → 지도(Z축이 위)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  }

  /** 원하는 건물이 아직 안 왔으면 먼저 도착한 아무 건물이나 세워 둔다. */
  function pickTemplate(variant: number) {
    return templates[variant] ?? templates.find(Boolean) ?? null
  }

  /** 건물과 빛기둥을 한 그룹으로 묶어 새 거점을 만든다. */
  function createInstance(variant: number, model: THREE.Group): VenueInstance {
    const group = new THREE.Group()
    // 건물은 따로 담아 둔다. 나중에 통째로 갈아 끼우기 위해서다.
    const shell = new THREE.Group()
    shell.add(model.clone(true))
    group.add(shell)

    const beams = [glowGeometry, coreGeometry].map((geometry) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uStrength: { value: 1 },
          uSpeed: { value: 1 },
          uTime: beamTime,
        },
        transparent: true,
        // 기둥 안쪽 면까지 그려야 어느 각도에서 봐도 속이 비지 않는다.
        side: THREE.DoubleSide,
        // 깊이를 남기면 자기 뒷면을 지워 기둥이 잘려 보인다.
        depthWrite: false,
      })
      group.add(new THREE.Mesh(geometry, material))
      return material
    })

    // 바닥 파동. 건물보다 먼저 그려도 되도록 깊이는 남기지 않는다.
    const ripple = new THREE.ShaderMaterial({
      vertexShader: RIPPLE_VERTEX,
      fragmentShader: RIPPLE_FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uStrength: { value: 1 },
        uSpeed: { value: 1 },
        uTime: beamTime,
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    group.add(new THREE.Mesh(rippleMesh, ripple))

    scene.add(group)
    return { group, shell, beams, ripple, variant }
  }

  /**
   * 거점 목록과 줌에 맞춰 모델을 배치한다.
   * 기준점에서 동쪽(x) · 위(y) · 남쪽(z) 방향 미터가 그대로 좌표가 된다.
   */
  function layout(ref: MercatorCoordinate, unit: number, lat: number) {
    const base = venueWidthMeters(lat, map.getZoom())
    const alive = new Set<string>()

    getPlacements().forEach((place) => {
      const look = styleOf(place, templates.length)
      const model = pickTemplate(look.variant)
      if (!model) return
      alive.add(place.id)

      let instance = instances.get(place.id)
      if (!instance) {
        instance = createInstance(look.variant, model)
        instances.set(place.id, instance)
      } else if (instance.variant !== look.variant && templates[look.variant]) {
        // 임시로 세워 뒀던 건물을 제 건물로 갈아 끼운다.
        instance.shell.clear()
        instance.shell.add(templates[look.variant]!.clone(true))
        instance.variant = look.variant
      }

      const point = MercatorCoordinate.fromLngLat({ lng: place.lng, lat: place.lat }, 0)
      instance.group.position.set((point.x - ref.x) / unit, 0, (point.y - ref.y) / unit)
      instance.group.rotation.y = look.yaw
      instance.group.scale.setScalar(base * look.scale * (place.selected ? 1.18 : 1))

      // 색·속도·세기는 거점 상태가 정한다(인기·1위·선택).
      const tone = beamTone(place)
      instance.beams.forEach((material, index) => {
        rawColor(tone.color, material.uniforms.uColor.value as THREE.Color)
        // 넓은 후광은 옅게, 가운데 심지는 진하게.
        material.uniforms.uStrength.value = (index === 0 ? 0.24 : 0.6) * tone.strength
        material.uniforms.uSpeed.value = tone.speed
      })
      rawColor(tone.color, instance.ripple.uniforms.uColor.value as THREE.Color)
      instance.ripple.uniforms.uStrength.value = tone.strength
      instance.ripple.uniforms.uSpeed.value = tone.speed
    })

    instances.forEach((instance, id) => {
      if (alive.has(id)) return
      scene.remove(instance.group)
      instance.beams.forEach((material) => material.dispose())
      instance.ripple.dispose()
      instances.delete(id)
    })
  }

  return {
    id: VENUE_MODEL_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, gl) {
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGLRenderingContext,
      })
      renderer.autoClear = false

      const loader = new GLTFLoader()
      MODEL_URLS.forEach((url, index) => {
        loader.load(
          url,
          (gltf) => {
            const { holder, info } = normalizeModel(gltf.scene)
            templates[index] = holder
            console.info(`[MATCHPOINT] 거점 모델 로드 · ${url} · ${info}`)
            map.triggerRepaint()
          },
          undefined,
          (error) => console.warn(`[MATCHPOINT] 거점 모델을 불러오지 못했습니다: ${url}`, error),
        )
      })
    },

    onRemove() {
      instances.forEach((instance) => {
        scene.remove(instance.group)
        instance.beams.forEach((material) => material.dispose())
        instance.ripple.dispose()
      })
      instances.clear()
      coreGeometry.dispose()
      glowGeometry.dispose()
      rippleMesh.dispose()
      templates.fill(null)
      // 캔버스는 MapLibre 소유라 renderer.dispose() 만 하고 컨텍스트는 건드리지 않는다.
      renderer?.dispose()
      renderer = null
    },

    render(_gl, args: unknown) {
      if (!renderer || !templates.some(Boolean)) return
      // MapLibre v5 는 defaultProjectionData 로, v4 는 행렬을 그대로 넘긴다.
      const input = args as { defaultProjectionData?: { mainMatrix?: number[] } } | number[]
      const matrix = Array.isArray(input) ? input : input?.defaultProjectionData?.mainMatrix
      if (!matrix) return

      const center = map.getCenter()
      const ref = MercatorCoordinate.fromLngLat({ lng: center.lng, lat: center.lat }, 0)
      const unit = ref.meterInMercatorCoordinateUnits()

      layout(ref, unit, center.lat)
      if (!reducedMotion) beamTime.value = (performance.now() - startedAt) / 1000

      camera.projectionMatrix = new THREE.Matrix4()
        .fromArray(matrix as number[])
        .multiply(worldMatrix(ref, unit))
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()

      renderer.resetState()
      // 반투명한 주변 도시 건물에 거점이 잘려 보이지 않도록 깊이를 비우고
      // 체육관만 온전히 얹는다. 모델 내부 앞뒤 관계는 그대로 유지된다.
      renderer.clearDepth()
      renderer.render(scene, camera)

      // 빛기둥 맥동은 지도가 멈춰 있어도 계속 흘러야 한다.
      // (탭이 가려지면 브라우저가 프레임을 멈춰 저절로 쉰다.)
      if (!reducedMotion) map.triggerRepaint()
    },

    refresh() {
      map.triggerRepaint()
    },
  }
}
