import { Limiter, sleep } from '../limiter'

/**
 * JEV (typesafe-ai/jev) を Vercel AI Gateway のネイティブ HTTP API で呼ぶ。
 * AI Gateway は CORS を許可しているため、GitHub Pages 版はユーザーのキーで直接呼ぶ。
 * 開発時は Vite dev proxy (/dev-jev) がサーバー側で .env のキーを付与する。
 */

export const JEV_MODEL = 'typesafe-ai/jev'
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
const DEV_PROXY_PATH = 'dev-jev/v1/evaluate'

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'boolean'; instructions: string; criteria?: { true?: string; false?: string } }

export interface Answer {
  type: 'choice' | 'score' | 'boolean'
  choice?: string
  score?: number
  probability?: number
  probabilities?: Record<string, number>
  confidence?: number
}

export type JevAuth =
  | { mode: 'key'; apiKey: string }
  | { mode: 'dev-proxy'; origin: string }
  | { mode: 'mock'; seed?: number }

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

export interface EvaluateOptions {
  signal?: AbortSignal
  /** リトライ待機のたびに呼ばれる。UI に「混雑中・再試行中」を出すため */
  onRetry?: (info: { attempt: number; waitMs: number; status: number }) => void
}

// 429/503 が頻発する状況で同時リクエストを増やすと悪化するため絞る
const limiter = new Limiter(3)
const MAX_ATTEMPTS = 8

export async function evaluate(
  auth: JevAuth,
  state: unknown,
  questions: Record<string, Question>,
  opts: EvaluateOptions = {},
): Promise<Record<string, Answer>> {
  if (auth.mode === 'mock') return mockEvaluate(questions)
  const url = auth.mode === 'key' ? GATEWAY_URL : new URL(DEV_PROXY_PATH, auth.origin).toString()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth.mode === 'key') headers.authorization = `Bearer ${auth.apiKey}`
  const body = JSON.stringify({
    model: JEV_MODEL,
    state,
    questions,
    // zeroDataRetention は Vercel Pro 以上限定で Hobby だと 403 になるため指定しない
  })

  return limiter.run(async () => {
    for (let attempt = 1; ; attempt++) {
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body, signal: opts.signal })
      } catch (e) {
        if (opts.signal?.aborted) throw e
        // ネットワーク断は一時的なことが多いのでリトライ対象
        res = new Response(null, { status: 599 })
      }
      if (res.ok) {
        const json = await res.json()
        return normalize(json)
      }
      const shouldRetryHeader = res.headers.get('x-should-retry')
      const retryable =
        shouldRetryHeader === 'true' ||
        (shouldRetryHeader !== 'false' && (res.status === 429 || res.status >= 500 || res.status === 408))
      const msg = await res.text().catch(() => '')
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new JevError(`JEV ${res.status}: ${extractMessage(msg)}`, res.status, retryable)
      }
      const ra = Number(res.headers.get('retry-after'))
      // retry-after 優先。無ければ指数バックオフ + ジッタで同時再送の集中を避ける
      const waitMs = ra > 0 ? ra * 1000 : Math.min(30000, 1000 * 2 ** (attempt - 1)) * (0.5 + Math.random())
      opts.onRetry?.({ attempt, waitMs, status: res.status })
      await sleep(waitMs, opts.signal)
    }
  })
}

function extractMessage(text: string): string {
  try {
    return JSON.parse(text).error?.message ?? text
  } catch {
    return text.slice(0, 200)
  }
}

function normalize(json: any): Record<string, Answer> {
  const conf = json.providerMetadata?.typesafe?.confidence ?? {}
  const out: Record<string, Answer> = {}
  for (const [k, v] of Object.entries<any>(json.answers ?? {})) out[k] = { ...v, confidence: v.confidence ?? conf[k] }
  return out
}

/** 開発・テスト用。API を消費せずにゲーム進行を確認するため、一様乱数で答える */
function mockEvaluate(questions: Record<string, Question>): Promise<Record<string, Answer>> {
  const out: Record<string, Answer> = {}
  for (const [k, q] of Object.entries(questions)) {
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria)
      // BACK ばかり選ばれると観戦確認にならないので BACK は低確率にする
      const pool = keys.length > 1 && Math.random() < 0.95 ? keys.filter((x) => x !== 'BACK') : keys
      const choice = pool[Math.floor(Math.random() * pool.length)]
      out[k] = { type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 0 }
    } else if (q.type === 'score') {
      const score = Math.floor(Math.random() * q.criteria.length)
      out[k] = { type: 'score', score, probabilities: { [String(score)]: 1 } }
    } else {
      out[k] = { type: 'boolean', probability: Math.random() }
    }
  }
  return new Promise((r) => setTimeout(() => r(out), 150 + Math.random() * 300))
}
