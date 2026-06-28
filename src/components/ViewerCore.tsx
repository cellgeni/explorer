import { DeckGL } from '@deck.gl/react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { MorphologyCanvas } from './MorphologyCanvas'
import { LoadingIndicator, type LoadingTaskSummary } from './AppStatusPanels'
import {
  CellBoundaryHoverTooltip,
  GridCellHoverTooltip,
  OverviewCellHoverTooltip,
  TranscriptHoverTooltip,
} from './viewerHoverTooltips'
import {
  cellForDeckCoordinate,
  isCellBoundaryDatum,
  isGridCellDatum,
  isOverviewCellDatum,
  isTranscriptAggregateDatum,
  isTranscriptPointDatum,
} from './viewerPicking'
import { MagicLensOverlay } from './viewerMagicLensOverlay'
import { magicLensOverlayModel } from './viewerMagicLensModel'
import {
  bboxFromCircle,
  countGridCellsInBbox,
  equivalentBoundaryStyleViewport,
  equivalentViewState,
  equivalentViewportSize,
  formatMouseCoordinate,
  mergeInitialViewState,
  normaliseViewState,
  pointerEventToDataPoint,
  viewStateFromKeyboardEvent,
  viewStateKey,
  type BoundaryStyleViewport,
  type MouseCoordinate,
} from './viewerNavigation'
import {
  dataPointsToBbox,
  dataPointsToPathOverlay,
  hasMinimumPointStep,
  roiBboxToScreenRect,
  roiSelectionFromBox,
  roiSelectionFromLasso,
  type RoiDraft,
} from './viewerRoiInteraction'
import { MeasurementOverlay, type MeasurementState } from './viewerMeasurementOverlay'
import { readViewportMessage } from './viewerStatus'
import {
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayerStyle,
  createGeneExpressionElementStyleIndex,
  createOverviewLayers,
  createOverviewViewState,
  spatialOverviewView,
  styleCellsByGeneExpression,
  styleGridCellsByGeneExpression,
} from '../rendering/deckLayers'
import {
  EXPRESSION_AGGREGATION_BIN_MICROMETERS,
  EXPRESSION_AGGREGATION_EXACT_ZOOM,
  aggregateExpressionElements,
  estimateOverviewCellCountInBbox,
  overviewCellsExtentBbox,
  overviewCellsIntersectingBbox,
  overviewCellsInBbox,
  sampleOverviewCellsForRendering,
} from '../rendering/cellAggregation'
import { morphologyViewportBbox } from '../rendering/morphologyCanvas'
import { styleOverviewCellsByObservation } from '../rendering/cellStyling'
import { scaleFromZoom } from '../data/coords'
import type { PickingInfo, ViewStateChangeParameters } from '@deck.gl/core'
import type { BBox } from '../data/coords'
import type { RoiSelection } from '../data/roiSelection'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type {
  FlatMorphologyCanvasImage,
  MorphologyCanvasChannel,
} from './MorphologyCanvas'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
  TranscriptAggregateDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import type { OverviewViewState } from '../rendering/deckLayers'
import { DEFAULT_CELL_FILL_OPACITY } from '../rendering/layerOpacity'
import type {
  AnnotationColorStyle,
  CellMetadataColorStyle,
  ObservationColorMode,
} from '../rendering/cellStyling'
import {
  DEFAULT_MICROMETERS_PER_PIXEL,
  hasMinimumMeasurementDistance,
  measurementOverlayModel,
  scaleBarModel,
  type ScaleBarModel,
  type ScreenPoint,
} from './viewerMeasurements'
import type {
  RoiDrawMode,
  ViewerCellBoundaryHoverDetail,
  ViewerCoordinateUnit,
  ViewerCoreProps,
  ViewerFocusRequest,
  ViewerGridCellHoverDetail,
  ViewerLoadStatus,
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerMagicLensSummary,
  ViewerOverviewCellHoverDetail,
  ViewerTranscriptHoverDetail,
  ViewerViewportDetail,
} from './viewerCoreTypes'
export type {
  InitialViewStateOverride,
  RoiDrawMode,
  ViewerCellBoundaryHoverDetail,
  ViewerCoordinateUnit,
  ViewerCoreProps,
  ViewerFocusRequest,
  ViewerGridCellHoverDetail,
  ViewerLoadStatus,
  ViewerMagicLensDetail,
  ViewerMagicLensGeneSummary,
  ViewerMagicLensStatus,
  ViewerMagicLensSummary,
  ViewerOverviewCellHoverDetail,
  ViewerTranscriptHoverDetail,
  ViewerViewportDetail,
} from './viewerCoreTypes'

