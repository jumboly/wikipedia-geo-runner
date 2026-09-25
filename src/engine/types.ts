import type { GeoPoint, LatLon } from '../lib/geo/geo'

export interface Goal {
  /** JEV が意味的に理解できるアンカー名（例: 大坂城周辺） */
  name: string
  anchorTitle?: string
  center: LatLon
  radiusM: number
}

export type RunnerKind = 'jev' | 'human'

export interface RaceEntry {
  runnerId: string
  name: string
  icon: string
  kind: RunnerKind
  personality: string
  startTitle: string
  /** レース開始時点の Memory のスナップショット（プロンプトに渡す） */
  memory: string[]
}

export interface RaceSettings {
  lang: string
  maxTurns: number
  backLimit: number
  /** argmax: 最も確率の高い手 / sample: JEV の確率分布からサンプリング */
  choiceMode: 'argmax' | 'sample'
  /** これ以下の候補数なら一度の Choice で全件渡す */
  flatLimit: number
}

export interface RaceConfig {
  id: string
  createdAt: number
  goal: Goal
  entries: RaceEntry[]
  settings: RaceSettings
}

export type Action = { type: 'link'; title: string } | { type: 'back' }

export type StepKind = 'start' | 'move' | 'back' | 'forced-back'

export interface RouteStep {
  turn: number
  kind: StepKind
  title: string
  coord: GeoPoint | null
  /** 座標はゴール圏内だが、対象がゴール圏より大きいため GOAL にならなかった */
  tooLarge?: boolean
}

export type RunnerStatus = 'running' | 'goal' | 'dnf'

export interface RunnerState {
  runnerId: string
  current: string
  /** BACK で戻るための経路スタック（先頭がスタート） */
  stack: string[]
  visited: string[]
  route: RouteStep[]
  backsLeft: number
  status: RunnerStatus
  finishTurn?: number
  dnfReason?: 'max-turns' | 'no-moves' | 'aborted'
  lastCoord: LatLon | null
}

export interface MoveRecord {
  runnerId: string
  action: Action
  from: string
  to: string
  /** このターン開始前に無料で行われた強制 BACK の経路 */
  forcedBacks: string[]
  /** JEV の選択確率（観戦用）。上位のみ */
  probs?: Record<string, number>
  /** 判断元。jev 以外（録画再生・ダミー）の手が混ざったレースは正式な JEV のレースとして扱わない */
  source?: 'jev' | 'replay' | 'mock' | 'human'
}

export interface TurnRecord {
  turn: number
  moves: MoveRecord[]
  goals: string[]
}

/** JEV の利用量。コスト表示と混雑状況の振り返りに使う */
export interface JevStats {
  /** 成功した JEV 呼び出し回数（課金対象） */
  calls: number
  inputTokens: number
  costUsd: number
  /** 429/503 等で再試行した回数（課金されない） */
  retries: number
}

export const emptyJevStats = (): JevStats => ({ calls: 0, inputTokens: 0, costUsd: 0, retries: 0 })

export interface RaceSnapshot {
  config: RaceConfig
  turn: number
  runners: RunnerState[]
  turns: TurnRecord[]
  finished: boolean
  /** 旧バージョンで保存した履歴には無い */
  jev?: JevStats
}

export interface RaceResult {
  runnerId: string
  rank: number | null
  status: RunnerStatus
  finishTurn?: number
  distanceM?: number
}
