import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { visiumHdTablesHandler } from '../workers/visiumHdTablesCore'
import type {
  VisiumHdTablesWorkerRequest,
  VisiumHdTablesWorkerResponse,
} from '../workers/visiumHdTablesMessages'
import { readVisiumHdBarcodeMappings } from './visiumHdBarcodeMappings'
import { readVisiumHdTissuePositions } from './visiumHdOverview'
import {
  visiumHdTablesWorkerReaders,
  type VisiumHdTablesWorkerLike,
} from './visiumHdTablesWorker'
import type { VisiumHdBinDescriptor } from './visiumHdDataset'

// Since O16 a tier's tissue positions, the bins' barcode mappings and the 2 µm
// filtered barcodes are read in a worker, which fetches with its own fetch.
// Here the worker's handler runs across a structured clone, as a real worker
// would, against the fixtures in src/test/fixtures/visium-hd/.

const BASE_URL = 'https://example.test/visium'
const POSITIONS_URL = `${BASE_URL}/binned_outputs/square_016um/spatial/tissue_positions.parquet`
const BIN2: VisiumHdBinDescriptor = {
  binSizeMicrometers: 2,
  outputPath: 'binned_outputs/square_002um',
  tissuePositionsPath: 'binned_outputs/square_002um/spatial/tissue_positions.parquet',
  scalefactorsPath: 'binned_outputs/square_002um/spatial/scalefactors_json.json',
  filteredMatrixH5Path: 'binned_outputs/square_002um/filtered_feature_bc_matrix.h5',
}
const BARCODES = [
  's_002um_00000_00000-1',
  's_002um_00000_00001-1',
  's_002um_00004_00007-1',
]

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), 'src/test/fixtures/visium-hd', name)))
const FILES: Record<string, Uint8Array> = {
  '/visium/binned_outputs/square_016um/spatial/tissue_positions.parquet': fixture(
    'tissue_positions.parquet',
  ),
  '/visium/barcode_mappings.parquet': fixture('barcode_mappings.parquet'),
  '/visium/binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz':
    new TextEncoder().encode(`${BARCODES.join('\n')}\n`),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// Serves the files with HEAD and Range.
function fixtureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const bytes = FILES[new URL(request.url).pathname]

    if (bytes === undefined) {
      return new Response(null, { status: 404 })
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') ?? '')

    if (match === null) {
      return new Response(bytes.slice())
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }) as typeof fetch
}