const OVERVIEW_CELL_CLIP_MIN_ZOOM = -2.25
const BOUNDARY_STYLE_VIEWPORT_IDLE_DELAY_MS = 160
const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const EMPTY_OVERVIEW_CELLS: readonly OverviewCellDatum[] = []

export function ViewerCore({
  cells = [],
  fitCells,
  expressionElements = [],
  geneExpressionActive = false,
  geneExpressionOverlayEnabled = true,
  boundaries = [],
  nucleusBoundaries = [],
  cellBoundaryHoverEnabled = false,
  hoverTooltipsEnabled = true,
  gridCells = [],
  fitGridCells,
  transcriptAggregateBins = [],
  transcriptPoints = [],
  imageLoader = null,
  imageChannels = [],
  flatImage = null,
  imageOpacity = 1,
  cellFillOpacity = DEFAULT_CELL_FILL_OPACITY,
  cellBoundaryOpacity = 1,
  transcriptOpacity = 1,
  transcriptPointSize = 2,
  observationColorMode = 'transcript-count',
  annotationStyleColors = EMPTY_ANNOTATION_STYLE_COLORS,
  cellMetadataTrack = null,
  loadingTasks = [],
  coordinateUnit = 'um',
  measurementEnabled = false,
  measurementUnit = 'um',
  measurementResetKey = 0,
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
  viewResetKey,
  focusRequest = null,
  overviewRenderCellLimit,
  maxConcurrentTileRequests,
  tileCacheMaxTiles,
  onImageTileError,
  onTileCacheEviction,
  onViewportChange,
  onViewportCellCountChange,
  onCellClick,
  onCellBoundaryClick,
  onGridCellClick,
  onTranscriptHover,
  onTranscriptClick,
  onRoiComplete,
  onMagicLensMove,
  onMagicLensLeave,
}: ViewerCoreProps) {
  const viewFitCells = fitCells ?? cells
  const viewFitGridCells = fitGridCells ?? gridCells
  const fittedViewState = useMemo(
    () => createOverviewViewState(viewFitCells, viewFitGridCells),
    [viewFitCells, viewFitGridCells],
  )
  const initialViewState = useMemo(
    () => mergeInitialViewState(fittedViewState, initialViewStateOverride),
    [fittedViewState, initialViewStateOverride],
  )
  const resetKey =
    viewResetKey === undefined ? viewStateKey(initialViewState) : String(viewResetKey)

  return (
    <ViewerSurface
      cells={cells}
      expressionElements={expressionElements}
      geneExpressionActive={geneExpressionActive}
      geneExpressionOverlayEnabled={geneExpressionOverlayEnabled}
      boundaries={boundaries}
      nucleusBoundaries={nucleusBoundaries}
      cellBoundaryHoverEnabled={cellBoundaryHoverEnabled}
      hoverTooltipsEnabled={hoverTooltipsEnabled}
      gridCells={gridCells}
      viewportCountGridCells={viewFitGridCells}
      transcriptAggregateBins={transcriptAggregateBins}
      transcriptPoints={transcriptPoints}
      imageLoader={imageLoader}
      imageChannels={imageChannels}
      flatImage={flatImage}
      imageOpacity={imageOpacity}
      cellFillOpacity={cellFillOpacity}
      cellBoundaryOpacity={cellBoundaryOpacity}
      transcriptOpacity={transcriptOpacity}
      transcriptPointSize={transcriptPointSize}
      observationColorMode={observationColorMode}
      annotationStyleColors={annotationStyleColors}
      cellMetadataTrack={cellMetadataTrack}
      loadingTasks={loadingTasks}
      coordinateUnit={coordinateUnit}
      measurementEnabled={measurementEnabled}
      measurementUnit={measurementUnit}
      measurementResetKey={measurementResetKey}
      micrometersPerPixel={micrometersPerPixel}
      initialViewState={initialViewState}
      viewResetKey={resetKey}
      focusRequest={focusRequest}
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
      {...(onCellBoundaryClick === undefined ? {} : { onCellBoundaryClick })}
      {...(onGridCellClick === undefined ? {} : { onGridCellClick })}
      {...(onTranscriptHover === undefined ? {} : { onTranscriptHover })}
      {...(onTranscriptClick === undefined ? {} : { onTranscriptClick })}
      {...(onRoiComplete === undefined ? {} : { onRoiComplete })}
      {...(onMagicLensMove === undefined ? {} : { onMagicLensMove })}
      {...(onMagicLensLeave === undefined ? {} : { onMagicLensLeave })}
    />
  )
}

