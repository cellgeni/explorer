import { DeckGL } from '@deck.gl/react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  estimateOverviewCellCountInBbox,
  overviewCellsExtentBbox,
  overviewCellsInBbox,
  sampleOverviewCellsForRendering,
} from '../rendering/cellAggregation'
import { morphologyViewportBbox } from '../rendering/morphologyCanvas'
import { styleOverviewCellsByObservation } from '../rendering/cellStyling'
import { micrometers, scaleFromZoom } from '../data/coords'
import type { ViewStateChangeParameters } from '@deck.gl/core'
import type { BBox, DataPoint } from '../data/coords'
import type { RoiSelection } from '../data/roiSelection'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { MorphologyCanvasChannel } from './MorphologyCanvas'
import type { CellBoundaryDatum, OverviewCellDatum } from '../rendering/deckLayers'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { AnnotationColorStyle, ObservationColorMode } from '../rendering/cellStyling'

const OVERVIEW_CELL_CLIP_MIN_ZOOM = -2.25
const DEFAULT_MICROMETERS_PER_PIXEL = 0.2125
const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const EMPTY_OVERVIEW_CELLS: readonly OverviewCellDatum[] = []

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ViewerCoordinateUnit = 'um' | 'px'

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly expressionCells?: readonly OverviewCellDatum[]
  readonly boundaries?: readonly CellBoundaryDatum[]
  readonly imageLoader?: TiffPyramidLoader | null
  readonly imageChannels?: readonly MorphologyCanvasChannel[]
  readonly imageOpacity?: number
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly observationColorMode?: ObservationColorMode
  readonly annotationStyleColors?: readonly AnnotationColorStyle[]
  readonly coordinateUnit?: ViewerCoordinateUnit
  readonly micrometersPerPixel?: number
  readonly status?: ViewerLoadStatus
  readonly imageStatus?: ViewerLoadStatus
  readonly boundaryStatus?: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly roiMode?: RoiDrawMode
  readonly roiBbox?: BBox | null
  readonly roiSelection?: RoiSelection | null
  readonly magicLensActive?: boolean
  readonly magicLensRadiusMicrometers?: number
  readonly magicLensStatus?: ViewerMagicLensStatus
  readonly magicLensSummary?: ViewerMagicLensSummary | null
  readonly initialViewStateOverride?: InitialViewStateOverride
  readonly overviewRenderCellLimit?: number
  readonly maxConcurrentTileRequests?: number
  readonly tileCacheMaxTiles?: number
  readonly onImageTileError?: (error: Error) => void
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
  readonly onViewportCellCountChange?: (cellCount: number) => void
  readonly onCellClick?: (cell: OverviewCellDatum) => void
  readonly onRoiComplete?: (selection: RoiSelection) => void
  readonly onMagicLensMove?: (detail: ViewerMagicLensDetail) => void
  readonly onMagicLensLeave?: () => void
}

export interface InitialViewStateOverride {
  readonly target?: readonly [number, number, number]
  readonly zoom?: number
}

export type ViewerMagicLensStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerMagicLensDetail {
  readonly center: DataPoint
  readonly radiusMicrometers: number
  readonly bbox: BBox
  readonly screen: ScreenPoint
}

export interface ViewerMagicLensSummary {
  readonly transcriptCount: number
  readonly cellCount: number
  readonly geneCount: number
  readonly selectedGeneTranscriptCount: number
  readonly topGenes: readonly ViewerMagicLensGeneSummary[]
  readonly hitLimit: boolean
}

export interface ViewerMagicLensGeneSummary {
  readonly gene: string
  readonly count: number
  readonly selected: boolean
}

export interface ViewerViewportDetail {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: OverviewViewState
}

export type RoiDrawMode = 'idle' | 'box' | 'lasso'

