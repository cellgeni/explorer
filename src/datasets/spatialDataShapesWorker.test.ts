import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSpatialDataShapes, type SpatialDataShapes } from './spatialDataShapes'
import {
  spatialDataShapesWorkerReader,
  type SpatialDataShapesWorkerLike,
} from './spatialDataShapesWorker'
import { IDENTITY_AFFINE } from './spatialDataTransforms'
import { spatialDataShapesHandler } from '../workers/spatialDataShapesCore'
import type {
  SpatialDataShapesWorkerRequest,
  SpatialDataShapesWorkerResponse,
} from '../workers/spatialDataShapesMessages'
import {
  spatialDataShapesFixture,
  spatialDataShapesFixtureBytes,
} from '../test/spatialDataShapesFixtures'
import { asyncBufferFromBytes, rangeFetcher } from '../test/xeniumCellsFixtures'
import { merscopeFixtureBytes } from '../test/merscopeFixtures'

const URL = 'https://example.test/sample.zarr/shapes/cell_boundaries/shapes.parquet'
const AFFINE = { ...IDENTITY_AFFINE, a: 2, e: 2 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('spatialDataShapesWorkerReader', () => {
  it('reads a zipped file in the worker, slice by slice', async () => {
    const worker = new FakeWorker()
    const read = spatialDataShapesWorkerReader(() => worker)
    const file = spatialDataShapesFixture('cell_boundaries.parquet')

    const shapes = await read({ url: URL, file, affine: AFFINE })

    expect(columns(shapes)).toEqual(
      columns(await readSpatialDataShapes({ url: URL, file, affine: AFFINE })),
    )
    expect(worker.requests[0]).toMatchObject({
      type: 'read',
      source: { kind: 'slices', url: URL, byteLength: file.byteLength },
    })
    expect(worker.requests.filter((request) => request.type === 'slice').length).toBe(
      worker.sliceRequests,
    )
    expect(worker.terminated).toBe(true)
  })

  it('lets the worker fetch a plain URL', async () => {
    vi.stubGlobal(
      'fetch',
      rangeFetcher(spatialDataShapesFixtureBytes('cell_circles.parquet')),
    )
    const worker = new FakeWorker()

    const shapes = await spatialDataShapesWorkerReader(() => worker)({
      url: URL,
      affine: AFFINE,
    })

    expect(shapes.ids).toEqual(['7', '8', '9'])
    expect(worker.requests).toEqual([
      { type: 'read', source: { kind: 'url', url: URL }, affine: AFFINE },
    ])
  })

  it('passes a read layout to the worker, which fetches the file whole', async () => {
    vi.stubGlobal(
      'fetch',
      rangeFetcher(merscopeFixtureBytes('cell_boundaries.parquet.gz')),
    )
    const worker = new FakeWorker()
    const layout = { idColumn: 'EntityID', planeColumn: 'ZIndex', wholeFile: true }

    const shapes = await spatialDataShapesWorkerReader(() => worker)({
      ...layout,
      url: URL,
      affine: AFFINE,
    })

    expect(shapes.ids).toHaveLength(4)
    expect(shapes.plane).toBe(3)
    expect(worker.requests).toEqual([
      { type: 'read', source: { kind: 'url', url: URL }, affine: AFFINE, layout },
    ])
  })

  it('fetches through a custom fetcher on this thread', async () => {
    const fetcher = vi.fn(
      rangeFetcher(spatialDataShapesFixtureBytes('cell_circles.parquet')),
    )
    const worker = new FakeWorker()

    const shapes = await spatialDataShapesWorkerReader(() => worker)({
      url: URL,
      affine: AFFINE,
      fetcher,
    })

    expect(shapes.ids).toEqual(['7', '8', '9'])
    expect(worker.requests[0]).toMatchObject({ source: { kind: 'slices' } })
    expect(fetcher).toHaveBeenCalled()
  })

  it('reads on this thread when the worker fails to run', async () => {
    const worker = new FakeWorker({ fail: true })
    const file = spatialDataShapesFixture('cell_circles.parquet')

    const shapes = await spatialDataShapesWorkerReader(() => worker)({
      url: URL,
      file,
      affine: AFFINE,
    })

    expect(shapes.ids).toEqual(['7', '8', '9'])
    expect(worker.terminated).toBe(true)
  })

  it('rejects with the error the worker reports', async () => {
    const worker = new FakeWorker()

    await expect(
      spatialDataShapesWorkerReader(() => worker)({
        url: URL,
        file: asyncBufferFromBytes(new TextEncoder().encode('not parquet')),
        affine: AFFINE,
      }),
    ).rejects.toThrow()
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker on abort', async () => {
    const worker = new FakeWorker({ silent: true })
    const controller = new AbortController()
    const read = spatialDataShapesWorkerReader(() => worker)({
      url: URL,
      file: spatialDataShapesFixture('cell_circles.parquet'),
      affine: AFFINE,
      signal: controller.signal,
    })

    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('reads on this thread without a worker', async () => {
    const shapes = await spatialDataShapesWorkerReader(null)({
      url: URL,
      file: spatialDataShapesFixture('cell_circles.parquet'),
      affine: AFFINE,
    })

    expect(shapes.ids).toEqual(['7', '8', '9'])
  })
})

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements SpatialDataShapesWorkerLike {
  onmessage: ((event: MessageEvent<SpatialDataShapesWorkerResponse>) => void) | null =
    null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: SpatialDataShapesWorkerRequest[] = []
  sliceRequests = 0
  terminated = false
  private readonly handle = spatialDataShapesHandler((response, transfer) => {
    if (response.type === 'slice') {
      this.sliceRequests += 1
    }

    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({ data } as MessageEvent<SpatialDataShapesWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(
    message: SpatialDataShapesWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.requests.push(message)
    const clone = structuredClone(message, { transfer })
    // jsdom's clones come from another realm, which fails hyparquet's
    // `instanceof ArrayBuffer`; a browser worker gets its own realm's buffers.
    const data =
      clone.type === 'slice'
        ? { ...clone, bytes: new Uint8Array(clone.bytes).slice().buffer }
        : clone

    queueMicrotask(() => {
      if (this.options.fail === true) {
        this.onerror?.({ message: 'failed', preventDefault: () => {} } as ErrorEvent)
      } else if (this.options.silent !== true) {
        this.handle(data)
      }
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

// Plain arrays, since cloned typed arrays come from another realm in jsdom.
function columns(shapes: SpatialDataShapes) {
  return {
    ids: shapes.ids,
    kinds: Array.from(shapes.kinds),
    centroids: Array.from(shapes.centroids),
    radii: Array.from(shapes.radii),
    areas: Array.from(shapes.areas),
    bounds: Array.from(shapes.bounds),
    ringOffsets: Array.from(shapes.ringOffsets),
    coords: Array.from(shapes.coords),
  }
}
