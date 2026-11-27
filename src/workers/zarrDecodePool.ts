import type { TileCellSums } from '../data/tileCellMeasure'
import { registerMemoryReporter } from '../data/memoryTelemetry'
import type { TileSamples, TileSampling } from '../data/tileSamples'
import type { PackedLabelTrace } from '../datasets/spatialDataLabelTrace'
import type { TileMeasure } from './tileDecodeMessages'
import type {
  ZarrChunkSource,
  ZarrChunkWindow,
  ZarrCodecCall,
  ZarrCodecChunk,
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

interface PendingResponse {
  readonly resolve: (response: ZarrDecodeResponse) => void
  readonly reject: (error: ZarrDecodeWorkerError) => void
}

// A worker failed, rather than the request: it did not start, or it stopped.
// Requests waiting on it, and every later request to the pool, get this; a
// chunk that does not decode gets an ordinary error.
export class ZarrDecodeWorkerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZarrDecodeWorkerError'
  }
}

// Remembered chunk placements; stale ones cost one extra round trip.
const MAX_TRACKED_CHUNKS = 2_048

// Decodes Zarr chunks off the main thread. Image chunks are cached in the
// worker that first received them, and later tiles of the same chunk are
// routed there, so a large chunk is fetched and decoded once for all of its
// virtual tiles.
//
// Once a worker fails, the pool starts no more: a worker whose script does
// not load, as in a tab left open over a deploy, fails each time it is
// started. Its requests are refused at once, and callers decode on the main
// thread, as the codecs do (src/zarr/workerZarrCodecs.ts).
export class ZarrDecodePool {
  private readonly size: number
  private readonly workerFactory: ZarrDecodeWorkerFactory
  private workers: ZarrDecodeWorkerLike[] = []
  private failure: ZarrDecodeWorkerError | null = null
  private readonly pending = new Map<number, PendingResponse>()
  private readonly chunkWorkers = new Map<string, Promise<number>>()
  private nextRequestId = 1
  private nextTurn = 0

  constructor(options: ZarrDecodePoolOptions = {}) {
    this.size = Math.max(1, options.size ?? defaultWorkerPoolSize())
    this.workerFactory = options.workerFactory ?? createDefaultZarrDecodeWorker
  }

  // Workers started and not ended.
  get workerCount(): number {
    return this.workers.length
  }

  // Whether a worker has failed, so that requests would be refused.
  get failed(): boolean {
    return this.failure !== null
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
    const bytes = request.bytes === undefined ? null : transferableCopy(request.bytes)
    const response = await this.send(
      this.takeTurn(),
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

  // Per-cell sums of a chunk's window (plan 26). The chunk is decoded for this
  // request alone, in the workers in turn, and not cached.
  async measureChunk(request: {
    readonly source: ZarrChunkSource
    readonly bytes: Uint8Array | undefined
    readonly window: ZarrChunkWindow
    readonly measure: TileMeasure
  }): Promise<TileCellSums> {
    const bytes = request.bytes === undefined ? null : transferableCopy(request.bytes)
    const { cells } = request.measure
    const response = await this.send(
      this.takeTurn(),
      (id) => ({
        type: 'measure-chunk',
        id,
        source: request.source,
        bytes,
        window: request.window,
        measure: request.measure,
      }),
      [
        ...(bytes === null ? [] : [bytes]),
        cells.x.buffer,
        cells.y.buffer,
        cells.radius.buffer,
      ] as Transferable[],
    )

    if (response.type === 'cell-sums') {
      return { sum: response.sum, count: response.count, above: response.above }
    }

    throw new Error(
      response.type === 'error' ? response.error : 'Unexpected Zarr measure response.',
    )
  }

  // Runs one codec step of a chunk zarrita decodes on the main thread (see
  // src/zarr/workerZarrCodecs.ts): decompressed bytes, or the strings of a
  // string codec.
  async decodeCodec(
    codec: ZarrCodecCall,
    bytes: Uint8Array,
  ): Promise<Uint8Array | ZarrCodecChunk> {
    const payload = transferableCopy(bytes)
    const response = await this.send(
      this.takeTurn(),
      (id) => ({ type: 'decode-codec', id, codec, bytes: payload }),
      [payload],
    )

    if (response.type === 'codec-bytes') {
      return new Uint8Array(response.bytes)
    }

    if (response.type === 'codec-chunk') {
      return { data: response.data, shape: response.shape, stride: response.stride }
    }

    throw new Error(
      response.type === 'error' ? response.error : 'Unexpected Zarr codec response.',
    )
  }

  terminate(): void {
    this.reset(new ZarrDecodeWorkerError('Zarr decode worker pool terminated.'))
  }

  // Requests not tied to a cached chunk go to the workers in turn.
  private takeTurn(): number {
    const workerIndex = this.nextTurn % this.size
    this.nextTurn += 1
    return workerIndex
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

    // The chunk's bytes are not read for a worker that will not take them.
    if (this.failure !== null) {
      return Promise.reject(this.failure)
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
      this.pending.set(id, { resolve, reject })

      try {
        this.worker(workerIndex).postMessage(message(id), transfer)
      } catch (cause) {
        this.pending.delete(id)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  private worker(index: number): ZarrDecodeWorkerLike {
    if (this.failure !== null) {
      throw this.failure
    }

    while (this.workers.length <= index) {
      const worker = this.startWorker()
      worker.onmessage = (event) => {
        const pending = this.pending.get(event.data.id)

        if (pending !== undefined) {
          this.pending.delete(event.data.id)
          pending.resolve(event.data)
        }
      }
      worker.onerror = (event) => {
        // A worker whose script does not load reports an empty message.
        this.fail(
          new ZarrDecodeWorkerError(event.message || 'Zarr decode worker failed.'),
        )
      }
      this.workers.push(worker)
    }

    const worker = this.workers[index]

    if (worker === undefined) {
      throw new Error('Zarr decode worker is not available.')
    }

    return worker
  }

  private startWorker(): ZarrDecodeWorkerLike {
    try {
      return this.workerFactory()
    } catch (cause) {
      const error = new ZarrDecodeWorkerError(
        `Zarr decode worker did not start: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      this.fail(error)
      throw error
    }
  }

  private fail(error: ZarrDecodeWorkerError): void {
    this.failure ??= error
    this.reset(error)
  }

  // Fails every request and drops all workers and chunk placements. After
  // terminate(), unlike a failure, the next request starts fresh workers.
  private reset(error: ZarrDecodeWorkerError): void {
    for (const { reject } of this.pending.values()) {
      reject(error)
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

registerMemoryReporter('Zarr decoders', () => ({
  entries: 0,
  workers: sharedPool?.workerCount ?? 0,
  bytes: null,
}))

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
