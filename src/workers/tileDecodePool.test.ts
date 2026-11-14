import { describe, expect, it, vi } from 'vitest'
import { TileDecodeWorkerPool } from './tileDecodePool'
import type {
  DecodeWorkerFactory,
  DecodeWorkerLike,
  TileDecodeWorkerPoolOptions,
} from './tileDecodePool'
import type { TileDecodeResponse, TileDecodeWorkerRequest } from './tileDecodeMessages'

class FakeWorker implements DecodeWorkerLike {
  onmessage: ((event: MessageEvent<TileDecodeResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly terminate = vi.fn()
  readonly posted: TileDecodeWorkerRequest[] = []

  postMessage(message: TileDecodeWorkerRequest): void {
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
      bitsPerSample: [8],
      compression: 5,
      displayWindow: { lo: 0, hi: 100 },
      color: [80, 160, 240],
      alphaFromIntensity: true,
      samplesPerPixel: 1,
      tileHeight: 1,
      tileWidth: 2,
    })
    const posted = workers[0]?.posted[0]
    const request =
      posted !== undefined && !('sampling' in posted) && !('stripRows' in posted)
        ? posted
        : undefined

    expect(request?.bitsPerSample).toEqual([8])
    expect(request?.compression).toBe(5)
    expect(request?.displayWindow).toEqual({ lo: 0, hi: 100 })
    expect(request?.color).toEqual([80, 160, 240])
    expect(request?.alphaFromIntensity).toBe(true)
    expect(request?.samplesPerPixel).toBe(1)
    expect(request?.tileHeight).toBe(1)
    expect(request?.tileWidth).toBe(2)
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

  it('decodes a tile into auto-contrast samples', async () => {
    const { pool, workers } = makePool({ size: 1 })
    const sampling = { startIndex: 3, stride: 2, width: 2, height: 1 }
    const promise = pool.sample(
      new Uint8Array([1, 2]),
      { compression: 1, bitsPerSample: [8], tileWidth: 2, tileHeight: 1 },
      sampling,
    )
    const request = workers[0]?.posted[0]

    expect(request).toMatchObject({ compression: 1, tileWidth: 2, sampling })
    expect(request?.bytes.byteLength).toBe(2)

    workers[0]?.resolve({
      id: request?.id ?? -1,
      ok: true,
      samples: Float64Array.from([2]),
      pixelCount: 2,
    })

    await expect(promise).resolves.toEqual({
      samples: Float64Array.from([2]),
      pixelCount: 2,
    })
  })

  it('decodes a band of TIFF strips into sample bytes', async () => {
    const { pool, workers } = makePool({ size: 1 })
    const options = {
      compression: 8,
      width: 2,
      rowBytes: 2,
      stripRows: [1, 1],
      stripByteLengths: [3, 4],
    }
    const promise = pool.decodeStripBand(new Uint8Array(7), options)
    const request = workers[0]?.posted[0]

    expect(request).toMatchObject(options)
    expect(request?.bytes.byteLength).toBe(7)

    workers[0]?.resolve({
      id: request?.id ?? -1,
      ok: true,
      band: Uint8Array.from([1, 2, 3, 4]).buffer,
    })

    await expect(promise).resolves.toEqual(Uint8Array.from([1, 2, 3, 4]))
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
