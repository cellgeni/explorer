import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  merscopeTableWorkerReader,
  type MerscopeTableWorkerLike,
} from './merscopeTableWorker'
import { merscopeTableHandler } from '../workers/merscopeTableCore'
import type {
  MerscopeTableWorkerRequest,
  MerscopeTableWorkerResponse,
} from '../workers/merscopeTableMessages'
import { merscopeFixtureBytes, type MerscopeFixture } from '../test/merscopeFixtures'

const ROOT = 'https://example.test/region_0'
const FILES = {
  cellByGene: `${ROOT}/cell_by_gene.csv`,
  cellMetadata: `${ROOT}/cell_metadata.csv`,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function fixtureFetcher(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const name = String(input).slice(ROOT.length + 1) as MerscopeFixture
    return new Response(merscopeFixtureBytes(name).slice())
  }) as typeof fetch
}

describe('merscopeTableWorkerReader', () => {
  it('reads both tables in the worker and passes its progress on', async () => {
    vi.stubGlobal('fetch', fixtureFetcher())
    const worker = new FakeWorker()
    const progress: string[] = []

    const table = await merscopeTableWorkerReader(() => worker)({
      files: FILES,
      onProgress: (message) => progress.push(message),
    })

    expect(table.ids).toEqual([
      '1577590100000000000',
      '1577590100000000001',
      '1577590100000000002',
    ])
    expect(Array.from(table.data)).toEqual([3, 1, 5])
    expect(worker.requests).toEqual([{ type: 'read', files: FILES }])
    expect(progress).toContain(
      'MERSCOPE tables parsed: 3 cells × 3 genes (+2 Blank); 14 metadata columns',
    )
    expect(worker.terminated).toBe(true)
  })

  it('reads through a custom fetcher on this thread', async () => {
    const worker = new FakeWorker()
    const table = await merscopeTableWorkerReader(() => worker)({
      files: FILES,
      fetcher: fixtureFetcher(),
    })

    expect(table.genes).toEqual(['GENE_A', 'GENE_B', 'GENE_C'])
    expect(worker.requests).toEqual([])
  })

  it('reads on this thread when the worker fails to run', async () => {
    vi.stubGlobal('fetch', fixtureFetcher())
    const worker = new FakeWorker({ fail: true })

    const table = await merscopeTableWorkerReader(() => worker)({ files: FILES })

    expect(table.ids).toHaveLength(3)
    expect(worker.terminated).toBe(true)
  })

  it('rejects with the error the worker reports', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    const worker = new FakeWorker()

    await expect(
      merscopeTableWorkerReader(() => worker)({ files: FILES }),
    ).rejects.toThrow('cell_by_gene.csv returned HTTP 404.')
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker on abort', async () => {
    const worker = new FakeWorker({ silent: true })
    const controller = new AbortController()
    const read = merscopeTableWorkerReader(() => worker)({
      files: FILES,
      signal: controller.signal,
    })

    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })
})

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements MerscopeTableWorkerLike {
  onmessage: ((event: MessageEvent<MerscopeTableWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: MerscopeTableWorkerRequest[] = []
  terminated = false
  private readonly handle = merscopeTableHandler((response, transfer) => {
    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({ data } as MessageEvent<MerscopeTableWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(message: MerscopeTableWorkerRequest): void {
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
