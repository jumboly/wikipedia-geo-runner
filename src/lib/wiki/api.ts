import type { GeoPoint, LatLon } from '../geo/geo'
import { Limiter, sleep } from '../limiter'
import { extractLinks, type RawSection } from './extractLinks'

/**
 * MediaWiki Action API クライアント。Worker / メインスレッドのどちらからでも使える
 * (fetch のみ依存)。Wikimedia の API 利用規約に従い、同時接続を絞り、
 * ブラウザでは User-Agent を変えられないため Api-User-Agent ヘッダで識別情報を送る。
 */

const API_USER_AGENT = 'JEVGeoRace/0.1 (https://github.com/; browser game)'
const limiter = new Limiter(4)

export interface WikiSection {
  title: string
  /** 正規化（リダイレクト解決）済みの記事タイトル。文書順 */
  links: string[]
}

export interface WikiArticle {
  title: string
  pageid: number
  sections: WikiSection[]
  /** 主座標（地球上のもののみ）。無ければ null */
  coord: GeoPoint | null
  /** Reader 表示用の生 HTML。表示前に必ずサニタイズすること */
  html: string
  /** リンク表記タイトル → 正規タイトル。Reader のリンク照合に使う */
  redirects: Record<string, string>
  disambiguation: boolean
}

export class WikiClient {
  private namespaces: Promise<Set<string>> | null = null
  private articleCache = new Map<string, Promise<WikiArticle>>()
  private coordCache = new Map<string, GeoPoint | null>()

  constructor(readonly lang: string) {}

  private get base() {
    return `https://${this.lang}.wikipedia.org/w/api.php`
  }

