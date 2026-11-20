// IO-02: tile decode workers and memory over 30 contrast edits on a
// 2-channel 4096 x 4096 OME-TIFF, then 5 typed edits, then a dataset switch.
import { test, expect } from '@playwright/test'
import {
  DATA,
  aliveByName,
  link,
  memory,
  openDatasetUrl,
  openLayerSection,
  routeExamples,
  trackRequests,
  trackWorkers,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

test('decode workers and memory over contrast edits', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(context)
  const page = await context.newPage()
  const workers = trackWorkers(page)
  const requests = trackRequests(context, (url) => url.startsWith(DATA))
  const rows = []
  const snapshot = async (step) => {
    const settledMs = await waitQuiet(page, requests)
    await page.waitForTimeout(500)
    const row = {
      step,
      settledMs,
      created: Object.values(workers.created).reduce((a, b) => a + b, 0),
      alive: workers.alive.size,
      aliveByName: aliveByName(workers),
      requests: requests.entries.length,
      ...(await memory(browser, page)),
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }

  await page.goto(link('/', `${DATA}two-channel.ome.tif`))
  const image = await openLayerSection(page, /^Image/)
  const max = image.getByLabel('rings maximum')
  await expect(max).toBeVisible({ timeout: 120_000 })
  await snapshot('loaded')

  for (let edit = 1; edit <= 30; edit += 1) {
    await max.fill(String(20_000 + edit * 500))
    if (edit % 5 === 0 || edit <= 2) await snapshot(`fill edit ${edit}`)
  }
  await page.screenshot({
    path: new URL('./out/io02-after-30-edits.png', import.meta.url).pathname,
  })

  for (let edit = 1; edit <= 5; edit += 1) {
    await max.selectText()
    await max.pressSequentially(String(40_000 + edit * 1000), { delay: 80 })
    await snapshot(`typed edit ${edit}`)
  }

  await openDatasetUrl(page, `${DATA}h5ad-smoke.h5ad`)
  await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
  await snapshot('after switch to h5ad-smoke')

  writeOut('io02-workers.json', {
    created: workers.created,
    closed: workers.closed,
    rows,
  })
  await context.close()
})
