import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action, Goal, RaceConfig, RaceSnapshot } from '../engine/types'
import type { JevAuth } from '@jumboly/jev-client'
import type { GateState } from '@jumboly/jev-client'
import type { FromWorker, HumanPrompt, ToWorker } from '../worker/protocol'

export type PlayMode = 'step' | 'auto' | 'fast'

let worker: Worker | null = null
let reqSeq = 0
const pendingReqs = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners = new Set<(m: FromWorker) => void>()

/** Worker は 1 個を共有する。記事キャッシュをセットアップ画面とレースで使い回すため */
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/race.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data
      if (m.type === 'setup-result') {
        const p = pendingReqs.get(m.reqId)
        pendingReqs.delete(m.reqId)
        if (m.ok) p?.resolve(m.value)
        else p?.reject(new Error(m.error))
        return
      }
      for (const l of listeners) l(m)
    }
  }
  return worker
}

function send(m: ToWorker) {
  getWorker().postMessage(m)
}

type DistOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

/** セットアップ系の重い処理（GeoSearch + 記事検証）を Worker に依頼する */
export function workerRequest<T>(m: DistOmit<Extract<ToWorker, { reqId: number }>, 'reqId'>): Promise<T> {
  const reqId = ++reqSeq
  return new Promise<T>((resolve, reject) => {
    pendingReqs.set(reqId, { resolve, reject })
    send({ ...m, reqId } as ToWorker)
  })
}

export const setupApi = {
  randomGoal: (lang: string, regionId: string, radiusM: number) =>
    workerRequest<Goal>({ type: 'setup-goal-random', lang, regionId, radiusM }),
  randomStarts: (lang: string, goal: Goal, count: number, minKm: number, maxKm: number) =>
    workerRequest<string[]>({ type: 'setup-starts', lang, goal, count, minKm, maxKm }),
  validateStart: (lang: string, goal: Goal, title: string) =>
    workerRequest<string>({ type: 'setup-validate-start', lang, goal, title }),
  article: (lang: string, title: string) =>
    workerRequest<{ title: string; coord: { lat: number; lon: number } | null }>({ type: 'setup-article', lang, title }),
}

export interface RaceUiState {
  snapshot: RaceSnapshot | null
  /** Runner ごとの入力待ち（同一端末で複数 Human が交代で遊ぶ場合に備える） */
  humans: Record<string, HumanPrompt>
  readyTurn: number | null
  thinking: string[]
  status: string | null
  error: { message: string; recoverable: boolean } | null
  finished: boolean
  gate: GateState | null
}

const initial: RaceUiState = { snapshot: null, humans: {}, readyTurn: null, thinking: [], status: null, error: null, finished: false, gate: null }

/**
 * レースの観戦制御。再生モードは「公開タイミング」だけを変え、ゲームルール（1ターン=全員1リンク）は変えない。
 */
export function useRace(onFinished: (s: RaceSnapshot) => void) {
  const [st, setSt] = useState<RaceUiState>(initial)
  const [mode, setMode] = useState<PlayMode>('step')
  const [intervalMs, setIntervalMs] = useState(1500)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    const l = (m: FromWorker) => {
      setSt((s) => {
        switch (m.type) {
          case 'snapshot':
            return { ...s, snapshot: m.snapshot, error: null }
          case 'thinking':
            return { ...s, thinking: m.pending, readyTurn: null, status: null }
          case 'human':
            return { ...s, humans: { ...s.humans, [m.prompt.runnerId]: m.prompt } }
          case 'ready':
            return { ...s, readyTurn: m.turn, thinking: [], humans: {}, status: null }
          case 'status':
            return { ...s, status: m.message }
          case 'jev-gate':
            return { ...s, gate: m.state }
          case 'error':
            return { ...s, error: { message: m.message, recoverable: m.recoverable } }
          case 'finished':
            return { ...s, snapshot: m.snapshot, finished: true, humans: {}, readyTurn: null, thinking: [] }
          default:
            return s
        }
      })
      if (m.type === 'finished') onFinishedRef.current(m.snapshot)
    }
    listeners.add(l)
    getWorker()
    return () => {
      listeners.delete(l)
    }
  }, [])

  const hasHuman = !!st.snapshot?.config.entries.some((e) => e.kind === 'human')

  // 自動公開: Human 参加時は全員の手が揃い次第すぐ公開（半同期）。JEV のみなら再生モードに従う
  useEffect(() => {
    if (st.readyTurn == null || st.finished) return
    if (hasHuman || mode === 'fast') {
      send({ type: 'reveal' })
      return
    }
    if (mode === 'auto') {
      const t = setTimeout(() => send({ type: 'reveal' }), intervalMs)
      return () => clearTimeout(t)
    }
  }, [st.readyTurn, st.finished, mode, intervalMs, hasHuman])

  const start = useCallback((config: RaceConfig, auth: JevAuth, jevRatePerMin?: number) => {
    // gate は経路ごとに Worker 全体で共有の状態。開始時に Worker が今回の経路の最新状態を送り直すので、
    // ここで前の経路（や mock）の表示を引き継がないよう一旦消す
    setSt({ ...initial })
    send({ type: 'start', config, auth, jevRatePerMin })
  }, [])

  return {
    ...st,
    mode,
    setMode,
    intervalMs,
    setIntervalMs,
    start,
    step: () => send({ type: 'reveal' }),
    humanMove: (runnerId: string, action: Action) => {
      setSt((s) => {
        const { [runnerId]: _, ...rest } = s.humans
        return { ...s, humans: rest }
      })
      send({ type: 'human-move', runnerId, action })
    },
    retry: () => {
      setSt((s) => ({ ...s, error: null }))
      send({ type: 'retry' })
    },
    stop: () => send({ type: 'abort' }),
    reset: () => setSt(initial),
  }
}
