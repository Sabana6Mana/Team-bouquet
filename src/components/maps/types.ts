export interface LatLng {
  lat: number
  lng: number
}

export interface MapMarker {
  id: string
  lat: number
  lng: number
  emoji: string
  sportLabel: string
  color: string
  label: string
  fullLabel: string
  /** 최근 경기가 많았던 인기 체육관 */
  hot: boolean
  /** 이 체육관 1위 플레이어의 티어 색 */
  tierColor: string
  /** 현재 종목 기준 체육관 최고 ELO */
  elo: number
  /** 선택 종목·지역 기준 가장 높은 거점 */
  crowned: boolean
  /**
   * 전체 거점 목록에서의 고정 자리 번호.
   * 3D 건물을 돌아가며 배정할 때 쓴다. 종목 필터로 목록이 줄어도
   * 번호가 그대로라 체육관 건물이 바뀌지 않는다.
   */
  seat: number
}

export interface VenueMapProps {
  center: LatLng
  me: LatLng
  markers: MapMarker[]
  activeId: string | null
  onMarkerClick: (id: string) => void
  focus?: LatLng | null
}
