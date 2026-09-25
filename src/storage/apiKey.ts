import type { JevAuth, JevProvider } from '@jumboly/jev-client'
import { BACK_KEY } from '../engine/runnerAgent'

/**
 * AI Gateway API キーの保管。
 * 静的サイトでは秘密を守るサーバーが無いため、キーはユーザー自身のブラウザ（この origin の
 * localStorage）にのみ置く。暗号化しても復号鍵を同じ場所に置くことになり意味が薄いので平文で、
 * 代わりに「保存しない（このタブのみ）」の選択肢と削除 UI を用意する。
 * TypeSafe 直接は開発時の dev proxy（.env のキー）専用なので、ブラウザには保存しない。
 */

const KEY = 'jev-geo-race:ai-gateway-key'

export type KeyStorage = 'local' | 'session'

export const ROUTE_LABEL: Record<JevProvider, string> = {
  gateway: 'Vercel AI Gateway 経由',
  typesafe: 'TypeSafe 直接（開発時のみ）',
}

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

// vite.config.ts の jevDevProxy が .env のキーを付与する
const devProxyUrl = (route: JevProvider) => new URL(`dev-jev/${route}`, new URL(import.meta.env.BASE_URL, location.href)).toString()

export type AuthResult = { ok: true; auth: JevAuth } | { ok: false; reason: string }

/**
 * 認証方式の決定。
 *  - 本番: AI Gateway のみ。CORS 許可済みなのでユーザーのキーで直接呼ぶ
 *  - 開発: 経路を選べる。gateway はユーザーのキーを優先し、無ければ dev proxy。
 *    typesafe は CORS 不可なので常に dev proxy（.env の TYPESAFE_API_KEY）を通す
 * import.meta.env.DEV は本番ビルドで false に静的置換されるため、dev proxy 分岐と typesafe 経路は本番に残らない。
 */
export function resolveAuth(route: JevProvider, useMock: boolean): AuthResult {
  if (useMock) return { ok: true, auth: { mode: 'mock', avoidKeys: [BACK_KEY] } }
  if (import.meta.env.DEV && route === 'typesafe') return { ok: true, auth: { mode: 'typesafe', url: devProxyUrl('typesafe') } }
  const k = loadApiKey()
  if (k) return { ok: true, auth: { mode: 'gateway', apiKey: k.key } }
  if (import.meta.env.DEV) return { ok: true, auth: { mode: 'gateway', url: devProxyUrl('gateway') } }
  return { ok: false, reason: 'JEV を使うには 設定 で Vercel AI Gateway API キーを入力してください（またはモック JEV を有効化）。' }
}
