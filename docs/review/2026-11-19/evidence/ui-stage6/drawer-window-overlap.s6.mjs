// With the Dataset info drawer open, does a newly opened Cell Query or Plots
// window sit under it? Checked at 1024 and 1280 px.
import { test, expect } from '@playwright/test'
import {
  DATA,
  link,
  routeExamples,
  trackRequests,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

test('drawer and window overlap', async ({ browser }) => {
  const results = []
  for (const width of [1024, 1280, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 768 } })
    await routeExamples(context)
    const page = await context.newPage()
    const requests = trackRequests(context, (url) => url.startsWith(DATA))
    await page.goto(link('/', `${DATA}h5ad-smoke.h5ad`))
    await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 60_000 })
    await waitQuiet(page, requests)
    await page.getByRole('button', { name: /^Dataset info/ }).click()
    const drawer = page.getByRole('dialog', { name: 'Dataset info' })
    await expect(drawer).toBeVisible()
    for (const [toggle, region] of [
      ['Query', 'Cell Query'],
      ['Plots', 'Plots'],
    ]) {
      await page
        .getByRole('group', { name: 'Panels' })
        .getByRole('button', { name: toggle, exact: true })
        .click()
      const window = page.getByRole('region', { name: region })
      await expect(window).toBeVisible()
      const d = await drawer.boundingBox()
      const w = await window.boundingBox()
      const overlapPx = Math.max(
        0,
        Math.min(d.x + d.width, w.x + w.width) - Math.max(d.x, w.x),
      )
      // Which element is on top at the middle of the overlap?
      const topAtOverlap =
        overlapPx === 0
          ? null
          : await page.evaluate(
              ([x, y]) => {
                const el = document.elementFromPoint(x, y)
                return (
                  el
                    ?.closest('[role=dialog],[role=region]')
                    ?.getAttribute('aria-label') ??
                  el?.closest('[role=dialog],[role=region]')?.className ??
                  el?.tagName
                )
              },
              [Math.max(d.x, w.x) + overlapPx / 2, w.y + Math.min(w.height, 200) / 2],
            )
      const row = {
        width,
        window: region,
        drawer: d,
        windowBox: w,
        overlapPx,
        topAtOverlap,
      }
      results.push(row)
      console.log(JSON.stringify(row))
      if (width === 1024) {
        await page.screenshot({
          path: new URL(`./out/w1024-drawer-${toggle}.png`, import.meta.url).pathname,
        })
      }
      await page
        .getByRole('group', { name: 'Panels' })
        .getByRole('button', { name: toggle, exact: true })
        .click()
    }
    await context.close()
  }
  writeOut('drawer-window-overlap.json', results)
})
