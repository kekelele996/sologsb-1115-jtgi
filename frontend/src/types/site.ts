/** 生境类型 */
export const HABITATS = ['阔叶林', '针阔混交林', '草甸', '农田', '湿地', '溪流边'] as const
export type Habitat = (typeof HABITATS)[number]

/** CollectSite 采集地 */
export interface CollectSite {
  id: string
  /** 采集地代码，用于生成标本编号 */
  code: string
  name: string
  region: string
  longitude: number
  latitude: number
  altitude: number
  habitat: Habitat
  /** 小生境描述 */
  microHabitat: string
  /** 微气候备注 */
  microClimate: string
  dateStart: string
  dateEnd: string
}

/** 坐标距离（Haversine，单位：米） */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10
}

/** 找出 50 米内（可配置）的邻近采集地 */
export function findNearbySites(
  sites: CollectSite[],
  latitude: number,
  longitude: number,
  radius = 50,
  excludeId?: string
): { site: CollectSite; distance: number }[] {
  return sites
    .filter((site) => site.id !== excludeId)
    .map((site) => ({ site, distance: distanceMeters(latitude, longitude, site.latitude, site.longitude) }))
    .filter((item) => item.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
}
