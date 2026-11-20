// Shared helpers for the runtime review scripts (area RT). Not a test file.
//
// APP defaults to the review build served by `vite preview` on 4473;
// DATA to scripts/range-server.mjs on 4474 (SLOW_DATA: --delay 1500 on 4475).
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const APP = process.env.RT_APP ?? 'http://127.0.0.1:4473/'
export const DATA = process.env.RT_DATA ?? 'http://127.0.0.1:4474/'
export const SLOW_DATA = process.env.RT_SLOW_DATA ?? 'http://127.0.0.1:4475/'
export const OUT = new URL('./', import.meta.url).pathname
export const EXAMPLES_INDEX_URL =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json'
const REPO = new URL('../../../../../', import.meta.url).pathname

// GPU (Metal) WebGL when RT_GPU=1, else Playwright's default headless shell
// (SwiftShader). Returns the browser and the renderer string it reports.
export async function launch({ gpu = process.env.RT_GPU === '1', args = [] } = {}) {
  const browser = await chromium.launch(
    gpu
      ? { channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', ...args] }
      : { args },
  )
  return browser
}

export async function rendererOf(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (gl === null) return 'no webgl2'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext === null
      ? gl.getParameter(gl.RENDERER)
      : gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
  })
}

// The start screen's gallery reads GitHub; answer it with this checkout's.
export async function routeExamples(page) {
  await page.route(EXAMPLES_INDEX_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: readFileSync(join(REPO, 'examples', 'index.json'), 'utf8'),
    }),
  )
}

export function datasetLink(url, extra = {}) {
  const params = new URLSearchParams({ dataset: url, ...extra })
  return `${APP}#${params.toString()}`
}

// --- Control areas, as tests/e2e/controls.ts ---

const infoButton = (page) => page.getByRole('button', { name: /^Dataset info/ })
const isExpanded = async (button) =>
  (await button.getAttribute('aria-expanded')) === 'true'

export async function openInfo(page) {
  const open = page.getByTitle('Open dataset')
  if ((await open.count()) > 0 && (await isExpanded(open))) await open.click()
  if (!(await isExpanded(infoButton(page)))) await infoButton(page).click()
  return page.getByRole('dialog', { name: 'Dataset info' })
}

export async function closeInfo(page) {
  if (await isExpanded(infoButton(page))) await infoButton(page).click()
}

export async function openSection(page, section) {
  const layers = page.getByRole('complementary', { name: 'Layers' })
  // Narrow screens: the layer panel is a bottom sheet with a handle.
  const handle = layers.getByRole('button', { name: /^Layers/ })
  if (
    (await handle.count()) > 0 &&
    (await handle.isVisible()) &&
    !(await isExpanded(handle))
  ) {
    await handle.click()
  }
  const button = layers
    .getByRole('heading', { level: 3 })
    .getByRole('button', { name: section })
  if (!(await isExpanded(button))) await button.click()
  return layers.getByRole('region', { name: section })
}

export async function openPanel(page, name, windowName) {
  const toggle = page
    .getByRole('group', { name: 'Panels' })
    .getByRole('button', { name, exact: true })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  return page.getByRole('region', { name: windowName })
}

export async function logText(page) {
  await openInfo(page)
  const log = page.getByRole('region', { name: 'Activity log' })
  const details = log.locator('details')
  if ((await details.getAttribute('open')) === null) await log.locator('summary').click()
  const text = await log.innerText({ timeout: 2000 })
  return text
}

export async function waitLog(page, pattern, timeout = 60_000) {
  await openInfo(page)
  const log = page.getByRole('region', { name: 'Activity log' })
  const details = log.locator('details')
  if ((await details.getAttribute('open')) === null) await log.locator('summary').click()
  await log.getByText(pattern).first().waitFor({ timeout })
}

export function nowIso() {
  return new Date().toISOString()
}

// Counts requests to `origin` from page and workers, keeping each request's
// start, end and status, so a script can count those that continue after a
// moment such as a dataset switch.
export function trackRequests(context, origin) {
  const entries = []
  const byRequest = new Map()
  context.on('request', (request) => {
    if (!request.url().startsWith(origin)) return
    const entry = {
      url: request.url().slice(origin.length),
      method: request.method(),
      range: request.headers()['range'] ?? null,
      start: Date.now(),
      end: null,
      status: null,
      failure: null,
      bytes: 0,
    }
    entries.push(entry)
    byRequest.set(request, entry)
  })
  context.on('requestfinished', async (request) => {
    const entry = byRequest.get(request)
    if (entry === undefined) return
    entry.end = Date.now()
    try {
      const response = await request.response()
      entry.status = response?.status() ?? null
      const sizes = await request.sizes()
      entry.bytes = sizes.responseBodySize
    } catch {
      // ignore
    }
  })
  context.on('requestfailed', (request) => {
    const entry = byRequest.get(request)
    if (entry === undefined) return
    entry.end = Date.now()
    entry.failure = request.failure()?.errorText ?? 'failed'
  })
  return entries
}
