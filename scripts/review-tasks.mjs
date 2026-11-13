// The eight review tasks (plan 15.5-E), live, headless with the GPU.
// Needs `npm run dev` on port 5173 and network access to both datasets.
// node scripts/review-tasks.mjs <xenium|visium> <width> <outDir>
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const BASE = 'http://localhost:5173/'
const DATASETS = {
  xenium: {
    url: 'https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328',
    geneQuery: 'SNAP25',
    gene: 'SNAP25',
    noun: 'Cells',
    card: 'Cell',
    set: 'graphclust',
    transcripts: true,
  },
  visium: {
    url: 'https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/60d5175f-f477-48b2-8396-ad76be2c3310.h5ad',
    geneQuery: 'ACTB',
    gene: null,
    noun: 'Spots',
    card: 'Spot',
    set: null,
    transcripts: false,
  },
}
const [, , key, widthArg, out] = process.argv
const ds = DATASETS[key]
const width = Number(widthArg)
const height = width >= 1440 ? 900 : width >= 1024 ? 700 : 844
const narrow = width < 860
const context = await chromium.launchPersistentContext(`${out}/profile`, {
  args: ['--use-angle=metal', '--enable-gpu'],
  viewport: { width, height },
})
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
const page = await context.newPage()
const results = []
const t0 = Date.now()
const prefix = `${key}-${width}`
let geneName = ds.gene

