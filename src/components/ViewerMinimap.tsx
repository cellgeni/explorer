import { memo, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import type { BBox } from '../data/coords'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import {
  MorphologyCanvas,
  type FlatMorphologyCanvasImage,
  type MorphologyCanvasChannel,
} from './MorphologyCanvas'
import {
  minimapDeckTarget,
  minimapDrawsImage,
  minimapTileCacheTiles,
  minimapViewRect,
  type MinimapLayout,
} from './viewerMinimapModel'

const MINIMAP_TILE_REQUESTS = 2

interface ViewerMinimapProps {
  readonly layout: MinimapLayout
  readonly imageLoader: ImagePyramidLoader | null
  readonly imageChannels: readonly MorphologyCanvasChannel[]
  readonly flatImage: FlatMorphologyCanvasImage | null
  // Cells or bins as dots, when there is no image (deck.gl coordinates).
  readonly points: readonly (readonly [number, number])[]
  // The main view, in data µm.
  readonly viewBbox: BBox | null
  readonly onNavigate: (target: readonly [number, number]) => void
}

// The minimap (UNIFIED_PLAN.md, 15.4-D). It sits beside the deck.gl canvas,
// never inside it. The image is the coarsest pyramid level, drawn by its own
// MorphologyCanvas with a small tile cache; Visium's tissue image is the flat
// image; otherwise the dots show where the cells are.
export const ViewerMinimap = memo(function ViewerMinimap({
  layout,
  imageLoader,
  imageChannels,
  flatImage,
  points,
  viewBbox,
  onNavigate,
}: ViewerMinimapProps) {
  const draggingRef = useRef(false)
  const hasImage = minimapDrawsImage(imageLoader, imageChannels, flatImage)
  const tileCacheMaxTiles = useMemo(
    () => minimapTileCacheTiles(imageLoader, imageChannels.length),
    [imageLoader, imageChannels.length],
  )
  const viewRect = viewBbox === null ? null : minimapViewRect(viewBbox, layout)

  function navigate(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    onNavigate(
      minimapDeckTarget(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        layout,
      ),
    )
  }

  return (
    <div
      className="viewer-minimap"
      style={{ width: layout.width, height: layout.height }}
      role="img"
      aria-label="Minimap of the whole dataset; the box is the view"
      title="Minimap: click or drag to move the view"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        draggingRef.current = true
        event.currentTarget.setPointerCapture?.(event.pointerId)
        navigate(event)
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) navigate(event)
      }}
      onPointerUp={(event) => {
        draggingRef.current = false
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => {
        draggingRef.current = false
      }}
    >
      {hasImage ? (
        <MorphologyCanvas
          loader={imageLoader}
          channels={imageChannels}
          flatImage={flatImage}
          viewState={layout.viewState}
          maxConcurrentTileRequests={MINIMAP_TILE_REQUESTS}
          tileCacheMaxTiles={tileCacheMaxTiles}
        />
      ) : (
        <MinimapDots layout={layout} points={points} />
      )}
      {viewRect === null ? null : (
        <span
          className="viewer-minimap-view"
          style={{
            left: viewRect.left,
            top: viewRect.top,
            width: viewRect.width,
            height: viewRect.height,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  )
})

function MinimapDots({
  layout,
  points,
}: {
  readonly layout: MinimapLayout
  readonly points: readonly (readonly [number, number])[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return

    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.round(layout.width * pixelRatio)
    canvas.height = Math.round(layout.height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, layout.width, layout.height)
    context.fillStyle =
      getComputedStyle(canvas).getPropertyValue('--minimap-dot').trim() || '#8a94a6'

    const { viewState } = layout
    const scale = 2 ** viewState.zoom
    const offsetX = layout.width / 2 - viewState.target[0] * scale
    const offsetY = layout.height / 2 + viewState.target[1] * scale

    for (const [x, y] of points) {
      context.fillRect(x * scale + offsetX, -y * scale + offsetY, 1, 1)
    }
  }, [layout, points])

  return <canvas ref={canvasRef} className="viewer-minimap-dots" aria-hidden="true" />
}
