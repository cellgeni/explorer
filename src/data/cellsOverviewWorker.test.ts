import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asyncBufferFromBytes,
  rangeFetcher,
  xeniumCellsFixtureBytes,
} from '../test/xeniumCellsFixtures'
import { handleCellsOverviewRequest } from '../workers/cellsOverviewCore'
import type {
  CellsOverviewWorkerRequest,
  CellsOverviewWorkerResponse,
} from '../workers/cellsOverviewMessages'
import {
  readCellsOverviewInWorker,
  type CellsOverviewWorkerLike,
} from './cellsOverviewWorker'
import { isCellsParquetDecodeError, readCellsOverview } from './hyparquetCells'

const CELLS_URL = 'https://example.test/xenium/cells.parquet'

// Runs the real handler behind a structured-clone boundary, as a worker does.
class CloningCellsOverviewWorker implements CellsOverviewWorkerLike {
  onmessage: ((event: MessageEvent<CellsOverviewWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: CellsOverviewWorkerRequest[] = []
  terminated = false

  postMessage(message: CellsOverviewWorkerRequest): void {
    this.requests.push(message)
    void handleCellsOverviewRequest(structuredClone(message), (response, transfer) => {
      this.answer(structuredClone(response, { transfer }))
    })
  }

  answer(data: CellsOverviewWorkerResponse): void {
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.(new MessageEvent('message', { data }))
      }
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

// Answers only when told to.
class ManualCellsOverviewWorker extends CloningCellsOverviewWorker {
  override postMessage(message: CellsOverviewWorkerRequest): void {
    this.requests.push(message)
  }
}

describe('readCellsOverviewInWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the same cells as the main-thread reader, then ends the worker', async () => {
    const bytes = xeniumCellsFixtureBytes('cells.parquet')
    vi.stubGlobal('fetch', rangeFetcher(bytes))
    const worker = new CloningCellsOverviewWorker()

    const cells = await readCellsOverviewInWorker({
      url: CELLS_URL,
      workerFactory: () => worker,
    })

    expect(worker.requests).toEqual([{ url: CELLS_URL, includeCellIds: true }])
    expect(worker.terminated).toBe(true)
    // structuredClone under jsdom makes values of another realm, so the cells
    // are compared through JSON.
    expect(JSON.parse(JSON.stringify(cells))).toEqual(
      JSON.parse(
        JSON.stringify(await readCellsOverview({ file: asyncBufferFromBytes(bytes) })),
      ),
    )
  })

  it('sends the row limit and the cell ID choice', async () => {
    vi.stubGlobal('fetch', rangeFetcher(xeniumCellsFixtureBytes('cells.parquet')))
    const worker = new CloningCellsOverviewWorker()

    const cells = await readCellsOverviewInWorker({
      url: CELLS_URL,
      limit: 2,
      includeCellIds: false,
      workerFactory: () => worker,
    })

    expect(worker.requests).toEqual([{ url: CELLS_URL, includeCellIds: false, limit: 2 }])
    expect(cells).toHaveLength(2)
    expect(cells[0]).not.toHaveProperty('cellId')
  })

  it('reports optional columns the worker found missing', async () => {
    const worker = new ManualCellsOverviewWorker()
    const onFallback = vi.fn()
    const reading = readCellsOverviewInWorker({
      url: CELLS_URL,
      onFallback,
      workerFactory: () => worker,
    })

    worker.answer({
      ok: true,
      columns: {
        length: 0,
        cellIds: [],
        x: new Float64Array(0),
        y: new Float64Array(0),
        transcriptCounts: new Float64Array(0),
        cellAreas: null,
        nucleusCounts: null,
        segmentationMethodIndices: null,
        segmentationMethods: [],
        missingColumns: ['nucleus_count'],
      },
    })

    await expect(reading).resolves.toEqual([])
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        coalesceKey: 'cells-parquet-optional-column:nucleus_count',
      }),
    )
  })

  it('keeps the name of a decode error so the overview can fall back', async () => {
    const worker = new ManualCellsOverviewWorker()
    const reading = readCellsOverviewInWorker({
      url: CELLS_URL,
      workerFactory: () => worker,
    })

    worker.answer({
      ok: false,
      error: 'Unable to decode',
      errorName: 'ParquetDecodeError',
    })

    const error: unknown = await reading.catch((cause: unknown) => cause)
    expect(isCellsParquetDecodeError(error)).toBe(true)
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker on abort', async () => {
    const worker = new ManualCellsOverviewWorker()
    const controller = new AbortController()
    const reading = readCellsOverviewInWorker({
      url: CELLS_URL,
      signal: controller.signal,
      workerFactory: () => worker,
    })

    controller.abort()

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('does not post a request that is already aborted', async () => {
    const worker = new ManualCellsOverviewWorker()
    const controller = new AbortController()
    controller.abort()

    await expect(
      readCellsOverviewInWorker({
        url: CELLS_URL,
        signal: controller.signal,
        workerFactory: () => worker,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.requests).toEqual([])
    expect(worker.terminated).toBe(true)
  })

  it('rejects when the worker fails', async () => {
    const worker = new ManualCellsOverviewWorker()
    const reading = readCellsOverviewInWorker({
      url: CELLS_URL,
      workerFactory: () => worker,
    })

    worker.onerror?.(new ErrorEvent('error', { message: 'Worker crashed' }))

    await expect(reading).rejects.toThrow('Worker crashed')
    expect(worker.terminated).toBe(true)
  })

  it('reads on this thread with options a worker cannot take', async () => {
    const workerFactory = vi.fn(() => new CloningCellsOverviewWorker())

    const cells = await readCellsOverviewInWorker({
      url: CELLS_URL,
      fetcher: rangeFetcher(xeniumCellsFixtureBytes('cells.parquet')),
      byteRangeCache: null,
      workerFactory,
    })

    expect(cells).toHaveLength(10)
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('reads on this thread where there is no Worker', async () => {
    vi.stubGlobal('fetch', rangeFetcher(xeniumCellsFixtureBytes('cells_v1.parquet')))

    expect(typeof Worker).toBe('undefined')
    await expect(readCellsOverviewInWorker({ url: CELLS_URL })).resolves.toHaveLength(10)
  })
})
