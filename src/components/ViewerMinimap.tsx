import { memo, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import type { BBox } from '../data/coords'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import {
  MorphologyCanvas,
  type FlatMorphologyCanvasImage,
  type MorphologyCanvasChannel,
  type MorphologyCanvasFrame,
} from './MorphologyCanvas'
import {
  minimapDeckTarget,
  minimapDrawsImage,
  minimapImageChannels,
  minimapImageLoader,
  minimapTileCacheTiles,
  minimapViewRect,
  type MinimapLayout,
} from './viewerMinimapModel'

const MINIMAP_TILE_REQUESTS = 2

interface ViewerMinimapProps {
  readonly layout: MinimapLayout
  readonly imageLoader: ImagePyramidLoader | null
  readonly imageChannels: readonly MorphologyCanvasChannel[]
  // The plane the channels show: the minimap swaps planes whole too.
  readonly imageFrame?: MorphologyCanvasFrame | undefined
  readonly flatImage: FlatMorphologyCanvasImage | null
  // Cells or bins as dots, when there is no image (deck.gl coordinates).
  readonly points: readonly (readonly [number, number])[]
  // The main view, in data µm.
  readonly viewBbox: BBox | null
  readonly onNavigate: (target: readonly [number, number]) => void
  // Which of the zoom buttons and scale bar below it are shown, so it sits
  // just above them.
  readonly navigationBelow: boolean
  readonly scaleBarBelow: boolean
}

// The minimap (plan 15.4-D). It sits beside the deck.gl canvas,
// never inside it. The image is its overview (an SVS thumbnail) or else the
// coarsest pyramid level, drawn by its own MorphologyCanvas with a small tile
// cache; Visium's tissue image is the flat image; otherwise the dots show
// where the cells are.
export const ViewerMinimap = memo(function ViewerMinimap({
  layout,
  imageLoader,
  imageChannels,
  imageFrame,
  flatImage,
  points,
  viewBbox,
  onNavigate,
  navigationBelow,
  scaleBarBelow,
}: ViewerMinimapProps) {
  const draggingRef = useRef(false)
  const hasImage = minimapDrawsImage(imageLoader, imageChannels, flatImage)
  const minimapLoader = imageLoader === null ? null : minimapImageLoader(imageLoader)
  const minimapChannels = useMemo(
    () => minimapImageChannels(imageChannels),
    [imageChannels],
  )
  const tileCacheMaxTiles = useMemo(
    () => minimapTileCacheTiles(minimapLoader, imageChannels.length),
    [minimapLoader, imageChannels.length],
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
      className={`viewer-minimap${navigationBelow ? '' : ' without-navigation'}${
        scaleBarBelow ? '' : ' without-scale-bar'
      }`}
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
          loader={minimapLoader}
          channels={minimapChannels}
          flatImage={flatImage}
          viewState={layout.viewState}
          maxConcurrentTileRequests={MINIMAP_TILE_REQUESTS}
          tileCacheMaxTiles={tileCacheMaxTiles}
          {...(imageFrame === undefined ? {} : { frame: imageFrame })}
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
