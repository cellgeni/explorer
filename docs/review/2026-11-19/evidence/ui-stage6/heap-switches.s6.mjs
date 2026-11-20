// What the page keeps per collection switch: heap snapshots (after garbage
// collection) at S1 after 9 and after 27 switches, on the unminified build
// served at 4276/sub/ (run with S6_DIST_REL pointing at that build). The
// snapshots go to S6_SNAPSHOTS; heap-diff.mjs compares them.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { DATA, routeExamples, trackRequests, waitQuiet } from './s6lib.mjs'

async function snapshot(page, file) {
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.enable')
  await session.send('HeapProfiler.collectGarbage')
  const chunks = []
  session.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(chunk))
  await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  await session.detach()
  writeFileSync(file, chunks.join(''))
}

test('heap snapshots across collection switches', async ({ browser }) => {
  test.setTimeout(600_000)
  const out = process.env.S6_SNAPSHOTS
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeExamples(context)
  const page = await context.newPage()
  const requests = trackRequests(context, (url) => url.startsWith(DATA))
  await page.goto(
    `http://127.0.0.1:4276/sub/#collection=${encodeURIComponent(`${DATA}sections/collection.json`)}`,
  )
  await expect(page.getByPlaceholder('Search genes')).toBeEnabled({ timeout: 120_000 })
  const cycle = async (times) => {
    for (let i = 0; i < times; i += 1) {
      for (const name of ['S2', 'S3', 'S1']) {
        await page.getByRole('button', { name, exact: true }).click()
        await expect(page.getByPlaceholder('Search genes')).toBeEnabled({
          timeout: 120_000,
        })
        await waitQuiet(page, requests, { quietMs: 800 })
      }
    }
  }
  await cycle(3)
  await page.waitForTimeout(1000)
  await snapshot(page, `${out}/after-9.heapsnapshot`)
  await cycle(6)
  await page.waitForTimeout(1000)
  await snapshot(page, `${out}/after-27.heapsnapshot`)
  await context.close()
})