describe('visiumHdTablesWorkerReaders (O16)', () => {
  it('reads tissue positions in the worker and transfers their arrays', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const worker = new FakeWorker()

    const positions = await visiumHdTablesWorkerReaders(() => worker).tissuePositions({
      url: POSITIONS_URL,
    })
    const expected = await readVisiumHdTissuePositions({
      url: POSITIONS_URL,
      fetcher: fixtureFetch(),
      byteRangeCache: null,
    })

    expect(worker.requests).toEqual([{ type: 'positions', url: POSITIONS_URL }])
    // jsdom's structuredClone makes typed arrays of another realm.
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      expect(Array.from(positions[key] as ArrayLike<unknown>)).toEqual(
        Array.from(expected[key] as ArrayLike<unknown>),
      )
    }
    // 30 bins in 3 row groups; the last column is out of tissue.
    expect(positions.ids).toHaveLength(30)
    expect(positions.ids[29]).toBe('s_016um_00005_00004-1')
    expect(Array.from(positions.inTissue.slice(0, 5))).toEqual([1, 1, 1, 1, 0])
    expect(positions.arrayRows[29]).toBe(5)
    expect(positions.fullresCols[29]).toBe(200.25 + 4 * 64.5 - 5 * 0.25)
    expect(worker.transferred).toHaveLength(5)
    expect(worker.terminated).toBe(true)
  })

  it("reads the bins' barcode mappings in the worker, with the footer read here", async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const worker = new FakeWorker()
    const bins = { binSizeMicrometers: 16 as const, binIds: ['s_016um_00002_00003-1'] }

    const mappings = await readVisiumHdBarcodeMappings(BASE_URL, {
      bins,
      readRangesInWorker: visiumHdTablesWorkerReaders(() => worker).barcodeMappingRanges,
    })
    const expected = await readVisiumHdBarcodeMappings(BASE_URL, {
      bins,
      fetcher: fixtureFetch(),
      byteRangeCache: null,
    })

    expect(mappings).toHaveLength(64)
    expect(mappings).toEqual(expected)
    expect(worker.requests).toEqual([
      {
        type: 'mapping-ranges',
        request: expect.objectContaining({
          url: `${BASE_URL}/barcode_mappings.parquet`,
          column: 'square_016um',
          binIds: bins.binIds,
          ranges: [{ rowStart: 16 * 40, rowEnd: 24 * 40 }],
        }),
      },
    ])
  })

  it('reads the 2 µm filtered barcodes in the worker', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const worker = new FakeWorker()

    const barcodes = await visiumHdTablesWorkerReaders(
      () => worker,
    ).filteredMatrixBarcodes(BASE_URL, BIN2, { maxBarcodeCount: 10 })

    expect(worker.requests).toEqual([
      { type: 'filtered-barcodes', baseUrl: BASE_URL, bin: BIN2, maxBarcodeCount: 10 },
    ])
    expect(barcodes.ids).toEqual(BARCODES)
    expect(Array.from(barcodes.rows)).toEqual([0, 0, 4])
    expect(Array.from(barcodes.cols)).toEqual([0, 1, 7])
    expect(worker.transferred).toHaveLength(2)
  })

  it('rejects with the error the worker reports, keeping its name', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const worker = new FakeWorker()

    await expect(
      visiumHdTablesWorkerReaders(() => worker).filteredMatrixBarcodes(BASE_URL, BIN2, {
        maxBarcodeCount: 2,
      }),
    ).rejects.toMatchObject({ name: 'VisiumHdFilteredBarcodeBudgetExceededError' })
    expect(worker.terminated).toBe(true)
  })

  it('reads on this thread with a custom fetcher or byte-range cache', async () => {
    const worker = new FakeWorker()
    const readers = visiumHdTablesWorkerReaders(() => worker)

    await expect(
      readers.tissuePositions({ url: POSITIONS_URL, fetcher: fixtureFetch() }),
    ).resolves.toMatchObject({ ids: expect.any(Array) })
    vi.stubGlobal('fetch', fixtureFetch())
    await expect(
      readers.tissuePositions({ url: POSITIONS_URL, byteRangeCache: null }),
    ).resolves.toMatchObject({ ids: expect.any(Array) })
    await expect(
      readers.filteredMatrixBarcodes(BASE_URL, BIN2, { fetcher: fixtureFetch() }),
    ).resolves.toMatchObject({ ids: BARCODES })
    await readVisiumHdBarcodeMappings(BASE_URL, {
      bins: { binSizeMicrometers: 8, binIds: ['s_008um_00000_00000-1'] },
      fetcher: fixtureFetch(),
      readRangesInWorker: readers.barcodeMappingRanges,
    })

    expect(worker.requests).toEqual([])
  })

  it('reads on this thread when the worker fails to run', async () => {
    vi.stubGlobal('fetch', fixtureFetch())
    const worker = new FakeWorker({ fail: true })

    const positions = await visiumHdTablesWorkerReaders(() => worker).tissuePositions({
      url: POSITIONS_URL,
    })

    expect(positions.ids).toHaveLength(30)
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker on abort', async () => {
    const worker = new FakeWorker({ silent: true })
    const controller = new AbortController()
    const read = visiumHdTablesWorkerReaders(() => worker).filteredMatrixBarcodes(
      BASE_URL,
      BIN2,
      { signal: controller.signal },
    )

    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })
})

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements VisiumHdTablesWorkerLike {
  onmessage: ((event: MessageEvent<VisiumHdTablesWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: VisiumHdTablesWorkerRequest[] = []
  readonly transferred: Transferable[] = []
  terminated = false
  private readonly handle = visiumHdTablesHandler((response, transfer) => {
    this.transferred.push(...transfer)
    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({ data } as MessageEvent<VisiumHdTablesWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(message: VisiumHdTablesWorkerRequest): void {
    const data = structuredClone(message)
    this.requests.push(data)

    if (this.options.silent === true) {
      return
    }

    if (this.options.fail === true) {
      queueMicrotask(() => {
        this.onerror?.({
          message: 'worker failed',
          preventDefault: () => undefined,
        } as ErrorEvent)
      })
      return
    }

    void this.handle(data)
  }

  terminate(): void {
    this.terminated = true
  }
}
