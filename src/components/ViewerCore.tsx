import { DeckGL } from '@deck.gl/react'
import type { PointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MorphologyCanvas } from './MorphologyCanvas'
import {
  createOverviewLayers,
  createOverviewViewState,
  expressionCellsToBoundaryLayerData,
  spatialOverviewView,
  styleCellBoundariesByCells,
} from '../rendering/deckLayers'
import {
  aggregateExpressionCells,
  overviewCellsInBbox,
} from '../rendering/cellAggregation'
import { hexCellBoundariesForVisibleCells } from '../rendering/hexCellBoundaries'
import { morphologyViewportBbox } from '../rendering/morphologyCanvas'
import { micrometers, scaleFromZoom } from '../data/coords'
import type { ViewStateChangeParameters } from '@deck.gl/core'
import type { BBox, DataPoint } from '../data/coords'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { MorphologyCanvasChannel } from './MorphologyCanvas'
import type {
  CellBoundaryDatum,
  CellColorLookup,
  OverviewCellDatum,
} from '../rendering/deckLayers'
import type { OverviewViewState } from '../rendering/deckLayers'

const OVERVIEW_CELL_CLIP_MIN_ZOOM = 4
const OVERVIEW_CELL_PICK_MAX_VISIBLE_CELLS = 50_000
const OVERVIEW_NAVIGATION_HIDE_CELL_THRESHOLD = 50_000
const OVERVIEW_NAVIGATION_IDLE_DELAY_MS = 180
const EMPTY_OVERVIEW_CELLS: readonly OverviewCellDatum[] = []
const EMPTY_CELL_BOUNDARIES: readonly CellBoundaryDatum[] = []

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly cellColorLookup?: CellColorLookup | null
  readonly expressionCells?: readonly OverviewCellDatum[]
  readonly boundaries?: readonly CellBoundaryDatum[]
  readonly imageLoader?: TiffPyramidLoader | null
  readonly imageChannels?: readonly MorphologyCanvasChannel[]
  readonly imageOpacity?: number
  readonly geneExpressionOpacity?: number
  readonly status?: ViewerLoadStatus
  readonly imageStatus?: ViewerLoadStatus
  readonly boundaryStatus?: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly hexBoundaryMaxVisibleCells?: number
  readonly roiMode?: RoiDrawMode
  readonly roiBbox?: BBox | null
  readonly onImageTileError?: (error: Error) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
  readonly onCellClick?: (cell: OverviewCellDatum) => void
  readonly onRoiComplete?: (bbox: BBox) => void
}

export interface ViewerViewportDetail {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: OverviewViewState
}

export type RoiDrawMode = 'idle' | 'box'

export function ViewerCore({
  cells = [],
  cellColorLookup = null,
  expressionCells = [],
  boundaries = [],
  imageLoader = null,
  imageChannels = [],
  imageOpacity = 1,
  geneExpressionOpacity = 1,
  status = 'idle',
  imageStatus = 'idle',
  boundaryStatus = 'idle',
  errorMessage,
  imageErrorMessage,
  boundaryErrorMessage,
  hexBoundaryMaxVisibleCells = 0,
  roiMode = 'idle',
  roiBbox = null,
  onImageTileError,
  onViewportChange,
  onCellClick,
  onRoiComplete,
}: ViewerCoreProps) {
  const fittedViewState = useMemo(() => createOverviewViewState(cells), [cells])
  const resetKey = viewStateKey(fittedViewState)

  return (
    <ViewerSurface
      key={resetKey}
      cells={cells}
      cellColorLookup={cellColorLookup}
      expressionCells={expressionCells}
      boundaries={boundaries}
      imageLoader={imageLoader}
      imageChannels={imageChannels}
      imageOpacity={imageOpacity}
      geneExpressionOpacity={geneExpressionOpacity}
      initialViewState={fittedViewState}
      status={status}
      imageStatus={imageStatus}
      boundaryStatus={boundaryStatus}
      {...(errorMessage === undefined ? {} : { errorMessage })}
      {...(imageErrorMessage === undefined ? {} : { imageErrorMessage })}
      {...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage })}
      hexBoundaryMaxVisibleCells={hexBoundaryMaxVisibleCells}
      roiMode={roiMode}
      roiBbox={roiBbox}
      {...(onImageTileError === undefined ? {} : { onImageTileError })}
      {...(onViewportChange === undefined ? {} : { onViewportChange })}
      {...(onCellClick === undefined ? {} : { onCellClick })}
      {...(onRoiComplete === undefined ? {} : { onRoiComplete })}
    />
  )
}

