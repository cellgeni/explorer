import type { DisplayWindow } from '../codecs/jpeg2000'
import type {
  TileDecodeRequest,
  TileDecodeResponse,
  WorkerDecodedTile,
} from './tileDecodeMessages'

export type TileBitmapDecoder = (
  bytes: Uint8Array,
  displayWindow?: DisplayWindow,
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
}

export class TileDecodeWorkerPool {
  private readonly workers: readonly DecodeWorkerLike[]
  private readonly pending = new Map<number, PendingDecode>()
  private nextRequestId = 1
  private nextWorkerIndex = 0

  constructor(options: TileDecodeWorkerPoolOptions = {}) {
    const size = Math.max(
      1,
      options.size ?? Math.max(1, navigator.hardwareConcurrency ?? 2),
    )
    const workerFactory = options.workerFactory ?? createDefaultDecodeWorker
    const workers: DecodeWorkerLike[] = []

    for (let index = 0; index < size; index += 1) {
      const worker = workerFactory()
      worker.onmessage = (event) => {
        this.handleMessage(event.data)
      }
      worker.onerror = (event) => {
        this.rejectAll(new Error(event.message || 'Tile decode worker failed.'))
      }
      workers.push(worker)
    }

    this.workers = workers
  }

  decode(bytes: Uint8Array, displayWindow?: DisplayWindow): Promise<WorkerDecodedTile> {
    const id = this.nextRequestId
    this.nextRequestId += 1
    const worker = this.workers[this.nextWorkerIndex]

    if (worker === undefined) {
      return Promise.reject(new Error('No tile decode workers are available.'))
    }

    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length
    const payload = copyToTransferableBuffer(bytes)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const request: TileDecodeRequest =
        displayWindow === undefined
          ? { id, bytes: payload }
          : { id, bytes: payload, displayWindow }

      worker.postMessage(request, [payload])
    })
  }

  terminate(): void {
    this.rejectAll(new Error('Tile decode worker pool terminated.'))

    for (const worker of this.workers) {
      worker.terminate()
    }
  }

  private handleMessage(response: TileDecodeResponse): void {
    const pending = this.pending.get(response.id)

    if (pending === undefined) {
      return
    }

    this.pending.delete(response.id)

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
  }
}

export function createWorkerTileDecoder(
  pool = new TileDecodeWorkerPool(),
): TileBitmapDecoder {
  return (bytes, displayWindow) => pool.decode(bytes, displayWindow)
}

function createDefaultDecodeWorker(): DecodeWorkerLike {
  return new Worker(new URL('./tileDecode.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function copyToTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
