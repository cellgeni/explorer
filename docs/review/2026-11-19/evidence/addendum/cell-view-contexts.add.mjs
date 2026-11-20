// Addendum (2026-11-20): does opening and closing the 3D cell view keep a
// WebGL context each time, as EXP-011 found for dataset switches? Opens
// cells3d.h5ad (3,000 cells with a third obsm spatial column), switches the
// Cells section's View to 3D and back TOGGLES times, and counts the WebGL
// contexts the page creates and loses. A context lost while its canvas is
// still on the page means the browser dropped one in use. The second run
// forces a garbage collection after every close, so contexts that are only
// waiting to be collected do not count.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const DATA = 'http://127.0.0.1:4274/'
const OUT = new URL('./', import.meta.url).pathname
const TOGGLES = 20
const INDEX =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json'

for (const gc of [false, true]) {
  test(`WebGL contexts across 3D cell view toggles${gc ? ', collecting garbage' : ''}`, async ({
    browser,
  }) => {
    const context = await browser.newContext()
    await context.route(INDEX, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await context.addInitScript(() => {
      const state = { created: 0, lost: 0, lostOnPage: 0 }
      const seen = new WeakSet()
      window.__gl = state
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const ctx = original.call(this, type, ...rest)
        if (ctx !== null && /webgl/.test(String(type)) && !seen.has(ctx)) {
          seen.add(ctx)
          state.created += 1
          this.addEventListener('webglcontextlost', () => {
            state.lost += 1
            if (this.isConnected) state.lostOnPage += 1
          })
        }
        return ctx
      }
    })
    const page = await context.newPage()
    const warnings = []
    const errors = []
    page.on('console', (message) => {
      if (/webgl|context/i.test(message.text())) warnings.push(message.text())
      if (message.type() === 'error') errors.push(message.text().slice(0, 300))
    })
    page.on('pageerror', (error) =>
      errors.push(`pageerror: ${error.message.slice(0, 300)}`),
    )

    await page.goto(`/#dataset=${encodeURIComponent(`${DATA}cells3d.h5ad`)}`)
    await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
    const view = page.getByRole('group', { name: 'Cell view' })
    await expect(view).toBeVisible({ timeout: 30_000 })
    const cells3d = page.getByRole('region', { name: '3D cells' })
    const counts = async () => page.evaluate(() => ({ ...window.__gl }))

    const before = await counts()
    await page.waitForTimeout(1000)
    if (!gc) await page.screenshot({ path: `${OUT}cell-view-contexts-before.png` })
    const after = []
    for (let toggle = 1; toggle <= TOGGLES; toggle += 1) {
      await view.getByRole('button', { name: '3D' }).click()
      await expect(cells3d).toBeVisible()
      await expect(cells3d.locator('canvas')).toHaveCount(1)
      await page.waitForTimeout(300)
      await view.getByRole('button', { name: '2D' }).click()
      await expect(cells3d).toHaveCount(0)
      if (gc) {
        const session = await page.context().newCDPSession(page)
        await session.send('HeapProfiler.collectGarbage')
        await session.detach()
        await page.waitForTimeout(200)
      }
      after.push({ toggle, ...(await counts()) })
    }

    // The 2D view after the toggles, then after zooming it, which redraws.
    await page.waitForTimeout(1000)
    if (!gc) await page.screenshot({ path: `${OUT}cell-view-contexts-after.png` })
    await page.mouse.move(700, 450)
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(1500)
    if (!gc) await page.screenshot({ path: `${OUT}cell-view-contexts-after-zoom.png` })

    // The 2D view's canvas after the toggles.
    const mainCanvasLost = await page.evaluate(() =>
      [...document.querySelectorAll('canvas')].map((canvas) => {
        const gl = canvas.getContext('webgl2')
        return gl === null ? null : gl.isContextLost()
      }),
    )

    const result = {
      gc,
      toggles: TOGGLES,
      before,
      after,
      mainCanvasLost,
      warnings: [...new Set(warnings)],
      errors: [...new Set(errors)],
    }
    writeFileSync(
      `${OUT}cell-view-contexts${gc ? '-gc' : ''}.json`,
      `${JSON.stringify(result, null, 2)}\n`,
    )
    console.info(
      'CELL-VIEW-CONTEXTS',
      JSON.stringify(result.after.at(-1)),
      result.warnings,
    )
    await context.close()
  })
}
