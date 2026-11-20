// Built assets and workers under a subpath and under the cross-origin
// isolation headers: the release-style build (--base ./) at /sub/ with and
// without COOP/COEP, and the default build from vite preview at the root.
import { test } from '@playwright/test'
import {
  DATA,
  link,
  openLayerSection,
  routeExamples,
  trackRequests,
  trackWorkers,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

const BASES = [
  ['release build at /sub/ with COOP/COEP', 'http://127.0.0.1:4275/sub/'],
  ['release build at /sub/ without isolation headers', 'http://127.0.0.1:4276/sub/'],
  ['default build at / (vite preview, COOP/COEP)', 'http://127.0.0.1:4273/'],
]
const DATASETS = [
  ['h5ad range reads', 'profile.h5ad'],
  ['ome-tiff', 'two-channel.ome.tif'],
  ['spatialdata image zarr', 'image_cells.zarr'],
  ['merscope folder', 'merscope-smoke/'],
  ['icechunk', 'anndata.icechunk'],
]

test('assets and workers load under each serving setup', async ({ browser }) => {
  test.setTimeout(600_000)
  const results = []
  for (const [setup, base] of BASES) {
    for (const [name, path] of DATASETS) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      await routeExamples(context)
      const page = await context.newPage()
      const errors = []
      page.on(
        'console',
        (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)),
      )
      page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)))
      const workers = trackWorkers(page)
      const workerUrls = new Set()
      page.on('worker', (w) =>
        workerUrls.add(new URL(w.url()).pathname.replace(/-[\w-]{8}\.js$/, '')),
      )
      const origin = new URL(base).origin
      const app = trackRequests(context, (url) => url.startsWith(origin))
      const data = trackRequests(context, (url) => url.startsWith(DATA))
      await page.goto(link(base, DATA + path))
      await page.waitForTimeout(1500)
      await waitQuiet(page, data, { quietMs: 2500, maxMs: 90_000 })
      if (path.endsWith('.tif')) {
        await openLayerSection(page, /^Image/)
        await waitQuiet(page, data, { quietMs: 1500, maxMs: 30_000 })
      }
      const isolated = await page.evaluate(() => self.crossOriginIsolated)
      const status = (await page.locator('header').first().innerText({ timeout: 5000 }))
        .replace(/\s+/g, ' ')
        .slice(0, 160)
      const appFailures = app.entries
        .filter((e) => e.failure !== null || (e.status !== null && e.status >= 400))
        .map((e) => `${e.url.slice(origin.length)} ${e.status ?? e.failure}`)
      const result = {
        setup,
        dataset: name,
        isolated,
        header: status,
        workers: workers.created,
        workerPaths: [...workerUrls],
        appRequests: app.entries.length,
        appFailures,
        dataRequests: data.entries.length,
        consoleErrors: errors,
      }
      results.push(result)
      console.log(JSON.stringify(result))
      if (setup.startsWith('release build at /sub/ with')) {
        await page.screenshot({
          path: new URL(
            `./out/serving-sub-${path.replace(/[/.]+/g, '-')}.png`,
            import.meta.url,
          ).pathname,
        })
      }
      await context.close()
    }
  }
  writeOut('serving.json', results)
})
