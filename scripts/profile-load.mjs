// Profiles the main thread while the built app loads a dataset, with a CDP
// CPU profile in headless Chromium (see docs/profiling.md).
//
//   node scripts/profile-load.mjs <app-url>[,<app-url>...] <dataset-url> [options]
//
// Several app URLs (for example a base and a branch build) are profiled in
// turn, once per run, so network and machine drift affect both alike. A
// dataset URL of `none` profiles the start screen.
//
//   --gene <symbol>      also profile colouring by this gene after the load
//   --steps <keys>       then press these keys on the spatial view, one
//                        profile each, e.g. "=,=,=,ArrowRight" (= zooms in)
//   --step-settle <s>    profile each step this long (default 2)
//   --then <urls>        then open each of these datasets (comma-separated)
//                        in turn from the dataset field, one profile each
//   --hash <params>      add these to the link's hash, e.g. cellBounds=0
//   --until <selector>   CSS selector that marks the load as done (default:
//                        the enabled gene search box, or the dataset field
//                        for `none`)
//   --runs <n>           runs per app URL (default 1)
//   --settle <seconds>   keep profiling this long after the load (default 3)
//   --requests <text>    summarise requests whose URL contains <text>
//   --memory             report the JavaScript heaps of the page and of each
//                        worker after every phase
//   --gpu                draw with the GPU (Metal through ANGLE, macOS)
//                        rather than SwiftShader
//   --throttle <mbit,ms> limit bandwidth and add latency, e.g. 10,150
//   --raw <prefix>       write each raw profile to <prefix>-<run>-<app>-<phase>.cpuprofile
//   --json               print one JSON line per phase instead of text
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const GENE_SEARCH = 'input[placeholder="Search genes"]:not([disabled])'
const DATASET_FIELD = 'input[title="Dataset or image URL"]'
const OPEN_DATASET = '.shell-dataset-name'
const SPATIAL_VIEW = 'Spatial viewer canvas area'
// Ids for CDP messages sent to workers through the browser session.
const targetMessageIds = { next: 1 }
const EXPRESSION_STATUS = /Expression (overview|all cells|sample|exact region): [\d,]+/
const TIMEOUT_MS = 600_000
const LONG_STRETCH_MS = 50

const { positional, options } = parseArgs(process.argv.slice(2))

if (positional.length < 2 || options.help !== undefined) {
  console.log(
    'Usage: node scripts/profile-load.mjs <app-url>[,<app-url>...] <dataset-url> ' +
      '[--gene S] [--steps KEYS] [--step-settle S] [--then URLS] [--hash PARAMS] ' +
      '[--until SELECTOR] [--runs N] ' +
      '[--settle S] [--requests TEXT] [--memory] [--gpu] [--throttle MBIT,MS] ' +
      '[--raw PREFIX] [--json]',
  )
  process.exit(positional.length < 2 ? 1 : 0)
}

const appUrls = positional[0].split(',')
const datasetUrl = positional[1]
const runs = Number(options.runs ?? 1)
const settleMs = Number(options.settle ?? 3) * 1000
const stepSettleMs = Number(options['step-settle'] ?? 2) * 1000
const steps = options.steps === undefined ? [] : options.steps.split(',')
const thenDatasets = options.then === undefined ? [] : options.then.split(',')
const extraHash =
  options.hash === undefined ? '' : `&${options.hash.replace(/^[#&]/, '')}`
const throttle = parseThrottle(options.throttle)

for (let run = 1; run <= runs; run += 1) {
  for (const [appIndex, appUrl] of appUrls.entries()) {
    await profileRun(run, appIndex, appUrl)
  }
}

