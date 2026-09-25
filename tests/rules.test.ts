import { describe, expect, it } from 'vitest'
import { applyAction, applyForcedBacks, canBack, computeResults, inGeofence, inGoal, isLegal, newRunnerState } from '../src/engine/rules'
import type { RaceSnapshot } from '../src/engine/types'

const graph: Record<string, string[]> = { S: ['A', 'B'], A: ['S', 'C'], B: ['S'], C: ['A'] }
const links = (t: string) => graph[t] ?? []
const noCoord = () => null

describe('rules', () => {
  it('再訪禁止: 訪問済みは不正手', () => {
    const r = newRunnerState('r', 'S', null, 3)
    applyAction(r, { type: 'link', title: 'A' }, 1, null)
    expect(isLegal(r, { type: 'link', title: 'S' }, links('A'))).toBe(false)
    expect(isLegal(r, { type: 'link', title: 'C' }, links('A'))).toBe(true)
  })

  it('BACK は回数を消費し直前へ戻る', () => {
    const r = newRunnerState('r', 'S', null, 1)
    expect(canBack(r)).toBe(false)
    applyAction(r, { type: 'link', title: 'A' }, 1, null)
    applyAction(r, { type: 'back' }, 2, null)
    expect(r.current).toBe('S')
    expect(r.backsLeft).toBe(0)
    expect(r.visited).toContain('A')
    applyAction(r, { type: 'link', title: 'B' }, 3, null)
    expect(canBack(r)).toBe(false)
  })

  it('強制BACK: 未訪問リンクのある記事まで無料で連続して戻る', () => {
    const r = newRunnerState('r', 'S', null, 3)
    applyAction(r, { type: 'link', title: 'A' }, 1, null)
    applyAction(r, { type: 'link', title: 'C' }, 2, null) // C -> A のみ（訪問済み）
    const path = applyForcedBacks(r, links, 2, noCoord)
    // A も残りは S(訪問済) のみなので S まで戻る。S には B が残る
    expect(path).toEqual(['A', 'S'])
    expect(r.current).toBe('S')
    expect(r.backsLeft).toBe(3)
    expect(r.status).toBe('running')
  })

  it('強制BACKで戻れなくなれば DNF', () => {
    const r = newRunnerState('r', 'S', null, 3)
    applyAction(r, { type: 'link', title: 'B' }, 1, null)
    applyAction(r, { type: 'back' }, 2, null)
    applyAction(r, { type: 'link', title: 'A' }, 3, null)
    applyAction(r, { type: 'link', title: 'C' }, 4, null)
    applyForcedBacks(r, links, 4, noCoord)
    expect(r.status).toBe('dnf')
    expect(r.dnfReason).toBe('no-moves')
  })

  it('座標なし記事では最後の既知座標を保持', () => {
    const r = newRunnerState('r', 'S', { lat: 1, lon: 1 }, 3)
    applyAction(r, { type: 'link', title: 'A' }, 1, null)
    expect(r.lastCoord).toEqual({ lat: 1, lon: 1 })
  })

  it('ゴール圏より広い対象（都道府県など）の記事では GOAL にならない', () => {
    const goal = { name: '大坂城周辺', center: { lat: 34.6872, lon: 135.5258 }, radiusM: 2000 }
    const osakaFu = { lat: 34.68633, lon: 135.51986, dimM: 100000 }
    const castle = { lat: 34.68722, lon: 135.52583, dimM: 1000 }
    expect(inGeofence(osakaFu, goal)).toBe(true)
    expect(inGoal(osakaFu, goal)).toBe(false)
    expect(inGoal(castle, goal)).toBe(true)
    expect(inGoal({ lat: 34.6872, lon: 135.5258 }, goal)).toBe(true) // dim 不明は通常地点
    expect(inGoal(osakaFu, { ...goal, radiusM: 150000 })).toBe(true) // 半径を広げれば対象になる
  })

  it('ジオフェンス判定と同ターン同順位', () => {
    const goal = { name: 'g', center: { lat: 34.687, lon: 135.526 }, radiusM: 2000 }
    expect(inGoal({ lat: 34.69, lon: 135.52 }, goal)).toBe(true)
    expect(inGoal({ lat: 35.0, lon: 135.52 }, goal)).toBe(false)
    const mk = (id: string, status: any, finishTurn?: number) => ({ ...newRunnerState(id, 'S', null, 0), status, finishTurn })
    const snap = { config: { goal }, runners: [mk('a', 'goal', 5), mk('b', 'goal', 5), mk('c', 'goal', 7), mk('d', 'dnf', 30)] } as unknown as RaceSnapshot
    expect(computeResults(snap).map((x) => [x.runnerId, x.rank])).toEqual([['a', 1], ['b', 1], ['c', 3], ['d', null]])
  })
})
