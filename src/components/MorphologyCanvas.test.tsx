import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { MorphologyCanvas } from './MorphologyCanvas'
import type { BBox, TileIndex } from '../data/coords'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { ReadyTile, TileCacheEntry } from '../tiff/tileCache'
import type { TiffPyramidLoader } from '../tiff/loader'

interface MockTileRequest {
  readonly key: string
  readonly promise: Promise<TileCacheEntry>
  readonly resolve: () => void
}

const tileCacheMock = vi.hoisted(() => {
  const requests: MockTileRequest[] = []

  class MockTileCache {
    private readonly entries = new Map<string, TileCacheEntry>()

    key(level: number, col: number, row: number): string {
      return `${level}:${col}:${row}`
    }

    get(level: number, col: number, row: number): TileCacheEntry | undefined {
      return this.entries.get(this.key(level, col, row))
    }

    request(
      loader: TiffPyramidLoader,
      level: number,
      col: number,
      row: number,
      signal?: AbortSignal,
    ): Promise<TileCacheEntry> {
      const key = this.key(level, col, row)
      const existing = this.entries.get(key)

      if (existing !== undefined) {
        return existing.state === 'loading' ? existing.promise : Promise.resolve(existing)
      }

      const bounds = loader.tileBounds(level, col, row)
      const sourceSize = loader.tileSourceSize(level, col, row)
      let resolveRequest = () => {}
      const promise = new Promise<TileCacheEntry>((resolve) => {
        resolveRequest = () => {
          const ready: TileCacheEntry = {
            state: 'ready',
            level,
            bounds,
            bitmap: { close: vi.fn() } as unknown as ImageBitmap,
            sourceWidth: sourceSize.width,
            sourceHeight: sourceSize.height,
          }

          this.entries.set(key, ready)
          resolve(ready)
        }
      })
      const loading: TileCacheEntry = {
        state: 'loading',
        bounds,
        promise,
        ...(signal === undefined ? {} : { signal }),
      }

      this.entries.set(key, loading)
      requests.push({ key, promise, resolve: resolveRequest })
      return promise
    }

    readyTiles(bbox: BBox, level?: number): readonly ReadyTile[] {
      const ready: ReadyTile[] = []

      for (const [id, entry] of this.entries) {
        if (
          entry.state !== 'ready' ||
          (level !== undefined && entry.level !== level) ||
          !bboxesOverlap(entry.bounds, bbox)
        ) {
          continue
        }

        ready.push({
          id,
          level: entry.level,
          image: entry.bitmap,
          bounds: entry.bounds,
          sourceWidth: entry.sourceWidth,
          sourceHeight: entry.sourceHeight,
        })
      }

      return ready
    }

    clear(): void {
      this.entries.clear()
    }
  }

  return {
    requests,
    reset: () => {
      requests.splice(0)
    },
    TileCache: MockTileCache,
  }
})

vi.mock('../tiff/tileCache', () => ({
  TileCache: tileCacheMock.TileCache,
}))

const rect = {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  top: 0,
  right: 200,
  bottom: 100,
  left: 0,
  toJSON: () => ({}),
} as DOMRect