interface ViewerSurfaceProps {
  readonly cells: readonly OverviewCellDatum[]
  readonly cellColorLookup: CellColorLookup | null
  readonly expressionCells: readonly OverviewCellDatum[]
  readonly boundaries: readonly CellBoundaryDatum[]
  readonly imageLoader: TiffPyramidLoader | null
  readonly imageChannels: readonly MorphologyCanvasChannel[]
  readonly imageOpacity: number
  readonly geneExpressionOpacity: number
  readonly initialViewState: OverviewViewState
  readonly status: ViewerLoadStatus
  readonly imageStatus: ViewerLoadStatus
  readonly boundaryStatus: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly hexBoundaryMaxVisibleCells: number
  readonly roiMode: RoiDrawMode
  readonly roiBbox: BBox | null
  readonly onImageTileError?: (error: Error) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
  readonly onCellClick?: (cell: OverviewCellDatum) => void
  readonly onRoiComplete?: (bbox: BBox) => void
}

interface RoiDrag {
  readonly start: DataPoint
  readonly current: DataPoint
}

interface RoiScreenRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function ViewerSurface({
  cells,
  cellColorLookup,
  expressionCells,
  boundaries,
  imageLoader,
  imageChannels,
  imageOpacity,
  geneExpressionOpacity,
  initialViewState,
  status,
  imageStatus,
  boundaryStatus,
  errorMessage,
  imageErrorMessage,
  boundaryErrorMessage,
  hexBoundaryMaxVisibleCells,
  roiMode,
  roiBbox,
  onImageTileError,
  onViewportChange,
  onCellClick,
  onRoiComplete,
}: ViewerSurfaceProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const navigationIdleTimeoutRef = useRef<number | null>(null)
  const [viewState, setViewState] = useState<OverviewViewState>(initialViewState)
  const [viewport, setViewport] = useState<CssViewportSize>({
    width: 0,
    height: 0,
  })
  const [isNavigating, setIsNavigating] = useState(false)
  const [roiDrag, setRoiDrag] = useState<RoiDrag | null>(null)
  const viewportBbox = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    return morphologyViewportBbox(viewState, viewport)
  }, [viewState, viewport])
  const visibleCells = useMemo(
    () =>
      viewportBbox === null || viewState.zoom <= OVERVIEW_CELL_CLIP_MIN_ZOOM
        ? cells
        : overviewCellsInBbox(cells, viewportBbox),
    [cells, viewportBbox, viewState.zoom],
  )
  const displayExpressionCells = useMemo(
    () =>
      expressionCells.length === 0
        ? EMPTY_OVERVIEW_CELLS
        : aggregateExpressionCells(expressionCells, viewState, {
            ...(viewportBbox === null ? {} : { bbox: viewportBbox }),
          }),
    [expressionCells, viewState, viewportBbox],
  )
  const hexBoundaries = useMemo(() => {
    if (visibleCells.length === 0 || visibleCells.length > hexBoundaryMaxVisibleCells) {
      return EMPTY_CELL_BOUNDARIES
    }

    return hexCellBoundariesForVisibleCells(visibleCells, {
      maxCells: hexBoundaryMaxVisibleCells,
      fillColorSource: 'cell',
      lineColorSource: 'cell',
      cellColorLookup,
    })
  }, [cellColorLookup, hexBoundaryMaxVisibleCells, visibleCells])
  const styledBoundaries = useMemo(
    () => styleCellBoundariesByCells(boundaries, visibleCells, cellColorLookup),
    [boundaries, cellColorLookup, visibleCells],
  )
  const expressionHexBoundaries = useMemo(
    () =>
      styledBoundaries.length > 0 || hexBoundaries.length === 0
        ? []
        : hexCellBoundariesForVisibleCells(displayExpressionCells, {
            maxCells: Number.MAX_SAFE_INTEGER,
            fillColorSource: 'cell',
            lineColor: [255, 253, 247, 210],
          }),
    [displayExpressionCells, hexBoundaries.length, styledBoundaries.length],
  )
  const expressionBoundaryPolygons = useMemo(
    () => expressionCellsToBoundaryLayerData(styledBoundaries, displayExpressionCells),
    [displayExpressionCells, styledBoundaries],
  )
  const cellsPickable =
    !isNavigating &&
    viewState.zoom > OVERVIEW_CELL_CLIP_MIN_ZOOM &&
    visibleCells.length <= OVERVIEW_CELL_PICK_MAX_VISIBLE_CELLS
  const cellsVisible =
    !isNavigating || visibleCells.length <= OVERVIEW_NAVIGATION_HIDE_CELL_THRESHOLD
  const pointCellColorLookup = cellsPickable ? cellColorLookup : null
  const annotationPreviewCells = EMPTY_OVERVIEW_CELLS
  const layers = useMemo(
    () =>
      createOverviewLayers(
        visibleCells,
        styledBoundaries,
        hexBoundaries,
        displayExpressionCells,
        {
          annotationPreviewCells,
          cellColorLookup: pointCellColorLookup,
          cellsPickable,
          cellsVisible,
          geneExpressionOpacity,
          expressionBoundaryPolygons,
          expressionHexBoundaries,
        },
      ),
    [
      annotationPreviewCells,
      cellsPickable,
      cellsVisible,
      expressionBoundaryPolygons,
      expressionHexBoundaries,
      displayExpressionCells,
      geneExpressionOpacity,
      hexBoundaries,
      pointCellColorLookup,
      styledBoundaries,
      visibleCells,
    ],
  )
  const hasCells = cells.length > 0
  const hasImage = imageLoader !== null || imageChannels.length > 0
  const visibleCellCount = visibleCells.length
  const roiScreenRect = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    return roiDrag === null
      ? roiBboxToScreenRect(roiBbox, viewState, viewport)
      : roiBboxToScreenRect(
          dataPointsToBbox(roiDrag.start, roiDrag.current),
          viewState,
          viewport,
        )
  }, [roiBbox, roiDrag, viewState, viewport])
  const viewportMessage = readViewportMessage(status, imageStatus, boundaryStatus, {
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(imageErrorMessage === undefined ? {} : { imageErrorMessage }),
    ...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage }),
  })
  const handleViewStateChange = useCallback(
    ({ viewState: nextViewState }: ViewStateChangeParameters) => {
      const normalizedViewState = normaliseViewState(nextViewState)

      setIsNavigating((currentValue) => (currentValue ? currentValue : true))

      if (navigationIdleTimeoutRef.current !== null) {
        window.clearTimeout(navigationIdleTimeoutRef.current)
      }

      navigationIdleTimeoutRef.current = window.setTimeout(() => {
        setIsNavigating(false)
        navigationIdleTimeoutRef.current = null
      }, OVERVIEW_NAVIGATION_IDLE_DELAY_MS)

      setViewState((currentViewState) =>
        equivalentViewState(currentViewState, normalizedViewState)
          ? currentViewState
          : normalizedViewState,
      )
    },
    [],
  )
  const handleDeckClick = useCallback(
    (info: { readonly object?: unknown }) => {
      if (onCellClick === undefined || !isOverviewCellDatum(info.object)) {
        return
      }

      onCellClick(info.object)
    },
    [onCellClick],
  )
  const handleRoiPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (roiMode !== 'box' || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const point = pointerEventToDataPoint(event, viewState, viewport)
      setRoiDrag({ start: point, current: point })
    },
    [roiMode, viewState, viewport],
  )
  const handleRoiPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (roiDrag === null || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      event.preventDefault()
      const point = pointerEventToDataPoint(event, viewState, viewport)
      setRoiDrag({ start: roiDrag.start, current: point })
    },
    [roiDrag, viewState, viewport],
  )
  const handleRoiPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (roiDrag === null || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      event.preventDefault()
      const point = pointerEventToDataPoint(event, viewState, viewport)
      const bbox = dataPointsToBbox(roiDrag.start, point)

      setRoiDrag(null)

      if (onRoiComplete !== undefined && hasMinimumRoiSize(bbox)) {
        onRoiComplete(bbox)
      }
    },
    [onRoiComplete, roiDrag, viewState, viewport],
  )

  useEffect(() => {
    const frame = frameRef.current

    if (frame === null) {
      return
    }

    const updateViewport = () => {
      const rect = frame.getBoundingClientRect()
      const nextViewport = {
        width: rect.width || frame.clientWidth,
        height: rect.height || frame.clientHeight,
      }

      setViewport((currentViewport) =>
        equivalentViewportSize(currentViewport, nextViewport)
          ? currentViewport
          : nextViewport,
      )
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport)
    observer?.observe(frame)

    return () => {
      window.removeEventListener('resize', updateViewport)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (onViewportChange === undefined || !hasCells || viewportBbox === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      onViewportChange({
        bbox: viewportBbox,
        visibleCellCount,
        viewState,
      })
    }, 180)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [hasCells, onViewportChange, viewState, viewportBbox, visibleCellCount])

  useEffect(
    () => () => {
      if (navigationIdleTimeoutRef.current !== null) {
        window.clearTimeout(navigationIdleTimeoutRef.current)
      }
    },
    [],
  )

  return (
    <div
      ref={frameRef}
      className="viewport-frame"
      role="img"
      aria-label="Spatial viewer canvas area"
    >
      {!hasImage ? <div className="viewport-grid" aria-hidden="true" /> : null}
      <MorphologyCanvas
        channels={imageChannels}
        loader={imageLoader}
        opacity={imageOpacity}
        viewState={viewState}
        {...(onImageTileError === undefined ? {} : { onTileError: onImageTileError })}
      />
      {hasCells ? (
        <div className="deckgl-host" aria-hidden="true">
          <DeckGL
            views={spatialOverviewView}
            viewState={viewState}
            onViewStateChange={handleViewStateChange}
            onClick={handleDeckClick}
            controller
            layers={layers}
          />
        </div>
      ) : null}
      <div
        className={`roi-draw-layer${roiMode === 'box' ? ' active' : ''}`}
        aria-hidden="true"
        onPointerDown={handleRoiPointerDown}
        onPointerMove={handleRoiPointerMove}
        onPointerUp={handleRoiPointerUp}
      >
        {roiScreenRect === null ? null : (
          <span
            className="roi-rectangle"
            style={{
              left: roiScreenRect.left,
              top: roiScreenRect.top,
              width: roiScreenRect.width,
              height: roiScreenRect.height,
            }}
          />
        )}
      </div>
      {!hasCells ? (
        <div className="viewport-empty-state" aria-hidden="true">
          Please load a dataset
        </div>
      ) : null}
      {viewportMessage === null ? null : (
        <p
          className={`viewport-message${viewportMessage.kind === 'error' ? ' viewport-message-error' : ''}`}
          aria-live={viewportMessage.kind === 'error' ? 'assertive' : 'polite'}
        >
          {viewportMessage.text}
        </p>
      )}
    </div>
  )
}

