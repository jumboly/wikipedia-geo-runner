export interface LatLon {
  lat: number
  lon: number
}

/** 記事の主座標。dimM は Wikipedia の座標に付く「対象のおおよその大きさ(m)」 */
export interface GeoPoint extends LatLon {
  dimM?: number
}

const R = 6371008.8

const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** 大円距離 (m)。ジオフェンス判定は球面近似で十分な精度のため haversine を使う */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 起点から方位・距離だけ進んだ地点。ランダムスタート地点の生成に使う */
export function destination(from: LatLon, bearingDeg: number, distM: number): LatLon {
  const d = distM / R
  const b = toRad(bearingDeg)
  const la1 = toRad(from.lat)
  const lo1 = toRad(from.lon)
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 =
    lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return { lat: toDeg(la2), lon: ((toDeg(lo2) + 540) % 360) - 180 }
}
