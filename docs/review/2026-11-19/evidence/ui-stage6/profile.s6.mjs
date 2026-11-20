// Bounded profiling (R5). (a) scripts/profile-load.mjs, unchanged, on the
// 200,000 x 500 range-read H5AD; (b) cold versus warm loads of that file;
// (c) collection section switches (S6_SWITCHES, default 9) with requests,
// workers and memory.
// SwiftShader unless S6_GPU=1; profile-load.mjs always uses its own default.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  DATA,
  link,
  memory,
  routeExamples,
  trackRequests,
  trackWorkers,
  waitQuiet,
  writeOut,
} from './s6lib.mjs'

const REPO = new URL('../../../../../', import.meta.url).pathname

test('(a) profile-load.mjs on profile.h5ad', async () => {
  test.setTimeout(600_000)
  const output = execFileSync(
    'node',
    [
      'scripts/profile-load.mjs',
      'http://127.0.0.1:4273',
      `${DATA}profile.h5ad`,
      '--gene',
      'Gene10',
      '--runs',
      '3',
      '--requests',
      'profile.h5ad',
      '--json',
    ],
    { cwd: REPO, encoding: 'utf8', timeout: 580_000 },
  )
  writeOut('profile-load.jsonl', output)
  console.log(output.slice(0, 3000))
})

test('(b) cold and warm loads of profile.h5ad', async ({ browser }) => {
  test.setTimeout(300_000)
  const rows = []
  const load = async (context, label, reload) => {
    const page = reload ?? (await context.newPage())
    const requests = trackRequests(context, (url) => url.startsWith(DATA))
    const started = Date.now()
    if (reload === undefined) await page.goto(link('/', `${DATA}profile.h5ad`))
    else await page.reload()
    await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 240_000 })
    const readyMs = Date.now() - started
    await waitQuiet(page, requests, { quietMs: 2000 })
    const row = {
      label,
      readyMs,
      requests: requests.entries.length,
      MB: +(requests.entries.reduce((s, e) => s + e.bytes, 0) / 1e6).toFixed(1),
    }
    rows.push(row)
    console.log(JSON.stringify(row))
    return page
  }
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(first)
  const page = await load(first, 'cold (new context)')
  await page.waitForTimeout(1000)
  await load(first, 'warm (reload, same context)', page)
  await first.close()
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(second)
  await load(second, 'cold again (new context)')
  await second.close()
  writeOut('profile-cold-warm.json', rows)
})

test('(c) repeated collection switches', async ({ browser }) => {
  test.setTimeout(400_000)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(context)
  const page = await context.newPage()
  const workers = trackWorkers(page)
  const requests = trackRequests(context, (url) => url.startsWith(DATA))
  await page.goto(`/#collection=${encodeURIComponent(`${DATA}sections/collection.json`)}`)
  await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
  await waitQuiet(page, requests, { quietMs: 2000 })
  const rows = [
    { step: 'S1 loaded', alive: workers.alive.size, ...(await memory(browser, page)) },
  ]
  const switches = Number(process.env.S6_SWITCHES ?? 9)
  const order = Array.from({ length: switches }, (_, i) => ['S2', 'S3', 'S1'][i % 3])
  for (const [index, name] of order.entries()) {
    const before = requests.entries.length
    const started = Date.now()
    await page.getByRole('button', { name, exact: true }).click()
    await expect(
      page.getByRole('button', { name: new RegExp(`^${name}`) }).first(),
    ).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`${name.toLowerCase()}\\.h5ad|section=${name}|${name}`),
      {
        timeout: 60_000,
      },
    )
    await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
    const readyMs = Date.now() - started
    await waitQuiet(page, requests, { quietMs: 1500 })
    if (switches > 9 && (index + 1) % 5 !== 0) continue
    const row = {
      step: `switch ${index + 1} to ${name}`,
      readyMs,
      newRequests: requests.entries.length - before,
      alive: workers.alive.size,
      created: workers.created,
      ...(await memory(browser, page)),
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
  writeOut(
    `profile-collection-switches-${switches}${process.env.S6_GC === '1' ? '-gc' : ''}.json`,
    rows,
  )
  await context.close()
})