interface ViewerSurfaceProps {
  readonly cells: readonly OverviewCellDatum[]
  readonly expressionElements: readonly OverviewCellDatum[]
  readonly geneExpressionActive: boolean
  readonly geneExpressionOverlayEnabled: boolean
  readonly boundaries: readonly CellBoundaryDatum[]
  readonly nucleusBoundaries: readonly CellBoundaryDatum[]
  readonly cellBoundaryHoverEnabled: boolean
  readonly hoverTooltipsEnabled: boolean
  readonly gridCells: readonly GridCellDatum[]
  readonly viewportCountGridCells: readonly GridCellDatum[]
  readonly transcriptAggregateBins: readonly TranscriptAggregateDatum[]
  readonly transcriptPoints: readonly TranscriptPointDatum[]
  readonly imageLoader: TiffPyramidLoader | null
  readonly imageChannels: readonly MorphologyCanvasChannel[]
  readonly flatImage: FlatMorphologyCanvasImage | null
  readonly imageOpacity: number
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly transcriptOpacity: number
  readonly transcriptPointSize: number
  readonly observationColorMode: ObservationColorMode
  readonly annotationStyleColors: readonly AnnotationColorStyle[]
  readonly cellMetadataTrack: CellMetadataColorStyle | null
  readonly loadingTasks: readonly LoadingTaskSummary[]
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly measurementEnabled: boolean
  readonly measurementUnit: ViewerCoordinateUnit
  readonly measurementResetKey: number
  readonly micrometersPerPixel: number
  readonly initialViewState: OverviewViewState
  readonly viewResetKey: string
  readonly focusRequest: ViewerFocusRequest | null
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
  readonly onCellBoundaryClick?: (boundary: CellBoundaryDatum) => void
  readonly onGridCellClick?: (cell: GridCellDatum) => void
  readonly onTranscriptHover?: (detail: ViewerTranscriptHoverDetail | null) => void
  readonly onTranscriptClick?: (detail: ViewerTranscriptHoverDetail) => void
  readonly onRoiComplete?: (selection: RoiSelection) => void
  readonly onMagicLensMove?: (detail: ViewerMagicLensDetail) => void
  readonly onMagicLensLeave?: () => void
}

