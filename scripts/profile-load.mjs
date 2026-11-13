// Profiles the main thread while the built app loads a dataset, with a CDP
// CPU profile in headless Chromium (see docs/profiling.md).
//
//   node scripts/profile-load.mjs <app-url>[,<app-url>...] <dataset-url> [options]
//
// Several app URLs (for example a base and a branch build) are profiled in
// turn, once per run, so network and machine drift affect both alike.
//
//   --gene <symbol>     also profile colouring by this gene after the load
//   --until <selector>  CSS selector that marks the load as done (default:
//                       the enabled gene search box)
//   --runs <n>          runs per app URL (default 1)
//   --settle <seconds>  keep profiling this long after the load (default 3)
//   --requests <text>   summarise requests whose URL contains <text>
//   --raw <prefix>      write each raw profile to <prefix>-<run>-<app>-<phase>.cpuprofile
//   --json              print one JSON line per phase instead of text
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const GENE_SEARCH = 'input[placeholder="Search genes"]:not([disabled])'
const EXPRESSION_STATUS = /Expression (overview|all cells|sample|exact region): [\d,]+/
const TIMEOUT_MS = 600_000
const LONG_STRETCH_MS = 50

const { positional, options } = parseArgs(process.argv.slice(2))

if (positional.length < 2 || options.help !== undefined) {
  console.log(
    'Usage: node scripts/profile-load.mjs <app-url>[,<app-url>...] <dataset-url> ' +
      '[--gene S] [--until SELECTOR] [--runs N] [--settle S] [--requests TEXT] [--raw PREFIX] [--json]',
  )
  process.exit(positional.length < 2 ? 1 : 0)
}

const appUrls = positional[0].split(',')
const datasetUrl = positional[1]
const runs = Number(options.runs ?? 1)
const settleMs = Number(options.settle ?? 3) * 1000

for (let run = 1; run <= runs; run += 1) {
  for (const [appIndex, appUrl] of appUrls.entries()) {
    await profileRun(run, appIndex, appUrl)
  }
}

async function profileRun(run, appIndex, appUrl) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const cdp = await page.context().newCDPSession(page)
  const requests = trackRequests(page, options.requests)
  const report = (phase, seconds, profile, extra = {}) => {
    const summary = { app: appUrl, run, phase, seconds, ...summarise(profile), ...extra }

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
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
    const started = Date.now()
    await page.goto(
      `${appUrl.replace(/\/$/, '')}/#dataset=${encodeURIComponent(datasetUrl)}`,
    )
    await page
      .locator(options.until ?? GENE_SEARCH)
      .first()
      .waitFor({ timeout: TIMEOUT_MS })
    const loadSeconds = (Date.now() - started) / 1000
    await page.waitForTimeout(settleMs)
    report('load', loadSeconds, (await cdp.send('Profiler.stop')).profile, {
      ...(requests === null ? {} : { requests: requests.summary() }),
    })

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
      report(
        `gene ${options.gene}`,
        geneSeconds,
        (await cdp.send('Profiler.stop')).profile,
        {
          status,
        },
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

// Vite names chunks `<name>-<8-character hash>.js`.
function chunkName({ functionName, url }) {
  if (functionName === '(idle)' || (functionName.startsWith('(') && url === '')) {
    return functionName
  }

  if (url.startsWith('wasm://')) {
    return 'wasm'
  }

  return (url.split('/').pop() ?? '').replace(/-[\w-]{8}\.js$/, '') || '(native)'
}

function trackRequests(page, match) {
  if (match === undefined) {
    return null
  }

  const started = Date.now()
  const finished = []
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

  return {
    summary: () => ({
      count: finished.length,
      megabytes:
        Math.round(finished.reduce((sum, entry) => sum + entry.bytes, 0) / 1e5) / 10,
      slowest: [...finished].sort((left, right) => right.ms - left.ms).slice(0, 5),
    }),
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
    } else if (arg === '--json' || arg === '--help') {
      options[arg.slice(2)] = true
    } else {
      options[arg.slice(2)] = args[index + 1]
      index += 1
    }
  }

  return { positional, options }
}
