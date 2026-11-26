import { describe, expect, it, vi } from 'vitest'
import type { VisiumHdSegmentationIndex } from './visiumHdSegmentationIndex'
import { VisiumHdSegmentationGeojsonBudgetExceededError } from './visiumHdSegmentations'
import {
  visiumHdSegmentationIndexReader,
  type VisiumHdSegmentationIndexWorkerLike,
} from './visiumHdSegmentationIndexWorker'
import { visiumHdSegmentationIndexHandler } from '../workers/visiumHdSegmentationIndexCore'
import type {
  VisiumHdSegmentationIndexWorkerRequest,
  VisiumHdSegmentationIndexWorkerResponse,
} from '../workers/visiumHdSegmentationIndexMessages'

const BASE_URL = 'https://example.test/visium/'
const URL = 'https://example.test/visium/segmented_outputs/cell_segmentations.geojson'
const OPTIONS = {
  path: 'segmented_outputs/cell_segmentations.geojson',
  scalefactors: { micronsPerPixel: 0.5 },
  kind: 'cell' as const,
}
const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [1, 2, 3].map((cellId) => ({
    type: 'Feature',
    properties: { cell_id: cellId },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [cellId * 100, 0],
          [cellId * 100 + 4, 0],
          [cellId * 100 + 4, 4],
          [cellId * 100, 0],
        ],
      ],
    },
  })),
})
const IDS = ['cellid_000000001-1', 'cellid_000000002-1', 'cellid_000000003-1']
const PARSER_OPTIONS = { kind: OPTIONS.kind, scalefactors: OPTIONS.scalefactors }

describe('visiumHdSegmentationIndexReader', () => {
  it('sends the body to the worker chunk by chunk', async () => {
    const worker = new FakeWorker()
    const fetcher = geojsonFetcher(GEOJSON, 64)

    const index = await visiumHdSegmentationIndexReader(() => worker)(BASE_URL, {
      ...OPTIONS,
      fetcher,
    })

    expect(columns(index)).toEqual(
      columns(
        await visiumHdSegmentationIndexReader(null)(BASE_URL, { ...OPTIONS, fetcher }),
      ),
    )
    expect(index.ids).toEqual(IDS)
    expect(worker.requests[0]).toEqual({ type: 'start', options: PARSER_OPTIONS })
    expect(worker.requests.filter((request) => request.type === 'chunk')).toHaveLength(
      Math.ceil(GEOJSON.length / 64),
    )
    expect(worker.requests.at(-1)).toEqual({ type: 'end' })
    expect(fetcher).toHaveBeenCalledWith(URL, {})
    expect(worker.terminated).toBe(true)
  })

  it('parses on this thread without a worker', async () => {
    const index = await visiumHdSegmentationIndexReader(null)(BASE_URL, {
      ...OPTIONS,
      fetcher: geojsonFetcher(GEOJSON, 10),
    })

    expect(index.ids).toEqual(IDS)
  })

  it('reads on this thread when the worker fails to run', async () => {
    const worker = new FakeWorker({ fail: true })
    const fetcher = geojsonFetcher(GEOJSON, 64)

    const index = await visiumHdSegmentationIndexReader(() => worker)(BASE_URL, {
      ...OPTIONS,
      fetcher,
    })

    expect(index.ids).toEqual(IDS)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(worker.terminated).toBe(true)
  })

  it('rejects with the error the worker reports and stops the download', async () => {
    const worker = new FakeWorker()
    const cancel = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"type":"FeatureCollection",'))
              controller.enqueue(new TextEncoder().encode('"features":[42'))
            },
            cancel,
          }),
        ),
    ) as unknown as typeof fetch

    await expect(
      visiumHdSegmentationIndexReader(() => worker)(BASE_URL, { ...OPTIONS, fetcher }),
    ).rejects.toThrow('feature 0 to be an object')
    expect(cancel).toHaveBeenCalled()
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker and cancels the body on abort', async () => {
    const worker = new FakeWorker({ silent: true })
    const cancel = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"type":"Feature'))
            },
            cancel,
          }),
        ),
    ) as unknown as typeof fetch
    const controller = new AbortController()
    const read = visiumHdSegmentationIndexReader(() => worker)(BASE_URL, {
      ...OPTIONS,
      fetcher,
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(worker.requests.length).toBeGreaterThan(1))
    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalled()
    expect(worker.terminated).toBe(true)
  })

  it('reports HTTP errors without starting a worker', async () => {
    const workerFactory = vi.fn(() => new FakeWorker())
    const fetcher = vi.fn(
      async () => new Response('missing', { status: 404 }),
    ) as unknown as typeof fetch

    await expect(
      visiumHdSegmentationIndexReader(workerFactory)(BASE_URL, { ...OPTIONS, fetcher }),
    ).rejects.toThrow(`Unable to read Visium HD segmentation GeoJSON at ${URL}: HTTP 404`)
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('enforces the full-file byte budget before reading', async () => {
    const workerFactory = vi.fn(() => new FakeWorker())
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 200, headers: { 'content-length': '2048' } }),
    ) as unknown as typeof fetch

    await expect(
      visiumHdSegmentationIndexReader(workerFactory)(BASE_URL, {
        ...OPTIONS,
        maxFullFileBytes: 1024,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(VisiumHdSegmentationGeojsonBudgetExceededError)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(URL, { method: 'HEAD' })
    expect(workerFactory).not.toHaveBeenCalled()
  })
})

// Serves `text` in chunks of `chunkBytes`, each in a buffer of its own.
function geojsonFetcher(text: string, chunkBytes: number) {
  const bytes = new TextEncoder().encode(text)

  return vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
              controller.enqueue(bytes.slice(offset, offset + chunkBytes))
            }

            controller.close()
          },
        }),
      ),
  ) as unknown as typeof fetch
}

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements VisiumHdSegmentationIndexWorkerLike {
  onmessage:
    ((event: MessageEvent<VisiumHdSegmentationIndexWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: VisiumHdSegmentationIndexWorkerRequest[] = []
  terminated = false
  private readonly handle = visiumHdSegmentationIndexHandler((response, transfer) => {
    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({
          data,
        } as MessageEvent<VisiumHdSegmentationIndexWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(
    message: VisiumHdSegmentationIndexWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.requests.push(message)
    const data = structuredClone(message, { transfer })

    queueMicrotask(() => {
      if (this.terminated) {
        return
      }

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
function columns(index: VisiumHdSegmentationIndex) {
  return {
    ids: index.ids,
    bounds: Array.from(index.bounds),
    polygonRingOffsets: Array.from(index.polygonRingOffsets),
    ringOffsets: Array.from(index.ringOffsets),
    coords: Array.from(index.coords),
    metadataIndexes: Array.from(index.metadataIndexes),
    metadata: index.metadata,
  }
}
