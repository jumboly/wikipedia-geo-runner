import { describe, expect, it } from 'vitest'
import { runHeadless } from '../src/engine/headless'
import type { RaceConfig, RaceSnapshot } from '../src/engine/types'
import { JevError } from '@jumboly/jev-client'
import { memoryStore, mockEvaluator, recording, replayEvaluator, withFallback, type Evaluator } from '@jumboly/jev-client'
import type { ArticleSource, WikiArticle } from '../src/lib/wiki/api'

/** 架空のリンク網。G がゴール圏内、Pref はゴール圏内だが広域（dim 大） */
const GRAPH: Record<string, { links: string[]; coord?: { lat: number; lon: number; dimM?: number } }> = {
  S1: { links: ['A', 'B', 'Pref'], coord: { lat: 35, lon: 135 } },
  S2: { links: ['B', 'C'], coord: { lat: 35.5, lon: 135.5 } },
  A: { links: ['S1', 'Dead'] },
  B: { links: ['C', 'Pref'], coord: { lat: 34.9, lon: 135.2 } },
  C: { links: ['G', 'B'] },
  Dead: { links: [] },
  Pref: { links: ['G', 'C'], coord: { lat: 34.6873, lon: 135.5262, dimM: 100000 } },
  G: { links: ['C'], coord: { lat: 34.6872, lon: 135.5258, dimM: 1000 } },
}

const fakeWiki: ArticleSource = {
  async getArticle(title: string): Promise<WikiArticle> {
    const n = GRAPH[title]
    if (!n) throw new Error(`no article ${title}`)
    return { title, pageid: 1, sections: [{ title: '(冒頭)', links: n.links }], coord: n.coord ?? null, html: '', redirects: {}, disambiguation: false }
  },
}

function config(): RaceConfig {
  const entry = (id: string, start: string) => ({ runnerId: id, name: id, icon: '🏃', kind: 'jev' as const, personality: '', startTitle: start, memory: [] })
  return {
    id: 'test',
    createdAt: 0,
    goal: { name: 'G周辺', center: { lat: 34.6872, lon: 135.5258 }, radiusM: 2000 },
    entries: [entry('r1', 'S1'), entry('r2', 'S2')],
    settings: { lang: 'ja', maxTurns: 10, backLimit: 3, choiceMode: 'argmax', flatLimit: 200 },
  }
}

/** 決定的な「JEV 役」: BACK 以外の最初の候補を選ぶ */
const firstChoice: Evaluator = async (_state, questions) => ({
  answers: Object.fromEntries(
    Object.entries(questions).map(([k, q]) => {
      const key = Object.keys(q.criteria as Record<string, string>).find((x) => x !== 'BACK')!
      return [k, { type: 'choice' as const, choice: key, probabilities: { [key]: 1 } }]
    }),
  ),
  source: 'jev',
})

const failingJev: Evaluator = async () => {
  throw new JevError('JEV 503: Service temporarily unavailable', 503, true)
}

const routes = (s: RaceSnapshot) => s.runners.map((r) => r.route.map((x) => `${x.kind}:${x.title}`).join(' '))
const sources = (s: RaceSnapshot) => new Set(s.turns.flatMap((t) => t.moves.map((m) => m.source)))

describe('ヘッドレス実行（エンジン単独）', () => {
  it('ダミー判断役で最後まで進み、全員 GOAL か DNF になる', async () => {
    const s = await runHeadless(config(), fakeWiki, mockEvaluator())
    expect(s.finished).toBe(true)
    expect(s.runners.every((r) => r.status === 'goal' || r.status === 'dnf')).toBe(true)
    expect(s.turn).toBeLessThanOrEqual(10)
    expect([...sources(s)]).toEqual(['mock'])
  })

  it('決定的な判断なら広域記事(Pref)では GOAL せず、G で GOAL する', async () => {
    const s = await runHeadless(config(), fakeWiki, firstChoice)
    const r1 = s.runners.find((r) => r.runnerId === 'r1')!
    // S1 → A → (Dead は行き止まり) … という経路でも最終的に G に到達するか DNF
    expect(r1.route.some((x) => x.title === 'Pref' && x.tooLarge) || r1.route.every((x) => x.title !== 'Pref')).toBe(true)
    expect(s.runners.filter((r) => r.status === 'goal').every((r) => r.current === 'G')).toBe(true)
  })

  it('JEV が失敗したら 録画 → ダミー の順に代替し、判断元を記録する', async () => {
    const store = memoryStore()
    const s = await runHeadless(config(), fakeWiki, withFallback(failingJev, replayEvaluator(store), mockEvaluator()))
    expect(s.finished).toBe(true)
    expect([...sources(s)]).toEqual(['mock'])
  })

  it('録画した回答を再生すると同じレースが再現される', async () => {
    const store = memoryStore()
    const live = await runHeadless(config(), fakeWiki, recording(firstChoice, store))
    expect(store.size()).toBeGreaterThan(0)
    const replay = await runHeadless(config(), fakeWiki, replayEvaluator(store))
    expect(routes(replay)).toEqual(routes(live))
    expect([...sources(replay)]).toEqual(['replay'])
  })

  it('JEV も録画も無く代替も無ければ、回復不能エラーで止まる', async () => {
    await expect(runHeadless(config(), fakeWiki, failingJev, { autoRetries: 1 })).rejects.toThrow(/503/)
  })
})
