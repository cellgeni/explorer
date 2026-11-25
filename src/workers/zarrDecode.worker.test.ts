import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ZarrDecodeRequest, ZarrDecodeResponse } from './zarrDecodeMessages'
import { ZarrDecodePool, type ZarrDecodeWorkerLike } from './zarrDecodePool'

// The worker script (zarrDecode.worker.ts) behind the real pool, with each
// message delivered as its own task, as in a browser.
const scope: {
  onmessage: ((event: { data: ZarrDecodeRequest }) => void) | null
  postMessage: (response: ZarrDecodeResponse, transfer?: Transferable[]) => void
} = { onmessage: null, postMessage: () => undefined }

class ScriptWorker implements ZarrDecodeWorkerLike {
  onmessage: ((event: MessageEvent<ZarrDecodeResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: ZarrDecodeRequest, transfer: Transferable[] = []): void {
    const buffers = transfer.filter(
      (item): item is ArrayBuffer => item instanceof ArrayBuffer,
    )
    const cloned = structuredClone(message, { transfer: buffers })
    setTimeout(() => scope.onmessage?.({ data: cloned }), 0)
  }

  terminate(): void {}
}

const worker = new ScriptWorker()

beforeAll(async () => {
  vi.stubGlobal('self', scope)
  await import('./zarrDecode.worker')
  scope.postMessage = (response) => {
    setTimeout(() => {
      worker.onmessage?.({ data: response } as MessageEvent<ZarrDecodeResponse>)
    }, 0)
  }
})

describe('Zarr decode worker', () => {
  it('answers a chunk that fails to decode with its error, without loading it again', async () => {
    const pool = new ZarrDecodePool({ size: 1, workerFactory: () => worker })
    let loads = 0
    const render = () =>
      pool.renderTile({
        cacheKey: 'image/0/0,0,2',
        source: {
          metadataKey: '.zarray',
          metadata: {
            zarr_format: 2,
            shape: [2, 4, 6],
            chunks: [2, 4, 6],
            dtype: '<u2',
            // A codec zarrita does not know: the decode fails at once, before
            // the request to draw the tile reaches the worker.
            compressor: { id: 'no-such-codec' },
            fill_value: 0,
            order: 'C',
            filters: null,
            dimension_separator: '/',
          },
          chunkKey: '0/0/2',
          coords: [0, 0, 2],
        },
        loadBytes: async () => {
          loads += 1
          return Uint8Array.from([1, 2, 3, 4, 5])
        },
        window: { xAxis: 2, yAxis: 1, x0: 0, y0: 0, width: 2, height: 2, fixedAxes: [] },
        render: {},
      })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(render()).rejects.toThrow(/no-such-codec/)
    }

    expect(loads).toBe(1)
  })

  it("traces the labels of the window's plane in a chunk of several (plan 28-D9)", async () => {
    const pool = new ZarrDecodePool({ size: 1, workerFactory: () => worker })
    // Two time points of 2 x 2 pixels: label 1 at the first, 7 at the second.
    const chunk = Int32Array.from([1, 1, 1, 0, 7, 0, 7, 7])
    const trace = await pool.traceLabels({
      source: {
        metadataKey: '.zarray',
        metadata: {
          zarr_format: 2,
          shape: [2, 2, 2],
          chunks: [2, 2, 2],
          dtype: '<i4',
          compressor: null,
          fill_value: 0,
          order: 'C',
          filters: null,
          dimension_separator: '/',
        },
        chunkKey: '0/0/0',
        coords: [0, 0, 0],
      },
      bytes: new Uint8Array(chunk.buffer),
      window: {
        xAxis: 2,
        yAxis: 1,
        x0: 0,
        y0: 0,
        width: 2,
        height: 2,
        fixedAxes: [{ axis: 0, index: 1 }],
      },
      levelX0: 0,
      levelY0: 0,
      levelWidth: 2,
    })

    expect(Array.from(trace.labels)).toEqual([7])
    expect(Array.from(trace.pixelCounts)).toEqual([3])
  })
})
