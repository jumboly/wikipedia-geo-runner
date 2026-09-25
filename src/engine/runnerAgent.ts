import type { Answer, EvaluateOptions } from '@jumboly/jev-client'
import type { AnswerSource, Evaluator } from '@jumboly/jev-client'
import type { WikiSection } from '../lib/wiki/api'
import type { Action, Goal, RaceEntry, RaceSettings, RunnerState } from './types'

/**
 * Runner JEV の 1 ターン分の判断。
 * コードは候補を「文書順のまま」全件渡すだけで、関連度による並べ替え・絞り込みはしない。
 * 候補が多すぎる場合のみ Wikipedia のセクション構造で階層 Choice にする。
 */

export interface TurnContext {
  entry: RaceEntry
  runner: RunnerState
  goal: Goal
  settings: RaceSettings
  turn: number
  sections: WikiSection[]
  hint: string | null
}

export interface Decision {
  action: Action
  probs: Record<string, number>
  /** 誰が判断したか。JEV 以外（録画・ダミー）の手は結果で区別できるようにする */
  source: AnswerSource | 'human'
}

// 階層 Choice で複数回答えた場合、1つでも JEV 以外が混ざればそちらを採る
const worst = (a: AnswerSource, b: AnswerSource | 'human'): AnswerSource | 'human' => (a === 'jev' ? b : a === 'mock' || b === 'mock' ? 'mock' : a)

// JEV の choice は最大 255 候補
const MAX_OPTIONS = 255
/** JEV の choice で BACK を表すキー。ダミー判断役に避けさせる時にも使う */
export const BACK_KEY = 'BACK'
const BACK = BACK_KEY

export function buildState(c: TurnContext) {
  const route = c.runner.route.slice(-12).map((s) => (s.kind === 'move' || s.kind === 'start' ? s.title : `${s.title}（${s.kind === 'back' ? 'BACKで戻った' : '行き止まりで戻った'}）`))
  return {
    game:
      'JEV Geo Race: Wikipedia の記事本文中のリンクを1ターンに1つずつたどり、ゴール地域の中にある場所・施設・地名などの記事へ到達する競争。訪問済みの記事には再訪できない。座標情報は与えられないので、記事同士の意味的なつながりを頼りに進む。',
    you: { name: c.entry.name, personality: c.entry.personality || '特になし' },
    goal: {
      name: c.goal.name,
      radius: formatKm(c.goal.radiusM),
      rule: `「${c.goal.name}」の中心から半径${formatKm(c.goal.radiusM)}以内に位置する場所の Wikipedia 記事に入ればゴール。`,
    },
    turn: `${c.turn} / ${c.settings.maxTurns}`,
    backsRemaining: c.runner.backsLeft,
    currentArticle: c.runner.current,
    recentRoute: route,
    hint: c.hint,
    experience: c.entry.memory.length ? c.entry.memory : undefined,
  }
}