describe('MorphologyCanvas', () => {
  afterEach(() => {
    tileCacheMock.reset()
    vi.restoreAllMocks()
  })

  it('waits for a drawable tile before clearing the canvas', async () => {
    const context = canvasContext()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )

    render(
      <MorphologyCanvas
        loader={mockLoader()}
        viewState={viewState}
        maxConcurrentTileRequests={2}
      />,
    )

    await waitFor(() => {
      expect(tileCacheMock.requests).toHaveLength(2)
    })
    expect(context.clearRect).not.toHaveBeenCalled()
    expect(context.drawImage).not.toHaveBeenCalled()

    await act(async () => {
      tileCacheMock.requests[0]?.resolve()
      await tileCacheMock.requests[0]?.promise
    })

    await waitFor(() => {
      expect(context.clearRect).toHaveBeenCalledTimes(1)
    })
    expect(context.drawImage).toHaveBeenCalledTimes(1)

    await act(async () => {
      tileCacheMock.requests[1]?.resolve()
      await tileCacheMock.requests[1]?.promise
    })

    await waitFor(() => {
      expect(context.clearRect).toHaveBeenCalledTimes(2)
    })
    expect(context.drawImage).toHaveBeenCalledTimes(3)
  })

  it('redraws cached tiles with the current view while new viewport tiles load', async () => {
    const context = canvasContext()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    let tilesForBboxCallCount = 0
    const loader = mockLoader({
      tilesForBbox: () => {
        tilesForBboxCallCount += 1
        return tilesForBboxCallCount > 1
          ? [
              { col: 1, row: 0 },
              { col: 2, row: 0 },
            ]
          : [
              { col: 0, row: 0 },
              { col: 1, row: 0 },
            ]
      },
    })
    const { rerender } = render(
      <MorphologyCanvas
        loader={loader}
        viewState={viewState}
        maxConcurrentTileRequests={2}
      />,
    )

    await waitFor(() => {
      expect(tileCacheMock.requests).toHaveLength(2)
    })
    await act(async () => {
      tileCacheMock.requests[0]?.resolve()
      tileCacheMock.requests[1]?.resolve()
      await Promise.all([
        tileCacheMock.requests[0]?.promise,
        tileCacheMock.requests[1]?.promise,
      ])
    })
    await waitFor(() => {
      expect(context.clearRect).toHaveBeenCalledTimes(1)
    })
    const drawCountBeforeZoom = context.drawImage.mock.calls.length
    const leftmostDrawBeforeZoom = Math.min(
      ...context.drawImage.mock.calls.map((call) => Number(call[5])),
    )

    rerender(
      <MorphologyCanvas
        loader={loader}
        viewState={{ ...viewState, target: [120, -25, 0] }}
        maxConcurrentTileRequests={2}
      />,
    )

    await waitFor(() => {
      expect(context.clearRect.mock.calls.length).toBeGreaterThan(1)
    })
    expect(context.drawImage.mock.calls.length).toBeGreaterThan(drawCountBeforeZoom)
    const leftmostDrawAfterZoom = Math.min(
      ...context.drawImage.mock.calls
        .slice(drawCountBeforeZoom)
        .map((call) => Number(call[5])),
    )
    expect(leftmostDrawAfterZoom).toBeLessThan(leftmostDrawBeforeZoom)
    await waitFor(() => {
      expect(tileCacheMock.requests).toHaveLength(3)
    })
  })

  it('uses one cached pyramid level for fallback redraws', async () => {
    const context = canvasContext()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    let requestedLevel = 2
    const loader = mockLoader({
      bestLevel: () => requestedLevel,
      tilesForBbox: () => [{ col: 0, row: 0 }],
    })
    const { rerender } = render(
      <MorphologyCanvas
        loader={loader}
        viewState={viewState}
        maxConcurrentTileRequests={1}
      />,
    )

    await waitFor(() => {
      expect(tileCacheMock.requests.map((request) => request.key)).toEqual(['2:0:0'])
    })
    await act(async () => {
      tileCacheMock.requests[0]?.resolve()
      await tileCacheMock.requests[0]?.promise
    })
    await waitFor(() => {
      expect(context.clearRect).toHaveBeenCalledTimes(1)
    })

    requestedLevel = 1
    rerender(
      <MorphologyCanvas
        loader={loader}
        viewState={{ ...viewState }}
        maxConcurrentTileRequests={1}
      />,
    )

    await waitFor(() => {
      expect(tileCacheMock.requests.map((request) => request.key)).toEqual([
        '2:0:0',
        '1:0:0',
      ])
    })
    await act(async () => {
      tileCacheMock.requests[1]?.resolve()
      await tileCacheMock.requests[1]?.promise
    })
    await waitFor(() => {
      expect(context.drawImage.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    const drawCountBeforeFallback = context.drawImage.mock.calls.length
    const clearCountBeforeFallback = context.clearRect.mock.calls.length

    requestedLevel = 0
    rerender(
      <MorphologyCanvas
        loader={loader}
        viewState={{ ...viewState }}
        maxConcurrentTileRequests={1}
      />,
    )

    await waitFor(() => {
      expect(tileCacheMock.requests.map((request) => request.key)).toEqual([
        '2:0:0',
        '1:0:0',
        '0:0:0',
      ])
    })
    await waitFor(() => {
      expect(context.clearRect.mock.calls.length).toBeGreaterThan(
        clearCountBeforeFallback,
      )
    })

    expect(context.drawImage.mock.calls.slice(drawCountBeforeFallback)).toHaveLength(1)
  })
})

const viewState: OverviewViewState = {
  target: [50, -25, 0],
  zoom: 0,
  minZoom: -10,
  maxZoom: 10,
}

function canvasContext() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  }
}

function mockLoader(
  options: {
    readonly bestLevel?: (deckScale: number) => number
    readonly tilesForBbox?: (bbox: BBox) => readonly TileIndex[]
  } = {},
): TiffPyramidLoader {
  const tiles: readonly TileIndex[] = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]

  return {
    url: 'https://example.test/morphology.ome.tif',
    bestLevel: options.bestLevel ?? (() => 0),
    tileDecodeOptions: () => ({ tileWidth: 64, tileHeight: 64 }),
    tilesForBbox: (_level: number, bbox: BBox) => options.tilesForBbox?.(bbox) ?? tiles,
    tileBounds: (_level: number, col: number): BBox => ({
      minX: micrometers(col * 64),
      maxX: micrometers((col + 1) * 64),
      minY: micrometers(0),
      maxY: micrometers(64),
    }),
    tileSourceSize: () => ({ width: 64, height: 64 }),
  } as unknown as TiffPyramidLoader
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}
