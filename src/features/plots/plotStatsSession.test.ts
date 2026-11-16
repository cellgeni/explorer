import { describe, expect, it } from 'vitest'
import type {
  PlotStatsWorkerRequest,
  PlotStatsWorkerResponse,
} from '../../workers/plotStatsMessages'
import { plotStatsHandler } from '../../workers/plotStatsCore'
import { createPlotStatsSession, type PlotStatsWorkerLike } from './plotStatsSession'

// A worker that runs the real handler, answering on a later task as a
// worker would; `fail` makes it error as a crashed worker does.
class FakePlotStatsWorker implements PlotStatsWorkerLike {
  onmessage: ((event: MessageEvent<PlotStatsWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly transfers: Transferable[][] = []
  terminated = false
  private readonly handle = plotStatsHandler((response) => {
    setTimeout(() => {
      this.onmessage?.({ data: response } as MessageEvent<PlotStatsWorkerResponse>)
    }, 0)
  })

  postMessage(message: PlotStatsWorkerRequest, transfer: Transferable[] = []): void {
    this.transfers.push(transfer)
    this.handle(structuredClone(message))
  }

  terminate(): void {
    this.terminated = true
  }

  fail(): void {
    this.onerror?.({ preventDefault: () => undefined } as ErrorEvent)
  }
}

function values(gene: string) {
  return { gene, rows: new Uint32Array([0, 2]), values: new Float32Array([1, 3]) }
}

describe('plot statistics session (plan 22-D6)', () => {
  it('runs groups and stats in the worker, transferring gene values', async () => {
    const worker = new FakePlotStatsWorker()
    const session = createPlotStatsSession(() => worker)
    session.setRows(['a', 'b', 'c'])

    const summary = await session.setGroups({
      classes: [['a', 'b', 'c']],
      selection: null,
    })
    session.addGene(values('Actb'))
    const result = await session.stats(['Actb', 'Gad1'])

    expect(summary.classSizes).toEqual([3])
    expect(result.missing).toEqual(['Gad1'])
    expect(result.stats[0]?.groups[0]).toMatchObject({ cells: 3, expressing: 2, sum: 4 })
    expect(worker.transfers.some((transfer) => transfer.length === 2)).toBe(true)
  })

  it('carries on this thread when the worker fails, asking for genes again', async () => {
    const worker = new FakePlotStatsWorker()
    const session = createPlotStatsSession(() => worker)
    session.setRows(['a', 'b', 'c'])
    await session.setGroups({ classes: [['a', 'b']], selection: ['c'] })
    session.addGene(values('Actb'))

    worker.fail()
    const result = await session.stats(['Actb'])

    expect(worker.terminated).toBe(true)
    expect(result.missing).toEqual(['Actb'])
    session.addGene(values('Actb'))
    const again = await session.stats(['Actb'])
    expect(again.stats[0]?.groups.map((group) => group.sum)).toEqual([3, 1])
  })

  it('runs on this thread without a Worker, and rejects after dispose', async () => {
    const session = createPlotStatsSession(null)
    session.setRows(['a'])
    await expect(
      session.setGroups({ classes: [['a']], selection: null }),
    ).resolves.toMatchObject({ classSizes: [1] })

    session.dispose()
    await expect(session.stats(['Actb'])).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects requests the store cannot answer', async () => {
    const session = createPlotStatsSession(() => new FakePlotStatsWorker())
    session.setRows(['a'])

    await expect(session.stats(['Actb'])).rejects.toThrow('Plot groups are not set.')
  })
})
