import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TileCellSums } from '../data/tileCellMeasure'
import type { TileSamples, TileSampling } from '../data/tileSamples'
import type { PackedLabelTrace } from '../datasets/spatialDataLabelTrace'
import type { TiffLabelTraceOptions } from './tiffLabelTraceCore'
import type {
  TileDecodeOptions,
  TileDecodeResponse,
  TileDecodeSuccess,
  TileDecodeWorkerRequest,
  TileLabelTraceSuccess,
  TileMeasure,
  TileMeasureSuccess,
  TileSamplesSuccess,
  TileStripBandSuccess,
  WorkerDecodedTile,
} from './tileDecodeMessages'

export type TileBitmapDecoder = (
  bytes: Uint8Array,
  options?: TileDecodeOptions,
) => Promise<WorkerDecodedTile>

export interface DecodeWorkerLike {
  onmessage: ((event: MessageEvent<TileDecodeResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TileDecodeWorkerRequest, transfer: Transferable[]): void
  terminate(): void
}

export type DecodeWorkerFactory = () => DecodeWorkerLike

export interface TileDecodeWorkerPoolOptions {
  readonly size?: number
  readonly workerFactory?: DecodeWorkerFactory
}

type TileDecodeWorkerSuccess =
  | TileDecodeSuccess
  | TileSamplesSuccess
  | TileMeasureSuccess
  | TileStripBandSuccess
  | TileLabelTraceSuccess

interface PendingDecode {
  readonly resolve: (response: TileDecodeWorkerSuccess) => void
  readonly reject: (error: Error) => void
  readonly workerIndex: number
}

export class TileDecodeWorkerPool {
  private readonly workers: DecodeWorkerLike[] = []
  private readonly inFlightByWorker: number[] = []
  private readonly size: number
  private readonly workerFactory: DecodeWorkerFactory
  private readonly pending = new Map<number, PendingDecode>()
  private nextRequestId = 1

  constructor(options: TileDecodeWorkerPoolOptions = {}) {
    this.size = Math.max(1, options.size ?? defaultWorkerPoolSize())
    this.workerFactory = options.workerFactory ?? createDefaultDecodeWorker
  }

  async decode(
    bytes: Uint8Array,
    options?: TileDecodeOptions,
  ): Promise<WorkerDecodedTile> {
    const response = await this.post(bytes, (id, payload) => ({
      id,
      bytes: payload,
      ...(options ?? {}),
    }))

    if (!('bitmap' in response)) {
      throw new Error('Tile decode worker returned samples instead of a bitmap.')
    }

    return {
      bitmap: response.bitmap,
      width: response.width,
      height: response.height,
      lo: response.lo,
      hi: response.hi,
    }
  }

  // Decodes a tile and returns its auto-contrast samples.
  async sample(
    bytes: Uint8Array,
    options: TiffTileDecodeMetadata,
    sampling: TileSampling,
  ): Promise<TileSamples> {
    const response = await this.post(bytes, (id, payload) => ({
      id,
      bytes: payload,
      ...options,
      sampling,
    }))

    if (!('samples' in response)) {
      throw new Error('Tile decode worker returned a bitmap instead of samples.')
    }

    return { samples: response.samples, pixelCount: response.pixelCount }
  }

  // Decodes a tile and returns per-cell sums (plan 26). The cells' arrays
  // are transferred, so the caller no longer has them.
  async measure(
    bytes: Uint8Array,
    options: TiffTileDecodeMetadata,
    measure: TileMeasure,
  ): Promise<TileCellSums> {
    const { cells } = measure
    const response = await this.post(
      bytes,
      (id, payload) => ({ id, bytes: payload, ...options, measure }),
      [cells.x.buffer, cells.y.buffer, cells.radius.buffer],
    )

    if (!('sum' in response)) {
      throw new Error('Tile decode worker did not return per-cell sums.')
    }

    return { sum: response.sum, count: response.count, above: response.above }
  }

  // Decodes a band of TIFF strips (see decodeTiffStripBand).
  async decodeStripBand(
    bytes: Uint8Array,
    options: TiffStripBandDecodeOptions,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const response = await this.post(bytes, (id, payload) => ({
      id,
      bytes: payload,
      ...options,
    }))

    if (!('band' in response)) {
      throw new Error('Tile decode worker did not return a strip band.')
    }

    return new Uint8Array(response.band)
  }

