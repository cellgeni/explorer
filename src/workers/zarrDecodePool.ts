import type { TileSamples, TileSampling } from '../data/tileSamples'
import type { PackedLabelTrace } from '../datasets/spatialDataLabelTrace'
import type {
  ZarrChunkSource,
  ZarrChunkWindow,
  ZarrDecodeRequest,
  ZarrDecodeResponse,
  ZarrTileRender,
} from './zarrDecodeMessages'

export interface ZarrDecodeWorkerLike {
  onmessage: ((event: MessageEvent<ZarrDecodeResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ZarrDecodeRequest, transfer: Transferable[]): void
  terminate(): void
}

export type ZarrDecodeWorkerFactory = () => ZarrDecodeWorkerLike

export interface ZarrDecodePoolOptions {
  readonly size?: number
  readonly workerFactory?: ZarrDecodeWorkerFactory
}

export interface ZarrWorkerTile {
  readonly bitmap: ImageBitmap
  readonly width: number
  readonly height: number
  readonly lo: number
  readonly hi: number
}

type PendingResponse = (response: ZarrDecodeResponse) => void

// Remembered chunk placements; stale ones cost one extra round trip.
const MAX_TRACKED_CHUNKS = 2_048

// Decodes Zarr chunks off the main thread. Image chunks are cached in the
// worker that first received them, and later tiles of the same chunk are
// routed there, so a large chunk is fetched and decoded once for all of its
// virtual tiles.
export class ZarrDecodePool {
  private readonly size: number
  private readonly workerFactory: ZarrDecodeWorkerFactory
  private workers: ZarrDecodeWorkerLike[] = []
  private readonly pending = new Map<number, PendingResponse>()
  private readonly chunkWorkers = new Map<string, Promise<number>>()
  private nextRequestId = 1
  private nextTraceWorker = 0

  constructor(options: ZarrDecodePoolOptions = {}) {
    this.size = Math.max(1, options.size ?? defaultWorkerPoolSize())
    this.workerFactory = options.workerFactory ?? createDefaultZarrDecodeWorker
  }

  async renderTile(request: {
    readonly cacheKey: string
    readonly source: ZarrChunkSource
    readonly loadBytes: () => Promise<Uint8Array | undefined>
    readonly window: ZarrChunkWindow
    readonly render: ZarrTileRender
  }): Promise<ZarrWorkerTile> {
    const response = await this.askChunkWorker(request, (id) => ({
      type: 'render-tile',
      id,
      cacheKey: request.cacheKey,
      window: request.window,
      render: request.render,
    }))

    if (response.type !== 'tile') {
      throw new Error('Unexpected Zarr tile response.')
    }

    return response
  }

  // Auto-contrast samples of a tile, read from the chunk the worker holds.
  async sampleTile(request: {
    readonly cacheKey: string
    readonly source: ZarrChunkSource
    readonly loadBytes: () => Promise<Uint8Array | undefined>
    readonly window: ZarrChunkWindow
    readonly sampling: TileSampling
  }): Promise<TileSamples> {
    const response = await this.askChunkWorker(request, (id) => ({
      type: 'sample-tile',
      id,
      cacheKey: request.cacheKey,
      window: request.window,
      sampling: request.sampling,
    }))

    if (response.type !== 'samples') {
      throw new Error('Unexpected Zarr tile samples response.')
    }

    return { samples: response.samples, pixelCount: response.pixelCount }
  }

  async traceLabels(request: {
    readonly source: ZarrChunkSource
    readonly bytes: Uint8Array | undefined
    readonly window: ZarrChunkWindow
    readonly levelX0: number
    readonly levelY0: number
    readonly levelWidth: number
  }): Promise<PackedLabelTrace> {
    const workerIndex = this.nextTraceWorker % this.size
    this.nextTraceWorker += 1
    const bytes = request.bytes === undefined ? null : transferableCopy(request.bytes)
    const response = await this.send(
      workerIndex,
      (id) => ({
        type: 'trace-labels',
        id,
        source: request.source,
        bytes,
        window: request.window,
        levelX0: request.levelX0,
        levelY0: request.levelY0,
        levelWidth: request.levelWidth,
      }),
      bytes === null ? [] : [bytes],
    )

    if (response.type === 'labels') {
      return response.trace
    }

    throw new Error(
      response.type === 'error' ? response.error : 'Unexpected label trace response.',
    )
  }

