import type {
  TileDecodeOptions,
  TileDecodeRequest,
  TileDecodeResponse,
  WorkerDecodedTile,
} from './tileDecodeMessages'

export type TileBitmapDecoder = (
  bytes: Uint8Array,
  options?: TileDecodeOptions,
) => Promise<WorkerDecodedTile>

export interface DecodeWorkerLike {
  onmessage: ((event: MessageEvent<TileDecodeResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TileDecodeRequest, transfer: Transferable[]): void
  terminate(): void
}

export type DecodeWorkerFactory = () => DecodeWorkerLike

export interface TileDecodeWorkerPoolOptions {
  readonly size?: number
  readonly workerFactory?: DecodeWorkerFactory
}

interface PendingDecode {
  readonly resolve: (tile: WorkerDecodedTile) => void
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

  decode(bytes: Uint8Array, options?: TileDecodeOptions): Promise<WorkerDecodedTile> {
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
      const request: TileDecodeRequest = {
        id,
        bytes: payload,
        ...(options?.displayWindow === undefined
          ? {}
          : { displayWindow: options.displayWindow }),
        ...(options?.color === undefined ? {} : { color: options.color }),
        ...(options?.alphaFromIntensity === undefined
          ? {}
          : { alphaFromIntensity: options.alphaFromIntensity }),
      }

      try {
        worker.postMessage(request, [payload])
      } catch (cause) {
        this.pending.delete(id)
        this.decrementWorker(workerIndex)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  terminate(): void {
    this.rejectAll(new Error('Tile decode worker pool terminated.'))

    for (const worker of this.workers) {
      worker.terminate()
    }

    this.workers.splice(0)
    this.inFlightByWorker.splice(0)
  }

  private handleMessage(response: TileDecodeResponse): void {
    const pending = this.pending.get(response.id)

    if (pending === undefined) {
      return
    }

    this.pending.delete(response.id)
    this.decrementWorker(pending.workerIndex)

    if (response.ok) {
      pending.resolve({
        bitmap: response.bitmap,
        width: response.width,
        height: response.height,
        lo: response.lo,
        hi: response.hi,
      })
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

export function createWorkerTileDecoder(
  pool = new TileDecodeWorkerPool(),
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