function pointerEventToDataPoint(
  event: PointerEvent<HTMLDivElement>,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): DataPoint {
  const rect = event.currentTarget.getBoundingClientRect()
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: micrometers((event.clientX - rect.left - offsetX) / scale),
    y: micrometers((event.clientY - rect.top - offsetY) / scale),
  }
}

function dataPointsToBbox(first: DataPoint, second: DataPoint): BBox {
  return {
    minX: micrometers(Math.min(first.x, second.x)),
    maxX: micrometers(Math.max(first.x, second.x)),
    minY: micrometers(Math.min(first.y, second.y)),
    maxY: micrometers(Math.max(first.y, second.y)),
  }
}

function roiBboxToScreenRect(
  bbox: BBox | null,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): RoiScreenRect | null {
  if (bbox === null) {
    return null
  }

  const topLeft = rawDataPointToScreen(
    { x: bbox.minX, y: bbox.minY },
    viewState,
    viewport,
  )
  const bottomRight = rawDataPointToScreen(
    { x: bbox.maxX, y: bbox.maxY },
    viewState,
    viewport,
  )
  const left = Math.min(topLeft.x, bottomRight.x)
  const top = Math.min(topLeft.y, bottomRight.y)
  const right = Math.max(topLeft.x, bottomRight.x)
  const bottom = Math.max(topLeft.y, bottomRight.y)

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

function rawDataPointToScreen(
  point: DataPoint,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): { readonly x: number; readonly y: number } {
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  }
}