  terminate(): void {
    this.reset(new Error('Zarr decode worker pool terminated.'))
  }

  // Sends a request about a chunk to the worker holding it, placing the chunk
  // first when needed.
  private async askChunkWorker(
    request: {
      readonly cacheKey: string
      readonly source: ZarrChunkSource
      readonly loadBytes: () => Promise<Uint8Array | undefined>
    },
    message: (id: number) => ZarrDecodeRequest,
  ): Promise<ZarrDecodeResponse> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const workerIndex = await this.placeChunk(
        request.cacheKey,
        request.source,
        request.loadBytes,
      )
      const response = await this.send(workerIndex, message)

      if (response.type === 'error') {
        throw new Error(response.error)
      }

      if (response.type !== 'miss') {
        return response
      }

      // The worker evicted the chunk; place it again.
      this.chunkWorkers.delete(request.cacheKey)
    }

    throw new Error('Zarr decode worker could not keep the chunk cached.')
  }

  private placeChunk(
    cacheKey: string,
    source: ZarrChunkSource,
    loadBytes: () => Promise<Uint8Array | undefined>,
  ): Promise<number> {
    const existing = this.chunkWorkers.get(cacheKey)

    if (existing !== undefined) {
      return existing
    }

    const workerIndex = hashString(cacheKey) % this.size
    const placement = loadBytes().then((bytes) => {
      const payload = bytes === undefined ? null : transferableCopy(bytes)
      this.worker(workerIndex).postMessage(
        { type: 'put-chunk', cacheKey, source, bytes: payload },
        payload === null ? [] : [payload],
      )
      return workerIndex
    })
    placement.catch(() => {
      if (this.chunkWorkers.get(cacheKey) === placement) {
        this.chunkWorkers.delete(cacheKey)
      }
    })
    this.chunkWorkers.set(cacheKey, placement)

    for (const key of this.chunkWorkers.keys()) {
      if (this.chunkWorkers.size <= MAX_TRACKED_CHUNKS) {
        break
      }

      this.chunkWorkers.delete(key)
    }

    return placement
  }

  private send(
    workerIndex: number,
    message: (id: number) => ZarrDecodeRequest,
    transfer: Transferable[] = [],
  ): Promise<ZarrDecodeResponse> {
    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve)

      try {
        this.worker(workerIndex).postMessage(message(id), transfer)
      } catch (cause) {
        this.pending.delete(id)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  private worker(index: number): ZarrDecodeWorkerLike {
    while (this.workers.length <= index) {
      const worker = this.workerFactory()
      worker.onmessage = (event) => {
        const resolve = this.pending.get(event.data.id)

        if (resolve !== undefined) {
          this.pending.delete(event.data.id)
          resolve(event.data)
        }
      }
      worker.onerror = (event) => {
        this.reset(new Error(event.message || 'Zarr decode worker failed.'))
      }
      this.workers.push(worker)
    }

    const worker = this.workers[index]

    if (worker === undefined) {
      throw new Error('Zarr decode worker is not available.')
    }

    return worker
  }

  // Fails every request and drops all workers and chunk placements; the next
  // request starts fresh workers.
  private reset(error: Error): void {
    for (const [id, resolve] of this.pending) {
      resolve({ type: 'error', id, error: error.message })
    }

    this.pending.clear()
    this.chunkWorkers.clear()

    for (const worker of this.workers) {
      worker.terminate()
    }

    this.workers = []
  }
}

let sharedPool: ZarrDecodePool | null | undefined

// Shared pool, or null where workers are unavailable (for example in tests),
// in which case callers decode on the main thread.
export function sharedZarrDecodePool(): ZarrDecodePool | null {
  if (sharedPool === undefined) {
    sharedPool = typeof Worker === 'undefined' ? null : new ZarrDecodePool()
  }

  return sharedPool
}

function createDefaultZarrDecodeWorker(): ZarrDecodeWorkerLike {
  return new Worker(new URL('./zarrDecode.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function defaultWorkerPoolSize(): number {
  const cores =
    typeof navigator === 'undefined' ? 2 : (navigator.hardwareConcurrency ?? 2)
  return Math.min(3, Math.max(1, cores - 1))
}

// Store bytes may be shared with a cache, so workers get their own copy.
function transferableCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function hashString(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}
