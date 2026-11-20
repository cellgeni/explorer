// A tile decode worker whose script does not load (a stale hashed asset
// after a redeploy, a worker-src policy, a dropped connection) fires one
// `error` event and then never answers. TileDecodeWorkerPool rejects the
// requests pending at that moment but keeps the dead worker, so every later
// request is posted to it and never settles. The Zarr pool resets on the
// same event (zarrDecodePool.ts reset()), and the one-shot readers fall back
// to the main thread; TIFF tiles have no fallback (tileCache.ts:103).
import { describe, expect, it } from 'vitest'
import {
  TileDecodeWorkerPool,
  type DecodeWorkerLike,
} from '../../../../../../src/workers/tileDecodePool'

class ScriptLoadFailure implements DecodeWorkerLike {
  onmessage: DecodeWorkerLike['onmessage'] = null
  onerror: DecodeWorkerLike['onerror'] = null
  posted = 0
  constructor() {
    // Browsers report the failed script load asynchronously, once.
    setTimeout(() => this.onerror?.({ message: '' } as ErrorEvent), 5)
  }
  postMessage(): void {
    this.posted += 1
  }
  terminate(): void {}
}

const settled = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.then(
      () => 'resolved',
      (error: Error) => `rejected: ${error.message}`,
    ),
    new Promise((resolve) => setTimeout(() => resolve('still pending'), ms)),
  ])

describe('tile decode pool after a worker fails to load', () => {
  it('rejects the first request, then leaves later requests pending forever', async () => {
    const workers: ScriptLoadFailure[] = []
    const pool = new TileDecodeWorkerPool({
      size: 1,
      workerFactory: () => {
        const worker = new ScriptLoadFailure()
        workers.push(worker)
        return worker
      },
    })

    const first = await settled(pool.decode(new Uint8Array([1, 2, 3])), 200)
    const second = await settled(pool.decode(new Uint8Array([1, 2, 3])), 500)
    const third = await settled(pool.decode(new Uint8Array([1, 2, 3])), 500)
    console.log(
      JSON.stringify({
        first,
        second,
        third,
        workersCreated: workers.length,
        posted: workers.map((w) => w.posted),
      }),
    )

    expect(first).toBe('rejected: Tile decode worker failed.')
    // Records current behaviour: no error, no retry, no new worker.
    expect(second).toBe('still pending')
    expect(third).toBe('still pending')
    expect(workers).toHaveLength(1)
  })
})
