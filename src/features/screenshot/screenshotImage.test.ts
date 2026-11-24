import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers, type BBox, type TileIndex } from '../../data/coords'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { MorphologyCanvasChannel } from '../../components/MorphologyCanvas'
import { MorphologyTileStore } from '../../rendering/morphologyTileStore'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import { TILE_RETRY_DELAYS_MS } from '../../tiff/tileCache'
import { ScreenshotImageComposer, ScreenshotImageError } from './screenshotImage'

// A two-level pyramid of 100 µm tiles at level 0 and 200 µm tiles at level 1,
// 4 × 4 tiles at level 0, with its origin at `origin`.
function fakeLoader(
  options: {
    readonly origin?: { readonly x: number; readonly y: number }
    readonly placement?: ImagePyramidLoader['placement']
    readonly failing?: (level: number, col: number, row: number) => boolean
    readonly name?: string
  } = {},
) {
  const origin = options.origin ?? { x: 0, y: 0 }
  const reads: string[] = []
  const size = (level: number) => 100 * 2 ** level
  const loader = {
    url: `https://example.test/${options.name ?? 'dapi'}.ome.tif`,
    channels: [{ id: options.name ?? 'dapi', name: options.name ?? 'DAPI' }],
    ...(options.placement === undefined ? {} : { placement: options.placement }),
    bestLevel: (deckScale: number) => (deckScale >= 1 ? 0 : 1),
    tilesForBbox: (level: number, bbox: BBox): readonly TileIndex[] => {
      const tiles: TileIndex[] = []
      const step = size(level)
      const count = 4 / 2 ** level
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          const minX = origin.x + col * step
          const minY = origin.y + row * step
          if (
            minX < bbox.maxX &&
            minX + step > bbox.minX &&
            minY < bbox.maxY &&
            minY + step > bbox.minY
          ) {
            tiles.push({ col, row })
          }
        }
      }
      return tiles
    },
    tileBounds: (level: number, col: number, row: number): BBox => ({
      minX: micrometers(origin.x + col * size(level)),
      maxX: micrometers(origin.x + (col + 1) * size(level)),
      minY: micrometers(origin.y + row * size(level)),
      maxY: micrometers(origin.y + (row + 1) * size(level)),
    }),
    tileSourceSize: () => ({ width: imagePixels(100), height: imagePixels(100) }),
    loadTile: vi.fn((level: number, col: number, row: number) => {
      const key = `${level.toString()}:${col.toString()}:${row.toString()}`
      reads.push(key)
      if (options.failing?.(level, col, row) === true) {
        return Promise.reject(new Error(`503 for ${key}`))
      }
      return Promise.resolve({
        bitmap: { key, close: vi.fn() } as unknown as ImageBitmap,
        width: 100,
        height: 100,
        lo: 0,
        hi: 255,
      })
    }),
  }

  return { loader: loader as unknown as ImagePyramidLoader, reads }
}

function channel(
  loader: ImagePyramidLoader,
  color: readonly [number, number, number] = [0, 0, 255],
): MorphologyCanvasChannel {
  return {
    id: loader.channels[0]?.id ?? 'dapi',
    loader,
    enabled: true,
    color,
    contrast: { lo: 0, hi: 255 },
  }
}

// The image drawn by a context: each drawImage's bitmap, operation and
// target rect.
function recordingContext() {
  const draws: {
    readonly key: string
    readonly operation: string
    readonly alpha: number
    readonly target: readonly number[]
    readonly transformed: boolean
  }[] = []
  let transformed = false
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingQuality: 'low',
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(() => {
      transformed = true
    }),
    restore: vi.fn(() => {
      transformed = false
    }),
    translate: vi.fn(),
    transform: vi.fn(),
    drawImage: vi.fn(function (
      this: { globalCompositeOperation: string; globalAlpha: number },
      image: { key?: string },
      ...args: number[]
    ) {
      draws.push({
        key: image.key ?? 'flat',
        operation: this.globalCompositeOperation,
        alpha: this.globalAlpha,
        target: args.slice(-4),
        transformed,
      })
    }),
  }

  return { context: context as unknown as CanvasRenderingContext2D, draws }
}

