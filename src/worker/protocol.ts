import type { JevAuth } from '../lib/jev/client'
import type { Action, Goal, RaceConfig, RaceSnapshot } from '../engine/types'

export interface HumanPrompt {
  runnerId: string
  turn: number
  title: string
  html: string
  redirects: Record<string, string>
  /** 選択可能（未訪問の合法）リンク */
  legal: string[]
  visited: string[]
  canBack: boolean
  prevTitle: string | null
  backsLeft: number
}

export type ToWorker =
  | { type: 'start'; config: RaceConfig; auth: JevAuth }
  | { type: 'reveal' }
  | { type: 'human-move'; runnerId: string; action: Action }
  | { type: 'retry' }
  | { type: 'abort' }
  | { type: 'setup-goal-random'; reqId: number; lang: string; regionId: string; radiusM: number }
  | { type: 'setup-starts'; reqId: number; lang: string; goal: Goal; count: number; minKm: number; maxKm: number }
  | { type: 'setup-validate-start'; reqId: number; lang: string; goal: Goal; title: string }
  | { type: 'setup-article'; reqId: number; lang: string; title: string }

export type FromWorker =
  | { type: 'snapshot'; snapshot: RaceSnapshot }
  /** 全 Runner の今ターンの手が揃った（公開待ち） */
  | { type: 'ready'; turn: number }
  | { type: 'thinking'; turn: number; pending: string[] }
  | { type: 'human'; prompt: HumanPrompt }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'finished'; snapshot: RaceSnapshot }
  | { type: 'setup-result'; reqId: number; ok: true; value: unknown }
  | { type: 'setup-result'; reqId: number; ok: false; error: string }
