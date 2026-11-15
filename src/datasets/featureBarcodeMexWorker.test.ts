import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  featureBarcodeMexWorkerReader,
  type FeatureBarcodeMexWorkerLike,
} from './featureBarcodeMexWorker'
import { featureBarcodeMexHandler } from '../workers/featureBarcodeMexCore'
import type {
  FeatureBarcodeMexWorkerRequest,
  FeatureBarcodeMexWorkerResponse,
} from '../workers/featureBarcodeMexMessages'

const ROOT = 'https://example.test/outs/filtered_feature_bc_matrix'
const URLS = {
  matrix: `${ROOT}/matrix.mtx`,
  barcodes: `${ROOT}/barcodes.tsv`,
  features: `${ROOT}/features.tsv`,
}
const FILES: Readonly<Record<string, string>> = {
  [URLS.matrix]: [
    '%%MatrixMarket matrix coordinate integer general',
    '2 3 3',
    '1 1 4',
    '2 1 1',
    '2 3 9',
  ].join('\n'),
  [URLS.barcodes]: 'B1-1\nB2-1\nB3-1\n',
  [URLS.features]: 'G1\tActb\tGene Expression\nG2\tGad1\tGene Expression\n',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function filesFetcher(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const body = FILES[String(input)]
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
  }) as typeof fetch
}

describe('featureBarcodeMexWorkerReader', () => {
  it('reads the matrix in the worker and passes its progress on', async () => {
    vi.stubGlobal('fetch', filesFetcher())
    const worker = new FakeWorker()
    const progress: string[] = []

    const matrix = await featureBarcodeMexWorkerReader(() => worker)({
      urls: URLS,
      onProgress: (message) => progress.push(message),
    })

    expect(matrix.barcodes).toEqual(['B1-1', 'B2-1', 'B3-1'])
    expect(Array.from(matrix.indptr)).toEqual([0, 2, 2, 3])
    expect(Array.from(matrix.data)).toEqual([4, 1, 9])
    expect(worker.requests).toEqual([{ type: 'read', urls: URLS }])
    expect(progress).toEqual(['matrix.mtx read: 3 barcodes × 2 features, 3 non-zero'])
    expect(worker.terminated).toBe(true)
  })

  it('reads through a custom fetcher on this thread', async () => {
    const worker = new FakeWorker()
    const matrix = await featureBarcodeMexWorkerReader(() => worker)({
      urls: URLS,
      fetcher: filesFetcher(),
    })

    expect(matrix.featureNames).toEqual(['Actb', 'Gad1'])
    expect(worker.requests).toEqual([])
  })

  it('reads on this thread when the worker fails to run', async () => {
    vi.stubGlobal('fetch', filesFetcher())
    const worker = new FakeWorker({ fail: true })

    const matrix = await featureBarcodeMexWorkerReader(() => worker)({ urls: URLS })

    expect(matrix.barcodes).toHaveLength(3)
    expect(worker.terminated).toBe(true)
  })

  it('rejects with the error the worker reports', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    const worker = new FakeWorker()

    await expect(
      featureBarcodeMexWorkerReader(() => worker)({ urls: URLS }),
    ).rejects.toThrow('returned HTTP 404.')
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker on abort', async () => {
    const worker = new FakeWorker({ silent: true })
    const controller = new AbortController()
    const read = featureBarcodeMexWorkerReader(() => worker)({
      urls: URLS,
      signal: controller.signal,
    })

    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })
})

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements FeatureBarcodeMexWorkerLike {
  onmessage: ((event: MessageEvent<FeatureBarcodeMexWorkerResponse>) => void) | null =
    null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: FeatureBarcodeMexWorkerRequest[] = []
  terminated = false
  private readonly handle = featureBarcodeMexHandler((response, transfer) => {
    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({ data } as MessageEvent<FeatureBarcodeMexWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(message: FeatureBarcodeMexWorkerRequest): void {
    this.requests.push(message)
    const data = structuredClone(message)

    queueMicrotask(() => {
      if (this.options.fail === true) {
        this.onerror?.({ message: 'failed', preventDefault: () => {} } as ErrorEvent)
      } else if (this.options.silent !== true) {
        void this.handle(data)
      }
    })
  }

  terminate(): void {
    this.terminated = true
  }
}
