import { isRecoverable, type Evaluator } from '@jumboly/jev-client'
import type { GeoPoint } from '../lib/geo/geo'
import type { ArticleSource, WikiArticle } from '../lib/wiki/api'
import type { FromWorker, HumanPrompt } from '../worker/protocol'
import { applyAction, applyForcedBacks, canBack, computeResults, inGeofence, inGoal, isLegal, newRunnerState, unvisitedLinks } from './rules'
import { decide, type Decision } from './runnerAgent'
import { emptyJevStats, type Action, type MoveRecord, type RaceConfig, type RaceSnapshot, type RunnerState } from './types'

/**
 * 半同期ターン制のレース進行。
 * 各ターン: 強制BACK → 全 Runner の手を集める（JEV は裏で並列、Human は入力待ち）→ ready
 * → reveal で同時公開・適用 → ゴール判定。
 * JEV の応答速度や Human の思考時間は「いつ公開できるか」にしか影響せず、勝敗には影響しない。
 */
export class RaceRuntime {
  private snap!: RaceSnapshot
  private articles = new Map<string, WikiArticle>()
  private decisions = new Map<string, Decision>()
  private forced = new Map<string, string[]>()
  private abort = new AbortController()
  private preparing = false
  private stats = emptyJevStats()
  /** 実際に JEV を呼んだ分だけ集計する（録画再生・ダミーは課金されない） */
  private counted: Evaluator

  constructor(
    private readonly config: RaceConfig,
    private readonly wiki: ArticleSource,
    private readonly evaluator: Evaluator,
    private readonly emit: (m: FromWorker) => void,
    /** JEV の最大試行回数。代替の判断役を連結している場合は小さくする */
    private readonly maxAttempts?: number,
    /** 共有の待機がこれより長ければ待たずに失敗させる（代替の判断役がある場合のみ指定） */
    private readonly maxWaitMs?: number,
  ) {
    this.counted = async (state, questions, opts) => {
      const r = await this.evaluator(state, questions, opts)
      if (r.usage) {
        this.stats.calls++
        this.stats.inputTokens += r.usage.inputTokens
        this.stats.costUsd += r.usage.costUsd
      }
      return r
    }
  }

  private async article(title: string): Promise<WikiArticle> {
    const a = await this.wiki.getArticle(title)
    this.articles.set(title, a)
    // リダイレクト経由で到達した場合も正規タイトルで引けるようにする
    this.articles.set(a.title, a)
    return a
  }

  private links = (title: string) => this.articles.get(title)?.sections.flatMap((s) => s.links) ?? []
  private coord = (title: string): GeoPoint | null => this.articles.get(title)?.coord ?? null

  async start() {
    const { entries, settings } = this.config
    const runners: RunnerState[] = []
    for (const e of entries) {
      const a = await this.article(e.startTitle)
      runners.push(newRunnerState(e.runnerId, a.title, a.coord, settings.backLimit))
    }
    this.snap = { config: this.config, turn: 0, runners, turns: [], finished: false }
    this.emitSnapshot()
    await this.prepareTurn()
  }

  private emitSnapshot() {
    this.snap.jev = { ...this.stats }
    this.emit({ type: 'snapshot', snapshot: structuredClone(this.snap) })
  }

  private running() {
    return this.snap.runners.filter((r) => r.status === 'running')
  }

  private entry(id: string) {
    return this.config.entries.find((e) => e.runnerId === id)!
  }

  private async prepareTurn() {
    if (this.preparing) return
    this.preparing = true
    try {
      const turn = this.snap.turn + 1
      if (turn > this.config.settings.maxTurns) {
        for (const r of this.running()) Object.assign(r, { status: 'dnf', dnfReason: 'max-turns', finishTurn: this.snap.turn })
        return this.finish()
      }
      // 強制 BACK は前ターンの結果に対する無料救済。戻り先の記事は訪問済みなので取得済み
      for (const r of this.running()) {
        if (this.decisions.has(r.runnerId)) continue
        await this.article(r.current)
        const path = applyForcedBacks(r, this.links, this.snap.turn, this.coord)
        if (path.length) this.forced.set(r.runnerId, [...(this.forced.get(r.runnerId) ?? []), ...path])
      }
      if (this.running().length === 0) return this.finish()
      this.emitSnapshot()
      await this.collectDecisions(turn)
    } finally {
      this.preparing = false
    }
  }

