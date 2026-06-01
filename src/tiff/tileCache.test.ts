import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { TileCache } from './tileCache'
import type { BBox } from '../data/coords'
import type { TileSource } from './tileCache'

const bounds: BBox = {
  minX: micrometers(0),
  maxX: micrometers(10),
  minY: micrometers(0),
  maxY: micrometers(10),
}

class FakeTileSource implements TileSource {
  readonly fetches: string[] = []

  tileBounds(): BBox {
    return bounds
  }

  async fetchTileBytes(level: number, col: number, row: number): Promise<Uint8Array> {
    this.fetches.push(`${level}:${col}:${row}`)
    return new Uint8Array([1, 2, 3])
  }
}

describe('TileCache', () => {
  it('loads, caches, and returns ready tiles', async () => {
    const source = new FakeTileSource()
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const cache = new TileCache({
      decodeTile: async () => ({
        pixels: new Uint16Array([0, 100]),
        width: 2,
        height: 1,
      }),
      createBitmap: async () => bitmap,
    })

    await expect(cache.request(source, 0, 1, 2)).resolves.toMatchObject({
      state: 'ready',
    })
    await cache.request(source, 0, 1, 2)

    expect(source.fetches).toEqual(['0:1:2'])
    expect(cache.readyTiles(bounds)).toEqual([{ id: '0:1:2', image: bitmap, bounds }])
  })

  it('evicts least recently used ready bitmaps', async () => {
    const source = new FakeTileSource()
    const firstBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const secondBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const bitmaps = [firstBitmap, secondBitmap]
    const cache = new TileCache({
      maxTiles: 1,
      decodeTile: async () => ({
        pixels: new Uint16Array([0, 100]),
        width: 2,
        height: 1,
      }),
      createBitmap: async () => {
        const bitmap = bitmaps.shift()

        if (bitmap === undefined) {
          throw new Error('No test bitmap available.')
        }

        return bitmap
      },
    })

    await cache.request(source, 0, 0, 0)
    await cache.request(source, 0, 1, 0)

    expect(firstBitmap.close).toHaveBeenCalledTimes(1)
    expect(secondBitmap.close).not.toHaveBeenCalled()
  })
})
