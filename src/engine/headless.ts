import type { Evaluator } from '@jumboly/jev-client'
import type { ArticleSource } from '../lib/wiki/api'
import type { FromWorker } from '../worker/protocol'
import { RaceRuntime } from './runtime'
import type { RaceConfig, RaceSnapshot } from './types'

export interface HeadlessOptions {
  /** 進行ログ用。UI と同じイベントがそのまま流れる */
  onEvent?: (m: FromWorker) => void
  /** JEV の最大試行回数（代替の判断役を連結しているなら小さく） */
  maxAttempts?: number
  /** 回復可能なエラーで一時停止した時に自動再試行する回数 */
  autoRetries?: number
  /** 共有の待機がこれより長ければ待たずに失敗させ、代替の判断役へ回す */
  maxWaitMs?: number
}

/**
 * UI なしでレースを最後まで進める（CLI・結合テスト用）。
 * 手が揃い次第すぐ公開する = ブラウザ版の Fast Run と同じ。ルール処理は RaceRuntime を共有する。
 */
export function runHeadless(config: RaceConfig, wiki: ArticleSource, evaluator: Evaluator, opts: HeadlessOptions = {}): Promise<RaceSnapshot> {
  if (config.entries.some((e) => e.kind === 'human')) return Promise.reject(new Error('ヘッドレス実行は Human Runner に対応していません'))
  let retriesLeft = opts.autoRetries ?? 3
  return new Promise((resolve, reject) => {
    const runtime: RaceRuntime = new RaceRuntime(
      config,
      wiki,
      evaluator,
      (m) => {
        opts.onEvent?.(m)
        if (m.type === 'ready') queueMicrotask(() => runtime.reveal().catch(reject))
        else if (m.type === 'finished') resolve(m.snapshot)
        else if (m.type === 'error') {
          if (m.recoverable && retriesLeft-- > 0) queueMicrotask(() => runtime.retry().catch(reject))
          else {
            // stop() は finished を発火するので、先に reject して「完了」扱いにならないようにする
            reject(new Error(m.message))
            runtime.stop()
          }
        }
      },
      opts.maxAttempts,
      opts.maxWaitMs,
    )
    runtime.start().catch(reject)
  })
}
