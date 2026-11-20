// Shared helpers for the stage 6 specs. Not a test file.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export const DATA = 'http://127.0.0.1:4274/'
export const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
export const EXAMPLES_INDEX_URL =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json'
const REPO = new URL('../../../../../', import.meta.url).pathname

export function writeOut(name, value) {
  writeFileSync(
    OUT + name,
    typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  )
}

// The start screen reads the gallery from GitHub; answer with this checkout's.
export async function routeExamples(context) {
  await context.route(EXAMPLES_INDEX_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: readFileSync(REPO + 'examples/index.json', 'utf8'),
    }),
  )
}

export function link(base, url, extra = {}) {
  return `${base}#${new URLSearchParams({ dataset: url, ...extra }).toString()}`
}

// Every dedicated worker the page starts, by script name, with closes.
export function trackWorkers(page) {
  const state = { created: {}, closed: {}, alive: new Set() }
  page.on('worker', (worker) => {
    const name = worker
      .url()
      .split('/')
      .pop()
      .replace(/-[\w-]{8}\.js$/, '')
    state.created[name] = (state.created[name] ?? 0) + 1
    state.alive.add(worker)
    worker.on('close', () => {
      state.closed[name] = (state.closed[name] ?? 0) + 1
      state.alive.delete(worker)
    })
  })
  return state
}

export function aliveByName(state) {
  const counts = {}
  for (const worker of state.alive) {
    const name = worker
      .url()
      .split('/')
      .pop()
      .replace(/-[\w-]{8}\.js$/, '')
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

// Requests from the page and its workers, with in-flight tracking.
export function trackRequests(context, filter = () => true) {
  const entries = []
  const byRequest = new Map()
  let inflight = 0
  context.on('request', (request) => {
    if (!filter(request.url())) return
    inflight += 1
    const entry = {
      url: request.url(),
      method: request.method(),
      range: request.headers()['range'] ?? null,
      start: Date.now(),
      end: null,
      status: null,
      bytes: 0,
      failure: null,
    }
    entries.push(entry)
    byRequest.set(request, entry)
  })
  const finish = (request, failure) => {
    const entry = byRequest.get(request)
    if (entry === undefined || entry.end !== null) return
    inflight -= 1
    entry.end = Date.now()
    entry.failure = failure
  }
  context.on('requestfinished', async (request) => {
    finish(request, null)
    const entry = byRequest.get(request)
    if (entry === undefined) return
    try {
      entry.status = (await request.response())?.status() ?? null
      entry.bytes = (await request.sizes()).responseBodySize
    } catch {
      // the page may have gone
    }
  })
  context.on('requestfailed', (request) =>
    finish(request, request.failure()?.errorText ?? 'failed'),
  )
  return { entries, inflight: () => inflight }
}

// Waits until no tracked request has been in flight for `quietMs`.
export async function waitQuiet(page, requests, { quietMs = 1000, maxMs = 30_000 } = {}) {
  const start = Date.now()
  let quietSince = Date.now()
  while (Date.now() - start < maxMs) {
    if (requests.inflight() > 0) quietSince = Date.now()
    else if (Date.now() - quietSince >= quietMs) return Date.now() - start
    await page.waitForTimeout(100)
  }
  return -1
}

// Resident set size of the browser's renderer and GPU processes (KiB, from
// ps), and the main thread's JavaScript heap (CDP Performance.getMetrics).
export async function memory(browser, page) {
  const cdp = await browser.newBrowserCDPSession()
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo')
  await cdp.detach()
  const rssKiB = {}
  for (const process of processInfo) {
    if (process.type === 'browser' || process.id === 0) continue
    try {
      const rss = Number(
        execFileSync('ps', ['-o', 'rss=', '-p', String(process.id)]).toString(),
      )
      rssKiB[process.type] = (rssKiB[process.type] ?? 0) + rss
    } catch {
      // process gone
    }
  }
  // measureUserAgentSpecificMemory is refused in this headless build even
  // when crossOriginIsolated, so worker heaps are not measured separately:
  // dedicated workers run in the renderer process, whose RSS includes them.
  const session = await page.context().newCDPSession(page)
  // S6_GC=1: collect garbage on the main thread first, so the heap is what
  // the page retains.
  if (process.env.S6_GC === '1') await session.send('HeapProfiler.collectGarbage')
  await session.send('Performance.enable')
  const { metrics } = await session.send('Performance.getMetrics')
  await session.detach()
  const metric = (name) => metrics.find((entry) => entry.name === name)?.value
  const js = {
    mainHeapUsedMiB: Math.round((metric('JSHeapUsedSize') ?? 0) / 1048576),
    crossOriginIsolated: await page.evaluate(() => self.crossOriginIsolated),
  }
  return { rssKiB, js }
}

export async function openLayerSection(page, name) {
  const layers = page.getByRole('complementary', { name: 'Layers' })
  const handle = layers.getByRole('button', { name: /^Layers/ })
  if ((await handle.count()) > 0 && (await handle.isVisible())) {
    if ((await handle.getAttribute('aria-expanded')) !== 'true') await handle.click()
  }
  const button = layers.getByRole('heading', { level: 3 }).getByRole('button', { name })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  return layers.getByRole('region', { name })
}

export async function openDatasetUrl(page, url) {
  const open = page.getByTitle('Open dataset')
  if ((await open.getAttribute('aria-expanded')) !== 'true') await open.click()
  const dialog = page.getByRole('dialog', { name: 'Open dataset' })
  await dialog.getByLabel('Dataset or image URL').fill(url)
  await dialog.getByRole('button', { name: 'Load Dataset' }).click()
}