function ViewerSurface({
  cells,
  expressionElements,
  geneExpressionActive,
  geneExpressionOverlayEnabled,
  boundaries,
  nucleusBoundaries,
  cellBoundaryHoverEnabled,
  hoverTooltipsEnabled,
  gridCells,
  viewportCountGridCells,
  transcriptAggregateBins,
  transcriptPoints,
  imageLoader,
  imageChannels,
  flatImage,
  imageOpacity,
  cellFillOpacity,
  cellBoundaryOpacity,
  transcriptOpacity,
  transcriptPointSize,
  observationColorMode,
  annotationStyleColors,
  cellMetadataTrack,
  loadingTasks,
  coordinateUnit,
  measurementEnabled,
  measurementUnit,
  measurementResetKey,
  micrometersPerPixel,
  initialViewState,
  viewResetKey,
  focusRequest,
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
  onCellBoundaryClick,
  onGridCellClick,
  onTranscriptHover,
  onTranscriptClick,
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
  const [measurementState, setMeasurementState] = useState<MeasurementState>(() => ({
    resetKey: measurementResetKey,
    draft: null,
    line: null,
  }))
  const [mouseCoordinate, setMouseCoordinate] = useState<MouseCoordinate | null>(null)
  const [magicLensScreen, setMagicLensScreen] = useState<ScreenPoint | null>(null)
  const [transcriptHover, setTranscriptHover] =
    useState<ViewerTranscriptHoverDetail | null>(null)
  const [gridCellHover, setGridCellHover] = useState<ViewerGridCellHoverDetail | null>(
    null,
  )
  const [cellBoundaryHover, setCellBoundaryHover] =
    useState<ViewerCellBoundaryHoverDetail | null>(null)
  const [cellHover, setCellHover] = useState<ViewerOverviewCellHoverDetail | null>(null)
  const [boundaryStyleViewport, setBoundaryStyleViewport] =
    useState<BoundaryStyleViewport | null>(null)
  const pendingMouseCoordinateRef = useRef<MouseCoordinate | null>(null)
  const mouseCoordinateFrameRef = useRef<number | null>(null)
  const lastAppliedViewResetKeyRef = useRef(viewResetKey)
  const lastAppliedFocusRequestKeyRef = useRef<number | null>(null)
  const cellExtentBbox = useMemo(() => overviewCellsExtentBbox(cells), [cells])
  useEffect(() => {
    if (lastAppliedViewResetKeyRef.current === viewResetKey) {
      return
    }

    lastAppliedViewResetKeyRef.current = viewResetKey
    setViewState((currentViewState) =>
      equivalentViewState(currentViewState, initialViewState)
        ? currentViewState
        : initialViewState,
    )
  }, [initialViewState, viewResetKey])
  useEffect(() => {
    if (
      focusRequest === null ||
      lastAppliedFocusRequestKeyRef.current === focusRequest.key
    ) {
      return
    }

    lastAppliedFocusRequestKeyRef.current = focusRequest.key
    setViewState((currentViewState) => {
      const nextViewState: OverviewViewState = {
        ...currentViewState,
        target: [focusRequest.target[0], focusRequest.target[1], focusRequest.target[2]],
      }

      return equivalentViewState(currentViewState, nextViewState)
        ? currentViewState
        : nextViewState
    })
  }, [focusRequest])
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
        cellMetadataTrack,
      ),
    [annotationStyleColors, cellMetadataTrack, observationColorMode, renderSourceCells],
  )
  const shouldUseExpressionPointBins = viewState.zoom < EXPRESSION_AGGREGATION_EXACT_ZOOM
  const geneExpressionPointStyleIndex = useMemo(
    () =>
      createGeneExpressionElementStyleIndex(
        expressionElements,
        shouldUseExpressionPointBins
          ? { binMicrometers: EXPRESSION_AGGREGATION_BIN_MICROMETERS }
          : {},
      ),
    [expressionElements, shouldUseExpressionPointBins],
  )
  const expressionStyledRenderCells = useMemo(
    () =>
      styleCellsByGeneExpression(renderCells, geneExpressionPointStyleIndex, {
        styleUnmatchedCells: geneExpressionActive,
      }),
    [geneExpressionActive, geneExpressionPointStyleIndex, renderCells],
  )
  const expressionStyledGridCells = useMemo(
    () =>
      styleGridCellsByGeneExpression(gridCells, geneExpressionPointStyleIndex, {
        styleUnmatchedCells: geneExpressionActive,
      }),
    [geneExpressionActive, geneExpressionPointStyleIndex, gridCells],
  )
  const geneExpressionOverlayElements = useMemo(
    () =>
      geneExpressionOverlayEnabled
        ? expressionOverlayCellsForRendering({
            expressionElements,
            viewState,
            viewportBbox,
          })
        : EMPTY_OVERVIEW_CELLS,
    [expressionElements, geneExpressionOverlayEnabled, viewState, viewportBbox],
  )
  const cellById = useMemo(() => {
    const nextCellById = new Map<string, OverviewCellDatum>()

    for (const cell of cells) {
      nextCellById.set(cell.id, cell)
    }

    return nextCellById
  }, [cells])
  const annotationLabelsByCellId = useMemo(
    () => annotationLabelsByCellIdForStyles(annotationStyleColors),
    [annotationStyleColors],
  )
  const cellBoundaryFillEnabled =
    (observationColorMode === 'annotations' && annotationStyleColors.length > 0) ||
    (observationColorMode === 'metadata' && cellMetadataTrack !== null) ||
    geneExpressionActive
  const boundaryLayerGeometry = useMemo(
    () =>
      createCellBoundaryLayerGeometry(boundaries, {
        includeFill: cellBoundaryFillEnabled,
      }),
    [boundaries, cellBoundaryFillEnabled],
  )
  const boundaryExpressionElements = useMemo(
    () =>
      boundaries.length === 0 || boundaryStyleViewport === null
        ? EMPTY_OVERVIEW_CELLS
        : overviewCellsIntersectingBbox(expressionElements, boundaryStyleViewport.bbox),
    [boundaries.length, boundaryStyleViewport, expressionElements],
  )
  const boundaryStyleCells = useMemo(() => {
    if (boundaryLayerGeometry.boundaryCellIds.size === 0) {
      return EMPTY_OVERVIEW_CELLS
    }

    const boundaryCells: OverviewCellDatum[] = []

    for (const cellId of boundaryLayerGeometry.boundaryCellIds) {
      const cell = cellById.get(cellId)

      if (cell !== undefined) {
        boundaryCells.push(cell)
      }
    }

    const observationStyledCells = styleCellsForObservation(
      boundaryCells,
      observationColorMode,
      annotationStyleColors,
      cellMetadataTrack,
    )

    return styleCellsByGeneExpression(
      observationStyledCells,
      boundaryExpressionElements,
      {
        styleUnmatchedCells: geneExpressionActive,
      },
    )
  }, [
    annotationStyleColors,
    boundaryExpressionElements,
    boundaryLayerGeometry,
    cellById,
    cellMetadataTrack,
    geneExpressionActive,
    observationColorMode,
  ])
  const boundaryLayerStyle = useMemo(
    () =>
      createCellBoundaryLayerStyle(
        boundaryLayerGeometry,
        cellBoundaryFillEnabled ? boundaryStyleCells : EMPTY_OVERVIEW_CELLS,
        boundaryExpressionElements,
      ),
    [
      boundaryExpressionElements,
      boundaryLayerGeometry,
      boundaryStyleCells,
      cellBoundaryFillEnabled,
    ],
  )
  const layers = useMemo(
    () =>
      createOverviewLayers(expressionStyledRenderCells, boundaries, {
        cellFillOpacity,
        cellBoundaryOpacity,
        cellBoundaryFillEnabled,
        cellBoundaryPickable: cellBoundaryHoverEnabled,
        nucleusBoundaries,
        gridCells: expressionStyledGridCells,
        cellBoundaryGeometry: boundaryLayerGeometry,
        cellBoundaryStyle: boundaryLayerStyle,
        geneExpressionActive,
        geneExpressionOverlayElements,
        transcriptAggregateBins,
        transcriptPoints,
        transcriptOpacity,
        transcriptPointSize,
      }),
    [
      cellBoundaryOpacity,
      cellFillOpacity,
      cellBoundaryFillEnabled,
      cellBoundaryHoverEnabled,
      boundaryLayerGeometry,
      boundaryLayerStyle,
      boundaries,
      nucleusBoundaries,
      expressionStyledRenderCells,
      expressionStyledGridCells,
      geneExpressionActive,
      geneExpressionOverlayElements,
      transcriptAggregateBins,
      transcriptOpacity,
      transcriptPointSize,
      transcriptPoints,
    ],
  )
  const hasCells = cells.length > 0
  const hasGridCells = gridCells.length > 0
  const hasViewportCountGridCells = viewportCountGridCells.length > 0
  const hasBoundaries = boundaries.length > 0
  const hasNucleusBoundaries = nucleusBoundaries.length > 0
  const hasSpatialData = hasCells || hasGridCells || hasBoundaries || hasNucleusBoundaries
  const hasImage = imageLoader !== null || imageChannels.length > 0 || flatImage !== null
  const canTrackMouseCoordinates = hasSpatialData || hasImage
  const visibleCellCount = visibleCells.length
  const visibleGridCellCount = useMemo(
    () =>
      viewportBbox === null
        ? viewportCountGridCells.length
        : countGridCellsInBbox(viewportCountGridCells, viewportBbox),
    [viewportBbox, viewportCountGridCells],
  )
  const estimatedViewportCellCount = useMemo(() => {
    if (!hasCells && hasViewportCountGridCells) {
      return visibleGridCellCount
    }

    if (!hasCells && !hasGridCells && hasBoundaries) {
      return boundaries.length
    }

    if (!hasCells && !hasGridCells && !hasBoundaries && hasNucleusBoundaries) {
      return nucleusBoundaries.length
    }

    if (viewportBbox === null) {
      return cells.length
    }

    if (viewState.zoom > OVERVIEW_CELL_CLIP_MIN_ZOOM) {
      return visibleCellCount
    }

    return estimateOverviewCellCountInBbox(cells, viewportBbox, {
      extentBbox: cellExtentBbox,
    })
  }, [
    cellExtentBbox,
    boundaries.length,
    cells,
    hasBoundaries,
    hasCells,
    hasGridCells,
    hasNucleusBoundaries,
    hasViewportCountGridCells,
    nucleusBoundaries.length,
    viewState.zoom,
    viewportBbox,
    visibleCellCount,
    visibleGridCellCount,
  ])
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
  const activeMeasurementDraft =
    measurementEnabled && measurementState.resetKey === measurementResetKey
      ? measurementState.draft
      : null
  const activeMeasurementLine =
    measurementState.resetKey === measurementResetKey ? measurementState.line : null
  const measurementOverlay = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    const activeMeasurement =
      activeMeasurementDraft === null
        ? activeMeasurementLine === null
          ? null
          : {
              start: activeMeasurementLine.start,
              end: activeMeasurementLine.end,
              isDraft: false,
            }
        : {
            start: activeMeasurementDraft.start,
            end: activeMeasurementDraft.current,
            isDraft: true,
          }

    return activeMeasurement === null
      ? null
      : measurementOverlayModel(
          activeMeasurement,
          viewState,
          viewport,
          measurementUnit,
          micrometersPerPixel,
        )
  }, [
    activeMeasurementDraft,
    activeMeasurementLine,
    measurementUnit,
    micrometersPerPixel,
    viewState,
    viewport,
  ])
  const loadingTaskIds = useMemo(
    () => new Set(loadingTasks.map((task) => task.id)),
    [loadingTasks],
  )
  const viewportMessage = readViewportMessage(
    status,
    imageStatus,
    boundaryStatus,
    {
      ...(errorMessage === undefined ? {} : { errorMessage }),
      ...(imageErrorMessage === undefined ? {} : { imageErrorMessage }),
      ...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage }),
    },
    loadingTaskIds,
  )
  const mouseCoordinateText =
    !canTrackMouseCoordinates || mouseCoordinate === null
      ? null
      : formatMouseCoordinate(mouseCoordinate, coordinateUnit, micrometersPerPixel)
  const scaleBar = useMemo(
    () =>
      !canTrackMouseCoordinates || viewport.width <= 0 || viewport.height <= 0
        ? null
        : scaleBarModel(viewState, viewport, coordinateUnit, micrometersPerPixel),
    [canTrackMouseCoordinates, coordinateUnit, micrometersPerPixel, viewState, viewport],
  )
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
    (info: {
      readonly object?: unknown
      readonly coordinate?: readonly number[]
      readonly x?: number
      readonly y?: number
    }) => {
      if (isTranscriptPointDatum(info.object)) {
        onTranscriptClick?.({
          transcript: info.object,
          screen: {
            x: info.x ?? 0,
            y: info.y ?? 0,
          },
        })
        return
      }

      if (isTranscriptAggregateDatum(info.object)) {
        onTranscriptClick?.({
          aggregate: info.object,
          screen: {
            x: info.x ?? 0,
            y: info.y ?? 0,
          },
        })
        return
      }

      if (isGridCellDatum(info.object)) {
        onGridCellClick?.(info.object)
        return
      }

      if (isOverviewCellDatum(info.object) && onCellClick !== undefined) {
        onCellClick(info.object)
        return
      }

      if (isCellBoundaryDatum(info.object)) {
        const cell = cellById.get(info.object.id)

        if (cell !== undefined && onCellClick !== undefined) {
          onCellClick(cell)
          return
        }

        onCellBoundaryClick?.(info.object)
        return
      }

      if (onCellClick === undefined) {
        return
      }

      const coordinateCell = cellForDeckCoordinate(
        info.coordinate,
        boundaries,
        visibleCells,
        cellById,
      )

      if (coordinateCell !== null) {
        onCellClick(coordinateCell)
      }
    },
    [
      boundaries,
      cellById,
      onCellBoundaryClick,
      onCellClick,
      onGridCellClick,
      onTranscriptClick,
      visibleCells,
    ],
  )
  const handleDeckHover = useCallback(
    (info: PickingInfo<unknown>) => {
      if (isTranscriptPointDatum(info.object)) {
        const detail = {
          transcript: info.object,
          screen: {
            x: info.x,
            y: info.y,
          },
        }
        setTranscriptHover(detail)
        setGridCellHover(null)
        setCellBoundaryHover(null)
        setCellHover(null)
        onTranscriptHover?.(detail)
        return
      }

      if (isTranscriptAggregateDatum(info.object)) {
        const detail = {
          aggregate: info.object,
          screen: {
            x: info.x,
            y: info.y,
          },
        }
        setTranscriptHover(detail)
        setGridCellHover(null)
        setCellBoundaryHover(null)
        setCellHover(null)
        onTranscriptHover?.(detail)
        return
      }

      if (isGridCellDatum(info.object)) {
        setTranscriptHover((current) => {
          if (current !== null) {
            onTranscriptHover?.(null)
          }

          return null
        })
        setCellHover(null)
        if (magicLensActive || !hoverTooltipsEnabled) {
          setGridCellHover(null)
          setCellBoundaryHover(null)
          return
        }

        setGridCellHover({
          cell: info.object,
          screen: {
            x: info.x,
            y: info.y,
          },
        })
        setCellBoundaryHover(null)
        return
      }

      if (cellBoundaryHoverEnabled && isCellBoundaryDatum(info.object)) {
        const boundary = info.object
        const expressionElement = geneExpressionPointStyleIndex.expressionByElementId.get(
          boundary.id,
        )
        const expressionCount =
          expressionElement?.expressionCount ?? boundary.expressionCount
        const expressionGenes =
          expressionElement?.expressionGenes ?? boundary.expressionGenes
        const annotationLabels = annotationLabelsByCellId.get(boundary.id)
        const cell = cellById.get(boundary.id)

        setTranscriptHover((current) => {
          if (current !== null) {
            onTranscriptHover?.(null)
          }

          return null
        })
        setGridCellHover(null)
        setCellHover(null)

        if (magicLensActive || !hoverTooltipsEnabled) {
          setCellBoundaryHover(null)
          return
        }

        setCellBoundaryHover({
          boundary,
          ...(cell === undefined ? {} : { cell }),
          ...(annotationLabels === undefined ? {} : { annotationLabels }),
          ...(expressionCount === undefined ? {} : { expressionCount }),
          ...(expressionGenes === undefined ? {} : { expressionGenes }),
          screen: {
            x: info.x,
            y: info.y,
          },
        })
        return
      }

      if (isOverviewCellDatum(info.object)) {
        const annotationLabels = annotationLabelsByCellId.get(info.object.id)

        setTranscriptHover((current) => {
          if (current !== null) {
            onTranscriptHover?.(null)
          }

          return null
        })
        setGridCellHover(null)
        setCellBoundaryHover(null)

        if (magicLensActive || !hoverTooltipsEnabled) {
          setCellHover(null)
          return
        }

        setCellHover({
          cell: info.object,
          ...(annotationLabels === undefined ? {} : { annotationLabels }),
          screen: {
            x: info.x,
            y: info.y,
          },
        })
        return
      }

      setTranscriptHover((current) => {
        if (current !== null) {
          onTranscriptHover?.(null)
        }

        return null
      })
      setGridCellHover(null)
      setCellBoundaryHover(null)
      setCellHover(null)
    },
    [
      annotationLabelsByCellId,
      cellBoundaryHoverEnabled,
      cellById,
      geneExpressionPointStyleIndex,
      hoverTooltipsEnabled,
      magicLensActive,
      onTranscriptHover,
    ],
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

      if (magicLensActive && roiMode === 'idle' && !measurementEnabled) {
        setGridCellHover((current) => (current === null ? current : null))
        setCellBoundaryHover((current) => (current === null ? current : null))
        setCellHover((current) => (current === null ? current : null))
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
      measurementEnabled,
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
    setTranscriptHover(null)
    setGridCellHover(null)
    setCellBoundaryHover(null)
    setCellHover(null)
    onTranscriptHover?.(null)
    onMagicLensLeave?.()
  }, [clearMouseCoordinate, onMagicLensLeave, onTranscriptHover])
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
  const handleMeasurementPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (
        !measurementEnabled ||
        !canTrackMouseCoordinates ||
        viewport.width <= 0 ||
        viewport.height <= 0
      ) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const point = pointerEventToDataPoint(event, viewState, viewport)
      setMeasurementState({
        resetKey: measurementResetKey,
        draft: { start: point, current: point },
        line: null,
      })
    },
    [
      canTrackMouseCoordinates,
      measurementEnabled,
      measurementResetKey,
      viewState,
      viewport,
    ],
  )
  const handleMeasurementPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (
        activeMeasurementDraft === null ||
        viewport.width <= 0 ||
        viewport.height <= 0
      ) {
        return
      }

      event.preventDefault()
      const point = pointerEventToDataPoint(event, viewState, viewport)
      setMeasurementState((currentState) =>
        currentState.resetKey !== measurementResetKey || currentState.draft === null
          ? currentState
          : {
              ...currentState,
              draft: { ...currentState.draft, current: point },
            },
      )
    },
    [activeMeasurementDraft, measurementResetKey, viewState, viewport],
  )
  const handleMeasurementPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (
        activeMeasurementDraft === null ||
        viewport.width <= 0 ||
        viewport.height <= 0
      ) {
        return
      }

      event.preventDefault()
      const point = pointerEventToDataPoint(event, viewState, viewport)
      const nextMeasurement = { start: activeMeasurementDraft.start, end: point }
      setMeasurementState({
        resetKey: measurementResetKey,
        draft: null,
        line: hasMinimumMeasurementDistance(nextMeasurement, viewState)
          ? nextMeasurement
          : null,
      })
    },
    [activeMeasurementDraft, measurementResetKey, viewState, viewport],
  )
  const handleMeasurementPointerCancel = useCallback(() => {
    setMeasurementState((currentState) =>
      currentState.resetKey !== measurementResetKey
        ? currentState
        : { ...currentState, draft: null },
    )
  }, [measurementResetKey])

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
    if (boundaries.length === 0 || viewportBbox === null) {
      return
    }

    const nextViewport = {
      bbox: viewportBbox,
      zoom: viewState.zoom,
    }
    const timeout = window.setTimeout(() => {
      setBoundaryStyleViewport((currentViewport) =>
        equivalentBoundaryStyleViewport(currentViewport, nextViewport)
          ? currentViewport
          : nextViewport,
      )
    }, BOUNDARY_STYLE_VIEWPORT_IDLE_DELAY_MS)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [boundaries.length, viewState.zoom, viewportBbox])

  useEffect(() => {
    if (onViewportCellCountChange === undefined || !hasSpatialData) {
      return
    }

    const timeout = window.setTimeout(() => {
      onViewportCellCountChange(estimatedViewportCellCount)
    }, 80)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [estimatedViewportCellCount, hasSpatialData, onViewportCellCountChange])

  useEffect(() => {
    if (onViewportChange === undefined || !hasSpatialData || viewportBbox === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      onViewportChange({
        bbox: viewportBbox,
        visibleCellCount: estimatedViewportCellCount,
        viewState,
      })
    }, 180)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    estimatedViewportCellCount,
    hasSpatialData,
    onViewportChange,
    viewState,
    viewportBbox,
  ])

  return (
    <div
      ref={frameRef}
      className={[
        'viewport-frame',
        magicLensActive ? 'is-magic-lens-active' : '',
        measurementEnabled ? 'is-measuring-distance' : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
        When measuring is enabled, drag across the spatial view to measure a distance.
      </p>
      {!hasImage ? <div className="viewport-grid" aria-hidden="true" /> : null}
      <MorphologyCanvas
        channels={imageChannels}
        flatImage={flatImage}
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
      {hasSpatialData ? (
        <div className="deckgl-host" aria-hidden="true">
          <DeckGL
            views={spatialOverviewView}
            viewState={viewState}
            onViewStateChange={handleViewStateChange}
            onClick={handleDeckClick}
            onHover={handleDeckHover}
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
      <div
        className={`measurement-draw-layer${measurementEnabled ? ' active' : ''}`}
        aria-hidden="true"
        onPointerDown={handleMeasurementPointerDown}
        onPointerMove={handleMeasurementPointerMove}
        onPointerUp={handleMeasurementPointerUp}
        onPointerCancel={handleMeasurementPointerCancel}
      >
        {measurementOverlay === null ? null : (
          <MeasurementOverlay model={measurementOverlay} />
        )}
      </div>
      {magicLensOverlay === null ? null : (
        <MagicLensOverlay
          model={magicLensOverlay}
          status={magicLensStatus}
          summary={magicLensSummary}
        />
      )}
      {transcriptHover === null ? null : (
        <TranscriptHoverTooltip detail={transcriptHover} />
      )}
      {cellHover === null || magicLensActive ? null : (
        <OverviewCellHoverTooltip detail={cellHover} />
      )}
      {gridCellHover === null || magicLensActive ? null : (
        <GridCellHoverTooltip detail={gridCellHover} />
      )}
      {cellBoundaryHover === null || magicLensActive ? null : (
        <CellBoundaryHoverTooltip detail={cellBoundaryHover} />
      )}
      {!hasSpatialData && status === 'idle' ? (
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
      {scaleBar === null ? null : <ScaleBar model={scaleBar} />}
      {loadingTasks.length === 0 && viewportMessage === null ? null : (
        <div className="viewport-notification-stack">
          <LoadingIndicator tasks={loadingTasks} />
          {viewportMessage === null ? null : (
            <p
              className={`viewport-message${viewportMessage.kind === 'error' ? ' viewport-message-error' : ''}`}
              aria-live={viewportMessage.kind === 'error' ? 'assertive' : 'polite'}
            >
              {viewportMessage.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function expressionOverlayCellsForRendering({
  expressionElements,
  viewState,
  viewportBbox,
}: {
  readonly expressionElements: readonly OverviewCellDatum[]
  readonly viewState: OverviewViewState
  readonly viewportBbox: BBox | null
}): readonly OverviewCellDatum[] {
  if (expressionElements.length === 0) {
    return EMPTY_OVERVIEW_CELLS
  }

  const overlayCells = aggregateExpressionElements(expressionElements, viewState, {
    ...(viewportBbox === null ? {} : { bbox: viewportBbox }),
    binMicrometers: EXPRESSION_AGGREGATION_BIN_MICROMETERS,
    exactZoom: EXPRESSION_AGGREGATION_EXACT_ZOOM,
  })

  return overlayCells.length === 0 ? EMPTY_OVERVIEW_CELLS : overlayCells
}

function ScaleBar({ model }: { readonly model: ScaleBarModel }) {
  return (
    <div className="viewport-scale-bar" aria-label={`Scale bar ${model.label}`}>
      <span className="viewport-scale-bar-label">{model.label}</span>
      <span
        className="viewport-scale-bar-track"
        style={{ width: model.widthPixels }}
        aria-hidden="true"
      />
    </div>
  )
}

function styleCellsForObservation(
  cells: readonly OverviewCellDatum[],
  observationColorMode: ObservationColorMode,
  annotationStyleColors: readonly AnnotationColorStyle[],
  cellMetadataTrack: CellMetadataColorStyle | null,
): readonly OverviewCellDatum[] {
  if (observationColorMode === 'transcript-count') {
    return cells
  }

  return styleOverviewCellsByObservation(cells, observationColorMode, {
    annotations: annotationStyleColors,
    metadataTrack: cellMetadataTrack,
  })
}

function annotationLabelsByCellIdForStyles(
  annotationStyles: readonly AnnotationColorStyle[],
): ReadonlyMap<string, readonly string[]> {
  const labelsByCellId = new Map<string, string[]>()

  for (const annotationStyle of annotationStyles) {
    const label = annotationStyle.label ?? annotationStyle.id

    for (const cellId of annotationStyle.cellIds) {
      const labels = labelsByCellId.get(cellId)

      if (labels === undefined) {
        labelsByCellId.set(cellId, [label])
        continue
      }

      labels.push(label)
    }
  }

  return labelsByCellId
}