function hasMinimumRoiSize(bbox: BBox): boolean {
  return bbox.maxX - bbox.minX >= 1 && bbox.maxY - bbox.minY >= 1
}

function readViewportMessage(
  status: ViewerLoadStatus,
  imageStatus: ViewerLoadStatus,
  boundaryStatus: ViewerLoadStatus,
  messages: {
    readonly errorMessage?: string
    readonly imageErrorMessage?: string
    readonly boundaryErrorMessage?: string
  },
): { readonly kind: 'info' | 'error'; readonly text: string } | null {
  if (status === 'loading') {
    return { kind: 'info', text: 'Loading overview cells…' }
  }

  if (status === 'error') {
    return {
      kind: 'error',
      text: messages.errorMessage ?? 'Dataset load failed.',
    }
  }

  if (imageStatus === 'loading') {
    return { kind: 'info', text: 'Reading OME-TIFF image…' }
  }

  if (imageStatus === 'error') {
    return {
      kind: 'error',
      text: messages.imageErrorMessage ?? 'OME-TIFF image load failed.',
    }
  }

  if (boundaryStatus === 'loading') {
    return { kind: 'info', text: 'Loading cell boundaries…' }
  }

  if (boundaryStatus === 'error') {
    return {
      kind: 'error',
      text: messages.boundaryErrorMessage ?? 'Cell boundary load failed.',
    }
  }

  return null
}

