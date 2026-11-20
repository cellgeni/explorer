// R5 journey 1: open each local fixture from a link at one width and record
// the activity log, the status line, notices and a screenshot.
//
//   RT_GPU=1 node docs/review/2026-11-19/evidence/runtime/open-each.mjs [width] [height]
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  DATA,
  OUT,
  datasetLink,
  launch,
  logText,
  rendererOf,
  routeExamples,
} from './lib.mjs'

const width = Number(process.argv[2] ?? 1440)
const height = Number(process.argv[3] ?? 900)
const dir = `${OUT}shots/open-each-${width}`
mkdirSync(dir, { recursive: true })

const CASES = [
  ['h5ad-tiny', `${DATA}h5ad-smoke.h5ad`, {}, /H5AD ready/],
  ['h5ad-medium', `${DATA}medium.h5ad`, {}, /H5AD ready/],
  ['icechunk', `${DATA}anndata.icechunk`, {}, /Icechunk AnnData ready/],
  [
    'visium-spaceranger',
    `${DATA}visium-smoke/`,
    {},
    /Visium hires tissue image ready|Visium ready/,
  ],
  [
    'merscope',
    `${DATA}merscope-smoke/`,
    {},
    /MERSCOPE cell boundaries ready|MERSCOPE ready/,
  ],
  ['merscope-vzg', `${DATA}merscope-vzg/`, {}, /Morphology image ready/],
  ['spatialdata-image', `${DATA}image_cells.zarr`, {}, /Morphology image ready/],
  [
    'segmentation-mask',
    `${DATA}segmentation-smoke/slide.tif`,
    { segmentation: `${DATA}segmentation-smoke/mask.tif`, panel: 'segmentation' },
    /outlines|Segmentation|ready/i,
  ],
  ['broken-h5ad', `${DATA}broken.h5ad`, {}, /fail|could not|error/i],
  ['missing-url', `${DATA}does-not-exist.h5ad`, {}, /fail|could not|error|not found/i],
  [
    'missing-folder',
    `${DATA}no-such-folder/`,
    {},
    /fail|could not|error|not found|recogni/i,
  ],
]

const browser = await launch()
const results = []
for (const [name, url, extra, done] of CASES) {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`))
  await routeExamples(page)
  const started = Date.now()
  await page.goto(datasetLink(url, extra))
  let ok = true
  try {
    const log = page.getByRole('region', { name: 'Activity log' })
    // Poll the log text without opening panels, so the screenshot shows the
    // plain view: the log is in the DOM once the info drawer was rendered.
    await page.waitForFunction(
      (source) => new RegExp(source, 'i').test(document.body.innerText),
      done.source,
      { timeout: 60_000, polling: 250 },
    )
    void log
  } catch {
    ok = false
  }
  const seconds = (Date.now() - started) / 1000
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${dir}/${name}.png` })
  const status = await page
    .getByRole('status')
    .allInnerTexts()
    .catch(() => [])
  const alerts = await page
    .getByRole('alert')
    .allInnerTexts()
    .catch(() => [])
  const renderer = await rendererOf(page)
  let log = ''
  try {
    log = await logText(page)
  } catch (error) {
    log = `log unavailable: ${String(error).slice(0, 200)}`
  }
  await page.screenshot({ path: `${dir}/${name}-info.png` })
  results.push({
    name,
    url,
    ok,
    seconds,
    status,
    alerts,
    consoleErrors,
    renderer,
    log: log.split('\n').slice(0, 60),
  })
  console.log(
    `${name}: ${ok ? 'done' : 'TIMEOUT'} in ${seconds}s; alerts=${JSON.stringify(alerts).slice(0, 200)}`,
  )
  await context.close()
}
await browser.close()
writeFileSync(`${OUT}open-each-${width}.json`, JSON.stringify(results, null, 2))
