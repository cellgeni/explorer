import { describe, expect, it, vi } from 'vitest'
import { TileDecodeWorkerPool } from './tileDecodePool'
import type {
  DecodeWorkerFactory,
  DecodeWorkerLike,
  TileDecodeWorkerPoolOptions,
} from './tileDecodePool'
import type { TileDecodeRequest, TileDecodeResponse } from './tileDecodeMessages'

class FakeWorker implements DecodeWorkerLike {
  onmessage: ((event: MessageEvent<TileDecodeResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly terminate = vi.fn()
  readonly posted: TileDecodeRequest[] = []

  postMessage(message: TileDecodeRequest): void {
    this.posted.push(message)
  }

  resolve(response: TileDecodeResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: response }))
  }
}

function makePool(options: Omit<TileDecodeWorkerPoolOptions, 'workerFactory'> = {}) {
  const workers: FakeWorker[] = []
  const workerFactory: DecodeWorkerFactory = () => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  }

  return {
    pool: new TileDecodeWorkerPool({ ...options, workerFactory }),
    workers,
  }
}

describe('TileDecodeWorkerPool', () => {
  it('dispatches decode requests and resolves transferred bitmaps', async () => {
    const { pool, workers } = makePool({ size: 1 })
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const promise = pool.decode(new Uint8Array([1, 2, 3]), {
      displayWindow: { lo: 0, hi: 100 },
      color: [80, 160, 240],
      alphaFromIntensity: true,
    })
    const request = workers[0]?.posted[0]

    expect(request?.displayWindow).toEqual({ lo: 0, hi: 100 })
    expect(request?.color).toEqual([80, 160, 240])
    expect(request?.alphaFromIntensity).toBe(true)
    expect(request?.bytes.byteLength).toBe(3)

    workers[0]?.resolve({
      id: request?.id ?? -1,
      ok: true,
      bitmap,
      width: 2,
      height: 1,
      lo: 0,
      hi: 100,
    })

    await expect(promise).resolves.toEqual({
      bitmap,
      width: 2,
      height: 1,
      lo: 0,
      hi: 100,
    })
  })

  it('creates workers lazily and reuses idle workers before scaling up', async () => {
    const { pool, workers } = makePool({ size: 3 })

    expect(workers).toHaveLength(0)

    const first = pool.decode(new Uint8Array([1]))
    expect(workers).toHaveLength(1)
    resolveLast(workers[0])
    await first

    const second = pool.decode(new Uint8Array([2]))
    expect(workers).toHaveLength(1)

    const third = pool.decode(new Uint8Array([3]))
    expect(workers).toHaveLength(2)

    resolveLast(workers[0])
    resolveLast(workers[1])
    await Promise.all([second, third])
  })

  it('rejects pending work when the pool terminates', async () => {
    const { pool, workers } = makePool({ size: 1 })
    const promise = pool.decode(new Uint8Array([1]))

    pool.terminate()

    await expect(promise).rejects.toThrow(/terminated/)
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1)
  })
})

function resolveLast(worker: FakeWorker | undefined): void {
  const request = worker?.posted.at(-1)

  if (worker === undefined || request === undefined) {
    throw new Error('Expected test worker request.')
  }

  worker.resolve({
    id: request.id,
    ok: true,
    bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    width: 2,
    height: 1,
    lo: 0,
    hi: 100,
  })
}
