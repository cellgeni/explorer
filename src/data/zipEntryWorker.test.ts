import { afterEach, describe, expect, it, vi } from 'vitest'
import { byteRangeFetcher, zipArchive } from '../test/zipFixtures'
import { readZipDirectory, type ZipEntry } from './zipArchive'
import { zipEntryWorkerReader, type ZipEntryWorkerLike } from './zipEntryWorker'
import { zipEntryHandler } from '../workers/zipEntryCore'
import type {
  ZipEntryWorkerRequest,
  ZipEntryWorkerResponse,
} from '../workers/zipEntryMessages'

const URL = 'https://example.test/region_0.vzg'
const data = Uint8Array.from({ length: 50_000 }, (_, index) => (index * 31) % 253)
const fetcher = byteRangeFetcher(
  new Map([[URL, zipArchive([{ name: 'pictures/a.tif', data, deflate: true }])]]),
)

async function entry(): Promise<ZipEntry> {
  return (await readZipDirectory(URL, { fetcher })).entries.get('pictures/a.tif')!
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('zipEntryWorkerReader', () => {
  it('inflates the entry in the worker, with progress', async () => {
    vi.stubGlobal('fetch', fetcher)
    const worker = new FakeWorker()
    const progress: number[] = []
    const zipEntry = await entry()

    const bytes = await zipEntryWorkerReader(() => worker)(URL, zipEntry, {
      onProgress: (received) => progress.push(received),
    })

    expect(Array.from(bytes)).toEqual(Array.from(data))
    expect(progress).toEqual([zipEntry.compressedSize])
    expect(worker.requests).toEqual([{ type: 'read', url: URL, entry: zipEntry }])
    expect(worker.terminated).toBe(true)
  })

  it('reads through a custom fetcher on this thread', async () => {
    const worker = new FakeWorker()
    const bytes = await zipEntryWorkerReader(() => worker)(URL, await entry(), {
      fetcher,
    })

    expect(bytes.length).toBe(data.length)
    expect(worker.requests).toEqual([])
  })

  it('reads on this thread when the worker fails, and stops on abort', async () => {
    vi.stubGlobal('fetch', fetcher)
    const zipEntry = await entry()

    expect(
      (await zipEntryWorkerReader(() => new FakeWorker({ fail: true }))(URL, zipEntry))
        .length,
    ).toBe(data.length)

    const silent = new FakeWorker({ silent: true })
    const controller = new AbortController()
    const read = zipEntryWorkerReader(() => silent)(URL, zipEntry, {
      signal: controller.signal,
    })
    controller.abort()
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(silent.terminated).toBe(true)
  })
})

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements ZipEntryWorkerLike {
  onmessage: ((event: MessageEvent<ZipEntryWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: ZipEntryWorkerRequest[] = []
  terminated = false
  private readonly handle = zipEntryHandler((response, transfer) => {
    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({ data } as MessageEvent<ZipEntryWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(message: ZipEntryWorkerRequest): void {
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
