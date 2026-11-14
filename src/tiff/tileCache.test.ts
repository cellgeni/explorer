import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
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

  tileSourceSize() {
    return { width: imagePixels(2), height: imagePixels(1) }
  }

  async fetchTileBytes(level: number, col: number, row: number): Promise<Uint8Array> {
    this.fetches.push(`${level}:${col}:${row}`)
    return new Uint8Array([1, 2, 3])
  }
}

class MetadataTileSource extends FakeTileSource {
  tileDecodeOptions() {
    return {
      bitsPerSample: [8],
      compression: 5,
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 1,
      tileHeight: 1,
      tileWidth: 2,
    }
  }
}

describe('TileCache', () => {
  it('loads, caches, and returns ready tiles', async () => {
    const source = new FakeTileSource()
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const decodeTile = vi.fn(async () => ({
      bitmap,
      width: 2,
      height: 1,
      lo: 0,
      hi: 100,
    }))
    const cache = new TileCache({
      displayWindow: { lo: 5, hi: 95 },
      color: [80, 160, 240],
      alphaFromIntensity: true,
      decodeTile,
    })

    await expect(cache.request(source, 0, 1, 2)).resolves.toMatchObject({
      state: 'ready',
    })
    await cache.request(source, 0, 1, 2)

    expect(source.fetches).toEqual(['0:1:2'])
    expect(decodeTile).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), {
      displayWindow: { lo: 5, hi: 95 },
      color: [80, 160, 240],
      alphaFromIntensity: true,
    })
    expect(cache.readyTiles(bounds)).toEqual([
      {
        id: '0:1:2',
        level: 0,
        image: bitmap,
        bounds,
        sourceWidth: imagePixels(2),
        sourceHeight: imagePixels(1),
      },
    ])
  })

  it('forwards loader-specific tile decode metadata to the decoder', async () => {
    const source = new MetadataTileSource()
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const decodeTile = vi.fn(async () => ({
      bitmap,
      width: 2,
      height: 1,
      lo: 0,
      hi: 100,
    }))
    const cache = new TileCache({
      color: [80, 160, 240],
      decodeTile,
    })

    await cache.request(source, 0, 1, 2)

    expect(decodeTile).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), {
      bitsPerSample: [8],
      color: [80, 160, 240],
      compression: 5,
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 1,
      tileHeight: 1,
      tileWidth: 2,
    })
  })

  it('keeps configured decode options after clearing cached tiles', async () => {
    const source = new FakeTileSource()
    const firstBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const secondBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const bitmaps = [firstBitmap, secondBitmap]
    const decodeTile = vi.fn(async () => ({
      bitmap: nextBitmap(),
      width: 2,
      height: 1,
      lo: 0,
      hi: 100,
    }))
    const cache = new TileCache({
      displayWindow: { lo: 10, hi: 90 },
      color: [255, 0, 128],
      alphaFromIntensity: true,
      decodeTile,
    })

    await cache.request(source, 0, 0, 0)
    cache.clear()
    await cache.request(source, 0, 0, 0)

    expect(firstBitmap.close).toHaveBeenCalledOnce()
    expect(decodeTile).toHaveBeenNthCalledWith(2, new Uint8Array([1, 2, 3]), {
      displayWindow: { lo: 10, hi: 90 },
      color: [255, 0, 128],
      alphaFromIntensity: true,
    })

    function nextBitmap(): ImageBitmap {
      const bitmap = bitmaps.shift()

      if (bitmap === undefined) {
        throw new Error('No test bitmap available.')
      }

      return bitmap
    }
  })

  it('decodes tiles requested together in the first decoded tile window', async () => {
    const source = new FakeTileSource()
    const decodes: {
      readonly options: unknown
      readonly finish: (window: { lo: number; hi: number }) => void
    }[] = []
    const decodeTile = vi.fn(
      (_bytes: Uint8Array, options?: unknown) =>
        new Promise<{
          bitmap: ImageBitmap
          width: number
          height: number
          lo: number
          hi: number
        }>((resolve) => {
          decodes.push({
            options,
            finish: (window) => {
              resolve({
                bitmap: { close: vi.fn() } as unknown as ImageBitmap,
                width: 2,
                height: 1,
                ...window,
              })
            },
          })
        }),
    )
    const cache = new TileCache({ decodeTile })

    // A single-level image's first view: the tiles load together, and stay
    // in the cache for every later zoom.
    const requests = [
      cache.request(source, 0, 0, 0),
      cache.request(source, 0, 1, 0),
      cache.request(source, 0, 0, 1),
    ]
    await vi.waitFor(() => {
      expect(source.fetches).toHaveLength(3)
    })

    expect(decodes).toHaveLength(1)
    expect(decodes[0]?.options).not.toHaveProperty('displayWindow')

    decodes[0]?.finish({ lo: 0, hi: 60_000 })
    await vi.waitFor(() => {
      expect(decodes).toHaveLength(3)
    })
    for (const decode of decodes.slice(1)) {
      // Without the first tile's window, each would stretch its own (a tile
      // without the image's bright lines drew twice as bright).
      expect(decode.options).toMatchObject({ displayWindow: { lo: 0, hi: 60_000 } })
      decode.finish({ lo: 0, hi: 60_000 })
    }

    await expect(Promise.all(requests)).resolves.toEqual([
      expect.objectContaining({ state: 'ready' }),
      expect.objectContaining({ state: 'ready' }),
      expect.objectContaining({ state: 'ready' }),
    ])
  })

  it('lets the next tile set the window when the first decode fails', async () => {
    const source = new FakeTileSource()
    const options: unknown[] = []
    let failFirst: (error: Error) => void = () => {}
    const decodeTile = vi.fn((_bytes: Uint8Array, decodeOptions?: unknown) => {
      options.push(decodeOptions)

      if (options.length === 1) {
        return new Promise<never>((_resolve, reject) => {
          failFirst = reject
        })
      }

      return Promise.resolve({
        bitmap: { close: vi.fn() } as unknown as ImageBitmap,
        width: 2,
        height: 1,
        lo: 10,
        hi: 20,
      })
    })
    const cache = new TileCache({ decodeTile })

    const first = cache.request(source, 0, 0, 0)
    const second = cache.request(source, 0, 1, 0)
    const third = cache.request(source, 0, 2, 0)
    await vi.waitFor(() => {
      expect(source.fetches).toHaveLength(3)
    })
    expect(options).toHaveLength(1)

    failFirst(new Error('decode failed'))

    await expect(first).resolves.toMatchObject({ state: 'error' })
    await expect(second).resolves.toMatchObject({ state: 'ready' })
    await expect(third).resolves.toMatchObject({ state: 'ready' })
    expect(options[1]).not.toHaveProperty('displayWindow')
    expect(options[2]).toMatchObject({ displayWindow: { lo: 10, hi: 20 } })
  })

  it('filters ready tiles by active pyramid level', async () => {
    const source = new FakeTileSource()
    const lowLevelBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const highLevelBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const bitmaps = [lowLevelBitmap, highLevelBitmap]
    const cache = new TileCache({
      decodeTile: async () => ({
        bitmap: nextBitmap(),
        width: 2,
        height: 1,
        lo: 0,
        hi: 100,
      }),
    })

    await cache.request(source, 4, 0, 0)
    await cache.request(source, 2, 0, 0)

    expect(cache.readyTiles(bounds, 2)).toEqual([
      expect.objectContaining({
        id: '2:0:0',
        level: 2,
        image: highLevelBitmap,
      }),
    ])
    expect(cache.readyTiles(bounds, 4)).toEqual([
      expect.objectContaining({
        id: '4:0:0',
        level: 4,
        image: lowLevelBitmap,
      }),
    ])

    function nextBitmap(): ImageBitmap {
      const bitmap = bitmaps.shift()

      if (bitmap === undefined) {
        throw new Error('No test bitmap available.')
      }

      return bitmap
    }
  })

  it('evicts least recently used ready bitmaps', async () => {
    const source = new FakeTileSource()
    const firstBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const secondBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const bitmaps = [firstBitmap, secondBitmap]
    const cache = new TileCache({
      maxTiles: 1,
      decodeTile: async () => ({
        bitmap: nextBitmap(),
        width: 2,
        height: 1,
        lo: 0,
        hi: 100,
      }),
    })

    await cache.request(source, 0, 0, 0)
    await cache.request(source, 0, 1, 0)

    expect(firstBitmap.close).toHaveBeenCalledTimes(1)
    expect(secondBitmap.close).not.toHaveBeenCalled()

    function nextBitmap(): ImageBitmap {
      const bitmap = bitmaps.shift()

      if (bitmap === undefined) {
        throw new Error('No test bitmap available.')
      }

      return bitmap
    }
  })

  it('reports tile load errors through the cache callback', async () => {
    const source = new FakeTileSource()
    const onError = vi.fn()
    const cache = new TileCache({
      decodeTile: async () => {
        throw new Error('decode failed')
      },
      onError,
    })

    await expect(cache.request(source, 0, 1, 2)).resolves.toMatchObject({
      state: 'error',
      error: new Error('decode failed'),
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0].message).toBe('decode failed')
  })

  it('drops aborted loading tiles without reporting a cache error', async () => {
    const source = new AbortableTileSource()
    const onError = vi.fn()
    const cache = new TileCache({ onError })
    const abortController = new AbortController()
    const promise = cache.request(source, 0, 1, 2, abortController.signal)

    expect(cache.get(0, 1, 2)).toMatchObject({ state: 'loading' })

    abortController.abort()

    await expect(promise).resolves.toMatchObject({
      state: 'error',
      error: expect.objectContaining({ name: 'AbortError' }),
    })
    expect(cache.get(0, 1, 2)).toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
  })

  it('closes decoded bitmaps when a tile is aborted after decode', async () => {
    const source = new FakeTileSource()
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const abortController = new AbortController()
    const cache = new TileCache({
      decodeTile: async () => {
        abortController.abort()
        return {
          bitmap,
          width: 2,
          height: 1,
          lo: 0,
          hi: 100,
        }
      },
    })

    await expect(
      cache.request(source, 0, 1, 2, abortController.signal),
    ).resolves.toMatchObject({
      state: 'error',
      error: expect.objectContaining({ name: 'AbortError' }),
    })

    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(cache.get(0, 1, 2)).toBeUndefined()
  })
})

class AbortableTileSource extends FakeTileSource {
  override async fetchTileBytes(
    _level: number,
    _col: number,
    _row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError())
        return
      }

      const timeout = window.setTimeout(() => resolve(new Uint8Array([1, 2, 3])), 10_000)

      signal?.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timeout)
          reject(abortError())
        },
        { once: true },
      )
    })
  }
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}
