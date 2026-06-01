import { useEffect, useRef, useState } from 'react'
import { micrometers, scaleFromZoom, type BBox, type TileIndex } from '../data/coords'
import {
  drawMorphologyTiles,
  morphologyViewportBbox,
  selectCenteredTiles,
} from '../rendering/morphologyCanvas'
import { TileCache } from '../tiff/tileCache'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { TileCacheEntry } from '../tiff/tileCache'
import type { OverviewViewState } from '../rendering/deckLayers'

const MAX_INITIAL_TILE_REQUESTS = 96
const MAX_CONCURRENT_TILE_REQUESTS = 4
const PREFETCH_SCREEN_MARGIN_PIXELS = 256

export interface MorphologyCanvasProps {
  readonly loader?: TiffPyramidLoader | null
  readonly viewState: OverviewViewState
  readonly onTileError?: (error: Error) => void
}

export function MorphologyCanvas({
  loader,
  viewState,
  onTileError,
}: MorphologyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cacheRef = useRef<TileCache | null>(null)
  const previousLoaderRef = useRef<TiffPyramidLoader | null>(null)
  const [viewport, setViewport] = useState<CssViewportSize>({
    width: 0,
    height: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const updateViewport = () => {
      const rect = canvas.getBoundingClientRect()
      setViewport({
        width: rect.width || canvas.clientWidth,
        height: rect.height || canvas.clientHeight,
      })
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport)
    observer?.observe(canvas)

    return () => {
      window.removeEventListener('resize', updateViewport)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null || viewport.width <= 0 || viewport.height <= 0) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    syncCanvasBackingStore(canvas, context, viewport)

    if (loader === null || loader === undefined) {
      context.clearRect(0, 0, viewport.width, viewport.height)
      cacheRef.current?.clear()
      previousLoaderRef.current = null
      return
    }

    if (previousLoaderRef.current !== loader) {
      cacheRef.current?.clear()
      previousLoaderRef.current = loader
    }

    const cache = (cacheRef.current ??= new TileCache({
      maxTiles: 96,
      ...(onTileError === undefined ? {} : { onError: onTileError }),
    }))
    const bbox = morphologyViewportBbox(viewState, viewport)
    const level = loader.bestLevel(2 ** viewState.zoom)
    const tileRequestBbox = expandBboxByScreenPixels(
      bbox,
      viewState.zoom,
      PREFETCH_SCREEN_MARGIN_PIXELS,
    )
    const tiles = selectCenteredTiles(
      loader.tilesForBbox(level, tileRequestBbox),
      MAX_INITIAL_TILE_REQUESTS,
      bbox,
      (tile) => loader.tileBounds(level, tile.col, tile.row),
    )
    const abortController = new AbortController()
    let cancelled = false

    const drawReadyTiles = () => {
      if (cancelled) {
        return
      }

      syncCanvasBackingStore(canvas, context, viewport)
      drawMorphologyTiles(context, cache.readyTiles(bbox, level), viewState, viewport)
    }

    drawReadyTiles()
    void requestTilesInPriorityOrder({
      cache,
      level,
      loader,
      onTileSettled: drawReadyTiles,
      signal: abortController.signal,
      tiles,
    })

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [loader, onTileError, viewState, viewport])

  return <canvas ref={canvasRef} className="morphology-canvas" aria-hidden="true" />
}

interface RequestTilesOptions {
  readonly cache: TileCache
  readonly level: number
  readonly loader: TiffPyramidLoader
  readonly onTileSettled: () => void
  readonly signal: AbortSignal
  readonly tiles: readonly TileIndex[]
}

async function requestTilesInPriorityOrder(options: RequestTilesOptions): Promise<void> {
  const queue = [...options.tiles]
  const workerCount = Math.min(MAX_CONCURRENT_TILE_REQUESTS, queue.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (!options.signal.aborted) {
      const tile = queue.shift()

      if (tile === undefined) {
        return
      }

      const entry = await options.cache.request(
        options.loader,
        options.level,
        tile.col,
        tile.row,
        options.signal,
      )

      if (!isAbortEntry(entry)) {
        options.onTileSettled()
      }
    }
  })

  await Promise.allSettled(workers)
}

function isAbortEntry(entry: TileCacheEntry): boolean {
  return entry.state === 'error' && entry.error.name === 'AbortError'
}

function expandBboxByScreenPixels(bbox: BBox, zoom: number, screenPixels: number): BBox {
  const margin = screenPixels / scaleFromZoom(zoom)

  return {
    minX: micrometers(Math.max(0, bbox.minX - margin)),
    maxX: micrometers(bbox.maxX + margin),
    minY: micrometers(Math.max(0, bbox.minY - margin)),
    maxY: micrometers(bbox.maxY + margin),
  }
}

function syncCanvasBackingStore(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  viewport: CssViewportSize,
): void {
  const pixelRatio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(viewport.width * pixelRatio))
  const height = Math.max(1, Math.round(viewport.height * pixelRatio))

  if (canvas.width !== width) {
    canvas.width = width
  }

  if (canvas.height !== height) {
    canvas.height = height
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
}