function normaliseViewState(viewState: {
  readonly target?: readonly [number, number] | readonly [number, number, number]
  readonly zoom?: number
  readonly minZoom?: number
  readonly maxZoom?: number
}): OverviewViewState {
  const target = viewState.target ?? [0, 0, 0]

  return {
    target: [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0],
    zoom: viewState.zoom ?? 0,
    minZoom: viewState.minZoom ?? -10,
    maxZoom: viewState.maxZoom ?? 10,
  }
}

function equivalentViewState(left: OverviewViewState, right: OverviewViewState): boolean {
  return (
    nearlyEqual(left.target[0], right.target[0], 0.5) &&
    nearlyEqual(left.target[1], right.target[1], 0.5) &&
    nearlyEqual(left.target[2], right.target[2], 0.5) &&
    nearlyEqual(left.zoom, right.zoom, 0.001) &&
    nearlyEqual(left.minZoom, right.minZoom, 0.001) &&
    nearlyEqual(left.maxZoom, right.maxZoom, 0.001)
  )
}

function equivalentViewportSize(left: CssViewportSize, right: CssViewportSize): boolean {
  return (
    nearlyEqual(left.width, right.width, 0.5) &&
    nearlyEqual(left.height, right.height, 0.5)
  )
}

function nearlyEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance
}

function viewStateKey(viewState: OverviewViewState): string {
  return `${viewState.target.join(':')}:${viewState.zoom}`
}

function isOverviewCellDatum(value: unknown): value is OverviewCellDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<OverviewCellDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.radiusPixels === 'number'
  )
}
