import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Wikipedia API の GET 応答をファイルにキャッシュする fetch。
 * 同じ条件のレースを再現する（録画再生）には記事内容も固定する必要があり、Wikipedia への負荷も減らせる。
 */
export function cachingFetch(dir: string, mode: 'read-write' | 'read-only'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const file = join(dir, createHash('sha256').update(url).digest('hex').slice(0, 32) + '.json')
    try {
      return new Response(await readFile(file, 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } })
    } catch {
      if (mode === 'read-only') return new Response(JSON.stringify({ error: { code: 'cache-miss', info: url } }), { status: 200 })
    }
    const res = await fetch(input, init)
    if (!res.ok) return res
    const text = await res.text()
    // maxlag などのエラー応答はキャッシュしない
    if (!text.includes('"error"')) {
      await mkdir(dir, { recursive: true })
      await writeFile(file, text)
    }
    return new Response(text, { status: res.status, headers: res.headers })
  }) as typeof fetch
}