async function profileRun(run, appIndex, appUrl) {
  const browser = await chromium.launch(
    options.gpu === true
      ? { channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal'] }
      : {},
  )
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const cdp = await page.context().newCDPSession(page)
  const browserCdp = options.memory === true ? await browser.newBrowserCDPSession() : null
  const requests = trackRequests(page, options.requests)
  const report = async (phase, seconds, profile, extra = {}) => {
    const summary = {
      app: appUrl,
      run,
      phase,
      seconds,
      ...summarise(profile),
      ...extra,
      ...(requests === null ? {} : { requests: requests.summary() }),
      ...(browserCdp === null ? {} : { memory: await measureMemory(cdp, browserCdp) }),
    }

    if (options.raw !== undefined) {
      writeFileSync(
        `${options.raw}-${run}-${appIndex + 1}-${phase}.cpuprofile`,
        JSON.stringify(profile),
      )
    }

    console.log(
      options.json === undefined ? formatSummary(summary) : JSON.stringify(summary),
    )
  }

  try {
    if (throttle !== null) {
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', throttle)
    }

    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
    const started = Date.now()
    const app = appUrl.replace(/\/$/, '')
    await page.goto(
      datasetUrl === 'none'
        ? `${app}/`
        : `${app}/#dataset=${encodeURIComponent(datasetUrl)}${extraHash}`,
    )
    await page
      .locator(options.until ?? (datasetUrl === 'none' ? DATASET_FIELD : GENE_SEARCH))
      .first()
      .waitFor({ timeout: TIMEOUT_MS })
    const loadSeconds = (Date.now() - started) / 1000
    await page.waitForTimeout(settleMs)
    await report('load', loadSeconds, (await cdp.send('Profiler.stop')).profile)

    if (options.gene !== undefined) {
      await cdp.send('Profiler.start')
      const geneStarted = Date.now()
      await page.locator(GENE_SEARCH).fill(options.gene)
      await page.getByRole('button', { name: options.gene, exact: true }).first().click()
      await page.waitForFunction(
        (source) =>
          new RegExp(source).test(
            document.querySelector('.analysis-status')?.textContent ?? '',
          ),
        EXPRESSION_STATUS.source,
        { timeout: TIMEOUT_MS, polling: 100 },
      )
      const geneSeconds = (Date.now() - geneStarted) / 1000
      const status = await page.locator('.analysis-status').textContent()
      await report(
        `gene ${options.gene}`,
        geneSeconds,
        (await cdp.send('Profiler.stop')).profile,
        {
          status,
        },
      )
    }

    // Each step is a key pressed on the focused spatial view (deck.gl's
    // keyboard controls: = and - zoom, the arrow keys pan), profiled for
    // --step-settle seconds so that the reads and redraws it starts are in it.
    if (steps.length > 0) {
      await page.getByRole('img', { name: SPATIAL_VIEW }).focus()
    }

    for (const [index, key] of steps.entries()) {
      await cdp.send('Profiler.start')
      const stepStarted = Date.now()
      await page.keyboard.press(key)
      await page.waitForTimeout(stepSettleMs)
      const status = await page
        .locator('.analysis-status')
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => null)
      await report(
        `step ${index + 1} ${key}`,
        (Date.now() - stepStarted) / 1000,
        (await cdp.send('Profiler.stop')).profile,
        status === null ? {} : { status },
      )
    }

    // Each further dataset is opened as a user would, from the dataset
    // field, so the viewer keeps or disposes the ones before as it does.
    for (const [index, url] of thenDatasets.entries()) {
      await cdp.send('Profiler.start')
      const thenStarted = Date.now()
      const field = page.locator(DATASET_FIELD).first()

      if (!(await field.isVisible())) {
        await page.locator(OPEN_DATASET).first().click()
      }

      await field.fill(url)
      await field.press('Enter')
      await page.waitForFunction(
        (expected) => decodeURIComponent(location.hash).includes(`dataset=${expected}`),
        url,
        { timeout: TIMEOUT_MS },
      )
      await page
        .locator(options.until ?? GENE_SEARCH)
        .first()
        .waitFor({ timeout: TIMEOUT_MS })
      const thenSeconds = (Date.now() - thenStarted) / 1000
      await page.waitForTimeout(settleMs)
      await report(
        `then ${index + 1} ${url}`,
        thenSeconds,
        (await cdp.send('Profiler.stop')).profile,
      )
    }
  } finally {
    await browser.close()
  }
}

