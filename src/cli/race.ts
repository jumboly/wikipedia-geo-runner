/**
 * エンジン単独でレースを走らせる CLI（開発・テスト用）。
 *
 *   npm run race -- --goal 大阪城 --runners 4
 *   npm run race -- --goal-random japan --jev mock
 *   npm run race -- --goal 大阪城 --starts 姫路城,奈良公園 --jev replay
 *
 * --jev live   : 実 JEV（成功した回答は録画）。失敗時は --fallback の順に代替（既定: replay,mock）
 *                --route gateway|typesafe で経路を選ぶ（既定: gateway。キーは AI_GATEWAY_API_KEY / TYPESAFE_API_KEY）
 * --jev replay : 録画のみ。Wikipedia もキャッシュのみ使用し、同じ条件のレースを完全に再現する
 * --jev mock   : ダミー（ランダム）
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { runHeadless } from '../engine/headless'
import { goalFromArticle, randomGoal, randomStart, REGIONS, validateStart } from '../engine/placement'
import { computeResults } from '../engine/rules'
import type { Goal, RaceConfig, RaceSnapshot } from '../engine/types'
import { defaultGates, type JevProvider } from '@jumboly/jev-client'
import { jevEvaluator, mockEvaluator, recording, replayEvaluator, withFallback, type Evaluator } from '@jumboly/jev-client'
import { WikiClient } from '../lib/wiki/api'
import { DEFAULT_RUNNERS } from '../ui/presets'
import { fileStore } from '@jumboly/jev-client/node'
import { BACK_KEY } from '../engine/runnerAgent'
import { cachingFetch } from './fileCache'

const CACHE = '.cache'
const USER_AGENT = 'JEVGeoRace-CLI/0.1 (https://github.com/jumboly/wikipedia-geo-runner)'

const { values: a } = parseArgs({
  options: {
    goal: { type: 'string' },
    'goal-random': { type: 'string' },
    radius: { type: 'string', default: '2' },
    starts: { type: 'string' },
    'same-start': { type: 'boolean', default: false },
    'start-min': { type: 'string', default: '30' },
    'start-max': { type: 'string', default: '300' },
    runners: { type: 'string', default: '4' },
    'max-turns': { type: 'string', default: '30' },
    backs: { type: 'string', default: '3' },
    lang: { type: 'string', default: 'ja' },
    jev: { type: 'string', default: 'live' },
    // Web 版の既定と揃える。どちらで走ったかは開始時に表示する
    route: { type: 'string', default: 'gateway' },
    fallback: { type: 'string', default: 'replay,mock' },
    'max-attempts': { type: 'string', default: '3' },
    // 共有の待機がこの秒数を超えるなら待たずに代替へ。JEV の 429 は 30〜57 秒の retry-after が多いので既定はそれより長く
    'max-wait': { type: 'string', default: '90' },
    // 1 分あたりの JEV 呼び出し上限。0 = 自動（429 発生時のみ学習して抑え、止めば徐々に解除）
    rate: { type: 'string', default: '0' },
    sample: { type: 'boolean', default: false },
    out: { type: 'string' },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (a.help) {
  console.log(
    `Usage: npm run race -- [--goal <記事名> | --goal-random japan|world] [--starts a,b,..] [--runners N]\n` +
      `  [--jev live|replay|mock] [--route gateway|typesafe] [--fallback replay,mock|none] [--max-attempts N] [--max-turns N] [--radius km] [--out file]`,
  )
  process.exit(0)
}

const log = (...x: unknown[]) => !a.quiet && console.log(...x)

if (a.route !== 'gateway' && a.route !== 'typesafe') throw new Error(`不明な --route: ${a.route}（gateway / typesafe）`)
const route: JevProvider = a.route
const KEY_ENV: Record<JevProvider, string> = { gateway: 'AI_GATEWAY_API_KEY', typesafe: 'TYPESAFE_API_KEY' }

async function main() {
  const replayOnly = a.jev === 'replay'
  const wiki = new WikiClient(a.lang!, { userAgent: USER_AGENT, fetch: cachingFetch(join(CACHE, 'wiki'), replayOnly ? 'read-only' : 'read-write') })
  const store = await fileStore(join(CACHE, 'jev-recordings.json'))
  const radiusM = Number(a.radius) * 1000

  // --- 判断役の組み立て
  let evaluator: Evaluator
  if (a.jev === 'mock') evaluator = mockEvaluator({ avoidKeys: [BACK_KEY] })
  else if (replayOnly) evaluator = replayEvaluator(store)
  else if (a.jev === 'live') {
    try {
      process.loadEnvFile('.env')
    } catch {
      /* .env 無しなら環境変数を使う */
    }
    const key = process.env[KEY_ENV[route]]
    if (!key) throw new Error(`${KEY_ENV[route]} が .env にも環境変数にもありません（--jev mock / replay なら不要）`)
    log(`🔌 JEV 経路: ${route}`)
    // Node からは CORS の制約が無いので、typesafe もプロキシ無しで直接呼べる
    const chain = [recording(jevEvaluator({ mode: route, apiKey: key }), store)]
    for (const f of a.fallback === 'none' ? [] : a.fallback!.split(',')) {
      if (f === 'replay') chain.push(replayEvaluator(store))
      else if (f === 'mock') chain.push(mockEvaluator({ avoidKeys: [BACK_KEY] }))
      else throw new Error(`不明な --fallback: ${f}`)
    }
    evaluator = withFallback(...chain)
  } else throw new Error(`不明な --jev: ${a.jev}`)

  // --- ゴール
  let goal: Goal
  if (a.goal) {
    const art = await wiki.getArticle(a.goal)
    if (!art.coord) throw new Error(`「${art.title}」は座標を持たない記事です`)
    goal = goalFromArticle(art.title, art.coord, radiusM)
  } else {
    const region = REGIONS.find((r) => r.id === (a['goal-random'] ?? 'japan'))
    if (!region) throw new Error(`不明な地域: ${a['goal-random']}（${REGIONS.map((r) => r.id).join(' / ')}）`)
    goal = await randomGoal(wiki, region, radiusM)
  }
  log(`🏁 ゴール: ${goal.name}（半径 ${a.radius}km）`)

  // --- Runner とスタート
  const n = Math.min(Number(a.runners), DEFAULT_RUNNERS.length)
  const presets = DEFAULT_RUNNERS.slice(0, n)
  let starts: string[]
  if (a.starts) {
    const given = a.starts.split(',').map((s) => s.trim())
    starts = await Promise.all(presets.map((_, i) => validateStart(wiki, given[i % given.length], goal)))
  } else {
    const used = new Set<string>()
    starts = []
    for (let i = 0; i < (a['same-start'] ? 1 : n); i++) {
      const t = await randomStart(wiki, goal, Number(a['start-min']), Number(a['start-max']), used)
      used.add(t)
      starts.push(t)
    }
    if (a['same-start']) starts = presets.map(() => starts[0])
  }
  const config: RaceConfig = {
    id: `cli-${Date.now()}`,
    createdAt: Date.now(),
    goal,
    entries: presets.map((p, i) => ({
      runnerId: `r${i + 1}`,
      name: p.name,
      icon: p.icon,
      kind: 'jev',
      personality: p.personality,
      startTitle: starts[i],
      memory: [],
    })),
    settings: {
      lang: a.lang!,
      maxTurns: Number(a['max-turns']),
      backLimit: Number(a.backs),
      choiceMode: a.sample ? 'sample' : 'argmax',
      flatLimit: 200,
    },
  }
  for (const e of config.entries) log(`  ${e.icon} ${e.name}: ${e.startTitle}`)
  // 再現用: 同じゴール・スタートを --jev replay で走らせる
  log(`  （再現: --goal "${goal.anchorTitle ?? ''}" --starts "${starts.join(',')}" --jev replay）`)

  const t0 = Date.now()
  // snapshot はターン公開後と強制 BACK 後の2回届くことがあるため、同じターンは1回だけ表示する
  let lastLogged = 0
  const gate = defaultGates[route]
  gate.configure({ ratePerMin: Number(a.rate) })
  let lastCooldown = 0
  let lastRate = gate.state.ratePerMin
  gate.subscribe((g) => {
    if (g.ratePerMin !== lastRate) {
      log(g.ratePerMin ? `  ⏱ JEV 呼び出し上限を ${g.ratePerMin} 回/分に設定（${g.rateMode === 'auto' ? '429 から推定' : '手動'}）` : '  ⏱ JEV 呼び出し上限を解除')
      lastRate = g.ratePerMin
    }
    if (g.cooldownUntil > lastCooldown && g.cooldownUntil > Date.now()) {
      lastCooldown = g.cooldownUntil
      log(`  ⏳ JEV ${g.lastStatus}: 全 Runner ${Math.ceil((g.cooldownUntil - Date.now()) / 1000)} 秒待機・同時実行 ${g.concurrency}/${g.maxConcurrency}`)
    }
  })
  const hasFallback = a.jev === 'live' && a.fallback !== 'none'
  const snap = await runHeadless(config, wiki, evaluator, {
    maxAttempts: Number(a['max-attempts']),
    maxWaitMs: hasFallback ? Number(a['max-wait']) * 1000 : undefined,
    onEvent: (m) => {
      // 待機は gate の購読でまとめて表示するので、Runner ごとの再試行メッセージは出さない
      // 最終ターンは snapshot ではなく finished で届く
      if ((m.type === 'snapshot' || m.type === 'finished') && m.snapshot.turns.length) {
        const t = m.snapshot.turns[m.snapshot.turns.length - 1]
        if (t.turn !== m.snapshot.turn || t.turn === lastLogged) return
        lastLogged = t.turn
        const moves = t.moves.map((mv) => {
          const e = config.entries.find((x) => x.runnerId === mv.runnerId)!
          const tag = mv.source && mv.source !== 'jev' ? `[${mv.source}]` : ''
          return `${e.icon}${mv.action.type === 'back' ? '↩' : '→'}${mv.to}${tag}${t.goals.includes(mv.runnerId) ? '🏁' : ''}`
        })
        log(`T${t.turn}: ${moves.join('  ')}`)
      }
    },
  })
  report(snap, (Date.now() - t0) / 1000)

  const out = a.out ?? join(CACHE, 'races', `${config.id}.json`)
  await mkdir(join(out, '..'), { recursive: true })
  await writeFile(out, JSON.stringify({ snapshot: snap, results: computeResults(snap) }, null, 2))
  log(`\n保存: ${out}（録画 ${store.size()} 件）`)
}

