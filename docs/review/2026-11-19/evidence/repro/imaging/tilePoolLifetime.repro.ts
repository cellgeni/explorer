// IMG review: who ends the tile decode workers a canvas channel starts?
// Drives the real MorphologyTileStore and TileCache, as MorphologyCanvas
// does (one spec key per channel id + loader URL + contrast), with a counting
// stand-in for Worker, through 6 contrast edits and a dataset switch.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/imaging/tilePoolLifetime.repro.ts
import { appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../../../../../../src/data/coords'
import { MorphologyTileStore } from '../../../../../../src/rendering/morphologyTileStore'
import type { TileSource } from '../../../../../../src/tiff/tileCache'

const LOG = join(__dirname, '../../imaging/tilePoolLifetime.out.txt')
rmSync(LOG, { force: true })
const log = (line: string) => appendFileSync(LOG, `${line}\n`)

let created = 0
let terminated = 0

class CountingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  constructor() {
    created += 1
  }
  postMessage(message: { id: number }) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          id: message.id,
          ok: true,
          bitmap: { close: () => undefined, width: 16, height: 16 },
          width: 16,
          height: 16,
          lo: 0,
          hi: 1,
        },
      } as MessageEvent)
    })
  }
  terminate() {
    terminated += 1
  }
}

// One 64 x 64 level of 16 x 16 uncompressed 8-bit tiles.
function source(url: string): TileSource & { url: string } {
  return {
    url,
    tileBounds: (_level, col, row) => ({
      minX: micrometers(col * 16),
      maxX: micrometers(col * 16 + 16),
      minY: micrometers(row * 16),
      maxY: micrometers(row * 16 + 16),
    }),
    tileSourceSize: () => ({ width: imagePixels(16), height: imagePixels(16) }),
    fetchTileBytes: async () => new Uint8Array(256),
    tileDecodeOptions: () => ({
      compression: 1,
      bitsPerSample: [8],
      samplesPerPixel: 1,
      tileWidth: 16,
      tileHeight: 16,
    }),
  }
}

// As MorphologyCanvas's channelCacheKey / planChannelRequest.
function spec(url: string, lo: number, hi: number) {
  return {
    key: `Channel:0:${url}:${lo}:${hi}:intensity-alpha`,
    cacheOptions: () => ({
      maxTiles: 120,
      displayWindow: { lo, hi },
      color: [255, 255, 255] as const,
      alphaFromIntensity: true,
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IMG tile decode pool lifetime', () => {
  it('counts workers started and ended across contrast edits and a dataset switch', async () => {
    vi.stubGlobal('Worker', CountingWorker)
    vi.stubGlobal('navigator', { ...navigator, hardwareConcurrency: 8 })
    const store = new MorphologyTileStore()
    const canvas = Symbol('canvas')
    const rows: string[] = []

    const draw = async (url: string, lo: number, hi: number) => {
      const [held] = store.use(canvas, [spec(url, lo, hi)])
      const loader = source(url)
      // A view of 4 tiles decoded at once, as a pan would request.
      await Promise.all([0, 1, 2, 3].map((col) => held?.cache.request(loader, 0, col, 0)))
      rows.push(
        `${url} ${lo}-${hi}: workers created ${created}, terminated ${terminated}`,
      )
    }

    for (let step = 0; step < 6; step += 1) {
      await draw('https://a.test/image.ome.tif', 0, 1000 + step * 100)
    }
    await draw('https://b.test/other.ome.tif', 0, 1000)
    store.dispose()
    rows.push(`after store.dispose(): created ${created}, terminated ${terminated}`)
    rows.forEach(log)
    expect(created).toBeGreaterThan(0)
  })
})