  private async collectDecisions(turn: number) {
    const pending = this.running().filter((r) => !this.decisions.has(r.runnerId))
    this.emit({ type: 'thinking', turn, pending: pending.map((r) => r.runnerId) })
    let failed: unknown = null
    await Promise.all(
      pending.map(async (r) => {
        const e = this.entry(r.runnerId)
        const art = await this.article(r.current)
        if (e.kind === 'human') {
          this.emit({ type: 'human', prompt: this.humanPrompt(r, art, turn) })
          return
        }
        try {
          const d = await decide(
            this.counted,
            { entry: e, runner: r, goal: this.config.goal, settings: this.config.settings, turn, sections: art.sections, hint: null },
            canBack(r),
            {
              signal: this.abort.signal,
              maxAttempts: this.maxAttempts,
              maxWaitMs: this.maxWaitMs,
              onRetry: ({ attempt, waitMs, status }) => {
                this.stats.retries++
                this.emit({ type: 'status', message: `${e.name}: JEV ${status} 混雑のため再試行 ${attempt}回目（全員 ${Math.round(waitMs / 1000)}秒待機）` })
              },
            },
          )
          if (!isLegal(r, d.action, this.links(r.current))) throw new Error(`${e.name} の手が不正です`)
          this.decisions.set(r.runnerId, d)
        } catch (err) {
          if (!this.abort.signal.aborted) failed = err
        }
      }),
    )
    if (this.abort.signal.aborted) return
    if (failed) {
      // 失敗した Runner の手をコードで代打ちすると JEV のレースでなくなるため、一時停止して再試行を待つ
      const msg = failed instanceof Error ? failed.message : String(failed)
      this.emit({ type: 'error', message: msg, recoverable: isRecoverable(failed) })
      return
    }
    this.checkReady(turn)
  }

  private humanPrompt(r: RunnerState, art: WikiArticle, turn: number): HumanPrompt {
    return {
      runnerId: r.runnerId,
      turn,
      title: art.title,
      html: art.html,
      redirects: art.redirects,
      legal: unvisitedLinks(r, this.links(r.current)),
      visited: r.visited,
      canBack: canBack(r),
      prevTitle: r.stack.length > 1 ? r.stack[r.stack.length - 2] : null,
      backsLeft: r.backsLeft,
    }
  }

  private checkReady(turn: number) {
    if (this.running().every((r) => this.decisions.has(r.runnerId))) this.emit({ type: 'ready', turn })
  }

  humanMove(runnerId: string, action: Action) {
    const r = this.snap.runners.find((x) => x.runnerId === runnerId)
    if (!r || r.status !== 'running' || !isLegal(r, action, this.links(r.current))) {
      this.emit({ type: 'error', message: '不正な手です', recoverable: true })
      return
    }
    this.decisions.set(runnerId, { action, probs: {}, source: 'human' })
    this.checkReady(this.snap.turn + 1)
  }

  async retry() {
    await this.collectDecisions(this.snap.turn + 1)
  }

  async reveal() {
    const running = this.running()
    if (this.snap.finished || !running.every((r) => this.decisions.has(r.runnerId))) return
    const turn = this.snap.turn + 1
    const moves: MoveRecord[] = []
    // 移動先記事は並列取得（座標判定と次ターンのリンクに必要）
    await Promise.all(
      running.map(async (r) => {
        const d = this.decisions.get(r.runnerId)!
        if (d.action.type === 'link') {
          const a = await this.article(d.action.title)
          // parse 時にリダイレクトが解決された場合は正規タイトルに寄せる
          if (a.title !== d.action.title) d.action = { type: 'link', title: a.title }
        }
      }),
    )
    const goals: string[] = []
    for (const r of running) {
      const d = this.decisions.get(r.runnerId)!
      const from = r.current
      const target = d.action.type === 'back' ? r.stack[r.stack.length - 2] : d.action.title
      applyAction(r, d.action, turn, this.coord(target))
      const here = this.coord(r.current)
      if (d.action.type === 'link' && inGoal(here, this.config.goal)) {
        r.status = 'goal'
        r.finishTurn = turn
        goals.push(r.runnerId)
      } else if (d.action.type === 'link' && inGeofence(here, this.config.goal)) {
        r.route[r.route.length - 1].tooLarge = true
      }
      moves.push({ runnerId: r.runnerId, action: d.action, from, to: r.current, forcedBacks: this.forced.get(r.runnerId) ?? [], probs: d.probs, source: d.source })
    }
    this.snap.turns.push({ turn, moves, goals })
    this.snap.turn = turn
    this.decisions.clear()
    this.forced.clear()
    if (this.running().length === 0) return this.finish()
    this.emitSnapshot()
    await this.prepareTurn()
  }

  /** ユーザーによる打ち切り。残りは DNF */
  stop() {
    this.abort.abort('stopped')
    if (!this.snap || this.snap.finished) return
    for (const r of this.running()) Object.assign(r, { status: 'dnf', dnfReason: 'aborted', finishTurn: this.snap.turn })
    this.finish()
  }

  private finish() {
    this.snap.jev = { ...this.stats }
    this.snap.finished = true
    this.emit({ type: 'finished', snapshot: structuredClone(this.snap) })
  }

  results() {
    return computeResults(this.snap)
  }
}
