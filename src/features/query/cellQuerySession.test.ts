import { describe, expect, it } from 'vitest'
import type {
  CellQueryWorkerRequest,
  CellQueryWorkerResponse,
} from '../../workers/cellQueryMessages'
import { cellQueryHandler } from '../../workers/cellQueryCore'
import { createCellQuerySession, type CellQueryWorkerLike } from './cellQuerySession'

// A worker that runs the real handler, answering on a later task as a
// worker would; `fail` makes it error as a crashed worker does.
class FakeCellQueryWorker implements CellQueryWorkerLike {
  onmessage: ((event: MessageEvent<CellQueryWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly responseTransfers: Transferable[][] = []
  terminated = false
  private readonly handle = cellQueryHandler((response, transfer = []) => {
    this.responseTransfers.push(transfer)
    setTimeout(() => {
      this.onmessage?.({ data: response } as MessageEvent<CellQueryWorkerResponse>)
    }, 0)
  })

  postMessage(message: CellQueryWorkerRequest): void {
    this.handle(structuredClone(message))
  }

  terminate(): void {
    this.terminated = true
  }

  fail(): void {
    this.onerror?.({ preventDefault: () => undefined } as ErrorEvent)
  }
}

const CONDITION = {
  kind: 'category',
  columnId: 'set:x',
  operator: 'in',
  classIds: ['x:1'],
} as const

describe('cell query session (plan 23-D4)', () => {
  it('sets columns, runs and reads values in the worker, transferring the rows', async () => {
    const worker = new FakeCellQueryWorker()
    const session = createCellQuerySession(() => worker)
    session.setRows(['a', 'b', 'c'])

    const summary = await session.setColumn({
      type: 'category-column',
      columnId: 'set:x',
      classes: [{ id: 'x:1', label: 'One', cellIds: ['a', 'c', 'gone'] }],
    })
    await session.setColumn({
      type: 'number-column',
      columnId: 'cell:area',
      values: new Float64Array([3, 2, 1]),
    })
    const result = await session.run([CONDITION], {
      columnId: 'cell:area',
      direction: 'ascending',
    })
    const values = await session.values(result.rows, ['cell:area', 'set:x'])

    expect(summary).toEqual({ unmatchedIds: 1 })
    expect(Array.from(result.rows)).toEqual([2, 0])
    expect(values).toEqual({
      'cell:area': { kind: 'number', values: new Float64Array([1, 3]) },
      'set:x': { kind: 'category', labels: ['One', 'One'] },
    })
    expect(worker.responseTransfers.some((transfer) => transfer.length === 1)).toBe(true)
  })

  it('carries on this thread with the same columns when the worker fails', async () => {
    const worker = new FakeCellQueryWorker()
    const session = createCellQuerySession(() => worker)
    session.setRows(['a', 'b', 'c'])
    await session.setColumn({
      type: 'category-column',
      columnId: 'set:x',
      classes: [{ id: 'x:1', label: 'One', cellIds: ['b'] }],
    })

    worker.fail()
    const result = await session.run([CONDITION], null)

    expect(worker.terminated).toBe(true)
    expect(Array.from(result.rows)).toEqual([1])
  })

  it('runs on this thread without a Worker, and rejects after dispose', async () => {
    const session = createCellQuerySession(null)
    session.setRows(['a', 'b'])
    await expect(
      session.setColumn({
        type: 'number-column',
        columnId: 'cell:area',
        values: new Float64Array([1]),
      }),
    ).rejects.toThrow(/1 values for 2 cells/)

    session.dispose()
    await expect(session.run([], null)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('forgets a deleted column', async () => {
    const session = createCellQuerySession(() => new FakeCellQueryWorker())
    session.setRows(['a'])
    await session.setColumn({
      type: 'category-column-by-row',
      columnId: 'cell:segmentation',
      codes: new Int32Array([0]),
      labels: ['Interior'],
    })
    session.deleteColumn('cell:segmentation')

    const result = await session.run(
      [
        {
          kind: 'category',
          columnId: 'cell:segmentation',
          operator: 'in',
          classIds: ['Interior'],
        },
      ],
      null,
    )
    expect(result.missingColumnIds).toEqual(['cell:segmentation'])
  })
})
