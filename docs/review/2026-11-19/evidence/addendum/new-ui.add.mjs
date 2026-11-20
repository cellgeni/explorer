// Addendum (2026-11-20): the new controls in the built app. Opens
// cells3d.h5ad (3,000 cells, obs section s0-s2, a third obsm spatial
// column), scans the page with axe (the smoke test's tags) with the Cells
// View control and the Open N Sections link showing, then with the 3D cell
// view open, and follows Open 3 Sections to the split collection.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { writeFileSync } from 'node:fs'

const DATA = 'http://127.0.0.1:4274/'
const OUT = new URL('./', import.meta.url).pathname
const INDEX =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json'
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

async function scan(page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5),
  }))
}

test('new Cells controls: axe, 3D view, Open N Sections', async ({ browser }) => {
  const context = await browser.newContext()
  await context.route(INDEX, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  const page = await context.newPage()
  await page.goto(`/#dataset=${encodeURIComponent(`${DATA}cells3d.h5ad`)}`)
  await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })

  const view = page.getByRole('group', { name: 'Cell view' })
  await expect(view).toBeVisible()
  // The split link appears once the annotation sets are listed.
  const split = page.getByRole('link', { name: /Open 3 Sections/ })
  await expect(split).toBeVisible({ timeout: 30_000 })
  const splitHref = await split.getAttribute('href')
  const twoD = await scan(page)

  await view.getByRole('button', { name: '3D' }).click()
  const cells3d = page.getByRole('region', { name: '3D cells' })
  await expect(cells3d).toBeVisible()
  await expect(cells3d.getByText(/3,000 cells, z/)).toBeVisible({ timeout: 30_000 })
  const summary = await cells3d.getByText(/3,000 cells, z/).textContent()
  const threeD = await scan(page)
  await view.getByRole('button', { name: '2D' }).click()

  await split.click()
  const bar = page.getByRole('navigation', { name: /collection/i })
  await expect(page.getByRole('button', { name: 's1', exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const sectionButtons = await page
    .getByRole('button', { name: /^s[0-2]$/ })
    .allTextContents()
  await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
  const title = await page.title()

  const result = {
    splitHref,
    summary3d: summary,
    sectionButtons,
    collectionBarFound: (await bar.count()) > 0,
    title,
    axe: { twoD, threeD },
  }
  writeFileSync(`${OUT}new-ui.json`, `${JSON.stringify(result, null, 2)}\n`)
  console.info('NEW-UI', JSON.stringify({ ...result, axe: undefined }))
  console.info(
    'AXE',
    JSON.stringify({ twoD: twoD.map((v) => v.id), threeD: threeD.map((v) => v.id) }),
  )
  await context.close()
})
