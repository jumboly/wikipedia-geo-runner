import type { RaceSnapshot, RouteStep } from '../engine/types'
import type { LatLon } from '../lib/geo/geo'
import { RUNNER_COLORS, type MapRunner } from './MapView'

/** 指定ターン時点の地図表示用データ。Replay でもライブでも同じ関数を使う */
export function mapRunnersAt(s: RaceSnapshot, turn = Infinity): MapRunner[] {
  return s.config.entries.map((e, i) => {
    const r = s.runners.find((x) => x.runnerId === e.runnerId)!
    const steps = r.route.filter((st) => st.turn <= turn)
    const trail: LatLon[] = steps.filter((st) => st.coord).map((st) => st.coord!)
    const done = r.status !== 'running' && (r.finishTurn ?? Infinity) <= turn
    return {
      id: e.runnerId,
      name: e.name,
      icon: e.icon,
      color: RUNNER_COLORS[i % RUNNER_COLORS.length],
      trail,
      position: trail[trail.length - 1] ?? null,
      dimmed: done && r.status === 'dnf',
    }
  })
}

export function currentTitleAt(route: RouteStep[], turn: number): string {
  const steps = route.filter((s) => s.turn <= turn)
  return steps[steps.length - 1]?.title ?? ''
}

export const STEP_MARK: Record<RouteStep['kind'], string> = { start: '●', move: '→', back: '↩', 'forced-back': '⤺' }