// Main-thread time by script (the built chunk's name without its hash),
// the hottest functions, and the longest busy stretches.
function summarise(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const byChunk = new Map()
  const byFunction = new Map()
  const stretches = []
  let stretch = null

  profile.samples.forEach((id, index) => {
    const node = nodes.get(id)
    const ms = (profile.timeDeltas[index + 1] ?? 0) / 1000
    const chunk = chunkName(node.callFrame)

    if (chunk === '(idle)') {
      if (stretch !== null) {
        stretches.push(stretch)
      }

      stretch = null
      return
    }

    add(byChunk, chunk, ms)
    stretch ??= { ms: 0, chunks: new Map() }
    stretch.ms += ms
    add(stretch.chunks, chunk, ms)

    if (!chunk.startsWith('(')) {
      const { functionName, lineNumber } = node.callFrame
      const key = `${functionName || '(anonymous)'} ${chunk}:${lineNumber + 1}`
      const entry = byFunction.get(key) ?? { ms: 0, lines: new Map() }
      entry.ms += ms

      for (const tick of node.positionTicks ?? []) {
        add(entry.lines, tick.line, tick.ticks)
      }

      byFunction.set(key, entry)
    }
  })

  if (stretch !== null) {
    stretches.push(stretch)
  }

  return {
    chunks: top(byChunk, 12),
    functions: Array.from(byFunction, ([name, entry]) => ({
      name,
      ms: Math.round(entry.ms),
      hottestLine: top(entry.lines, 1)[0]?.[0],
    }))
      .sort((left, right) => right.ms - left.ms)
      .slice(0, 12),
    longStretches: stretches
      .filter((entry) => entry.ms >= LONG_STRETCH_MS)
      .sort((left, right) => right.ms - left.ms)
      .slice(0, 8)
      .map((entry) => ({ ms: Math.round(entry.ms), chunks: top(entry.chunks, 4) })),
  }
}

// Vite names chunks `<name>-<8-character hash>.js`, and WASM assets (whose
// functions a streamed compile attributes to the asset URL) likewise.
function chunkName({ functionName, url }) {
  if (functionName === '(idle)' || (functionName.startsWith('(') && url === '')) {
    return functionName
  }

  if (url.startsWith('wasm://')) {
    return 'wasm'
  }

  return (url.split('/').pop() ?? '').replace(/-[\w-]{8}\.(js|wasm)$/, '') || '(native)'
}

function trackRequests(page, match) {
  if (match === undefined) {
    return null
  }

  const started = Date.now()
  let finished = []
  page.on('requestfinished', async (request) => {
    if (!request.url().includes(match)) {
      return
    }

    const sizes = await request.sizes().catch(() => null)
    finished.push({
      endSeconds: (Date.now() - started) / 1000,
      ms: Math.round(request.timing().responseEnd),
      bytes: sizes?.responseBodySize ?? 0,
      range: request.headers().range ?? request.method(),
    })
  })

  // Each summary covers the requests that finished since the one before.
  return {
    summary: () => {
      const phase = finished
      finished = []

      return {
        count: phase.length,
        megabytes:
          Math.round(phase.reduce((sum, entry) => sum + entry.bytes, 0) / 1e5) / 10,
        slowest: [...phase].sort((left, right) => right.ms - left.ms).slice(0, 5),
      }
    },
  }
}

// The page's JavaScript heap, and each worker's, from CDP's
// Runtime.getHeapUsage: `usedSize` is the JavaScript heap and
// `backingStorageSize` the memory behind its ArrayBuffers, which includes
// WebAssembly memory. Playwright gives no CDP session for a worker, so the
// browser session attaches to each one in turn.
async function measureMemory(pageCdp, browserCdp) {
  const megabytes = (bytes) => Math.round(bytes / 1e5) / 10
  const usage = (heap) => ({
    heap: megabytes(heap.usedSize),
    buffers: megabytes(heap.backingStorageSize ?? 0),
  })
  const page = usage(await pageCdp.send('Runtime.getHeapUsage'))
  const { targetInfos } = await browserCdp.send('Target.getTargets')
  const workers = []
  let gone = 0

  for (const target of targetInfos.filter((info) => info.type === 'worker')) {
    // A worker that ends before it is read is counted as gone.
    const heap = await targetHeapUsage(browserCdp, target.targetId).catch(() => null)

    if (heap === null) {
      gone += 1
    } else {
      workers.push({ name: workerName(target.url), ...usage(heap) })
    }
  }

  return { page, workers, gone }
}

