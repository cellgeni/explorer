import { afterEach, describe, expect, it } from 'vitest'
import {
  LiveInstances,
  memoryTotals,
  readMemoryReports,
  registerMemoryReporter,
  sumReportedBytes,
  workerTally,
} from './memoryTelemetry'

// Since O20 each cache and worker pool reports what it holds, for the memory
// table in Data access notes.

const unregister: (() => void)[] = []

afterEach(() => {
  for (const stop of unregister.splice(0)) stop()
})

function reportsNamed(names: readonly string[]) {
  return readMemoryReports({ timeoutMs: 50 }).then((reports) =>
    reports.filter((report) => names.includes(report.name)),
  )
}

describe('memory telemetry (O20)', () => {
  it('reads each reporter, with bytes a worker reports later', async () => {
    unregister.push(
      registerMemoryReporter('test tiles', () => ({
        entries: 3,
        workers: 0,
        bytes: 3_000,
      })),
      registerMemoryReporter('test files', () => ({
        entries: 2,
        workers: 2,
        bytes: sumReportedBytes([Promise.resolve(100), Promise.resolve(null)]),
      })),
      registerMemoryReporter('test pool', () => ({
        entries: 0,
        workers: 4,
        bytes: null,
      })),
    )

    const reports = await reportsNamed(['test tiles', 'test files', 'test pool'])

    expect(reports).toEqual([
      { name: 'test tiles', entries: 3, workers: 0, bytes: 3_000 },
      { name: 'test files', entries: 2, workers: 2, bytes: 100 },
      { name: 'test pool', entries: 0, workers: 4, bytes: null },
    ])
    expect(memoryTotals(reports)).toEqual({ entries: 5, workers: 6, bytes: 3_100 })
  })

  it("leaves out a busy worker's bytes, and a reporter that throws", async () => {
    unregister.push(
      registerMemoryReporter('test busy', () => ({
        entries: 1,
        workers: 1,
        bytes: new Promise<number>(() => undefined),
      })),
      registerMemoryReporter('test broken', () => {
        throw new Error('gone')
      }),
    )

    await expect(reportsNamed(['test busy', 'test broken'])).resolves.toEqual([
      { name: 'test busy', entries: 1, workers: 1, bytes: null },
      { name: 'test broken', entries: 0, workers: 0, bytes: null },
    ])
  })

  it('replaces a reporter of the same name, and removes only its own', async () => {
    const first = registerMemoryReporter('test same', () => ({
      entries: 1,
      workers: 0,
      bytes: 1,
    }))
    unregister.push(
      registerMemoryReporter('test same', () => ({ entries: 2, workers: 0, bytes: 2 })),
    )
    first()

    await expect(reportsNamed(['test same'])).resolves.toEqual([
      { name: 'test same', entries: 2, workers: 0, bytes: 2 },
    ])
  })

  it('sums bytes only from the workers that answered', async () => {
    await expect(sumReportedBytes([])).resolves.toBeNull()
    await expect(
      sumReportedBytes([Promise.resolve(null), Promise.reject(new Error('ended'))]),
    ).resolves.toBeNull()
    await expect(
      sumReportedBytes([Promise.resolve(5), Promise.reject(new Error('ended'))]),
    ).resolves.toBe(5)
  })

  it('counts live instances until they are deleted', () => {
    const live = new LiveInstances<object>()
    const a = {}
    const b = {}

    live.add(a)
    live.add(a)
    live.add(b)
    expect([...live]).toEqual([a, b])

    live.delete(a)
    expect([...live]).toEqual([b])
  })

  it('counts the workers of a tally', async () => {
    const workers = workerTally('test tally')
    const worker = {}

    workers.add(worker)
    await expect(reportsNamed(['test tally'])).resolves.toEqual([
      { name: 'test tally', entries: 0, workers: 1, bytes: null },
    ])

    workers.delete(worker)
    await expect(reportsNamed(['test tally'])).resolves.toEqual([
      { name: 'test tally', entries: 0, workers: 0, bytes: null },
    ])
  })
})
