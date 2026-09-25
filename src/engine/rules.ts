import { distanceM, type GeoPoint, type LatLon } from '../lib/geo/geo'
import type { Action, Goal, RaceResult, RaceSnapshot, RunnerState } from './types'

/**
 * ゲームルール（決定論的処理）。JEV の判断は一切含めず、I/O も持たない。
 * 記事データは呼び出し側が事前に取得して linksOf で渡す。
 */

export type LinksOf = (title: string) => string[]

export function newRunnerState(runnerId: string, start: string, coord: LatLon | null, backLimit: number): RunnerState {
  return {
    runnerId,
    current: start,
    stack: [start],
    visited: [start],
    route: [{ turn: 0, kind: 'start', title: start, coord }],
    backsLeft: backLimit,
    status: 'running',
    lastCoord: coord,
  }
}

/** 未訪問の合法リンク（文書順のまま。コード側で並べ替え・絞り込みをしない） */
export function unvisitedLinks(r: RunnerState, links: string[]): string[] {
  const v = new Set(r.visited)
  return links.filter((t) => !v.has(t))
}

export function canBack(r: RunnerState): boolean {
  return r.backsLeft > 0 && r.stack.length > 1
}

/**
 * 行き止まり救済。未訪問リンクが残る記事まで無料で連続バックトラックする。
 * ターン・BACK 回数は消費しない。戻れる記事が尽きたら DNF。
 * 戻った記事のタイトル列を返す。
 */
export function applyForcedBacks(r: RunnerState, linksOf: LinksOf, turn: number, coordOf: (t: string) => LatLon | null): string[] {
  const path: string[] = []
  while (r.status === 'running' && unvisitedLinks(r, linksOf(r.current)).length === 0) {
    if (r.stack.length <= 1) {
      r.status = 'dnf'
      r.dnfReason = 'no-moves'
      r.finishTurn = turn
      break
    }
    r.stack.pop()
    r.current = r.stack[r.stack.length - 1]
    const coord = coordOf(r.current)
    if (coord) r.lastCoord = coord
    r.route.push({ turn, kind: 'forced-back', title: r.current, coord })
    path.push(r.current)
  }
  return path
}

export function isLegal(r: RunnerState, action: Action, links: string[]): boolean {
  if (action.type === 'back') return canBack(r)
  return links.includes(action.title) && !r.visited.includes(action.title)
}

/** 1 手を適用する。合法性は呼び出し側で確認済みであること */
export function applyAction(r: RunnerState, action: Action, turn: number, coord: LatLon | null): void {
  if (action.type === 'back') {
    r.backsLeft--
    r.stack.pop()
    r.current = r.stack[r.stack.length - 1]
    r.route.push({ turn, kind: 'back', title: r.current, coord })
  } else {
    r.current = action.title
    r.stack.push(action.title)
    r.visited.push(action.title)
    r.route.push({ turn, kind: 'move', title: action.title, coord })
  }
  // 座標を持たない記事の間は地図上の位置を最後の既知座標に残す
  if (coord) r.lastCoord = coord
}

export function inGeofence(coord: LatLon | null, goal: Goal): boolean {
  return !!coord && distanceM(coord, goal.center) <= goal.radiusM
}

/**
 * GOAL 判定。都道府県・市などの広域記事は座標が庁舎の1点しかなく、それだけで GOAL になると
 * 「ゴール付近に着いた」ことにならないため、対象の大きさ(dim)がゴール半径を超える記事は除外する
 * （ユーザー決定 2026-09-25）。dim 不明の記事は通常の地点として扱う。
 */
export function inGoal(coord: GeoPoint | null, goal: Goal): boolean {
  return inGeofence(coord, goal) && !((coord?.dimM ?? 0) > goal.radiusM)
}

/**
 * 最終順位。GOAL 者は到達ターン順（同ターンは同順位）。DNF は正式順位を持たない。
 */
export function computeResults(s: RaceSnapshot): RaceResult[] {
  const goals = s.runners.filter((r) => r.status === 'goal').sort((a, b) => a.finishTurn! - b.finishTurn!)
  const out: RaceResult[] = []
  for (const r of goals) {
    const rank = 1 + goals.filter((g) => g.finishTurn! < r.finishTurn!).length
    out.push({ runnerId: r.runnerId, rank, status: 'goal', finishTurn: r.finishTurn })
  }
  const others = s.runners
    .filter((r) => r.status !== 'goal')
    .map((r) => ({
      runnerId: r.runnerId,
      rank: null,
      status: r.status,
      finishTurn: r.finishTurn,
      distanceM: r.lastCoord ? distanceM(r.lastCoord, s.config.goal.center) : undefined,
    }))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))
  return [...out, ...others]
}