async function run(n, name, fn) {
  const started = Date.now()
  const notes = []
  try {
    await fn(notes)
    results.push({ n, name, ok: true, seconds: (Date.now() - started) / 1000, notes })
  } catch (error) {
    notes.push(`FAILED: ${String(error.message ?? error).split('\n')[0]}`)
    results.push({ n, name, ok: false, seconds: (Date.now() - started) / 1000, notes })
  }
  await page.screenshot({ path: `${out}/${prefix}-t${n}.png` }).catch(() => {})
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(0)}s task ${n} ${name}: ${results.at(-1).ok ? 'ok' : 'FAIL'} ${notes.join(' | ')}`,
  )
}

const layersPanel = () => page.getByRole('complementary', { name: 'Layers' })
async function expandSheet(open) {
  if (!narrow) return
  const handle = layersPanel().getByRole('button', { name: /^Layers/ })
  const expanded = (await handle.getAttribute('aria-expanded')) === 'true'
  if (expanded !== open) await handle.click()
}
async function section(name) {
  await expandSheet(true)
  const button = layersPanel()
    .getByRole('heading', { level: 3 })
    .getByRole('button', { name: new RegExp(`^${name}`) })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  return layersPanel().getByRole('region', { name: new RegExp(`^${name}`) })
}
async function tool(name) {
  if (narrow) {
    await page.getByRole('button', { name: /^Tools/ }).click()
    await page
      .getByRole('group', { name: 'Tools' })
      .getByRole('button', { name: new RegExp(`^${name}`) })
      .click()
  } else {
    await page
      .getByRole('toolbar', { name: 'Tools' })
      .getByRole('button', { name, exact: true })
      .click()
  }
}
const legend = () => page.getByRole('region', { name: 'Legend' })
const canvas = () => page.getByRole('img', { name: 'Spatial viewer canvas area' })

// Boxes over the canvas that a pick or a drag must not start on: the cards,
// the legend and loading list, toasts, and the minimap with its buttons.
async function obstacles() {
  const selectors = [
    '.shell-card-stack',
    '.viewport-notification-stack',
    '.viewer-toasts',
    '.viewer-minimap',
    '.viewport-tool-hint',
  ]
  const boxes = []
  for (const selector of selectors) {
    for (const element of await page.locator(selector).all()) {
      const box = await element.boundingBox().catch(() => null)
      if (box !== null && box.width > 0 && box.height > 0) boxes.push(box)
    }
  }
  const zoom = await page
    .getByRole('button', { name: 'Zoom in (+)' })
    .boundingBox()
    .catch(() => null)
  if (zoom !== null)
    boxes.push({ x: zoom.x - 80, y: zoom.y - 10, width: 200, height: 120 })
  return boxes
}
const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height

// Points on tissue (coloured, neither background nor white), nearest the
// canvas centre first, each with a clear square of `half` around it.
async function tissuePoints(half, count = 6) {
  const box = await canvas().boundingBox()
  const blocked = await obstacles()
  const png = await page.screenshot({ clip: box })
  const pixels = await page.evaluate(
    async ({ data, step }) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob()
      const image = await createImageBitmap(blob)
      const offscreen = new OffscreenCanvas(image.width, image.height)
      const context = offscreen.getContext('2d')
      context.drawImage(image, 0, 0)
      const {
        data: rgba,
        width,
        height,
      } = context.getImageData(0, 0, image.width, image.height)
      const found = []
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const i = (y * width + x) * 4
          const max = Math.max(rgba[i], rgba[i + 1], rgba[i + 2])
          const min = Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
          if (max - min > 45 && max > 60 && min < 225) found.push([x / width, y / height])
        }
      }
      return found
    },
    { data: png.toString('base64'), step: 6 },
  )
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const points = pixels
    .map(([fx, fy]) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height }))
    .filter((point) => {
      const square = {
        x: point.x - half,
        y: point.y - half,
        width: 2 * half,
        height: 2 * half,
      }
      return (
        square.x > box.x &&
        square.y > box.y &&
        square.x + square.width < box.x + box.width &&
        square.y + square.height < box.y + box.height &&
        !blocked.some((other) => overlaps(square, other))
      )
    })
    .sort(
      (a, b) =>
        Math.hypot(a.x - centre.x, a.y - centre.y) -
        Math.hypot(b.x - centre.x, b.y - centre.y),
    )
  const chosen = []
  for (const point of points) {
    if (chosen.every((other) => Math.hypot(other.x - point.x, other.y - point.y) > 30))
      chosen.push(point)
    if (chosen.length >= count) break
  }
  return chosen
}

// Draws a box on clear tissue, as large as fits. Under 860 px an open card
// covers half the canvas, so the cards close first, as on a phone.
async function drawBoxOnTissue(notes) {
  const close = page
    .locator('.shell-card-stack .ui-card-header')
    .getByRole('button', { name: /^(Close|Clear|Turn off) / })
  for (let i = 0; narrow && i < 5 && (await close.count()) > 0; i += 1) {
    await close.first().click()
  }
  for (const half of [90, 60, 40]) {
    const [centre] = await tissuePoints(half, 1)
    if (centre === undefined) continue
    await dragBox(centre, half)
    notes.push(`drew a ${2 * half} px box`)
    return
  }
  throw new Error('no clear tissue for an 80 px box')
}

async function dragBox(centre, half) {
  await page.mouse.move(centre.x - half, centre.y - half)
  await page.mouse.down()
  await page.mouse.move(centre.x, centre.y, { steps: 5 })
  await page.mouse.move(centre.x + half, centre.y + half, { steps: 5 })
  await page.mouse.up()
}
const text = async (locator) =>
  (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()

await run(1, 'Open a dataset', async (notes) => {
  await page.goto(BASE)
  const start = page.getByRole('region', { name: 'Open a dataset' })
  await start.waitFor()
  const examples = start.getByRole('list', { name: 'Examples' }).getByRole('listitem')
  await examples
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {})
  notes.push(`${await examples.count()} examples`)
  await start.getByLabel('Dataset or image URL').fill(ds.url)
  const loadStarted = Date.now()
  await start.getByRole('button', { name: 'Load Dataset' }).click()
  const summary = page.locator('.shell-summary').filter({ hasText: /cells|spots/ })
  await summary.waitFor({ state: 'attached', timeout: 180000 })
  notes.push(
    `ready in ${((Date.now() - loadStarted) / 1000).toFixed(1)} s: ${await summary.textContent()}`,
  )
  await page.waitForTimeout(3000)
})

await run(2, 'Colour cells by a gene', async (notes) => {
  const cells = await section(ds.noun)
  await cells.getByLabel('Gene selection').fill(ds.geneQuery)
  let option =
    ds.gene === null
      ? cells.getByRole('list', { name: 'Gene options' }).getByRole('button').first()
      : cells.getByRole('button', { name: ds.gene, exact: true })
  if (!(await option.isVisible().catch(() => false))) {
    await cells.getByLabel('Gene selection').fill('')
    option = cells.getByRole('list', { name: 'Gene options' }).getByRole('button').first()
  }
  geneName = (await option.textContent()).trim()
  notes.push(`picked ${geneName} (title "${await option.getAttribute('title')}")`)
  await option.click()
  await expandSheet(false)
  await legend().filter({ hasText: geneName }).waitFor({ timeout: 120000 })
  const loadedAt = Date.now()
  await page
    .waitForFunction(
      () => !document.querySelector('.viewer-legend')?.textContent?.includes('Loading'),
      null,
      { timeout: 120000 },
    )
    .catch(() => notes.push('legend still loading after 120 s'))
  notes.push(`expression in ${((Date.now() - loadedAt) / 1000).toFixed(1)} s more`)
  notes.push(`legend: ${await text(legend())}`)
})

await run(3, 'Show the clusters and hide one', async (notes) => {
  let cells = await section(ds.noun)
  const set = cells.getByLabel('Annotation set')
  const labels = (await set.locator('option').allTextContents()).map((label) =>
    label.trim(),
  )
  const candidates =
    ds.set !== null && labels.includes(ds.set)
      ? [ds.set]
      : labels.filter((label) => !['None', 'All'].includes(label))
  notes.push(`${labels.length} sets (was ${await set.inputValue()})`)
  const eyes = legend().getByRole('checkbox')
  let classes = 0
  // A set with one class would hide every cell, so look for two or more.
  for (const choice of candidates.slice(0, 8)) {
    cells = await section(ds.noun)
    await cells.getByLabel('Annotation set').selectOption({ label: choice })
    const load = cells.getByRole('button', { name: 'Load Annotations' })
    if (await load.isEnabled()) await load.click()
    await expandSheet(false)
    await legend()
      .filter({ hasText: choice })
      .getByRole('checkbox')
      .first()
      .waitFor({ timeout: 120000 })
    await page.waitForTimeout(500)
    classes = await eyes.count()
    notes.push(`${choice}: ${classes} classes`)
    if (classes >= 2) break
  }
  notes.push(`legend: ${(await text(legend())).slice(0, 160)}`)
  const first = eyes.first()
  const name = await first.getAttribute('aria-label')
  await first.click()
  if (await first.isChecked()) throw new Error(`hiding ${name} did not take`)
  notes.push(`hid ${name}`)
  if (classes < 2) {
    await page.waitForTimeout(1000)
    await first.click()
    notes.push('no set with two classes, so showed it again')
  }
  await page.waitForTimeout(1500)
})

await run(4, 'Inspect one cell', async (notes) => {
  await expandSheet(false)
  const card = page.getByRole('region', { name: ds.card, exact: true })
  let opened = false
  for (let round = 0; round < 3 && !opened; round += 1) {
    for (const point of await tissuePoints(12)) {
      await page.mouse.click(point.x, point.y)
      if (
        await card.waitFor({ timeout: 5000 }).then(
          () => true,
          () => false,
        )
      ) {
        opened = true
        break
      }
    }
    if (!opened) {
      await page.getByRole('button', { name: 'Zoom in (+)' }).click()
      await page.waitForTimeout(2000)
      notes.push('zoomed in')
    }
  }
  await card.waitFor({ timeout: 5000 })
  await page.waitForTimeout(2000)
  notes.push(`card: ${(await text(card)).slice(0, 160)}`)
})

await run(5, 'Select a region and read its genes', async (notes) => {
  await expandSheet(false)
  await tool('Box selection')
  await drawBoxOnTissue(notes)
  const card = page.getByRole('region', { name: /^ROI/ }).first()
  const genes = card.getByLabel('ROI gene distribution')
  await genes.waitFor({ timeout: 180000 })
  const compared = card.getByText(/^Compared with/)
  if (
    await compared.waitFor({ timeout: 90000 }).then(
      () => true,
      () => false,
    )
  )
    notes.push(await text(compared))
  await page.waitForTimeout(2000)
  notes.push(`subtitle/genes: ${(await text(card)).slice(0, 220)}`)
})

await run(6, 'Show the transcripts of the selected genes', async (notes) => {
  if (!ds.transcripts) {
    notes.push('not offered on this platform')
    return
  }
  const tx = await section('Transcripts')
  await tx.getByRole('checkbox', { name: 'Show transcripts', exact: true }).check()
  await expandSheet(false)
  const shown = await legend()
    .filter({ hasText: /transcripts|Transcripts/ })
    .waitFor({ timeout: 120000 })
    .then(
      () => true,
      () => false,
    )
  if (!shown) {
    const legends = await legend().count()
    throw new Error(
      `no transcript legend after 120 s; ${legends} legend(s): ${(
        await legend()
          .first()
          .textContent()
          .catch(() => '')
      )?.slice(0, 160)}`,
    )
  }
  await page.waitForTimeout(4000)
  notes.push(`legend: ${(await text(legend())).slice(0, 200)}`)
})

await run(7, 'Share the view and reopen it', async (notes) => {
  await page.getByRole('button', { name: /^Share/ }).click()
  await page.getByText('Link copied').first().waitFor({ timeout: 15000 })
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const params = [...new URLSearchParams(new URL(link).hash.slice(1)).keys()]
  notes.push(`${link.length} chars: ${params.join(',')}`)
  const reopened = await context.newPage()
  await reopened.goto(link)
  await reopened
    .locator('.shell-summary')
    .filter({ hasText: /cells|spots/ })
    .waitFor({ state: 'attached', timeout: 180000 })
  await reopened.waitForTimeout(8000)
  const reopenedLegend = await text(reopened.getByRole('region', { name: 'Legend' }))
  notes.push(`reopened legend: ${reopenedLegend.slice(0, 120)}`)
  notes.push(
    `reopened cards: ${(await reopened.locator('.shell-card-stack h2').allTextContents()).join(', ')}`,
  )
  await reopened.screenshot({ path: `${out}/${prefix}-t7-reopened.png` })
  await reopened.close()
})

await run(8, 'Recover: bad address, undo, cancel', async (notes) => {
  await page.getByTitle('Open dataset', { exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Open dataset' })
  await menu.getByLabel('Dataset or image URL').fill(`${ds.url}-missing`)
  await menu.getByRole('button', { name: 'Load Dataset' }).click()
  const toast = page.getByText(/could not be opened/).first()
  await toast.waitFor({ timeout: 90000 })
  notes.push(`toast: ${await text(toast.locator('xpath=ancestor::*[@role="alert"][1]'))}`)
  await page.screenshot({ path: `${out}/${prefix}-t8-bad-address.png` })
  await page
    .getByRole('alert')
    .filter({ hasText: /could not be opened/ })
    .getByRole('button', { name: 'Dismiss' })
    .click()

  // Remove a cluster class, then Undo (15.3-C).
  const cells = await section(ds.noun)
  const labels = cells.getByRole('region', { name: / labels$/ }).first()
  const remove = labels.getByRole('button', { name: /^Remove / }).nth(1)
  const removeName = await remove.getAttribute('aria-label')
  const before = await labels.getByRole('button', { name: /^Remove / }).count()
  await remove.click()
  await page.getByRole('button', { name: 'Undo' }).click({ timeout: 30000 })
  await labels
    .getByRole('button', { name: removeName, exact: true })
    .waitFor({ timeout: 5000 })
  notes.push(`undo restored ${removeName.replace('Remove ', '')} (${before} classes)`)
  await expandSheet(false)

  // A second selection, then Cancel on its query (15.3-D).
  await page.keyboard.press('Escape')
  // F, not the button: at 390 px an open card covers the zoom buttons.
  await page.keyboard.press('f')
  await tool('Box selection')
  await drawBoxOnTissue(notes)
  const cancel = page.getByRole('button', { name: /^Cancel querying ROI/i }).first()
  if (
    await cancel.waitFor({ timeout: 8000 }).then(
      () => true,
      () => false,
    )
  ) {
    const label = await cancel.getAttribute('aria-label')
    await cancel.click()
    notes.push(`cancelled: ${label}`)
  } else {
    notes.push('the query finished before Cancel could be pressed')
  }
  await page.waitForTimeout(1500)
})

writeFileSync(`${out}/${prefix}.json`, JSON.stringify(results, null, 2))
await context.close()
