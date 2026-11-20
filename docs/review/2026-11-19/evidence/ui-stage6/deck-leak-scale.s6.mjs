// Does an ordinary dataset switch keep the previous Deck, and how does the
// retained heap scale with cells? Alternates medium.h5ad (20,000 cells) and
// h5ad-smoke.h5ad (4 cells) through the Open dataset form on the production
// build, measuring the main-thread heap after garbage collection each time
// the 4-cell dataset is shown. Also records WebGL context warnings.
import { test, expect } from '@playwright/test'
import {
  DATA,
  link,
  openDatasetUrl,
  routeExamples,
  trackRequests,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

async function heapMiB(page) {
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  await session.send('Performance.enable')
  const { metrics } = await session.send('Performance.getMetrics')
  await session.detach()
  return +(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576).toFixed(1)
}

test('heap retained per dataset switch', async ({ browser }) => {
  test.setTimeout(600_000)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(context)
  const page = await context.newPage()
  const warnings = []
  page.on('console', (m) => {
    if (/WebGL|context/i.test(m.text()))
      warnings.push(`${m.type()}: ${m.text().slice(0, 160)}`)
  })
  const requests = trackRequests(context, (url) => url.startsWith(DATA))
  const ready = async (cells) => {
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `${cells} cells` })
        .first(),
    ).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
    await waitQuiet(page, requests, { quietMs: 1000 })
    await page.waitForTimeout(500)
  }
  await page.goto(link('/', `${DATA}h5ad-smoke.h5ad`))
  await ready('4')
  const rows = [{ step: 'smoke first', heapMiB: await heapMiB(page) }]
  // S6_BIG=1 visits profile.h5ad (200,000 cells) three times instead.
  const big = process.env.S6_BIG === '1'
  for (let round = 1; round <= (big ? 3 : 6); round += 1) {
    await openDatasetUrl(page, `${DATA}${big ? 'profile' : 'medium'}.h5ad`)
    await ready(big ? '200,000' : '20,000')
    await openDatasetUrl(page, `${DATA}h5ad-smoke.h5ad`)
    await ready('4')
    const row = {
      step: `smoke after ${big ? 'profile' : 'medium'} visit ${round}`,
      heapMiB: await heapMiB(page),
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
  const result = {
    rows,
    webglWarnings: warnings.slice(0, 20),
    warningCount: warnings.length,
  }
  console.log(
    JSON.stringify({ warningCount: warnings.length, first: warnings.slice(0, 3) }),
  )
  writeOut(`deck-leak-scale${big ? '-200k' : ''}.json`, result)
  await context.close()
})
