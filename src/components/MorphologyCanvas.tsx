import { useEffect, useRef, useState } from 'react'
import {
  drawMorphologyTiles,
  morphologyViewportBbox,
  selectCenteredTiles,
} from '../rendering/morphologyCanvas'
import { TileCache } from '../tiff/tileCache'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { OverviewViewState } from '../rendering/deckLayers'

const MAX_INITIAL_TILE_REQUESTS = 24

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
    const tiles = selectCenteredTiles(
      loader.tilesForBbox(level, bbox),
      MAX_INITIAL_TILE_REQUESTS,
      bbox,
      (tile) => loader.tileBounds(level, tile.col, tile.row),
    )
    let cancelled = false

    const drawReadyTiles = () => {
      if (cancelled) {
        return
      }

      syncCanvasBackingStore(canvas, context, viewport)
      drawMorphologyTiles(context, cache.readyTiles(bbox), viewState, viewport)
    }

    drawReadyTiles()

    for (const tile of tiles) {
      void cache.request(loader, level, tile.col, tile.row).then(drawReadyTiles)
    }

    return () => {
      cancelled = true
    }
  }, [loader, onTileError, viewState, viewport])

  return <canvas ref={canvasRef} className="morphology-canvas" aria-hidden="true" />
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