export function ViewerCore({
  cells = [],
  expressionCells = [],
  boundaries = [],
  imageLoader = null,
  imageChannels = [],
  imageOpacity = 1,
  cellFillOpacity = 1,
  cellBoundaryOpacity = 1,
  observationColorMode = 'transcript-count',
  annotationStyleColors = EMPTY_ANNOTATION_STYLE_COLORS,
  coordinateUnit = 'um',
  micrometersPerPixel = DEFAULT_MICROMETERS_PER_PIXEL,
  status = 'idle',
  imageStatus = 'idle',
  boundaryStatus = 'idle',
  errorMessage,
  imageErrorMessage,
  boundaryErrorMessage,
  roiMode = 'idle',
  roiBbox = null,
  roiSelection = null,
  magicLensActive = false,
  magicLensRadiusMicrometers = 80,
  magicLensStatus = 'idle',
  magicLensSummary = null,
  initialViewStateOverride,
  overviewRenderCellLimit,
  maxConcurrentTileRequests,
  tileCacheMaxTiles,
  onImageTileError,
  onTileCacheEviction,
  onViewportChange,
  onViewportCellCountChange,
  onCellClick,
  onRoiComplete,
  onMagicLensMove,
  onMagicLensLeave,
}: ViewerCoreProps) {
  const fittedViewState = useMemo(() => createOverviewViewState(cells), [cells])
  const initialViewState = useMemo(
    () => mergeInitialViewState(fittedViewState, initialViewStateOverride),
    [fittedViewState, initialViewStateOverride],
  )
  const resetKey = viewStateKey(initialViewState)

  return (
    <ViewerSurface
      key={resetKey}
      cells={cells}
      expressionCells={expressionCells}
      boundaries={boundaries}
      imageLoader={imageLoader}
      imageChannels={imageChannels}
      imageOpacity={imageOpacity}
      cellFillOpacity={cellFillOpacity}
      cellBoundaryOpacity={cellBoundaryOpacity}
      observationColorMode={observationColorMode}
      annotationStyleColors={annotationStyleColors}
      coordinateUnit={coordinateUnit}
      micrometersPerPixel={micrometersPerPixel}
      initialViewState={initialViewState}
      {...(overviewRenderCellLimit === undefined ? {} : { overviewRenderCellLimit })}
      {...(maxConcurrentTileRequests === undefined ? {} : { maxConcurrentTileRequests })}
      {...(tileCacheMaxTiles === undefined ? {} : { tileCacheMaxTiles })}
      status={status}
      imageStatus={imageStatus}
      boundaryStatus={boundaryStatus}
      {...(errorMessage === undefined ? {} : { errorMessage })}
      {...(imageErrorMessage === undefined ? {} : { imageErrorMessage })}
      {...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage })}
      roiMode={roiMode}
      roiBbox={roiBbox}
      roiSelection={roiSelection}
      magicLensActive={magicLensActive}
      magicLensRadiusMicrometers={magicLensRadiusMicrometers}
      magicLensStatus={magicLensStatus}
      magicLensSummary={magicLensSummary}
      {...(onImageTileError === undefined ? {} : { onImageTileError })}
      {...(onTileCacheEviction === undefined ? {} : { onTileCacheEviction })}
      {...(onViewportChange === undefined ? {} : { onViewportChange })}
      {...(onViewportCellCountChange === undefined ? {} : { onViewportCellCountChange })}
      {...(onCellClick === undefined ? {} : { onCellClick })}
      {...(onRoiComplete === undefined ? {} : { onRoiComplete })}
      {...(onMagicLensMove === undefined ? {} : { onMagicLensMove })}
      {...(onMagicLensLeave === undefined ? {} : { onMagicLensLeave })}
    />
  )
}

interface ViewerSurfaceProps {
  readonly cells: readonly OverviewCellDatum[]
  readonly expressionCells: readonly OverviewCellDatum[]
  readonly boundaries: readonly CellBoundaryDatum[]
  readonly imageLoader: TiffPyramidLoader | null
  readonly imageChannels: readonly MorphologyCanvasChannel[]
  readonly imageOpacity: number
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly observationColorMode: ObservationColorMode
  readonly annotationStyleColors: readonly AnnotationColorStyle[]
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly micrometersPerPixel: number
  readonly initialViewState: OverviewViewState
  readonly overviewRenderCellLimit?: number
  readonly maxConcurrentTileRequests?: number
  readonly tileCacheMaxTiles?: number
  readonly status: ViewerLoadStatus
  readonly imageStatus: ViewerLoadStatus
  readonly boundaryStatus: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly roiMode: RoiDrawMode
  readonly roiBbox: BBox | null
  readonly roiSelection: RoiSelection | null
  readonly magicLensActive: boolean
  readonly magicLensRadiusMicrometers: number
  readonly magicLensStatus: ViewerMagicLensStatus
  readonly magicLensSummary: ViewerMagicLensSummary | null
  readonly onImageTileError?: (error: Error) => void
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
  readonly onViewportCellCountChange?: (cellCount: number) => void
  readonly onCellClick?: (cell: OverviewCellDatum) => void
  readonly onRoiComplete?: (selection: RoiSelection) => void
  readonly onMagicLensMove?: (detail: ViewerMagicLensDetail) => void
  readonly onMagicLensLeave?: () => void
}

