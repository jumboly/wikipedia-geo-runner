import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractLinks } from '../src/lib/wiki/extractLinks'

const html: string = JSON.parse(readFileSync(new URL('./fixture-osaka.json', import.meta.url), 'utf8')).parse.text
const ns = new Set(['file', 'ファイル', 'category', 'template', 'help', 'portal', 'wikipedia', 'special', '特別', 'プロジェクト', 'ノート'])

describe('extractLinks (実データ: 大坂城)', () => {
  const sections = extractLinks(html, ns)
  const all = sections.flatMap((s) => s.links.map((l) => l.title))

  it('本文リンクを抽出し重複を除く', () => {
    expect(all.length).toBeGreaterThan(100)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toContain('豊臣秀吉')
  })
  it('名前空間リンクを含まない', () => {
    expect(all.some((t) => /^(ファイル|Category|Template|Help|Portal):/i.test(t))).toBe(false)
  })
  it('脚注・外部リンク系セクションを含まない', () => {
    const titles = sections.map((s) => s.title)
    expect(titles).not.toContain('脚注')
    expect(titles).not.toContain('外部リンク')
    expect(titles[0]).toBe('(冒頭)')
  })
  it('小さい例: navbox/参照/赤リンクを除外', () => {
    const s = extractLinks(
      `<p><a href="/wiki/A" title="A">A</a><a href="/wiki/B" class="mw-redirect">B</a><a href="/wiki/Red" class="new">R</a><sup class="reference"><a href="/wiki/Ref">1</a></sup></p>
       <div class="navbox"><a href="/wiki/Nav">N</a></div>
       <div class="mw-heading mw-heading2"><h2 id="x">歴史</h2></div><p><a href="/wiki/C_D#x">C</a><a href="/wiki/Category:Z">Z</a></p>
       <div class="mw-heading mw-heading2"><h2>脚注</h2></div><p><a href="/wiki/E">E</a></p>`,
      new Set(['category']),
    )
    expect(s).toEqual([
      { title: '(冒頭)', links: [{ title: 'A', redirect: false }, { title: 'B', redirect: true }] },
      { title: '歴史', links: [{ title: 'C D', redirect: false }] },
    ])
  })
})
