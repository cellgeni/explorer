// IMG review: dedicated worker count while editing a channel's contrast, in
// a production build (headless Chromium).
//
//   npx vite build --outDir <scratch>/dist-img
//   npx vite preview --outDir <scratch>/dist-img --port 4461 --strictPort
//   node scripts/range-server.mjs <scratch>/img --port 4462   # big.ome.tif
//   node docs/review/2026-11-19/evidence/repro/imaging/workerCount.browser.mjs
//
// big.ome.tif: fixtures/imaging/make_worker_count_fixture.py (2 channels,
// 2048 x 2048 uint16, 256 px deflate tiles, 3 levels).
import { chromium } from '@playwright/test'

const APP = process.env.APP ?? 'http://localhost:4461/'
const IMAGE = process.env.IMAGE ?? 'http://localhost:4462/big.ome.tif'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const workerUrls = () =>
  page.workers().map((w) => new URL(w.url()).pathname.split('/').pop())
const tally = () => {
  const counts = {}
  for (const name of workerUrls()) {
    const key = name.replace(/-[\w-]{8}\.js$/, '')
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

await page.goto(`${APP}#dataset=${encodeURIComponent(IMAGE)}`)
await page.getByLabel('Alpha maximum').waitFor({ timeout: 60_000 })
await page.waitForTimeout(4000)
console.log('loaded', page.workers().length, JSON.stringify(tally()))

const max = page.getByLabel('Alpha maximum')
for (let step = 1; step <= 8; step += 1) {
  await max.fill(String(3000 + step * 50))
  await page.waitForTimeout(1500)
  console.log(`contrast edit ${step}`, page.workers().length, JSON.stringify(tally()))
}

await browser.close()