async function targetHeapUsage(browserCdp, targetId) {
  const { sessionId } = await browserCdp.send('Target.attachToTarget', {
    targetId,
    flatten: false,
  })
  const id = targetMessageIds.next
  targetMessageIds.next += 1

  try {
    const reply = new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.message)

        if (event.sessionId === sessionId && message.id === id) {
          browserCdp.off('Target.receivedMessageFromTarget', onMessage)

          if (message.error === undefined) {
            resolve(message.result)
          } else {
            reject(new Error(message.error.message))
          }
        }
      }

      browserCdp.on('Target.receivedMessageFromTarget', onMessage)
    })
    await browserCdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }),
    })

    return await reply
  } finally {
    await browserCdp.send('Target.detachFromTarget', { sessionId }).catch(() => {})
  }
}

// A built worker's file name without its hash, or the start of a blob URL.
function workerName(url) {
  return url.startsWith('blob:')
    ? 'blob'
    : (url.split('/').pop() ?? '').replace(/-[\w-]{8}\.js$/, '') || url
}

function parseThrottle(value) {
  if (value === undefined) {
    return null
  }

  const [mbit, latency] = value.split(',').map(Number)

  if (!Number.isFinite(mbit) || mbit <= 0 || !Number.isFinite(latency ?? 0)) {
    throw new Error(`--throttle takes <megabits per second>,<latency ms>, not ${value}`)
  }

  const bytesPerSecond = (mbit * 1e6) / 8

  return {
    offline: false,
    latency: latency ?? 0,
    downloadThroughput: bytesPerSecond,
    uploadThroughput: bytesPerSecond,
  }
}

function formatSummary(summary) {
  const pairs = (entries) => entries.map(([name, ms]) => `${name} ${ms} ms`).join(', ')
  const lines = [
    `${summary.app} run ${summary.run}, ${summary.phase}: ${summary.seconds.toFixed(1)} s`,
    `  main thread by script: ${pairs(summary.chunks)}`,
    `  hottest functions: ${summary.functions
      .map(
        (entry) =>
          `${entry.name}${entry.hottestLine === undefined ? '' : ` (line ${entry.hottestLine})`} ${entry.ms} ms`,
      )
      .join(', ')}`,
    `  busy stretches over ${LONG_STRETCH_MS} ms: ${summary.longStretches
      .map((entry) => `${entry.ms} ms [${pairs(entry.chunks)}]`)
      .join('; ')}`,
  ]

  if (summary.status !== undefined) {
    lines.push(`  status: ${summary.status}`)
  }

  if (summary.requests !== undefined) {
    const { count, megabytes, slowest } = summary.requests
    lines.push(
      `  requests: ${count}, ${megabytes} MB; slowest: ${slowest
        .map(
          (entry) =>
            `${entry.ms} ms ${entry.range} (done at ${entry.endSeconds.toFixed(1)} s)`,
        )
        .join('; ')}`,
    )
  }

  if (summary.memory !== undefined) {
    const { page, workers, gone } = summary.memory
    const total = workers.reduce(
      (sum, worker) => sum + worker.heap + worker.buffers,
      page.heap + page.buffers,
    )
    lines.push(
      `  memory: ${Math.round(total)} MB; page heap ${page.heap} MB, buffers ${page.buffers} MB; ` +
        `${workers.length} workers: ${workers
          .map((worker) => `${worker.name} ${worker.heap}+${worker.buffers} MB`)
          .join(', ')}${gone > 0 ? `; ${gone} ended before they were read` : ''}`,
    )
  }

  return lines.join('\n')
}

function add(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value)
}

function top(map, count) {
  return Array.from(map, ([key, value]) => [key, Math.round(value)])
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
}

function parseArgs(args) {
  const positional = []
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (!arg.startsWith('--')) {
      positional.push(arg)
    } else if (['--json', '--help', '--memory', '--gpu'].includes(arg)) {
      options[arg.slice(2)] = true
    } else {
      options[arg.slice(2)] = args[index + 1]
      index += 1
    }
  }

  return { positional, options }
}