  async call(params: Record<string, string | number>): Promise<any> {
    const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', maxlag: '5' })
    for (const [k, v] of Object.entries(params)) q.set(k, String(v))
    const url = `${this.base}?${q}`
    return limiter.run(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { headers: { 'Api-User-Agent': API_USER_AGENT } })
        const retryAfter = Number(res.headers.get('retry-after'))
        if (res.ok) {
          const json = await res.json()
          // maxlag 超過は 200 で error.code=maxlag が返る
          if (json.error?.code === 'maxlag' && attempt < 5) {
            await sleep((retryAfter || 2) * 1000)
            continue
          }
          if (json.error) throw new Error(`MediaWiki: ${json.error.code} ${json.error.info}`)
          return json
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          await sleep(retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt)
          continue
        }
        throw new Error(`MediaWiki HTTP ${res.status}`)
      }
    })
  }

  /** 本文記事以外の名前空間名（エイリアス含む・小文字） */
  getNamespaces(): Promise<Set<string>> {
    this.namespaces ??= this.call({ action: 'query', meta: 'siteinfo', siprop: 'namespaces|namespacealiases' }).then(
      (j) => {
        const s = new Set<string>()
        for (const ns of Object.values<any>(j.query.namespaces)) {
          if (ns.id === 0) continue
          for (const n of [ns.name, ns.canonicalname]) if (n) s.add(n.toLowerCase())
        }
        for (const a of j.query.namespacealiases) if (a.id !== 0) s.add(a.alias.toLowerCase())
        return s
      },
    )
    return this.namespaces
  }

  /** 記事の取得・合法リンク抽出。複数 Runner が同じ記事を踏むことが多いためキャッシュする */
  getArticle(title: string): Promise<WikiArticle> {
    let p = this.articleCache.get(title)
    if (!p) {
      p = this.fetchArticle(title)
      p.catch(() => this.articleCache.delete(title))
      this.articleCache.set(title, p)
    }
    return p
  }

  private async fetchArticle(title: string): Promise<WikiArticle> {
    const [ns, parsed] = await Promise.all([
      this.getNamespaces(),
      this.call({
        action: 'parse',
        page: title,
        prop: 'text|properties',
        redirects: 1,
        disableeditsection: 1,
        disabletoc: 1,
        disablelimitreport: 1,
      }),
    ])
    const p = parsed.parse
    const raw: RawSection[] = extractLinks(p.text, ns)
    const redirectTitles = raw.flatMap((s) => s.links.filter((l) => l.redirect).map((l) => l.title))
    const [redirects, coord] = await Promise.all([this.resolveTitles(redirectTitles), this.getCoord(p.title)])
    const seen = new Set<string>([p.title])
    const sections: WikiSection[] = []
    for (const s of raw) {
      const links: string[] = []
      for (const l of s.links) {
        const t = redirects[l.title] ?? l.title
        // 解決先が本文記事でない/存在しないものは除外、自己リンクと重複も除外
        if (t === '' || seen.has(t)) continue
        seen.add(t)
        links.push(t)
      }
      if (links.length) sections.push({ title: s.title, links })
    }
    // formatversion=2 ではオブジェクト、旧形式では {name,value} 配列で返る
    const props: Record<string, string> = Array.isArray(p.properties)
      ? Object.fromEntries(p.properties.map((x: any) => [x.name, x.value]))
      : (p.properties ?? {})
    return {
      title: p.title,
      pageid: p.pageid,
      sections,
      coord,
      html: p.text,
      redirects,
      disambiguation: 'disambiguation' in props,
    }
  }

  /**
   * リダイレクトを正規タイトルに解決する。本文記事(ns0)でない・存在しない場合は ''。
   * 1 リクエスト 50 タイトル上限（非 bot）に合わせて分割する。
   */
  async resolveTitles(titles: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    const chunks: string[][] = []
    for (let i = 0; i < titles.length; i += 50) chunks.push(titles.slice(i, i + 50))
    await Promise.all(
      chunks.map(async (chunk) => {
        const j = await this.call({
          action: 'query',
          titles: chunk.join('|'),
          redirects: 1,
          prop: 'coordinates',
          coprimary: 'primary',
          // 既定の colimit=10 だと 50 タイトル中 10 件分しか座標が返らず「座標なし」と誤認する
          colimit: 'max',
          coprop: 'dim',
        })
        // 座標が continue で分割された場合は不完全なのでキャッシュしない（getCoord で個別取得させる）
        const complete = !j.continue
        const norm = new Map<string, string>()
        for (const n of j.query.normalized ?? []) norm.set(n.from, n.to)
        const redir = new Map<string, string>()
        for (const r of j.query.redirects ?? []) redir.set(r.from, r.to)
        const pages = new Map<string, any>()
        for (const pg of j.query.pages ?? []) {
          pages.set(pg.title, pg)
          if (complete) this.coordCache.set(pg.title, earthCoord(pg))
        }
        for (const t of chunk) {
          let cur = norm.get(t) ?? t
          cur = redir.get(cur) ?? cur
          const pg = pages.get(cur)
          out[t] = pg && !pg.missing && !pg.invalid && pg.ns === 0 ? cur : ''
        }
      }),
    )
    return out
  }

  async getCoord(title: string): Promise<GeoPoint | null> {
    if (this.coordCache.has(title)) return this.coordCache.get(title)!
    const j = await this.call({ action: 'query', titles: title, prop: 'coordinates', coprimary: 'primary', coprop: 'dim', redirects: 1 })
    const c = earthCoord(j.query.pages?.[0])
    this.coordCache.set(title, c)
    return c
  }

  async geoSearch(center: LatLon, radiusM: number, limit = 50): Promise<{ title: string; lat: number; lon: number; dist: number }[]> {
    const j = await this.call({
      action: 'query',
      list: 'geosearch',
      gscoord: `${center.lat}|${center.lon}`,
      // GeoSearch の半径上限は 10km
      gsradius: Math.min(10000, Math.max(10, Math.round(radiusM))),
      gslimit: limit,
      gsprimary: 'primary',
      gsnamespace: 0,
    })
    return j.query.geosearch
  }

  async searchTitles(query: string, limit = 8): Promise<string[]> {
    const j = await this.call({ action: 'opensearch', search: query, limit, namespace: 0 })
    return j[1] ?? []
  }
}

function earthCoord(page: any): GeoPoint | null {
  const c = page?.coordinates?.find((x: any) => x.primary !== false && (x.globe ?? 'earth') === 'earth')
  if (!c) return null
  const dim = Number(c.dim)
  return dim > 0 ? { lat: c.lat, lon: c.lon, dimM: dim } : { lat: c.lat, lon: c.lon }
}