  // Decodes a label image tile and traces its labels (see traceTiffLabelTile).
  async traceLabels(
    bytes: Uint8Array,
    options: TiffLabelTraceOptions,
  ): Promise<PackedLabelTrace> {
    const response = await this.post(bytes, (id, payload) => ({
      id,
      bytes: payload,
      ...options,
      labelTrace: true,
    }))

    if (!('trace' in response)) {
      throw new Error('Tile decode worker did not return a label trace.')
    }

    return response.trace
  }

  terminate(): void {
    this.rejectAll(new Error('Tile decode worker pool terminated.'))

    for (const worker of this.workers) {
      worker.terminate()
    }

    this.workers.splice(0)
    this.inFlightByWorker.splice(0)
  }

  private post(
    bytes: Uint8Array,
    request: (id: number, payload: ArrayBuffer) => TileDecodeWorkerRequest,
    transfer: readonly ArrayBufferLike[] = [],
  ): Promise<TileDecodeWorkerSuccess> {
    const id = this.nextRequestId
    this.nextRequestId += 1
    const workerIndex = this.workerIndexForNextRequest()
    const worker = this.workers[workerIndex]

    if (worker === undefined) {
      return Promise.reject(new Error('No tile decode workers are available.'))
    }

    const payload = copyToTransferableBuffer(bytes)

    return new Promise((resolve, reject) => {
      this.inFlightByWorker[workerIndex] = (this.inFlightByWorker[workerIndex] ?? 0) + 1
      this.pending.set(id, { resolve, reject, workerIndex })

      try {
        worker.postMessage(request(id, payload), [
          payload,
          ...(transfer as readonly ArrayBuffer[]),
        ])
      } catch (cause) {
        this.pending.delete(id)
        this.decrementWorker(workerIndex)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  private handleMessage(response: TileDecodeResponse): void {
    const pending = this.pending.get(response.id)

    if (pending === undefined) {
      return
    }

    this.pending.delete(response.id)
    this.decrementWorker(pending.workerIndex)

    if (response.ok) {
      pending.resolve(response)
      return
    }

    pending.reject(new Error(response.error))
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }

    this.pending.clear()
    this.inFlightByWorker.fill(0)
  }

  private workerIndexForNextRequest(): number {
    if (this.workers.length === 0) {
      return this.createWorker()
    }

    const availableIndex = this.inFlightByWorker.findIndex((count) => count === 0)

    if (availableIndex >= 0) {
      return availableIndex
    }

    if (this.workers.length < this.size) {
      return this.createWorker()
    }

    let selectedIndex = 0
    let selectedCount = this.inFlightByWorker[0] ?? 0

    for (let index = 1; index < this.inFlightByWorker.length; index += 1) {
      const count = this.inFlightByWorker[index] ?? 0

      if (count < selectedCount) {
        selectedIndex = index
        selectedCount = count
      }
    }

    return selectedIndex
  }

  private createWorker(): number {
    const worker = this.workerFactory()
    const index = this.workers.length

    worker.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || 'Tile decode worker failed.'))
    }

    this.workers.push(worker)
    this.inFlightByWorker.push(0)
    return index
  }

  private decrementWorker(workerIndex: number): void {
    this.inFlightByWorker[workerIndex] = Math.max(
      0,
      (this.inFlightByWorker[workerIndex] ?? 0) - 1,
    )
  }
}

let sharedStripPool: TileDecodeWorkerPool | null | undefined

// Shared pool for TIFF strip bands, or null where workers are unavailable
// (for example in tests), in which case callers decode on the main thread.
export function sharedStripDecodePool(): TileDecodeWorkerPool | null {
  if (sharedStripPool === undefined) {
    sharedStripPool = typeof Worker === 'undefined' ? null : new TileDecodeWorkerPool()
  }

  return sharedStripPool
}

let sharedTilePool: TileDecodeWorkerPool | undefined

// Shared pool for the tiles of every TileCache. A cache is made per channel
// and contrast, so a pool per cache started up to four more workers with each
// contrast value, and nothing ended them.
export function sharedTileDecodePool(): TileDecodeWorkerPool {
  sharedTilePool ??= new TileDecodeWorkerPool()
  return sharedTilePool
}

export function createWorkerTileDecoder(
  pool = sharedTileDecodePool(),
): TileBitmapDecoder {
  return (bytes, options) => pool.decode(bytes, options)
}

function createDefaultDecodeWorker(): DecodeWorkerLike {
  return new Worker(new URL('./tileDecode.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function defaultWorkerPoolSize(): number {
  return Math.min(4, Math.max(1, navigator.hardwareConcurrency ?? 2))
}

function copyToTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
