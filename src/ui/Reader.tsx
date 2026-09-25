import { useMemo, useRef, useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { EXCLUDED_CLASSES, isExcludedSection, titleFromHref } from '../lib/wiki/rules'
import type { Action } from '../engine/types'
import type { HumanPrompt } from '../worker/protocol'

interface Props {
  prompt: HumanPrompt
  lang: string
  runnerName: string
  onMove: (a: Action) => void
}

const EMPTY_NS = new Set<string>()

/**
 * Wikipedia 記事の簡易 Reader。
 * 外部由来の HTML なので DOMPurify でサニタイズし、JEV 側と同じ除外ルールでナビ・脚注等を落とす。
 * クリック可能なのは Worker が算出した「未訪問の合法リンク」だけ。
 */
export function Reader({ prompt, lang, runnerName, onMove }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // スマホで誤タップしても即確定しないよう「選択 → 確定」の2段階にする
  const [selected, setSelected] = useState<Action | null>(null)
  const legal = useMemo(() => new Set(prompt.legal), [prompt.legal])
  const visited = useMemo(() => new Set(prompt.visited), [prompt.visited])

  const html = useMemo(() => {
    const clean = DOMPurify.sanitize(prompt.html, {
      FORBID_TAGS: ['style', 'link', 'meta', 'form', 'input', 'button'],
      RETURN_DOM: true,
    }) as HTMLElement
    clean.querySelectorAll(EXCLUDED_CLASSES.map((c) => `.${CSS.escape(c)}`).join(',')).forEach((e) => e.remove())
    // 除外セクション（脚注・外部リンク等）は見出しから次の h2 見出しまでを落とす
    clean.querySelectorAll('.mw-heading2, h2').forEach((h) => {
      const head = h.matches('h2') ? h : h.querySelector('h2')
      if (!head || !isExcludedSection(head.textContent ?? '')) return
      const block = h.matches('h2') && h.parentElement?.classList.contains('mw-heading') ? h.parentElement : h
      let n = block.nextElementSibling
      while (n && !n.matches('.mw-heading2, h2')) {
        const next = n.nextElementSibling
        n.remove()
        n = next
      }
      block.remove()
    })
    clean.querySelectorAll('img').forEach((img) => {
      // parse API はプロトコル相対 URL を返す
      for (const attr of ['src', 'srcset']) {
        const v = img.getAttribute(attr)
        if (v) img.setAttribute(attr, v.replace(/(^|\s|,)\/\//g, '$1https://'))
      }
      img.setAttribute('loading', 'lazy')
    })
    clean.querySelectorAll('a').forEach((a) => {
      const t = titleFromHref(a.getAttribute('href'), EMPTY_NS)
      const canonical = t ? (prompt.redirects[t] ?? t) : null
      a.removeAttribute('target')
      if (canonical && legal.has(canonical) && !a.classList.contains('new')) {
        a.setAttribute('data-move', canonical)
        a.className = 'wl legal'
      } else {
        a.className = canonical && visited.has(canonical) ? 'wl visited' : 'wl dead'
        a.removeAttribute('href')
      }
    })
    return clean.innerHTML
  }, [prompt, legal, visited])

  useEffect(() => {
    ref.current?.scrollTo(0, 0)
    setSelected(null)
  }, [prompt.title, prompt.turn])

  useEffect(() => {
    ref.current?.querySelectorAll('a.selected').forEach((a) => a.classList.remove('selected'))
    if (selected?.type === 'link')
      ref.current?.querySelectorAll(`a[data-move="${CSS.escape(selected.title)}"]`).forEach((a) => a.classList.add('selected'))
  }, [selected, html])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const t = a.getAttribute('data-move')
    if (t) setSelected({ type: 'link', title: t })
  }

  return (
    <div className="reader">
      <div className="reader-head">
        <div>
          <strong>{runnerName}</strong> のターン {prompt.turn} ・ 現在: <strong>{prompt.title}</strong>
          <span className="muted"> ・ 選択可能リンク {prompt.legal.length}件</span>
        </div>
        <div className="row">
          <a className="muted small" href={`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(prompt.title)}`} target="_blank" rel="noreferrer">
            Wikipedia
          </a>
          <button disabled={!prompt.canBack} onClick={() => setSelected({ type: 'back' })}>
            ↩ BACK（残り{prompt.backsLeft}）
          </button>
        </div>
      </div>
      <h1 className="reader-title">{prompt.title}</h1>
      <div ref={ref} className="reader-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {selected && (
        <div className="confirm-bar">
          <span>
            {selected.type === 'back' ? `↩ BACK:「${prompt.prevTitle}」へ戻る` : `→「${selected.title}」へ進む`}
          </span>
          <button onClick={() => setSelected(null)}>取消</button>
          <button className="primary" onClick={() => onMove(selected)}>
            決定
          </button>
        </div>
      )}
    </div>
  )
}
