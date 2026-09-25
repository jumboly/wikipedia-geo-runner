import { destination, distanceM, type LatLon } from '../lib/geo/geo'
import type { WikiClient } from '../lib/wiki/api'
import type { Goal } from './types'

/** スタートとして成立する最低リンク数。少なすぎると即強制 BACK→DNF になりゲームにならない */
const MIN_START_LINKS = 3

type Box = [latMin: number, latMax: number, lonMin: number, lonMax: number]

export interface Region {
  id: string
  label: string
  /** 1つの矩形だと日本に韓国・中国沿岸が入るため、複数矩形の和で近似する */
  boxes: Box[]
}

export const REGIONS: Region[] = [
  {
    id: 'japan',
    label: '日本',
    boxes: [
      [24, 31, 123, 131.5], // 南西諸島・九州南部
      [31, 34.6, 129.5, 132.5], // 九州
      [33, 35.8, 132, 141], // 西日本・中部
      [35.8, 41.6, 135.8, 142.2], // 東日本・東北
      [41.3, 45.6, 139.3, 146], // 北海道
    ],
  },
  { id: 'world', label: '世界', boxes: [[-50, 65, -170, 180]] },
]

function randomPointIn(region: Region): LatLon {
  // 面積比で矩形を選び、地域内で一様に近い分布にする
  const area = (b: Box) => (b[1] - b[0]) * (b[3] - b[2]) * Math.cos((((b[0] + b[1]) / 2) * Math.PI) / 180)
  const total = region.boxes.reduce((a, b) => a + area(b), 0)
  let r = Math.random() * total
  const b = region.boxes.find((x) => (r -= area(x)) <= 0) ?? region.boxes[0]
  return { lat: b[0] + Math.random() * (b[1] - b[0]), lon: b[2] + Math.random() * (b[3] - b[2]) }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function isPlayable(wiki: WikiClient, title: string): Promise<boolean> {
  try {
    const a = await wiki.getArticle(title)
    return !a.disambiguation && a.sections.reduce((n, s) => n + s.links.length, 0) >= MIN_START_LINKS
  } catch {
    return false
  }
}

/** 地域内のランダム地点周辺にある座標付き記事をアンカーにしてゴールを作る */
export async function randomGoal(wiki: WikiClient, region: Region, radiusM: number): Promise<Goal> {
  for (let i = 0; i < 40; i++) {
    const p = randomPointIn(region)
    const hits = await wiki.geoSearch(p, 10000, 30)
    for (const h of shuffle(hits)) {
      if (!(await isPlayable(wiki, h.title))) continue
      return goalFromArticle(h.title, { lat: h.lat, lon: h.lon }, radiusM)
    }
  }
  throw new Error('ランダムゴールを生成できませんでした（地域を変えて再試行してください）')
}

export function goalFromArticle(title: string, center: LatLon, radiusM: number): Goal {
  return { name: `${title}周辺`, anchorTitle: title, center, radiusM }
}

/**
 * ゴールから指定距離帯にランダム地点を取り、その周辺の座標付き記事をスタートにする。
 * 有利不利は許容（オッズ・番狂わせのゲーム性に使う）が、ゴール圏内や成立しない記事は除く。
 */
export async function randomStart(
  wiki: WikiClient,
  goal: Goal,
  minKm: number,
  maxKm: number,
  exclude: Set<string>,
): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const d = (minKm + Math.random() * (maxKm - minKm)) * 1000
    const p = destination(goal.center, Math.random() * 360, d)
    const hits = await wiki.geoSearch(p, 10000, 30)
    for (const h of shuffle(hits)) {
      if (exclude.has(h.title)) continue
      if (distanceM(h, goal.center) <= goal.radiusM * 1.5) continue
      if (await isPlayable(wiki, h.title)) return h.title
    }
  }
  throw new Error('スタート地点を生成できませんでした（距離帯を変えて再試行してください）')
}

/** 手動指定スタートの検証。座標付き・ゴール圏外・リンクあり */
export async function validateStart(wiki: WikiClient, title: string, goal: Goal): Promise<string> {
  const a = await wiki.getArticle(title)
  if (!a.coord) throw new Error(`「${a.title}」は座標を持たない記事です`)
  if (distanceM(a.coord, goal.center) <= goal.radiusM) throw new Error(`「${a.title}」はゴール圏内です`)
  if (!(await isPlayable(wiki, a.title))) throw new Error(`「${a.title}」はスタートとして成立しません`)
  return a.title
}
