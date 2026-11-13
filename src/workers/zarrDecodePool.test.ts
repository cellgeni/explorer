import { describe, expect, it, vi } from 'vitest'
import type {
  ZarrCodecChunkMeta,
  ZarrDecodeRequest,
  ZarrDecodeResponse,
} from './zarrDecodeMessages'
import { ZarrDecodePool, type ZarrDecodeWorkerLike } from './zarrDecodePool'

// Answers like the real worker: tiles of chunks it holds, misses otherwise.
class FakeWorker implements ZarrDecodeWorkerLike {
  onmessage: ((event: MessageEvent<ZarrDecodeResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly chunks = new Set<string>()
  readonly messages: ZarrDecodeRequest[] = []

  postMessage(message: ZarrDecodeRequest): void {
    this.messages.push(message)

    if (message.type === 'put-chunk') {
      this.chunks.add(message.cacheKey)
      return
    }

    const response = this.answer(message)

    queueMicrotask(() => {
      this.onmessage?.({ data: response } as MessageEvent<ZarrDecodeResponse>)
    })
  }

  terminate(): void {}

  private answer(
    message: Exclude<ZarrDecodeRequest, { readonly type: 'put-chunk' }>,
  ): ZarrDecodeResponse {
    if (message.type === 'trace-labels') {
      return {
        type: 'labels',
        id: message.id,
        trace: {
          labels: Int32Array.from([5]),
          edgeOffsets: Uint32Array.from([0, 0]),
          edges: new Float64Array(0),
          bounds: new Int32Array(4),
          pixelCounts: Uint32Array.from([1]),
        },
      }
    }

    // Codec steps come back reversed; string codecs as one string per byte.
    if (message.type === 'decode-codec') {
      const bytes = new Uint8Array(message.bytes)
      return message.codec.name === 'vlen-utf8'
        ? {
            type: 'codec-chunk',
            id: message.id,
            data: Array.from(bytes, String),
            shape: [bytes.length],
            stride: [1],
          }
        : { type: 'codec-bytes', id: message.id, bytes: bytes.reverse().buffer }
    }

    if (!this.chunks.has(message.cacheKey)) {
      return { type: 'miss', id: message.id }
    }

    return message.type === 'sample-tile'
      ? {
          type: 'samples',
          id: message.id,
          samples: Float64Array.from([message.sampling.startIndex]),
          pixelCount: message.window.width * message.window.height,
        }
      : {
          type: 'tile',
          id: message.id,
          bitmap: {} as ImageBitmap,
          width: message.window.width,
          height: message.window.height,
          lo: 0,
          hi: 255,
        }
  }
}

const SOURCE = {
  metadataKey: '.zarray',
  metadata: {},
  chunkKey: '0.0',
  coords: [0, 0],
} as const
const WINDOW = { xAxis: 1, yAxis: 0, x0: 0, y0: 0, width: 2, height: 2, fixedAxes: [] }

describe('ZarrDecodePool', () => {
  it('sends a chunk once and renders all of its tiles on the same worker', async () => {
    const workers: FakeWorker[] = []
    const pool = new ZarrDecodePool({
      size: 3,
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const loadBytes = vi.fn(async () => Uint8Array.from([1, 2, 3]))

    const tiles = await Promise.all(
      [0, 1, 2, 3].map(() =>
        pool.renderTile({
          cacheKey: 'image/0/0,0',
          source: SOURCE,
          loadBytes,
          window: WINDOW,
          render: {},
        }),
      ),
    )

    expect(tiles).toHaveLength(4)
    expect(loadBytes).toHaveBeenCalledOnce()
    const owners = workers.filter((worker) => worker.chunks.has('image/0/0,0'))
    expect(owners).toHaveLength(1)
    expect(
      owners[0]?.messages.filter((message) => message.type === 'render-tile'),
    ).toHaveLength(4)
  })

  it('resends a chunk the worker evicted', async () => {
    const worker = new FakeWorker()
    const pool = new ZarrDecodePool({ size: 1, workerFactory: () => worker })
    const loadBytes = vi.fn(async () => Uint8Array.from([1]))
    const request = {
      cacheKey: 'image/0/1,0',
      source: SOURCE,
      loadBytes,
      window: WINDOW,
      render: {},
    }

    await pool.renderTile(request)
    worker.chunks.clear()
    await expect(pool.renderTile(request)).resolves.toMatchObject({ width: 2 })
    expect(loadBytes).toHaveBeenCalledTimes(2)
  })

  it('samples a tile from the chunk the worker holds, placing it again after eviction', async () => {
    const worker = new FakeWorker()
    const pool = new ZarrDecodePool({ size: 1, workerFactory: () => worker })
    const loadBytes = vi.fn(async () => Uint8Array.from([1]))
    const request = {
      cacheKey: 'image/0/2,0',
      source: SOURCE,
      loadBytes,
      window: WINDOW,
      sampling: { startIndex: 12, stride: 3, width: 2, height: 2 },
    }

    await expect(pool.sampleTile(request)).resolves.toEqual({
      samples: Float64Array.from([12]),
      pixelCount: 4,
    })
    worker.chunks.clear()
    await expect(pool.sampleTile(request)).resolves.toMatchObject({ pixelCount: 4 })
    expect(loadBytes).toHaveBeenCalledTimes(2)
    expect(
      worker.messages.filter((message) => message.type === 'sample-tile'),
    ).toHaveLength(3)
  })

  it('runs codec steps on the workers in turn with a copy of the bytes', async () => {
    const workers: FakeWorker[] = []
    const pool = new ZarrDecodePool({
      size: 2,
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const meta: ZarrCodecChunkMeta = {
      dataType: 'uint8',
      shape: [3],
      codecs: [],
      fillValue: 0,
    }
    const bytes = Uint8Array.from([1, 2, 3])

    const decoded = await pool.decodeCodec(
      { name: 'numcodecs.zstd', configuration: { level: 0 }, meta },
      bytes,
    )
    const strings = await pool.decodeCodec(
      { name: 'vlen-utf8', configuration: {}, meta },
      bytes,
    )

    expect(Array.from(decoded as Uint8Array)).toEqual([3, 2, 1])
    expect(strings).toEqual({ data: ['1', '2', '3'], shape: [3], stride: [1] })
    // The caller's bytes are untouched; each worker got its own copy.
    expect(Array.from(bytes)).toEqual([1, 2, 3])
    expect(workers.map((worker) => worker.messages.length)).toEqual([1, 1])
  })

  it('rejects a codec step the worker cannot decode', async () => {
    const worker = new FakeWorker()
    const pool = new ZarrDecodePool({ size: 1, workerFactory: () => worker })
    worker.postMessage = (message) => {
      queueMicrotask(() => {
        worker.onmessage?.({
          data: { type: 'error', id: 'id' in message ? message.id : 0, error: 'corrupt' },
        } as MessageEvent<ZarrDecodeResponse>)
      })
    }

    await expect(
      pool.decodeCodec(
        {
          name: 'gzip',
          configuration: {},
          meta: { dataType: 'uint8', shape: [1], codecs: [], fillValue: 0 },
        },
        Uint8Array.from([0]),
      ),
    ).rejects.toThrow('corrupt')
  })

  it('returns label traces and fails pending work when a worker crashes', async () => {
    const worker = new FakeWorker()
    const pool = new ZarrDecodePool({ size: 1, workerFactory: () => worker })

    await expect(
      pool.traceLabels({
        source: SOURCE,
        bytes: undefined,
        window: WINDOW,
        levelX0: 0,
        levelY0: 0,
        levelWidth: 2,
      }),
    ).resolves.toMatchObject({ labels: Int32Array.from([5]) })

    worker.postMessage = () => {
      queueMicrotask(() => {
        worker.onerror?.({ message: 'boom' } as ErrorEvent)
      })
    }

    await expect(
      pool.renderTile({
        cacheKey: 'image/0/2,0',
        source: SOURCE,
        loadBytes: async () => undefined,
        window: WINDOW,
        render: {},
      }),
    ).rejects.toThrow('boom')
  })
})
