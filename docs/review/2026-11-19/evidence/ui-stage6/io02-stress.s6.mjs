// IO-02 stress: typed contrast edits (each keystroke is a new value) until
// 60 edits, the tab crashes, or 4 minutes pass. Snapshot every 10 edits.
import { test, expect } from '@playwright/test'
import {
  DATA,
  link,
  memory,
  openLayerSection,
  routeExamples,
  trackRequests,
  trackWorkers,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

test('typed contrast edits until failure or 60 edits', async ({ browser }) => {
  test.setTimeout(300_000)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(context)
  const page = await context.newPage()
  let crashed = null
  page.on('crash', () => (crashed = new Date().toISOString()))
  const workers = trackWorkers(page)
  const requests = trackRequests(context, (url) => url.startsWith(DATA))
  const rows = []
  const started = Date.now()

  await page.goto(link('/', `${DATA}two-channel.ome.tif`))
  const image = await openLayerSection(page, /^Image/)
  const max = image.getByLabel('rings maximum')
  await expect(max).toBeVisible({ timeout: 120_000 })

  for (
    let edit = 1;
    edit <= 60 && crashed === null && Date.now() - started < 240_000;
    edit += 1
  ) {
    try {
      await max.selectText({ timeout: 20_000 })
      await max.pressSequentially(String(30_000 + edit * 100), {
        delay: 60,
        timeout: 20_000,
      })
    } catch (error) {
      rows.push({ edit, error: String(error).slice(0, 200) })
      break
    }
    if (edit % 10 === 0) {
      const settledMs = await waitQuiet(page, requests)
      const t0 = Date.now()
      const responsive = await page
        .evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => resolve(true))),
        )
        .catch(() => false)
      const row = {
        edit,
        elapsedS: Math.round((Date.now() - started) / 1000),
        settledMs,
        frameMs: Date.now() - t0,
        responsive,
        created: Object.values(workers.created).reduce((a, b) => a + b, 0),
        alive: workers.alive.size,
        ...(await memory(browser, page).catch((error) => ({
          memoryError: String(error),
        }))),
      }
      rows.push(row)
      console.log(JSON.stringify(row))
    }
  }
  const result = { crashed, rows, closed: workers.closed }
  console.log(JSON.stringify({ crashed }))
  writeOut('io02-stress.json', result)
  if (crashed === null) {
    await page.screenshot({
      path: new URL('./out/io02-stress-end.png', import.meta.url).pathname,
    })
  }
  await context.close()
})
