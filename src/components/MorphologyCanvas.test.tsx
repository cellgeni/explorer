import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
import { MorphologyTileStore } from '../rendering/morphologyTileStore'
import { TiffPyramidLoader } from '../tiff/loader'
import { MorphologyCanvas } from './MorphologyCanvas'
import type { BBox, TileIndex } from '../data/coords'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { ReadyTile, TileCacheEntry } from '../tiff/tileCache'
import type { TiffChunk, TiffLevelMeta } from '../tiff/loader'

interface MockTileRequest {
  readonly key: string
  // The loader's URL: each plane of an image has its own.
  readonly url: string
  readonly promise: Promise<TileCacheEntry>
  readonly resolve: () => void
  // Fails the read; the tile may be read again from retryAt, as the cache's.
  readonly fail: (retryAt: number) => void
}

const tileCacheMock = vi.hoisted(() => {
  const requests: MockTileRequest[] = []
  // The colour each cache was made with, in order.
  const colors: (readonly [number, number, number] | undefined)[] = []

  class MockTileCache {
    private readonly entries = new Map<string, TileCacheEntry>()

    constructor(options: { readonly color?: readonly [number, number, number] } = {}) {
      colors.push(options.color)
    }

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

      if (
        existing !== undefined &&
        !(
          existing.state === 'error' &&
          existing.retryAt !== undefined &&
          Date.now() >= existing.retryAt
        )
      ) {
        return existing.state === 'loading' ? existing.promise : Promise.resolve(existing)
      }

      const bounds = loader.tileBounds(level, col, row)
      const sourceSize = loader.tileSourceSize(level, col, row)
      let resolveRequest = () => {}
      let failRequest: (retryAt: number) => void = () => {}
      const promise = new Promise<TileCacheEntry>((resolve) => {
        failRequest = (retryAt) => {
          const failed: TileCacheEntry = {
            state: 'error',
            bounds,
            error: new TypeError('Failed to fetch'),
            failures: 1,
            retryAt,
          }

          this.entries.set(key, failed)
          resolve(failed)
        }
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
      requests.push({
        key,
        url: loader.url,
        promise,
        resolve: resolveRequest,
        fail: failRequest,
      })
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

    readyPixels(): number {
      return [...this.entries.values()].filter((entry) => entry.state === 'ready').length
    }

    clear(): void {
      this.entries.clear()
    }
  }

  return {
    requests,
    colors,
    reset: () => {
      requests.splice(0)
      colors.splice(0)
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

  it('reads a failed tile again and draws it, with the view still (EXP-296)', async () => {
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
    await act(async () => {
      tileCacheMock.requests[0]?.resolve()
      tileCacheMock.requests[1]?.fail(Date.now() + 20)
      await Promise.all([
        tileCacheMock.requests[0]?.promise,
        tileCacheMock.requests[1]?.promise,
      ])
    })
    // The ready tile, drawn as it came and again once the other failed.
    await waitFor(() => {
      expect(context.drawImage).toHaveBeenCalledTimes(2)
    })

    // Once its retry time comes, the tile is asked for again.
    await waitFor(() => {
      expect(tileCacheMock.requests).toHaveLength(3)
    })
    expect(tileCacheMock.requests[2]?.key).toBe(tileCacheMock.requests[1]?.key)

    await act(async () => {
      tileCacheMock.requests[2]?.resolve()
      await tileCacheMock.requests[2]?.promise
    })
    await waitFor(() => {
      expect(context.drawImage).toHaveBeenCalledTimes(4)
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

  // The placed image is 1200 × 800 µm in 200 µm tiles. The canvas is 200 × 100
  // px at zoom 0, and the prefetch margin adds 256 µm on each side.
  it('requests the visible tiles of an image at a negative origin', async () => {
    mockCanvasContext()

    // The image spans x -600 to 600 and y -400 to 400. The view, x -400 to
    // -200 and y -250 to -150, sees tiles (1, 0) and (1, 1). With the margin
    // it reaches x -656 to 56 and y -506 to 106: columns 0-3, rows 0-2.
    render(
      <MorphologyCanvas
        loader={placedLoader({ x: -600, y: -400 })}
        viewState={{ ...viewState, target: [-300, 200, 0] }}
        maxConcurrentTileRequests={64}
      />,
    )

    await waitFor(() => {
      expect(requestedTileKeys().sort()).toEqual(
        tileKeys({ cols: [0, 1, 2, 3], rows: [0, 1, 2] }),
      )
    })
    expect(requestedTileKeys().slice(0, 2)).toEqual(['0:1:0', '0:1:1'])
  })

  it('requests tiles for a view wholly at negative coordinates', async () => {
    mockCanvasContext()

    // The view, x -550 to -350 and y -300 to -200, sees tiles (0, 0) and
    // (1, 0). With the margin it reaches x -806 to -94 and y -556 to 56,
    // still left of x = 0: columns 0-2, rows 0-2.
    render(
      <MorphologyCanvas
        loader={placedLoader({ x: -600, y: -400 })}
        viewState={{ ...viewState, target: [-450, 250, 0] }}
        maxConcurrentTileRequests={64}
      />,
    )

    await waitFor(() => {
      expect(requestedTileKeys().sort()).toEqual(
        tileKeys({ cols: [0, 1, 2], rows: [0, 1, 2] }),
      )
    })
    expect(requestedTileKeys().slice(0, 2)).toEqual(['0:0:0', '0:1:0'])
  })

  it('requests no tiles left of or above an image at the data origin', async () => {
    mockCanvasContext()

    // The view, x -50 to 150 and y -25 to 75, overhangs the image's top-left
    // corner. With the margin it reaches x -306 to 406 and y -281 to 331, but
    // only columns 0-2 and rows 0-1 of the image are requested.
    render(
      <MorphologyCanvas
        loader={placedLoader({ x: 0, y: 0 })}
        viewState={viewState}
        maxConcurrentTileRequests={64}
      />,
    )

    await waitFor(() => {
      expect(requestedTileKeys().sort()).toEqual(
        tileKeys({ cols: [0, 1, 2], rows: [0, 1] }),
      )
    })
    expect(requestedTileKeys()[0]).toBe('0:0:0')
  })

  it('requests tiles in the frame of an image with swapped axes', async () => {
    mockCanvasContext()
    // x' = y, y' = 1200 - x: the 1200 × 800 frame covers x 0 to 800 and y 0
    // to 1200. The view with its margin, x -306 to 406 and y -281 to 331, is
    // frame x 869 to 1481 and y -306 to 406: columns 4-5, rows 0-2.
    const loader = Object.assign(placedLoader({ x: 0, y: 0 }), {
      placement: {
        a: 0,
        b: 1,
        c: micrometers(0),
        d: -1,
        e: 0,
        f: micrometers(1200),
      },
    })

    render(
      <MorphologyCanvas
        loader={loader}
        viewState={viewState}
        maxConcurrentTileRequests={64}
      />,
    )

    await waitFor(() => {
      expect(requestedTileKeys().sort()).toEqual(
        tileKeys({ cols: [4, 5], rows: [0, 1, 2] }),
      )
    })
    // The view's centre, frame (1175, 50), is in tile (5, 0).
    expect(requestedTileKeys()[0]).toBe('0:5:0')
  })

  it("decodes a channel's tiles again in its new colour (EXP-043)", async () => {
    mockCanvasContext()
    const loader = mockLoader()
    const channel = (color: readonly [number, number, number]) => [
      {
        id: 'Channel:0',
        loader,
        enabled: true,
        color,
        contrast: { lo: 0, hi: 255 },
      },
    ]
    const { rerender } = render(
      <MorphologyCanvas channels={channel([255, 0, 0])} viewState={viewState} />,
    )

    await waitFor(() => {
      expect(tileCacheMock.requests).toHaveLength(2)
    })

    rerender(<MorphologyCanvas channels={channel([0, 255, 0])} viewState={viewState} />)

    // The tiles bake the colour in, so the red cache cannot serve green.
    await waitFor(() => {
      expect(tileCacheMock.colors).toEqual([
        [255, 0, 0],
        [0, 255, 0],
      ])
    })
    await waitFor(() => {
      expect(tileCacheMock.requests).toHaveLength(4)
    })
  })

  describe('at the planes of an image (plan 28)', () => {
    const channelsAt = (loader: TiffPyramidLoader) => [
      { id: 'DNA', loader, enabled: true, color: [0, 0, 255] as const },
    ]
    const frameAt = (t: number) => ({ image: 'planes', plane: `:${t.toString()}` })

    async function resolveRequests(requests: readonly MockTileRequest[]) {
      await act(async () => {
        for (const request of requests) request.resolve()
        await Promise.all(requests.map((request) => request.promise))
      })
    }

    function requestsAt(t: number): MockTileRequest[] {
      return tileCacheMock.requests.filter((request) =>
        request.url.endsWith(`#t=${t.toString()}`),
      )
    }

    it('keeps the shown plane until the visible tiles of the next are read (28-D6)', async () => {
      const context = canvasContext()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      )
      const at = planeLoaders()
      const onFrameShown = vi.fn()
      const { rerender } = render(
        <MorphologyCanvas
          channels={channelsAt(at(0))}
          frame={frameAt(0)}
          onFrameShown={onFrameShown}
          viewState={viewState}
        />,
      )

      await waitFor(() => {
        expect(requestsAt(0)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(0))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenCalledWith(frameAt(0))
      })
      const drawsAtZero = context.drawImage.mock.calls.length

      rerender(
        <MorphologyCanvas
          channels={channelsAt(at(1))}
          frame={frameAt(1)}
          onFrameShown={onFrameShown}
          viewState={viewState}
        />,
      )

      await waitFor(() => {
        expect(requestsAt(1)).toHaveLength(2)
      })
      const clearsWhileHeld = context.clearRect.mock.calls.length
      // The shown plane is drawn again, and not the half-read one.
      expect(context.drawImage.mock.calls.length).toBe(drawsAtZero * 2)

      await resolveRequests(requestsAt(1).slice(0, 1))
      expect(context.clearRect.mock.calls.length).toBe(clearsWhileHeld)
      expect(onFrameShown).toHaveBeenCalledTimes(1)

      await resolveRequests(requestsAt(1).slice(1))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenLastCalledWith(frameAt(1))
      })
      expect(context.clearRect.mock.calls.length).toBe(clearsWhileHeld + 1)
      expect(context.drawImage.mock.calls.length).toBe(drawsAtZero * 2 + 2)
    })

    it('waits for the outlines of the next plane too (28-D9)', async () => {
      const context = canvasContext()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      )
      const at = planeLoaders()
      const onFrameShown = vi.fn()
      const canvasAt = (t: number, outlinesAt: number) => (
        <MorphologyCanvas
          channels={channelsAt(at(t))}
          frame={frameAt(t)}
          outlinesPlane={frameAt(outlinesAt).plane}
          onFrameShown={onFrameShown}
          prefetchPlanes={[{ t: 1 }]}
          viewState={viewState}
        />
      )
      const { rerender } = render(canvasAt(0, 0))

      await waitFor(() => {
        expect(requestsAt(0)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(0))
      await waitFor(() => {
        expect(requestsAt(1)).toHaveLength(1)
      })
      await resolveRequests(requestsAt(1))
      await waitFor(() => {
        expect(requestsAt(1)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(1).slice(1))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenLastCalledWith(frameAt(0))
      })
      const clearsAtZero = context.clearRect.mock.calls.length

      // Time point 1's tiles are read, but its outlines are not.
      rerender(canvasAt(1, 0))
      await act(async () => {
        await Promise.resolve()
      })
      expect(onFrameShown).toHaveBeenCalledTimes(1)
      const drawsHeld = context.drawImage.mock.calls.length

      rerender(canvasAt(1, 1))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenLastCalledWith(frameAt(1))
      })
      expect(context.clearRect.mock.calls.length).toBeGreaterThan(clearsAtZero)
      expect(context.drawImage.mock.calls.length).toBe(drawsHeld + 2)
    })

    it("draws a slow plane's tiles as they come after the fallback time", async () => {
      const context = canvasContext()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      )
      const at = planeLoaders()
      const { rerender } = render(
        <MorphologyCanvas
          channels={channelsAt(at(0))}
          frame={frameAt(0)}
          frameFallbackMs={40}
          viewState={viewState}
        />,
      )

      await waitFor(() => {
        expect(requestsAt(0)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(0))
      rerender(
        <MorphologyCanvas
          channels={channelsAt(at(1))}
          frame={frameAt(1)}
          frameFallbackMs={40}
          viewState={viewState}
        />,
      )
      await waitFor(() => {
        expect(requestsAt(1)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(1).slice(0, 1))
      const drawsBeforeFallback = context.drawImage.mock.calls.length

      // The one tile read is drawn once the time passes.
      await waitFor(() => {
        expect(context.drawImage.mock.calls.length).toBe(drawsBeforeFallback + 1)
      })
    })

    it('shows the last plane asked for when another step comes first', async () => {
      mockCanvasContext()
      const at = planeLoaders()
      const onFrameShown = vi.fn()
      const canvasAt = (t: number) => (
        <MorphologyCanvas
          channels={channelsAt(at(t))}
          frame={frameAt(t)}
          onFrameShown={onFrameShown}
          viewState={viewState}
        />
      )
      const { rerender } = render(canvasAt(0))

      await waitFor(() => {
        expect(requestsAt(0)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(0))
      rerender(canvasAt(1))
      await waitFor(() => {
        expect(requestsAt(1)).toHaveLength(2)
      })
      rerender(canvasAt(2))
      await waitFor(() => {
        expect(requestsAt(2)).toHaveLength(2)
      })

      await resolveRequests(requestsAt(1))
      await resolveRequests(requestsAt(2))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenLastCalledWith(frameAt(2))
      })
      expect(onFrameShown.mock.calls.map(([frame]) => frame)).toEqual([
        frameAt(0),
        frameAt(2),
      ])
    })

    it('reads the next planes without drawing them, and replays played ones (28-D8)', async () => {
      const context = canvasContext()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      )
      const at = planeLoaders()
      const onFrameShown = vi.fn()
      const canvasAt = (t: number, prefetch: readonly number[]) => (
        <MorphologyCanvas
          channels={channelsAt(at(t))}
          frame={frameAt(t)}
          onFrameShown={onFrameShown}
          prefetchPlanes={prefetch.map((next) => ({ t: next }))}
          viewState={viewState}
        />
      )
      const { rerender } = render(canvasAt(0, [1, 2]))

      // The shown plane is read first; each next plane a tile at a time.
      await waitFor(() => {
        expect(tileCacheMock.requests).toHaveLength(4)
      })
      expect(tileCacheMock.requests.slice(0, 2)).toEqual(requestsAt(0))
      expect(requestsAt(1)).toHaveLength(1)
      expect(requestsAt(2)).toHaveLength(1)
      await resolveRequests(requestsAt(1))
      await waitFor(() => {
        expect(requestsAt(1)).toHaveLength(2)
      })
      await resolveRequests(requestsAt(1).slice(1))
      expect(context.drawImage).not.toHaveBeenCalled()

      await resolveRequests(requestsAt(0))
      const drawsAtZero = context.drawImage.mock.calls.length

      // The next plane is whole already: it is drawn at once.
      rerender(canvasAt(1, [2, 3]))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenLastCalledWith(frameAt(1))
      })
      expect(requestsAt(1)).toHaveLength(2)
      expect(context.drawImage.mock.calls.length).toBe(drawsAtZero + 2)
      await waitFor(() => {
        expect(requestsAt(3)).toHaveLength(1)
      })

      // Back to a played plane: drawn from memory.
      rerender(canvasAt(0, []))
      await waitFor(() => {
        expect(onFrameShown).toHaveBeenLastCalledWith(frameAt(0))
      })
      expect(requestsAt(0)).toHaveLength(2)
    })

    it('reads the next planes again when the view moves', async () => {
      mockCanvasContext()
      const at = planeLoaders({
        tilesForBbox: (bbox) =>
          bbox.minX > 0
            ? [
                { col: 2, row: 0 },
                { col: 3, row: 0 },
              ]
            : [
                { col: 0, row: 0 },
                { col: 1, row: 0 },
              ],
      })
      const canvasWith = (view: OverviewViewState) => (
        <MorphologyCanvas
          channels={channelsAt(at(0))}
          frame={frameAt(0)}
          prefetchPlanes={[{ t: 1 }]}
          viewState={view}
        />
      )
      const { rerender } = render(canvasWith(viewState))

      await waitFor(() => {
        expect(requestsAt(1).map((request) => request.key)).toEqual(['0:0:0'])
      })

      // The read for the old view stops; the new view's tiles are read,
      // nearest its centre first.
      rerender(canvasWith({ ...viewState, target: [250, -25, 0] }))

      await waitFor(() => {
        expect(requestsAt(1).map((request) => request.key)).toEqual(['0:0:0', '0:3:0'])
      })
    })
  })

  describe('with a tile store shared by several canvases (plan 23-D11)', () => {
    it('reads a tile two canvases show once', async () => {
      mockCanvasContext()
      const loader = placedLoader({ x: -600, y: -400 })
      const store = new MorphologyTileStore({ prefetch: false })
      const view: OverviewViewState = { ...viewState, target: [-300, 200, 0] }

      render(
        <>
          <MorphologyCanvas loader={loader} viewState={view} tileStore={store} />
          <MorphologyCanvas loader={loader} viewState={view} tileStore={store} />
        </>,
      )

      // The view, x -400 to -200 and y -250 to -150, sees tiles (1, 0) and
      // (1, 1); without a prefetch margin nothing more is read.
      await waitFor(() => {
        expect(requestedTileKeys().sort()).toEqual(['0:1:0', '0:1:1'])
      })
    })

    it('keeps the tiles for the next canvas when one unmounts', async () => {
      const context = canvasContext()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      )
      const loader = mockLoader()
      const store = new MorphologyTileStore()
      const first = render(
        <MorphologyCanvas loader={loader} viewState={viewState} tileStore={store} />,
      )

      await waitFor(() => {
        expect(tileCacheMock.requests).toHaveLength(2)
      })
      await act(async () => {
        for (const request of tileCacheMock.requests) request.resolve()
        await Promise.all(tileCacheMock.requests.map((request) => request.promise))
      })
      first.unmount()
      const drawsBefore = context.drawImage.mock.calls.length

      render(<MorphologyCanvas loader={loader} viewState={viewState} tileStore={store} />)

      await waitFor(() => {
        expect(context.drawImage.mock.calls.length).toBe(drawsBefore + 2)
      })
      expect(tileCacheMock.requests).toHaveLength(2)
    })
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

function mockCanvasContext() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvasContext() as unknown as CanvasRenderingContext2D,
  )
}

// A one-level 1200 × 800 px image at 1 µm/px in 200 px tiles, with its
// top-left corner at `origin`. Tile requests go to the mocked tile cache.
function placedLoader(origin: { readonly x: number; readonly y: number }) {
  return new TiffPyramidLoader({
    url: 'https://example.test/placed.ome.tif',
    chunkIndex: new Map<string, TiffChunk>(),
    levelMeta: new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(1200), height: imagePixels(800), nCols: 6, nRows: 4 }],
    ]),
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(1),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    tileWidth: imagePixels(200),
    tileHeight: imagePixels(200),
    numLevels: 1,
    imageWidth: imagePixels(1200),
    imageHeight: imagePixels(800),
    byteRangeCache: null,
    origin,
  })
}

function requestedTileKeys(): string[] {
  return tileCacheMock.requests.map((request) => request.key)
}

function tileKeys(options: {
  readonly cols: readonly number[]
  readonly rows: readonly number[]
}): readonly string[] {
  return options.rows
    .flatMap((row) => options.cols.map((col) => `0:${col.toString()}:${row.toString()}`))
    .sort()
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

// One loader for each time point of an image, each making the others, as an
// OME-Zarr loader's `atPlane` does.
function planeLoaders(
  options: { readonly tilesForBbox?: (bbox: BBox) => readonly TileIndex[] } = {},
): (t: number) => TiffPyramidLoader {
  const loaders = new Map<number, TiffPyramidLoader>()
  const at = (t: number): TiffPyramidLoader => {
    let loader = loaders.get(t)

    if (loader === undefined) {
      loader = {
        ...mockLoader(options),
        url: `https://example.test/planes.ome.zarr#t=${t.toString()}`,
        atPlane: (plane: { readonly t?: number }) => at(plane.t ?? t),
      } as unknown as TiffPyramidLoader
      loaders.set(t, loader)
    }

    return loader
  }

  return at
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}
