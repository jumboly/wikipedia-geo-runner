import type { JevAuth } from '@jumboly/jev-client'
import { BACK_KEY } from '../engine/runnerAgent'

/**
 * AI Gateway API キーの保管。
 * 静的サイトでは秘密を守るサーバーが無いため、キーはユーザー自身のブラウザ（この origin の
 * localStorage）にのみ置く。暗号化しても復号鍵を同じ場所に置くことになり意味が薄いので平文で、
 * 代わりに「保存しない（このタブのみ）」の選択肢と削除 UI を用意する。
 */

const KEY = 'jev-geo-race:ai-gateway-key'

export type KeyStorage = 'local' | 'session'

export function loadApiKey(): { key: string; storage: KeyStorage } | null {
  try {
    const l = localStorage.getItem(KEY)
    if (l) return { key: l, storage: 'local' }
    const s = sessionStorage.getItem(KEY)
    if (s) return { key: s, storage: 'session' }
  } catch {
    /* ストレージ無効環境 */
  }
  return null
}

export function saveApiKey(key: string, storage: KeyStorage) {
  clearApiKey()
  ;(storage === 'local' ? localStorage : sessionStorage).setItem(KEY, key.trim())
}

export function clearApiKey() {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}

/**
 * 認証方式の決定。ユーザーのキーを最優先し、無ければ開発時のみ dev proxy を使う。
 * import.meta.env.DEV は本番ビルドで false に静的置換されるため、proxy 分岐は本番に残らない。
 */
export function resolveAuth(useMock: boolean): JevAuth | null {
  if (useMock) return { mode: 'mock', avoidKeys: [BACK_KEY] }
  const k = loadApiKey()
  if (k) return { mode: 'key', apiKey: k.key }
  // vite.config.ts の /dev-jev プロキシが .env のキーを付与する
  if (import.meta.env.DEV) return { mode: 'proxy', url: new URL('dev-jev/v1/evaluate', new URL(import.meta.env.BASE_URL, location.href)).toString() }
  return null
}