function report(s: RaceSnapshot, sec: number) {
  const name = (id: string) => {
    const e = s.config.entries.find((x) => x.runnerId === id)!
    return `${e.icon} ${e.name}`
  }
  const bySource: Record<string, number> = {}
  for (const t of s.turns) for (const m of t.moves) bySource[m.source ?? '?'] = (bySource[m.source ?? '?'] ?? 0) + 1
  console.log(`\n=== 結果（${s.turn} ターン, ${sec.toFixed(1)} 秒）===`)
  for (const r of computeResults(s)) {
    const st = s.runners.find((x) => x.runnerId === r.runnerId)!
    const dist = r.distanceM != null ? `（残り約${Math.round(r.distanceM / 1000)}km）` : ''
    console.log(`${r.rank ?? '-'}\t${name(r.runnerId)}\t${r.status.toUpperCase()}${dist}\tT${r.finishTurn ?? '-'}\t${st.route.map((x) => x.title).join(' → ')}`)
  }
  const nonJev = Object.entries(bySource).filter(([k]) => k !== 'jev')
  console.log(`判断元: ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  if (s.jev)
    console.log(`JEV: ${s.jev.calls} 回 / 入力 ${s.jev.inputTokens} トークン / 概算 $${s.jev.costUsd.toPrecision(3)}（${s.jev.provider === 'typesafe' ? 'AI Gateway の公表単価から' : '定価ベース'}）/ 再試行 ${s.jev.retries} 回`)
  if (nonJev.length) console.log('⚠ JEV 以外（録画・ダミー）の手を含むため、正式な JEV のレースではありません')
}

main().catch((e) => {
  console.error('エラー:', e instanceof Error ? e.message : e)
  process.exit(1)
})
