import { chromium } from '@playwright/test'
const SHOT = process.env.SHOT
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/')
await page.getByRole('button', { name: '⚙ 設定' }).click()
if (process.env.REAL !== '1') await page.getByText('モック JEV').click()
// ROUTE=typesafe で TypeSafe 直接（dev server の /dev-jev/typesafe 経由）を試す。既定は設定画面の既定（gateway）
if (process.env.ROUTE === 'typesafe') await page.getByLabel('TypeSafe 直接（開発時のみ）').check()
const jevHits = {}
page.on('response', (r) => { const m = r.url().match(/dev-jev\/(\w+)|ai-gateway\.vercel\.sh|api\.typesafe\.ai/); if (m) { const k = (m[1] ?? m[0]) + ' ' + r.status(); jevHits[k] = (jevHits[k] ?? 0) + 1 } })
await page.getByRole('button', { name: '🏁 レース' }).click()
if (process.env.GOAL === 'random') {
  await page.getByRole('button', { name: '🎲 ランダム生成' }).click()
} else {
  await page.getByRole('button', { name: '記事から' }).click()
  await page.getByPlaceholder('座標を持つ記事名').fill(process.env.GOAL ?? '大阪城')
  await page.locator('.suggest li').first().click()
}
await page.locator('strong', { hasText: '周辺' }).waitFor({ timeout: 20000 }).catch(async (e) => { await page.screenshot({ path: SHOT + '/fail.png' }); throw e })
await page.getByRole('button', { name: '🎲 スタート生成' }).click()
await page.locator('ul.small li').nth(3).waitFor({ timeout: 90000 })
console.log('goal:', await page.locator('strong', { hasText: '周辺' }).innerText()); console.log('starts:', await page.locator('ul.small li').allInnerTexts())
await page.screenshot({ path: SHOT + '/setup.png' })
await page.getByRole('button', { name: '🏁 レース開始' }).click()
await page.getByText('ターン 0').waitFor({ timeout: 30000 })
await page.getByRole('button', { name: '⏩ Fast' }).click()
const t0 = Date.now()
// UI が固まっていないか: レース中に requestAnimationFrame の最大間隔を測る
const jank = page.evaluate(() => new Promise((res) => { let last = performance.now(), max = 0; const end = last + 8000; const f = (t) => { max = Math.max(max, t - last); last = t; if (t < end) requestAnimationFrame(f); else res(max) }; requestAnimationFrame(f) }))
await page.screenshot({ path: SHOT + '/race-early.png' })
console.log('max frame gap ms during race:', Math.round(await jank))
// 進行状況を 20 秒ごとに出力し、止まっているのか長いだけなのかを判別できるようにする
const ticker = setInterval(async () => {
  try {
    console.log('[tick]', Math.round((Date.now() - t0) / 1000) + 's', await page.locator('.controls .turn').innerText(), '|', await page.locator('.cost-chip').innerText().catch(() => '-'), '|', await page.locator('.status-line').innerText())
    if (await page.locator('.gate.cooling').count()) await page.screenshot({ path: SHOT + '/gate-cooling.png' })
  } catch {}
}, 20000)
await page.getByRole('heading', { name: 'レース結果' }).waitFor({ timeout: 600000 }).catch(async (e) => {
  await page.screenshot({ path: SHOT + '/race-timeout.png' })
  throw e
})
clearInterval(ticker)
console.log('race finished in', Math.round((Date.now() - t0) / 1000), 's')
console.log(await page.locator('table.results').innerText())
console.log('cost:', await page.locator('p', { hasText: 'JEV 利用' }).innerText().catch(() => '-'))
console.log(await page.locator('.card', { hasText: 'Wikipedia ルート' }).innerText())
await page.screenshot({ path: SHOT + '/result.png' })
console.log('JEV requests:', jevHits)
console.log('errors:', errors.slice(0, 10))
await browser.close()
