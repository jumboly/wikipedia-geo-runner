/// <reference lib="webworker" />
import { RaceRuntime } from '../engine/runtime'
import { randomGoal, randomStart, REGIONS, validateStart } from '../engine/placement'
import { WikiClient } from '../lib/wiki/api'
import type { FromWorker, ToWorker } from './protocol'

/**
 * Wikipedia 取得・HTML 解析・JEV 呼び出し・レース進行をメインスレッドから切り離す。
 * レース中も地図操作や描画が固まらないようにするため。
 */

const post = (m: FromWorker) => self.postMessage(m)
const clients = new Map<string, WikiClient>()
const wiki = (lang: string) => {
  let c = clients.get(lang)
  if (!c) clients.set(lang, (c = new WikiClient(lang)))
  return c
}

let runtime: RaceRuntime | null = null

async function setup(reqId: number, fn: () => Promise<unknown>) {
  try {
    post({ type: 'setup-result', reqId, ok: true, value: await fn() })
  } catch (e) {
    post({ type: 'setup-result', reqId, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  try {
    switch (m.type) {
      case 'start':
        runtime?.stop()
        runtime = new RaceRuntime(m.config, wiki(m.config.settings.lang), m.auth, post)
        await runtime.start()
        break
      case 'reveal':
        await runtime?.reveal()
        break
      case 'human-move':
        runtime?.humanMove(m.runnerId, m.action)
        break
      case 'retry':
        await runtime?.retry()
        break
      case 'abort':
        runtime?.stop()
        break
      case 'setup-goal-random':
        await setup(m.reqId, () => randomGoal(wiki(m.lang), REGIONS.find((r) => r.id === m.regionId) ?? REGIONS[0], m.radiusM))
        break
      case 'setup-starts':
        await setup(m.reqId, async () => {
          const used = new Set<string>()
          const out: string[] = []
          for (let i = 0; i < m.count; i++) {
            const t = await randomStart(wiki(m.lang), m.goal, m.minKm, m.maxKm, used)
            used.add(t)
            out.push(t)
          }
          return out
        })
        break
      case 'setup-validate-start':
        await setup(m.reqId, () => validateStart(wiki(m.lang), m.title, m.goal))
        break
      case 'setup-article':
        await setup(m.reqId, async () => {
          const a = await wiki(m.lang).getArticle(m.title)
          return { title: a.title, coord: a.coord }
        })
        break
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e), recoverable: m.type !== 'start' })
  }
}
