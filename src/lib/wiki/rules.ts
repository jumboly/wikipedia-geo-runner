/**
 * 合法手判定のルール。Worker 側のリンク抽出と、Human Reader 側の表示除外の両方で
 * 同じ定義を使うことで、Human と JEV が同じ合法リンク集合を扱うことを保証する。
 */

/** これらの class を持つ要素配下のリンクは本文リンクとみなさない（ナビ・脚注・メンテナンス枠など） */
export const EXCLUDED_CLASSES = [
  'navbox',
  'vertical-navbox',
  'navbox-inner',
  'authority-control',
  'reflist',
  'references',
  'reference',
  'mw-references-wrap',
  'hatnote',
  'dablink',
  'ambox',
  'metadata',
  'side-box',
  'sistersitebox',
  'noprint',
  'mw-editsection',
  'toc',
  'catlinks',
  'portalbox',
  'navigation-not-searchable',
  'mw-empty-elt',
]

/** 本文ではなく出典・外部参照を列挙するセクション。リンク先が記事でも「本文中のリンク」ではないため除外 */
export const EXCLUDED_SECTION_TITLES = [
  '脚注',
  '注釈',
  '注',
  '出典',
  '参考文献',
  '参考資料',
  '関連文献',
  '外部リンク',
  'references',
  'notes',
  'footnotes',
  'citations',
  'sources',
  'bibliography',
  'further reading',
  'external links',
]

export const LEAD_SECTION = '(冒頭)'

export function isExcludedSection(title: string): boolean {
  return EXCLUDED_SECTION_TITLES.includes(title.trim().toLowerCase())
}

/**
 * href から記事タイトルを得る。/wiki/ 以外（外部・interwiki・ページ内アンカー）は null。
 * namespaces は siteinfo 由来の「本文記事以外」の名前空間名（小文字）集合。
 */
export function titleFromHref(href: string | undefined | null, namespaces: Set<string>): string | null {
  if (!href) return null
  // parse API は相対 /wiki/ で返す。Reader 側で絶対化済みの URL も受け付ける
  const m = href.match(/^(?:https?:\/\/[a-z-]+\.wikipedia\.org)?\/wiki\/([^?#]+)/)
  if (!m) return null
  let title: string
  try {
    title = decodeURIComponent(m[1]).replace(/_/g, ' ')
  } catch {
    return null
  }
  const colon = title.indexOf(':')
  if (colon > 0 && namespaces.has(title.slice(0, colon).trim().toLowerCase())) return null
  return title
}
