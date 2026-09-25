import { Parser } from 'htmlparser2'
import { EXCLUDED_CLASSES, LEAD_SECTION, isExcludedSection, titleFromHref } from './rules'

export interface RawLink {
  title: string
  /** mw-redirect。正規タイトルへの解決が別途必要 */
  redirect: boolean
}

export interface RawSection {
  title: string
  links: RawLink[]
}

const EXCLUDED = new Set(EXCLUDED_CLASSES)
// 自己終了タグは close イベントの対応が取れないため深さ計算から除く
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'col', 'embed', 'track'])

/**
 * parse API の HTML から本文内部リンクをセクション別に抽出する。
 * DOMParser が使えない Worker 内で動かすため、DOM を作らないストリーミングパーサを使う。
 * 並び順は文書順のまま返す（コード側で関連度による並べ替えをしないため）。
 */
export function extractLinks(html: string, namespaces: Set<string>): RawSection[] {
  const sections: RawSection[] = [{ title: LEAD_SECTION, links: [] }]
  const seen = new Set<string>()
  let depth = 0
  // 除外要素に入った深さ。-1 は除外外
  let excludedAt = -1
  let sectionExcluded = false
  let headingDepth = -1
  let headingText = ''

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (VOID.has(name)) return
        depth++
        if (name === 'h2') {
          headingDepth = depth
          headingText = ''
        }
        if (name === 'style' || name === 'script') {
          if (excludedAt < 0) excludedAt = depth
        }
        const cls = attrs.class
        if (excludedAt < 0 && cls && cls.split(/\s+/).some((c) => EXCLUDED.has(c))) excludedAt = depth
        if (name !== 'a' || excludedAt >= 0 || sectionExcluded || headingDepth >= 0) return
        const c = cls ? cls.split(/\s+/) : []
        // 赤リンク(new)は記事が存在しない、extiw は他プロジェクト
        if (c.includes('new') || c.includes('extiw') || c.includes('external')) return
        const title = titleFromHref(attrs.href, namespaces)
        if (!title || seen.has(title)) return
        seen.add(title)
        sections[sections.length - 1].links.push({ title, redirect: c.includes('mw-redirect') })
      },
      ontext(t) {
        if (headingDepth >= 0) headingText += t
      },
      onclosetag(name) {
        if (VOID.has(name)) return
        if (name === 'h2' && headingDepth === depth) {
          headingDepth = -1
          const title = headingText.trim()
          sectionExcluded = isExcludedSection(title)
          sections.push({ title, links: [] })
        }
        if (excludedAt === depth) excludedAt = -1
        depth--
      },
    },
    { decodeEntities: true },
  )
  parser.write(html)
  parser.end()
  return sections.filter((s) => s.links.length > 0)
}