// The frame is 200 × 100 CSS px at zoom 0 over x 0–200, y 0–100 µm.
const viewState: OverviewViewState = {
  target: [100, -50, 0],
  zoom: 0,
  minZoom: -10,
  maxZoom: 10,
}
const frame = { width: 200, height: 100 }
const whole = { x: 0, y: 0, width: 200, height: 100 }

function composer(
  channels: readonly MorphologyCanvasChannel[],
  options: Partial<ConstructorParameters<typeof ScreenshotImageComposer>[1]> = {},
) {
  return new ScreenshotImageComposer(
    { channels, flatImage: null, opacity: 1 },
    {
      viewState,
      frame,
      scale: 2,
      maxConcurrentRequests: 2,
      signal: new AbortController().signal,
      waitUntil: () => Promise.resolve(),
      ...options,
    },
  )
}

describe('screenshot image (plan 27, task C)', () => {
  it('reads each channel at the level its pixel size needs, and adds channels', async () => {
    const dapi = fakeLoader()
    const cd3 = fakeLoader({ name: 'cd3' })
    const { context, draws } = recordingContext()
    const image = composer([channel(dapi.loader), channel(cd3.loader, [255, 0, 0])], {
      scale: 1,
      viewState: { ...viewState, zoom: -1 },
    })

    expect(image.tileCount(whole)).toBe(2 + 2)
    await image.drawTile(context, whole)

    // Zoom −1 at 1× reads level 1; the frame spans x 0–400, y 0–200 µm.
    expect(dapi.reads.sort()).toEqual(['1:0:0', '1:1:0'])
    expect(cd3.reads.sort()).toEqual(['1:0:0', '1:1:0'])
    expect(new Set(draws.map((draw) => draw.operation))).toEqual(new Set(['lighter']))
  })

  it('reads the finer level at a larger scale (D4)', async () => {
    const dapi = fakeLoader()
    const { context, draws } = recordingContext()
    const image = composer([channel(dapi.loader)], {
      scale: 2,
      viewState: { ...viewState, target: [200, -100, 0], zoom: -1 },
    })

    await image.drawTile(context, whole)

    expect(dapi.reads.every((key) => key.startsWith('0:'))).toBe(true)
    // At 2× the frame, x 0–400 and y 0–200 µm, is 400 × 200 PNG pixels: one
    // per µm, on 4 × 2 tiles of 100.
    expect(
      draws.map((draw) => draw.target[0]).sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([0, 0, 100, 100, 200, 200, 300, 300])
    expect(draws.every((draw) => draw.target[2] === 100 && draw.target[3] === 100)).toBe(
      true,
    )
  })

  it('draws a tile of the frame at its own place', async () => {
    const dapi = fakeLoader()
    const { context, draws } = recordingContext()
    const image = composer([channel(dapi.loader)], { scale: 2 })

    // The right half of the frame, x 100–200 µm, 200 PNG pixels wide.
    await image.drawTile(context, { x: 100, y: 0, width: 100, height: 100 })

    expect(dapi.reads.sort()).toEqual(['0:1:0'])
    expect(draws[0]?.target).toEqual([0, 0, 200, 200])
  })

  it('places an image whose origin is not the data origin (MERSCOPE)', async () => {
    const dapi = fakeLoader({ origin: { x: 150, y: 0 } })
    const { context, draws } = recordingContext()
    const image = composer([channel(dapi.loader)], { scale: 1 })

    await image.drawTile(context, whole)

    expect(dapi.reads).toEqual(['0:0:0'])
    expect(draws[0]?.target).toEqual([150, 0, 100, 100])
  })

  it('turns a flipped image as the canvas does', async () => {
    const dapi = fakeLoader({
      placement: { a: 1, b: 0, c: micrometers(0), d: 0, e: -1, f: micrometers(100) },
    })
    const { context, draws } = recordingContext()
    const image = composer([channel(dapi.loader)], { scale: 1 })

    await image.drawTile(context, whole)

    expect(draws.length).toBeGreaterThan(0)
    expect(draws.every((draw) => draw.transformed)).toBe(true)
  })

  it('draws a flat image (Visium) over the frame', async () => {
    const { context, draws } = recordingContext()
    const image = new ScreenshotImageComposer(
      {
        channels: [],
        flatImage: {
          url: 'https://example.test/hires.png',
          scaleFactor: 0.5,
          micrometersPerPixel: 1,
        },
        opacity: 0.6,
      },
      {
        viewState,
        frame,
        scale: 2,
        maxConcurrentRequests: 2,
        signal: new AbortController().signal,
        loadFlatImage: () =>
          Promise.resolve({ image: {} as CanvasImageSource, naturalSize: [100, 50] }),
      },
    )

    await image.drawTile(context, whole)

    // 100 px at 0.5 of full resolution: 200 µm, 400 PNG pixels at 2×.
    expect(draws).toEqual([
      expect.objectContaining({ key: 'flat', target: [0, 0, 400, 200] }),
    ])
  })

  it('reads a failed tile again after each delay, then fails naming the channel', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const dapi = fakeLoader({ failing: (_level, col) => col === 1 })
      const waits: number[] = []
      const { context } = recordingContext()
      const start = Date.now()
      const image = composer([channel(dapi.loader)], {
        scale: 1,
        waitUntil: (time) => {
          waits.push(time - start)
          vi.setSystemTime(time)
          return Promise.resolve()
        },
      })

      const drawing = image.drawTile(context, whole)
      await expect(drawing).rejects.toBeInstanceOf(ScreenshotImageError)
      await expect(drawing).rejects.toThrow(
        /A tile of DAPI could not be read: 503 for 0:1:0/,
      )
      expect(dapi.reads.filter((key) => key === '0:1:0')).toHaveLength(
        1 + TILE_RETRY_DELAYS_MS.length,
      )
      expect(waits).toEqual([1_000, 3_000, 7_000])
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads a spent tile again on Retry, with new caches', async () => {
    let failing = true
    const dapi = fakeLoader({ failing: (_level, col) => failing && col === 1 })
    const { context } = recordingContext()

    await expect(
      composer([channel(dapi.loader)], { scale: 1 }).drawTile(context, whole),
    ).rejects.toBeInstanceOf(ScreenshotImageError)

    failing = false
    const before = dapi.reads.length
    await composer([channel(dapi.loader)], { scale: 1 }).drawTile(context, whole)

    expect(dapi.reads.slice(before).sort()).toEqual(['0:0:0', '0:1:0'])
  })

  it('leaves the canvas’s tile caches as they were', async () => {
    const dapi = fakeLoader()
    const store = new MorphologyTileStore()
    const [held] = store.use('canvas', [
      {
        key: 'dapi',
        cacheOptions: () => ({ maxTiles: 4, displayWindow: { lo: 0, hi: 255 } }),
      },
    ])
    await held?.cache.request(dapi.loader, 0, 0, 0)
    const before = held?.cache.readyTiles({
      minX: micrometers(-1e6),
      maxX: micrometers(1e6),
      minY: micrometers(-1e6),
      maxY: micrometers(1e6),
    })
    const { context } = recordingContext()

    const image = composer([channel(dapi.loader)], { scale: 8 })
    await image.drawTile(context, whole)
    image.dispose()

    expect(
      held?.cache.readyTiles({
        minX: micrometers(-1e6),
        maxX: micrometers(1e6),
        minY: micrometers(-1e6),
        maxY: micrometers(1e6),
      }),
    ).toEqual(before)
  })

  it('stops reading when cancelled', async () => {
    const dapi = fakeLoader()
    const controller = new AbortController()
    const { context } = recordingContext()
    const image = composer([channel(dapi.loader)], { signal: controller.signal })

    controller.abort()

    await expect(image.drawTile(context, whole)).rejects.toThrow(/abort/i)
    expect(dapi.reads).toEqual([])
  })
})
