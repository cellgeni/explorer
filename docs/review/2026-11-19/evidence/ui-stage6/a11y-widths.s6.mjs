// R5 accessibility and layout at three widths: axe (the smoke test's WCAG 2.2
// A/AA and best-practice tags) on states the smoke test does not scan, a
// horizontal overflow check, and a screenshot. Then Escape and focus return
// for every window and popover toggle, opened from the keyboard.
import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  DATA,
  link,
  routeExamples,
  trackRequests,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
const WIDTHS = [
  [1440, 900],
  [1024, 768],
  [390, 844],
]
const STATES = [
  ['start screen', null, {}],
  ['h5ad medium', 'medium.h5ad', {}],
  ['ome-tiff image controls', 'two-channel.ome.tif', {}],
  ['visium folder', 'visium-smoke/', {}],
  ['merscope vzg', 'merscope-vzg/', {}],
  [
    'segmentation mask',
    'segmentation-smoke/slide.tif',
    { segmentation: `${DATA}segmentation-smoke/mask.tif`, panel: 'segmentation' },
  ],
  ['collection', null, { collection: `${DATA}sections/collection.json` }],
]

async function expandLayers(page) {
  const layers = page.getByRole('complementary', { name: 'Layers' })
  const handle = layers.getByRole('button', { name: /^Layers/ })
  if ((await handle.count()) > 0 && (await handle.first().isVisible())) {
    if ((await handle.first().getAttribute('aria-expanded')) !== 'true')
      await handle.first().click()
  }
  const sections = layers.getByRole('heading', { level: 3 }).getByRole('button')
  for (let index = 0; index < (await sections.count()); index += 1) {
    const section = sections.nth(index)
    if ((await section.getAttribute('aria-expanded')) !== 'true') {
      await section.click({ timeout: 5000 }).catch(() => {})
    }
  }
}

function overflow() {
  const label = (el) =>
    (
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      el.textContent ??
      el.tagName
    )
      .trim()
      .slice(0, 40)
  const offscreen = []
  for (const el of document.querySelectorAll(
    'button, input, select, textarea, a[href], [role=button], [role=switch]',
  )) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden')
      continue
    if (r.right > innerWidth + 1 || r.left < -1) offscreen.push(label(el))
  }
  return {
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offscreenCount: offscreen.length,
    offscreen: offscreen.slice(0, 12),
  }
}

test('axe, overflow and screenshots at three widths', async ({ browser }) => {
  test.setTimeout(900_000)
  const results = []
  for (const [width, height] of WIDTHS) {
    for (const [name, path, extra] of STATES) {
      if (process.env.S6_ONLY !== undefined && name !== process.env.S6_ONLY) continue
      const context = await browser.newContext({ viewport: { width, height } })
      await routeExamples(context)
      const page = await context.newPage()
      const requests = trackRequests(context, (url) => url.startsWith(DATA))
      const row = { width, state: name }
      try {
        const target =
          path !== null
            ? link('/', DATA + path, extra)
            : Object.keys(extra).length === 0
              ? '/'
              : `/#${new URLSearchParams(extra).toString()}`
        await page.goto(target)
        await page.waitForTimeout(1500)
        await waitQuiet(page, requests, { quietMs: 2000, maxMs: 60_000 })
        if (target !== '/') await expandLayers(page)
        await page.waitForTimeout(500)
        const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
        row.violations = axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
          summary: v.nodes[0]?.failureSummary
            ?.split('\n')
            .slice(0, 2)
            .join(' ')
            .slice(0, 220),
        }))
        row.incomplete = axe.incomplete.map((v) => `${v.id}:${v.nodes.length}`)
        row.layout = await page.evaluate(overflow)
        if (width !== 1440) {
          await page.screenshot({
            path: new URL(
              `./out/w${width}-${name.replace(/\W+/g, '-')}.png`,
              import.meta.url,
            ).pathname,
          })
        }
      } catch (error) {
        row.error = String(error).slice(0, 300)
      }
      results.push(row)
      console.log(JSON.stringify(row))
      await context.close()
    }
  }
  writeOut(
    process.env.S6_ONLY === undefined
      ? 'a11y-widths.json'
      : `a11y-widths-${process.env.S6_ONLY}.json`,
    results,
  )
})

const TOGGLES = [
  [
    'Embedding',
    (page) =>
      page
        .getByRole('group', { name: 'Panels' })
        .getByRole('button', { name: 'Embedding', exact: true }),
  ],
  [
    'Plots',
    (page) =>
      page
        .getByRole('group', { name: 'Panels' })
        .getByRole('button', { name: 'Plots', exact: true }),
  ],
  [
    'Query',
    (page) =>
      page
        .getByRole('group', { name: 'Panels' })
        .getByRole('button', { name: 'Query', exact: true }),
  ],
  ['Share', (page) => page.getByRole('button', { name: /^Share/ }).first()],
  ['Help', (page) => page.getByTitle('Help', { exact: true })],
  ['Settings', (page) => page.getByTitle('Settings', { exact: true })],
  ['Open dataset', (page) => page.getByTitle('Open dataset', { exact: true })],
  ['Dataset info', (page) => page.getByRole('button', { name: /^Dataset info/ })],
  [
    'Measure options',
    (page) => page.getByRole('button', { name: 'Measure options', exact: true }),
  ],
]

test('Escape and focus return for windows and popovers', async ({ browser }) => {
  test.setTimeout(300_000)
  const results = []
  for (const [width, height] of [WIDTHS[0], WIDTHS[2]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    await routeExamples(context)
    const page = await context.newPage()
    const requests = trackRequests(context, (url) => url.startsWith(DATA))
    await page.goto(link('/', DATA + 'medium.h5ad'))
    await page.waitForTimeout(1500)
    await waitQuiet(page, requests, { quietMs: 2000, maxMs: 60_000 })
    for (const [name, find] of TOGGLES) {
      const row = { width, toggle: name }
      try {
        const toggle = find(page)
        if ((await toggle.count()) === 0 || !(await toggle.isVisible())) {
          row.result = 'toggle not visible'
        } else {
          await toggle.focus()
          await page.keyboard.press('Enter')
          await page.waitForTimeout(400)
          row.openState =
            (await toggle.getAttribute('aria-expanded')) ??
            (await toggle.getAttribute('aria-pressed'))
          row.focusAfterOpen = await page.evaluate(() => {
            const el = document.activeElement
            return `${el?.tagName} ${(el?.getAttribute('aria-label') ?? el?.getAttribute('title') ?? el?.textContent ?? '').trim().slice(0, 40)}`
          })
          await page.keyboard.press('Escape')
          await page.waitForTimeout(400)
          row.stateAfterEscape =
            (await toggle.getAttribute('aria-expanded')) ??
            (await toggle.getAttribute('aria-pressed'))
          row.focusReturned = await toggle.evaluate((el) => el === document.activeElement)
          row.focusAfterEscape = await page.evaluate(() => {
            const el = document.activeElement
            return `${el?.tagName} ${(el?.getAttribute('aria-label') ?? el?.getAttribute('title') ?? el?.textContent ?? '').trim().slice(0, 40)}`
          })
          // Leave it closed for the next toggle.
          const state =
            (await toggle.getAttribute('aria-expanded')) ??
            (await toggle.getAttribute('aria-pressed'))
          if (state === 'true') await toggle.click()
        }
      } catch (error) {
        row.error = String(error).slice(0, 200)
      }
      results.push(row)
      console.log(JSON.stringify(row))
    }
    await context.close()
  }
  writeOut('focus-return.json', results)
})