function formatKm(m: number) {
  return m >= 1000 ? `${+(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

function backOption(c: TurnContext): Record<string, string> {
  const prev = c.runner.stack[c.runner.stack.length - 2]
  return { [BACK]: `BACK: 直前の記事「${prev}」に戻る（1ターン消費、残り${c.runner.backsLeft}回）` }
}

function pick(ans: Answer | undefined, mode: RaceSettings['choiceMode'], valid: string[]): string {
  const probs = ans?.probabilities ?? {}
  if (mode === 'sample' && Object.keys(probs).length) {
    let r = Math.random() * Object.values(probs).reduce((a, b) => a + b, 0)
    for (const [k, p] of Object.entries(probs)) if ((r -= p) <= 0 && valid.includes(k)) return k
  }
  if (ans?.choice && valid.includes(ans.choice)) return ans.choice
  // choice が不正な場合でも JEV 自身の確率分布の最大値を採用し、コード側の判断を混ぜない
  const best = Object.entries(probs)
    .filter(([k]) => valid.includes(k))
    .sort((a, b) => b[1] - a[1])[0]
  if (best) return best[0]
  throw new Error('JEV の回答に有効な選択肢がありません')
}

function topProbs(ans: Answer | undefined, label: (k: string) => string): Record<string, number> {
  return Object.fromEntries(
    Object.entries(ans?.probabilities ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, p]) => [label(k), p]),
  )
}

export async function decide(evaluator: Evaluator, c: TurnContext, canBack: boolean, opts: EvaluateOptions): Promise<Decision> {
  const visited = new Set(c.runner.visited)
  const sections = c.sections
    .map((s) => ({ title: s.title, links: s.links.filter((t) => !visited.has(t)) }))
    .filter((s) => s.links.length)
  const all = sections.flatMap((s) => s.links)
  const state = buildState(c)
  const backOpt = canBack ? backOption(c) : {}

  const chooseLinks = async (links: string[], note: string, withBack: boolean): Promise<Decision> => {
    const criteria: Record<string, string> = {}
    links.forEach((t, i) => (criteria[`L${i + 1}`] = t))
    if (withBack) Object.assign(criteria, backOpt)
    const { answers: ans, source } = await evaluator(
      state,
      {
        move: {
          type: 'choice',
          instructions: `あなたは ${c.entry.name}。性格(personality)に従い、ゴール「${c.goal.name}」を目指して現在の記事「${c.runner.current}」から次に進むリンクを1つ選んでください。${note}`,
          criteria,
        },
      },
      opts,
    )
    const key = pick(ans.move, c.settings.choiceMode, Object.keys(criteria))
    const label = (k: string) => criteria[k]?.startsWith('BACK') ? BACK : (criteria[k] ?? k)
    return {
      action: key === BACK ? { type: 'back' } : { type: 'link', title: criteria[key] },
      probs: topProbs(ans.move, label),
      source,
    }
  }

  if (all.length + 1 <= c.settings.flatLimit) return chooseLinks(all, '', true)

  // 階層 Choice: 255 を超えるセクションは文書順で分割する
  const groups: { title: string; links: string[] }[] = []
  for (const s of sections) {
    const size = MAX_OPTIONS - 1
    const n = Math.ceil(s.links.length / size)
    for (let i = 0; i < n; i++)
      groups.push({ title: n > 1 ? `${s.title} (${i + 1}/${n})` : s.title, links: s.links.slice(i * size, (i + 1) * size) })
  }
  const criteria: Record<string, string> = {}
  groups.slice(0, MAX_OPTIONS - 1).forEach((g, i) => {
    // リンク一覧は文書順の先頭から文字数予算まで。関連度で選んだ「代表例」ではない
    let preview = ''
    for (const t of g.links) {
      if (preview.length + t.length > 300) break
      preview += (preview ? '、' : '') + t
    }
    const more = preview.split('、').length < g.links.length ? ' ほか' : ''
    criteria[`S${i + 1}`] = `セクション「${g.title}」（リンク${g.links.length}件）: ${preview}${more}`
  })
  Object.assign(criteria, backOpt)
  const { answers: ans, source: sectionSource } = await evaluator(
    state,
    {
      section: {
        type: 'choice',
        instructions: `あなたは ${c.entry.name}。現在の記事「${c.runner.current}」はリンクが多いため、まず次に進むリンクを探すセクションを1つ選んでください。性格(personality)に従い、ゴール「${c.goal.name}」への道筋を考えること。`,
        criteria,
      },
    },
    opts,
  )
  const key = pick(ans.section, c.settings.choiceMode, Object.keys(criteria))
  if (key === BACK) return { action: { type: 'back' }, probs: { BACK: ans.section.probabilities?.[BACK] ?? 1 }, source: sectionSource }
  const g = groups[Number(key.slice(1)) - 1]
  // セクション選択後は BACK を候補に含めない（BACK 判断は第1段で済んでいるため）
  const d = await chooseLinks(g.links, `（セクション「${g.title}」内のリンクから選択）`, false)
  return { ...d, source: worst(sectionSource, d.source) }
}
