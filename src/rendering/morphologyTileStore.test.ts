import { afterEach, describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
import { MorphologyTileStore } from './morphologyTileStore'
import type { MorphologyTileChannelSpec } from './morphologyTileStore'
import type { TileSource } from '../tiff/tileCache'

function spec(key: string, maxTiles = 24): MorphologyTileChannelSpec {
  return {
    key,
    cacheOptions: () => ({ maxTiles, decodeTile: vi.fn() }),
  }
}

describe('morphology tile store (plan 23-D11)', () => {
  it('gives canvases drawing the same channel one cache', () => {
    const store = new MorphologyTileStore()
    const [first] = store.use('a', [spec('dapi')])
    const [second] = store.use('b', [spec('dapi')])

    expect(second?.cache).toBe(first?.cache)
  })

  it('sizes a new channel by the channels it already holds', () => {
    const store = new MorphologyTileStore()
    const held: number[] = []
    const counted = (key: string): MorphologyTileChannelSpec => ({
      key,
      cacheOptions: (heldChannels) => {
        held.push(heldChannels)
        return { maxTiles: 24, decodeTile: vi.fn() }
      },
    })

    store.use('a', [counted('dapi'), counted('cd3')])

    expect(held).toEqual([0, 1])
  })

  it('drops a channel a canvas moves off once no canvas draws it', () => {
    const store = new MorphologyTileStore()
    const [dapi] = store.use('a', [spec('dapi')])
    store.use('b', [spec('dapi')])
    const clear = vi.spyOn(dapi!.cache, 'clear')

    store.use('a', [spec('cd3')])
    expect(clear).not.toHaveBeenCalled()

    store.use('b', [spec('cd3')])
    expect(clear).toHaveBeenCalledOnce()
    expect(store.use('c', [spec('dapi')])[0]?.cache).not.toBe(dapi?.cache)
  })

  it('keeps a channel whose canvases unmount, until another channel set', () => {
    const store = new MorphologyTileStore()
    const [dapi] = store.use('a', [spec('dapi')])
    const clear = vi.spyOn(dapi!.cache, 'clear')

    store.release('a')
    expect(store.use('b', [spec('dapi')])[0]?.cache).toBe(dapi?.cache)

    store.release('b')
    store.use('c', [spec('cd3')])
    expect(clear).toHaveBeenCalledOnce()
  })

  it('clears every channel when disposed', () => {
    const store = new MorphologyTileStore()
    const channels = store.use('a', [spec('dapi'), spec('cd3')])
    const clears = channels.map((channel) => vi.spyOn(channel.cache, 'clear'))

    store.dispose()

    for (const clear of clears) expect(clear).toHaveBeenCalledOnce()
  })

  it('decodes a flat image once for its canvases, and keeps the latest only', () => {
    const store = new MorphologyTileStore()
    const first = store.flatImage('https://example.test/hires.png')

    expect(store.flatImage('https://example.test/hires.png')).toBe(first)

    store.flatImage('https://example.test/other.png')
    expect(store.flatImage('https://example.test/hires.png')).not.toBe(first)
  })

  it('names the address when the browser cannot decode a flat image (EXP-327)', async () => {
    // Chromium's decode() rejects so for a missing, blocked or damaged image.
    class FailingDecodeImage {
      crossOrigin = ''
      src = ''
      decode(): Promise<void> {
        return Promise.reject(new Error('The source image cannot be decoded.'))
      }
    }
    vi.stubGlobal('Image', FailingDecodeImage)

    try {
      await expect(
        new MorphologyTileStore().flatImage('https://example.test/hires.png'),
      ).rejects.toMatchObject({
        name: 'FlatImageLoadError',
        message:
          'Failed to load flat morphology image https://example.test/hires.png: The source image cannot be decoded.',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('tile decode workers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // One 64 x 64 level of 16 x 16 uncompressed 8-bit tiles.
  const source: TileSource = {
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

  it('decodes every channel and contrast with one pool of workers', async () => {
    let started = 0
    class CountingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      constructor() {
        started += 1
      }
      postMessage(message: { readonly id: number }) {
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
      terminate() {}
    }
    vi.stubGlobal('Worker', CountingWorker)
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8)
    const store = new MorphologyTileStore()
    // As MorphologyCanvas keys a channel: its image and contrast.
    const draw = async (url: string, max: number) => {
      const [held] = store.use('canvas', [
        {
          key: `dapi:${url}:0:${max}`,
          cacheOptions: () => ({ maxTiles: 24, displayWindow: { lo: 0, hi: max } }),
        },
      ])
      await Promise.all([0, 1, 2, 3].map((col) => held?.cache.request(source, 0, col, 0)))
    }

    // Four tiles at once decode in parallel, one worker each.
    await draw('https://example.test/a.ome.tif', 1000)
    expect(started).toBe(4)

    for (let edit = 1; edit <= 10; edit += 1) {
      await draw('https://example.test/a.ome.tif', 1000 + edit * 100)
    }
    await draw('https://example.test/b.ome.tif', 1000)
    store.dispose()
    expect(started).toBe(4)
  })
})