type RoiDraft =
  | {
      readonly kind: 'box'
      readonly start: DataPoint
      readonly current: DataPoint
    }
  | {
      readonly kind: 'lasso'
      readonly points: readonly DataPoint[]
      readonly current: DataPoint
    }

interface ScreenPoint {
  readonly x: number
  readonly y: number
}

interface RoiPathOverlay {
  readonly d: string
  readonly isDraft: boolean
}

interface MouseCoordinate {
  readonly xMicrometers: number
  readonly yMicrometers: number
}

interface RoiScreenRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function ViewerSurface({
  cells,
  expressionCells,
  boundaries,
  imageLoader,
  imageChannels,
  imageOpacity,
  cellFillOpacity,
  cellBoundaryOpacity,
  observationColorMode,
  annotationStyleColors,
  coordinateUnit,
  micrometersPerPixel,
  initialViewState,
  overviewRenderCellLimit,
  maxConcurrentTileRequests,
  tileCacheMaxTiles,
  status,
  imageStatus,
  boundaryStatus,
  errorMessage,
  imageErrorMessage,
  boundaryErrorMessage,
  roiMode,
  roiBbox,
  roiSelection,
  magicLensActive,
  magicLensRadiusMicrometers,
  magicLensStatus,
  magicLensSummary,
  onImageTileError,
  onTileCacheEviction,
  onViewportChange,
  onViewportCellCountChange,
  onCellClick,
  onRoiComplete,
  onMagicLensMove,
  onMagicLensLeave,
}: ViewerSurfaceProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const keyboardHelpId = useId()
  const [viewState, setViewState] = useState<OverviewViewState>(initialViewState)
  const [viewport, setViewport] = useState<CssViewportSize>({
    width: 0,
    height: 0,
  })
  const [roiDraft, setRoiDraft] = useState<RoiDraft | null>(null)
  const [mouseCoordinate, setMouseCoordinate] = useState<MouseCoordinate | null>(null)
  const [magicLensScreen, setMagicLensScreen] = useState<ScreenPoint | null>(null)
  const pendingMouseCoordinateRef = useRef<MouseCoordinate | null>(null)
  const mouseCoordinateFrameRef = useRef<number | null>(null)
  const cellExtentBbox = useMemo(() => overviewCellsExtentBbox(cells), [cells])
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
  const renderSourceCells = useMemo(
    () =>
      sampleOverviewCellsForRendering(visibleCells, {
        ...(overviewRenderCellLimit === undefined
          ? {}
          : { maxCells: overviewRenderCellLimit }),
      }),
    [overviewRenderCellLimit, visibleCells],
  )
  const renderCells = useMemo(
    () =>
      styleCellsForObservation(
        renderSourceCells,
        observationColorMode,
        annotationStyleColors,
      ),
    [annotationStyleColors, observationColorMode, renderSourceCells],
  )
  const boundaryStyleCells = useMemo(
    () =>
      boundaries.length === 0
        ? EMPTY_OVERVIEW_CELLS
        : styleCellsForObservation(
            visibleCells,
            observationColorMode,
            annotationStyleColors,
          ),
    [annotationStyleColors, boundaries.length, observationColorMode, visibleCells],
  )
  const displayExpressionCells = useMemo(
    () =>
      aggregateExpressionCells(expressionCells, viewState, {
        ...(viewportBbox === null ? {} : { bbox: viewportBbox }),
      }),
    [expressionCells, viewState, viewportBbox],
  )
  const cellById = useMemo(() => {
    const nextCellById = new Map<string, OverviewCellDatum>()

    for (const cell of cells) {
      nextCellById.set(cell.id, cell)
    }

    return nextCellById
  }, [cells])
  const styledBoundaries = useMemo(
    () => styleCellBoundariesByCells(boundaries, boundaryStyleCells),
    [boundaries, boundaryStyleCells],
  )
  const expressionBoundaryPolygons = useMemo(
    () => expressionCellsToBoundaryLayerData(styledBoundaries, displayExpressionCells),
    [displayExpressionCells, styledBoundaries],
  )
  const layers = useMemo(
    () =>
      createOverviewLayers(renderCells, styledBoundaries, displayExpressionCells, {
        cellFillOpacity,
        cellBoundaryOpacity,
        expressionBoundaryPolygons,
      }),
    [
      cellBoundaryOpacity,
      cellFillOpacity,
      expressionBoundaryPolygons,
      displayExpressionCells,
      renderCells,
      styledBoundaries,
    ],
  )
  const hasCells = cells.length > 0
  const hasImage = imageLoader !== null || imageChannels.length > 0
  const canTrackMouseCoordinates = hasCells || hasImage
  const visibleCellCount = visibleCells.length
  const estimatedViewportCellCount = useMemo(() => {
    if (viewportBbox === null) {
      return cells.length
    }

    if (viewState.zoom > OVERVIEW_CELL_CLIP_MIN_ZOOM) {
      return visibleCellCount
    }

    return estimateOverviewCellCountInBbox(cells, viewportBbox, {
      extentBbox: cellExtentBbox,
    })
  }, [cellExtentBbox, cells, viewState.zoom, viewportBbox, visibleCellCount])
  const displayedRoiSelection = useMemo<RoiSelection | null>(
    () => roiSelection ?? (roiBbox === null ? null : { kind: 'box', bbox: roiBbox }),
    [roiBbox, roiSelection],
  )
  const roiScreenRect = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    const boxDraft = roiDraft?.kind === 'box' ? roiDraft : null

    return boxDraft === null
      ? roiBboxToScreenRect(
          displayedRoiSelection?.kind === 'box' ? displayedRoiSelection.bbox : null,
          viewState,
          viewport,
        )
      : roiBboxToScreenRect(
          dataPointsToBbox(boxDraft.start, boxDraft.current),
          viewState,
          viewport,
        )
  }, [displayedRoiSelection, roiDraft, viewState, viewport])
  const roiPathOverlay = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    const lassoDraft = roiDraft?.kind === 'lasso' ? roiDraft : null

    if (lassoDraft !== null) {
      return dataPointsToPathOverlay(
        [...lassoDraft.points, lassoDraft.current],
        viewState,
        viewport,
        true,
      )
    }

    if (displayedRoiSelection?.kind === 'lasso') {
      return dataPointsToPathOverlay(
        displayedRoiSelection.points,
        viewState,
        viewport,
        false,
      )
    }

    return null
  }, [displayedRoiSelection, roiDraft, viewState, viewport])
  const magicLensOverlay = useMemo(
    () =>
      magicLensActive && magicLensScreen !== null
        ? magicLensOverlayModel(
            magicLensScreen,
            magicLensRadiusMicrometers,
            viewState,
            viewport,
            magicLensStatus,
            magicLensSummary,
          )
        : null,
    [
      magicLensActive,
      magicLensRadiusMicrometers,
      magicLensScreen,
      magicLensStatus,
      magicLensSummary,
      viewState,
      viewport,
    ],
  )
  const viewportMessage = readViewportMessage(status, imageStatus, boundaryStatus, {
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(imageErrorMessage === undefined ? {} : { imageErrorMessage }),
    ...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage }),
  })
  const mouseCoordinateText =
    !canTrackMouseCoordinates || mouseCoordinate === null
      ? null
      : formatMouseCoordinate(mouseCoordinate, coordinateUnit, micrometersPerPixel)
  const flushMouseCoordinate = useCallback(() => {
    mouseCoordinateFrameRef.current = null
    setMouseCoordinate(pendingMouseCoordinateRef.current)
  }, [])
  const scheduleMouseCoordinate = useCallback(
    (coordinate: MouseCoordinate | null) => {
      pendingMouseCoordinateRef.current = coordinate

      if (typeof window.requestAnimationFrame !== 'function') {
        setMouseCoordinate(coordinate)
        return
      }

      if (mouseCoordinateFrameRef.current === null) {
        mouseCoordinateFrameRef.current =
          window.requestAnimationFrame(flushMouseCoordinate)
      }
    },
    [flushMouseCoordinate],
  )
  const clearMouseCoordinate = useCallback(() => {
    pendingMouseCoordinateRef.current = null

    if (mouseCoordinateFrameRef.current !== null) {
      window.cancelAnimationFrame(mouseCoordinateFrameRef.current)
      mouseCoordinateFrameRef.current = null
    }

    setMouseCoordinate(null)
  }, [])

  const handleViewStateChange = useCallback(
    ({ viewState: nextViewState }: ViewStateChangeParameters) => {
      const normalizedViewState = normaliseViewState(nextViewState)

      setViewState((currentViewState) =>
        equivalentViewState(currentViewState, normalizedViewState)
          ? currentViewState
          : normalizedViewState,
      )
    },
    [],
  )
  const handleKeyboardNavigation = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!canTrackMouseCoordinates) {
        return
      }

      const nextViewState = viewStateFromKeyboardEvent(event, viewState, initialViewState)

      if (nextViewState === null) {
        return
      }

      event.preventDefault()
      setViewState((currentViewState) =>
        equivalentViewState(currentViewState, nextViewState)
          ? currentViewState
          : nextViewState,
      )
    },
    [canTrackMouseCoordinates, initialViewState, viewState],
  )
  const handleDeckClick = useCallback(
    (info: { readonly object?: unknown }) => {
      if (onCellClick === undefined) {
        return
      }

      if (isOverviewCellDatum(info.object)) {
        onCellClick(info.object)
        return
      }

      if (isCellBoundaryDatum(info.object)) {
        const cell = cellById.get(info.object.id)

        if (cell !== undefined) {
          onCellClick(cell)
        }
      }
    },
    [cellById, onCellClick],
  )
  const handleMouseCoordinatePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canTrackMouseCoordinates || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      const point = pointerEventToDataPoint(event, viewState, viewport)
      scheduleMouseCoordinate({
        xMicrometers: point.x,
        yMicrometers: point.y,
      })

      if (magicLensActive && roiMode === 'idle') {
        const rect = event.currentTarget.getBoundingClientRect()
        const screen = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }

        setMagicLensScreen(screen)
        onMagicLensMove?.({
          center: point,
          radiusMicrometers: magicLensRadiusMicrometers,
          bbox: bboxFromCircle(point, magicLensRadiusMicrometers),
          screen,
        })
      }
    },
    [
      canTrackMouseCoordinates,
      magicLensActive,
      magicLensRadiusMicrometers,
      onMagicLensMove,
      roiMode,
      scheduleMouseCoordinate,
      viewState,
      viewport,
    ],
  )
  const handlePointerLeave = useCallback(() => {
    clearMouseCoordinate()
    setMagicLensScreen(null)
    onMagicLensLeave?.()
  }, [clearMouseCoordinate, onMagicLensLeave])
  const handleRoiPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (roiMode === 'idle' || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const point = pointerEventToDataPoint(event, viewState, viewport)
      setRoiDraft(
        roiMode === 'box'
          ? { kind: 'box', start: point, current: point }
          : { kind: 'lasso', points: [point], current: point },
      )
    },
    [roiMode, viewState, viewport],
  )
  const handleRoiPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (roiDraft === null || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      event.preventDefault()
      const point = pointerEventToDataPoint(event, viewState, viewport)
      const minPointStep = 4 / scaleFromZoom(viewState.zoom)

      setRoiDraft((currentDraft) => {
        if (currentDraft === null) {
          return null
        }

        if (currentDraft.kind === 'box') {
          return { ...currentDraft, current: point }
        }

        const previousPoint =
          currentDraft.points[currentDraft.points.length - 1] ?? currentDraft.current
        const points = hasMinimumPointStep(previousPoint, point, minPointStep)
          ? [...currentDraft.points, point]
          : currentDraft.points

        return { ...currentDraft, points, current: point }
      })
    },
    [roiDraft, viewState, viewport],
  )
  const handleRoiPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (roiDraft === null || viewport.width <= 0 || viewport.height <= 0) {
        return
      }

      event.preventDefault()
      const point = pointerEventToDataPoint(event, viewState, viewport)
      const selection =
        roiDraft.kind === 'box'
          ? roiSelectionFromBox(roiDraft.start, point)
          : roiSelectionFromLasso([...roiDraft.points, point])

      setRoiDraft(null)

      if (selection !== null && onRoiComplete !== undefined) {
        onRoiComplete(selection)
      }
    },
    [onRoiComplete, roiDraft, viewState, viewport],
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
    return () => {
      if (mouseCoordinateFrameRef.current !== null) {
        window.cancelAnimationFrame(mouseCoordinateFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (onViewportCellCountChange === undefined || !hasCells) {
      return
    }

    const timeout = window.setTimeout(() => {
      onViewportCellCountChange(estimatedViewportCellCount)
    }, 80)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [estimatedViewportCellCount, hasCells, onViewportCellCountChange])

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

  return (
    <div
      ref={frameRef}
      className={`viewport-frame${magicLensActive ? ' is-magic-lens-active' : ''}`}
      role="img"
      aria-label="Spatial viewer canvas area"
      aria-describedby={keyboardHelpId}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Home"
      tabIndex={0}
      onKeyDown={handleKeyboardNavigation}
      onPointerMove={handleMouseCoordinatePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <p id={keyboardHelpId} className="visually-hidden">
        Use arrow keys to pan, plus or minus to zoom, and Home to reset the spatial view.
      </p>
      {!hasImage ? <div className="viewport-grid" aria-hidden="true" /> : null}
      <MorphologyCanvas
        channels={imageChannels}
        loader={imageLoader}
        opacity={imageOpacity}
        viewState={viewState}
        {...(maxConcurrentTileRequests === undefined
          ? {}
          : { maxConcurrentTileRequests })}
        {...(tileCacheMaxTiles === undefined ? {} : { tileCacheMaxTiles })}
        {...(onImageTileError === undefined ? {} : { onTileError: onImageTileError })}
        {...(onTileCacheEviction === undefined ? {} : { onTileCacheEviction })}
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
        className={`roi-draw-layer${roiMode !== 'idle' ? ' active' : ''}`}
        aria-hidden="true"
        onPointerDown={handleRoiPointerDown}
        onPointerMove={handleRoiPointerMove}
        onPointerUp={handleRoiPointerUp}
      >
        {roiPathOverlay === null ? null : (
          <svg className="roi-path-svg" focusable="false" aria-hidden="true">
            <path
              className={`roi-lasso-path${roiPathOverlay.isDraft ? ' is-draft' : ''}`}
              d={roiPathOverlay.d}
            />
          </svg>
        )}
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
      {magicLensOverlay === null ? null : (
        <MagicLensOverlay
          model={magicLensOverlay}
          status={magicLensStatus}
          summary={magicLensSummary}
        />
      )}
      {!hasCells ? (
        <div className="viewport-empty-state" aria-hidden="true">
          Please load a dataset
        </div>
      ) : null}
      {mouseCoordinateText === null ? null : (
        <p
          className="viewport-coordinate-readout"
          aria-label={`Mouse coordinates ${mouseCoordinateText}`}
        >
          {mouseCoordinateText}
        </p>
      )}
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

function bboxFromCircle(center: DataPoint, radius: number): BBox {
  return {
    minX: micrometers(Math.max(0, center.x - radius)),
    maxX: micrometers(center.x + radius),
    minY: micrometers(Math.max(0, center.y - radius)),
    maxY: micrometers(center.y + radius),
  }
}

interface MagicLensOverlayModel {
  readonly circleStyle: CSSProperties
  readonly hudStyle: CSSProperties
}

function MagicLensOverlay({
  model,
  status,
  summary,
}: {
  readonly model: MagicLensOverlayModel
  readonly status: ViewerMagicLensStatus
  readonly summary: ViewerMagicLensSummary | null
}) {
  const topGenes = summary?.topGenes.slice(0, 8) ?? []
  const maxCount = Math.max(...topGenes.map((gene) => gene.count), 1)

  return (
    <div className="viewer-magic-lens" aria-hidden="true">
      <span className="viewer-magic-lens-circle" style={model.circleStyle} />
      {status === 'idle' && summary === null ? null : (
        <div className="viewer-magic-lens-hud" style={model.hudStyle}>
          <p>
            {summary === null
              ? 'Scanning lens'
              : `${summary.cellCount.toLocaleString()} cells - ${summary.transcriptCount.toLocaleString()} tx`}
          </p>
          {status === 'loading' ? <small>loading expression...</small> : null}
          {topGenes.length === 0 && status !== 'loading' ? (
            <small>No detected genes</small>
          ) : null}
          {topGenes.length === 0 ? null : (
            <ol>
              {topGenes.map((gene) => (
                <li
                  key={gene.gene}
                  className={gene.selected ? 'is-selected' : undefined}
                  style={
                    {
                      '--viewer-magic-lens-gene-width': `${Math.max(
                        4,
                        (gene.count / maxCount) * 100,
                      )}%`,
                    } as CSSProperties
                  }
                >
                  <span>{gene.gene}</span>
                  <strong>{gene.count.toLocaleString()}</strong>
                  <i />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function magicLensOverlayModel(
  screen: ScreenPoint,
  radiusMicrometers: number,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  status: ViewerMagicLensStatus,
  summary: ViewerMagicLensSummary | null,
): MagicLensOverlayModel {
  const radiusPixels = Math.max(10, radiusMicrometers * scaleFromZoom(viewState.zoom))
  const hudWidth = 190
  const geneCount = Math.min(summary?.topGenes.length ?? 1, 8)
  const hudHeight = status === 'loading' ? 58 : 46 + geneCount * 22
  const gap = 10
  let hudLeft = screen.x + radiusPixels + gap
  let hudTop = screen.y - hudHeight / 2

  if (hudLeft + hudWidth > viewport.width - 8) {
    hudLeft = screen.x - radiusPixels - gap - hudWidth
  }

  hudTop = Math.max(8, Math.min(viewport.height - hudHeight - 8, hudTop))

  return {
    circleStyle: {
      left: screen.x,
      top: screen.y,
      width: radiusPixels * 2,
      height: radiusPixels * 2,
    },
    hudStyle: {
      left: Math.max(8, hudLeft),
      top: hudTop,
      width: hudWidth,
    },
  }
}

function dataPointArrayToBbox(points: readonly DataPoint[]): BBox | null {
  if (points.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
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

function dataPointsToPathOverlay(
  points: readonly DataPoint[],
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  isDraft: boolean,
): RoiPathOverlay | null {
  if (points.length < 2) {
    return null
  }

  const screenPoints = points.map((point) =>
    rawDataPointToScreen(point, viewState, viewport),
  )

  return {
    d: screenPointsToPath(screenPoints, !isDraft && screenPoints.length >= 3),
    isDraft,
  }
}

function screenPointsToPath(points: readonly ScreenPoint[], closePath: boolean): string {
  const [firstPoint, ...remainingPoints] = points

  if (firstPoint === undefined) {
    return ''
  }

  const lineCommands = remainingPoints
    .map((point) => `L ${formatPathPoint(point.x)} ${formatPathPoint(point.y)}`)
    .join(' ')

  return [
    `M ${formatPathPoint(firstPoint.x)} ${formatPathPoint(firstPoint.y)}`,
    lineCommands,
    closePath ? 'Z' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function formatPathPoint(value: number): string {
  return value.toFixed(2)
}

function roiSelectionFromBox(first: DataPoint, second: DataPoint): RoiSelection | null {
  const bbox = dataPointsToBbox(first, second)

  return hasMinimumRoiSize(bbox) ? { kind: 'box', bbox } : null
}

function roiSelectionFromLasso(points: readonly DataPoint[]): RoiSelection | null {
  const bbox = dataPointArrayToBbox(points)

  if (bbox === null || points.length < 3 || !hasMinimumRoiSize(bbox)) {
    return null
  }

  return { kind: 'lasso', bbox, points }
}

function hasMinimumRoiSize(bbox: BBox): boolean {
  return bbox.maxX - bbox.minX >= 1 && bbox.maxY - bbox.minY >= 1
}

function hasMinimumPointStep(
  first: DataPoint,
  second: DataPoint,
  minDistance: number,
): boolean {
  const deltaX = second.x - first.x
  const deltaY = second.y - first.y

  return deltaX * deltaX + deltaY * deltaY >= minDistance * minDistance
}

function styleCellsForObservation(
  cells: readonly OverviewCellDatum[],
  observationColorMode: ObservationColorMode,
  annotationStyleColors: readonly AnnotationColorStyle[],
): readonly OverviewCellDatum[] {
  if (observationColorMode === 'transcript-count') {
    return cells
  }

  return styleOverviewCellsByObservation(cells, observationColorMode, {
    annotations: annotationStyleColors,
  })
}

function formatMouseCoordinate(
  coordinate: MouseCoordinate,
  unit: ViewerCoordinateUnit,
  micrometersPerPixel: number,
): string {
  if (unit === 'px') {
    const pixelSize =
      Number.isFinite(micrometersPerPixel) && micrometersPerPixel > 0
        ? micrometersPerPixel
        : DEFAULT_MICROMETERS_PER_PIXEL

    return `X ${formatCoordinateValue(coordinate.xMicrometers / pixelSize)} px | Y ${formatCoordinateValue(coordinate.yMicrometers / pixelSize)} px`
  }

  return `X ${formatCoordinateValue(coordinate.xMicrometers)} μm | Y ${formatCoordinateValue(coordinate.yMicrometers)} μm`
}

function formatCoordinateValue(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
    useGrouping: false,
  })
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

function mergeInitialViewState(
  fittedViewState: OverviewViewState,
  override: InitialViewStateOverride | undefined,
): OverviewViewState {
  if (override === undefined) {
    return fittedViewState
  }

  const nextViewState = normaliseViewState({
    ...fittedViewState,
    ...override,
    target: override.target ?? fittedViewState.target,
    minZoom: fittedViewState.minZoom,
    maxZoom: fittedViewState.maxZoom,
  })

  return {
    ...nextViewState,
    zoom: clampZoom(nextViewState.zoom, fittedViewState),
  }
}

function viewStateFromKeyboardEvent(
  event: KeyboardEvent<HTMLDivElement>,
  viewState: OverviewViewState,
  initialViewState: OverviewViewState,
): OverviewViewState | null {
  const panStep = (event.shiftKey ? 256 : 64) / scaleFromZoom(viewState.zoom)

  switch (event.key) {
    case 'ArrowLeft':
      return {
        ...viewState,
        target: [viewState.target[0] - panStep, viewState.target[1], viewState.target[2]],
      }
    case 'ArrowRight':
      return {
        ...viewState,
        target: [viewState.target[0] + panStep, viewState.target[1], viewState.target[2]],
      }
    case 'ArrowUp':
      return {
        ...viewState,
        target: [viewState.target[0], viewState.target[1] - panStep, viewState.target[2]],
      }
    case 'ArrowDown':
      return {
        ...viewState,
        target: [viewState.target[0], viewState.target[1] + panStep, viewState.target[2]],
      }
    case '+':
    case '=':
      return {
        ...viewState,
        zoom: clampZoom(viewState.zoom + 0.5, viewState),
      }
    case '-':
    case '_':
      return {
        ...viewState,
        zoom: clampZoom(viewState.zoom - 0.5, viewState),
      }
    case 'Home':
      return initialViewState
    default:
      return null
  }
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

function clampZoom(zoom: number, viewState: OverviewViewState): number {
  return Math.min(viewState.maxZoom, Math.max(viewState.minZoom, zoom))
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

function isCellBoundaryDatum(value: unknown): value is CellBoundaryDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<CellBoundaryDatum>

  return typeof candidate.id === 'string' && Array.isArray(candidate.polygon)
}
