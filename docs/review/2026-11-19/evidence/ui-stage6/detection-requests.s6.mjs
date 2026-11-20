// Cold-load request counts: every request to the fixture server from a fresh
// browser context (empty HTTP cache, empty IndexedDB) until the network is
// quiet, with repeats of the same method, URL and range listed.
import { test } from '@playwright/test'
import {
  DATA,
  link,
  routeExamples,
  trackRequests,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

const CASES = [
  ['h5ad-medium (whole file)', 'medium.h5ad'],
  ['h5ad-profile (range reads, 95 MB)', 'profile.h5ad'],
  ['icechunk anndata', 'anndata.icechunk'],
  ['visium space ranger folder', 'visium-smoke/'],
  ['merscope folder', 'merscope-smoke/'],
  ['spatialdata image store', 'image_cells.zarr'],
  ['ome-tiff two channels', 'two-channel.ome.tif'],
]

test('cold load request counts', async ({ browser }) => {
  test.setTimeout(600_000)
  const results = []
  for (const [name, path] of CASES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await routeExamples(context)
    const page = await context.newPage()
    const requests = trackRequests(context, (url) => url.startsWith(DATA))
    const started = Date.now()
    await page.goto(link('/', DATA + path))
    await page.waitForTimeout(1500)
    const settledMs = await waitQuiet(page, requests, { quietMs: 3000, maxMs: 120_000 })
    const counts = new Map()
    for (const entry of requests.entries) {
      const key =
        `${entry.method} ${entry.url.slice(DATA.length)} ${entry.range ?? ''}`.trim()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const repeats = [...counts].filter(([, n]) => n > 1).map(([key, n]) => `${n}x ${key}`)
    const result = {
      name,
      settledMs,
      elapsedMs: Date.now() - started,
      requests: requests.entries.length,
      distinct: counts.size,
      status404: requests.entries.filter((e) => e.status === 404).length,
      bytes: requests.entries.reduce((sum, e) => sum + e.bytes, 0),
      repeats,
      list: requests.entries.map(
        (e) =>
          `${e.method} ${e.url.slice(DATA.length)} ${e.range ?? ''} -> ${e.status ?? e.failure}`,
      ),
    }
    results.push(result)
    console.log(
      JSON.stringify({
        ...result,
        list: undefined,
        repeats: result.repeats.slice(0, 12),
      }),
    )
    await context.close()
  }
  writeOut('detection-requests.json', results)
})
