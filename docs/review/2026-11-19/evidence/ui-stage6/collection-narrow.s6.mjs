// At 390 px, can the collection's off-screen section buttons be reached?
import { test } from '@playwright/test'
import { DATA, routeExamples, trackRequests, waitQuiet, writeOut } from './s6lib.mjs'

test('collection section buttons at 390 px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await routeExamples(context)
  const page = await context.newPage()
  const requests = trackRequests(context, (url) => url.startsWith(DATA))
  await page.goto(`/#collection=${encodeURIComponent(`${DATA}sections/collection.json`)}`)
  await page.waitForTimeout(1500)
  await waitQuiet(page, requests, { quietMs: 2000 })
  const handle = page
    .getByRole('complementary', { name: 'Layers' })
    .getByRole('button', { name: /^Layers/ })
  // Sheet open (S6_SHEET=open) or as loaded (closed).
  if (
    process.env.S6_SHEET === 'open' &&
    (await handle.getAttribute('aria-expanded')) !== 'true'
  ) {
    await handle.click()
  }
  const sheetExpanded = await handle.getAttribute('aria-expanded')
  const target = page.getByRole('button', { name: 'Show S3 beside' })
  const before = await target.boundingBox()
  const container = await target.evaluate((el) => {
    let node = el.parentElement
    while (node !== null) {
      const style = getComputedStyle(node)
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        return {
          className: node.className,
          overflowX: style.overflowX,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
        }
      }
      node = node.parentElement
    }
    return null
  })
  await target.scrollIntoViewIfNeeded()
  const after = await target.boundingBox()
  await page.screenshot({
    path: new URL(
      `./out/w390-collection-sections-sheet-${sheetExpanded}.png`,
      import.meta.url,
    ).pathname,
  })
  let clicked = 'not tried'
  try {
    await target.click({ timeout: 5000 })
    clicked = 'clicked'
  } catch (error) {
    clicked = String(error).slice(0, 200)
  }
  const pressed = await target.getAttribute('aria-pressed')
  const result = {
    sheetExpanded,
    before,
    after,
    container,
    clicked,
    pressedAfterClick: pressed,
  }
  console.log(JSON.stringify(result))
  writeOut(`collection-narrow-sheet-${sheetExpanded}.json`, result)
  await context.close()
})
