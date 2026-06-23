import { DeckGL } from '@deck.gl/react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { MorphologyCanvas } from './MorphologyCanvas'
import { LoadingIndicator, type LoadingTaskSummary } from './AppStatusPanels'
import {
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayerStyle,
  createGeneExpressionCellStyleIndex,
  createOverviewLayers,
  createOverviewViewState,
  spatialOverviewView,
  styleCellsByGeneExpression,
  styleGridCellsByGeneExpression,
} from '../rendering/deckLayers'
import {
  EXPRESSION_AGGREGATION_BIN_MICROMETERS,
  EXPRESSION_AGGREGATION_EXACT_ZOOM,
  aggregateExpressionCells,
  estimateOverviewCellCountInBbox,
  overviewCellsExtentBbox,
  overviewCellsInBbox,
  sampleOverviewCellsForRendering,
} from '../rendering/cellAggregation'
import { morphologyViewportBbox } from '../rendering/morphologyCanvas'
import { styleOverviewCellsByObservation } from '../rendering/cellStyling'
import { micrometers, scaleFromZoom } from '../data/coords'
import type { PickingInfo, Position, ViewStateChangeParameters } from '@deck.gl/core'
import type { BBox, DataPoint } from '../data/coords'
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
  formatCoordinateValue,
  hasMinimumMeasurementDistance,
  measurementOverlayModel,
  rawDataPointToScreen,
  safeMicrometersPerPixel,
  scaleBarModel,
  type MeasurementLine,
  type MeasurementOverlayModel,
  type ScaleBarModel,
  type ScreenPoint,
  type ViewerDistanceUnit,
} from './viewerMeasurements'

const OVERVIEW_CELL_CLIP_MIN_ZOOM = -2.25
const BOUNDARY_STYLE_VIEWPORT_IDLE_DELAY_MS = 160
const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const EMPTY_OVERVIEW_CELLS: readonly OverviewCellDatum[] = []
const DATASET_LOADING_TASK_ID = 'dataset'
const MORPHOLOGY_LOADING_TASK_ID = 'morphology'
const BOUNDARY_LOADING_TASK_ID = 'boundaries'

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ViewerCoordinateUnit = ViewerDistanceUnit

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly fitCells?: readonly OverviewCellDatum[]
  readonly expressionCells?: readonly OverviewCellDatum[]
  readonly geneExpressionActive?: boolean
  readonly geneExpressionOverlayEnabled?: boolean
  readonly boundaries?: readonly CellBoundaryDatum[]
  readonly nucleusBoundaries?: readonly CellBoundaryDatum[]
  readonly cellBoundaryHoverEnabled?: boolean
  readonly gridCells?: readonly GridCellDatum[]
  readonly fitGridCells?: readonly GridCellDatum[]
  readonly transcriptAggregateBins?: readonly TranscriptAggregateDatum[]
  readonly transcriptPoints?: readonly TranscriptPointDatum[]
  readonly imageLoader?: TiffPyramidLoader | null
  readonly imageChannels?: readonly MorphologyCanvasChannel[]
  readonly flatImage?: FlatMorphologyCanvasImage | null
  readonly imageOpacity?: number
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
  readonly observationColorMode?: ObservationColorMode
  readonly annotationStyleColors?: readonly AnnotationColorStyle[]
  readonly cellMetadataTrack?: CellMetadataColorStyle | null
  readonly loadingTasks?: readonly LoadingTaskSummary[]
  readonly coordinateUnit?: ViewerCoordinateUnit
  readonly measurementEnabled?: boolean
  readonly measurementUnit?: ViewerCoordinateUnit
  readonly measurementResetKey?: number
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
  readonly viewResetKey?: string | number
  readonly focusRequest?: ViewerFocusRequest | null
  readonly overviewRenderCellLimit?: number
  readonly maxConcurrentTileRequests?: number
  readonly tileCacheMaxTiles?: number
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

export interface InitialViewStateOverride {
  readonly target?: readonly [number, number, number]
  readonly zoom?: number
}

export interface ViewerFocusRequest {
  readonly key: number
  readonly target: readonly [number, number, number]
}

export type ViewerMagicLensStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerMagicLensDetail {
  readonly center: DataPoint
  readonly radiusMicrometers: number
  readonly bbox: BBox
  readonly screen: ScreenPoint
}

export interface ViewerMagicLensSummary {
  readonly kind?: 'transcripts' | 'expression'
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

export interface ViewerTranscriptHoverDetail {
  readonly transcript?: TranscriptPointDatum
  readonly aggregate?: TranscriptAggregateDatum
  readonly screen: ScreenPoint
}

export interface ViewerGridCellHoverDetail {
  readonly cell: GridCellDatum
  readonly screen: ScreenPoint
}

export interface ViewerCellBoundaryHoverDetail {
  readonly boundary: CellBoundaryDatum
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
  readonly screen: ScreenPoint
}

export type RoiDrawMode = 'idle' | 'box' | 'lasso'

export function ViewerCore({
  cells = [],
  fitCells,
  expressionCells = [],
  geneExpressionActive = false,
  geneExpressionOverlayEnabled = true,
  boundaries = [],
  nucleusBoundaries = [],
  cellBoundaryHoverEnabled = false,
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
      expressionCells={expressionCells}
      geneExpressionActive={geneExpressionActive}
      geneExpressionOverlayEnabled={geneExpressionOverlayEnabled}
      boundaries={boundaries}
      nucleusBoundaries={nucleusBoundaries}
      cellBoundaryHoverEnabled={cellBoundaryHoverEnabled}
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
  readonly expressionCells: readonly OverviewCellDatum[]
  readonly geneExpressionActive: boolean
  readonly geneExpressionOverlayEnabled: boolean
  readonly boundaries: readonly CellBoundaryDatum[]
  readonly nucleusBoundaries: readonly CellBoundaryDatum[]
  readonly cellBoundaryHoverEnabled: boolean
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

interface MeasurementDraft {
  readonly start: DataPoint
  readonly current: DataPoint
}

interface MeasurementState {
  readonly resetKey: number
  readonly draft: MeasurementDraft | null
  readonly line: MeasurementLine | null
}

interface BoundaryStyleViewport {
  readonly bbox: BBox
  readonly zoom: number
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
  geneExpressionActive,
  geneExpressionOverlayEnabled,
  boundaries,
  nucleusBoundaries,
  cellBoundaryHoverEnabled,
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
      createGeneExpressionCellStyleIndex(
        expressionCells,
        shouldUseExpressionPointBins
          ? { binMicrometers: EXPRESSION_AGGREGATION_BIN_MICROMETERS }
          : {},
      ),
    [expressionCells, shouldUseExpressionPointBins],
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
  const geneExpressionOverlayCells = useMemo(
    () =>
      geneExpressionOverlayEnabled
        ? expressionOverlayCellsForRendering({
            expressionCells,
            viewState,
            viewportBbox,
          })
        : EMPTY_OVERVIEW_CELLS,
    [expressionCells, geneExpressionOverlayEnabled, viewState, viewportBbox],
  )
  const cellById = useMemo(() => {
    const nextCellById = new Map<string, OverviewCellDatum>()

    for (const cell of cells) {
      nextCellById.set(cell.id, cell)
    }

    return nextCellById
  }, [cells])
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
  const boundaryExpressionCells = useMemo(
    () =>
      boundaries.length === 0 || boundaryStyleViewport === null
        ? EMPTY_OVERVIEW_CELLS
        : overviewCellsInBbox(expressionCells, boundaryStyleViewport.bbox),
    [boundaries.length, boundaryStyleViewport, expressionCells],
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

    return styleCellsByGeneExpression(observationStyledCells, boundaryExpressionCells, {
      styleUnmatchedCells: geneExpressionActive,
    })
  }, [
    annotationStyleColors,
    boundaryExpressionCells,
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
        boundaryStyleCells,
        boundaryExpressionCells,
      ),
    [boundaryExpressionCells, boundaryLayerGeometry, boundaryStyleCells],
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
        geneExpressionOverlayCells,
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
      geneExpressionOverlayCells,
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
        const expressionCell = geneExpressionPointStyleIndex.expressionByCellId.get(
          info.object.id,
        )

        setTranscriptHover((current) => {
          if (current !== null) {
            onTranscriptHover?.(null)
          }

          return null
        })
        setGridCellHover(null)
        setCellBoundaryHover({
          boundary: info.object,
          ...(expressionCell?.expressionCount === undefined
            ? {}
            : { expressionCount: expressionCell.expressionCount }),
          ...(expressionCell?.expressionGenes === undefined
            ? {}
            : { expressionGenes: expressionCell.expressionGenes }),
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
    },
    [cellBoundaryHoverEnabled, geneExpressionPointStyleIndex, onTranscriptHover],
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
      {gridCellHover === null ? null : <GridCellHoverTooltip detail={gridCellHover} />}
      {cellBoundaryHover === null ? null : (
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
  expressionCells,
  viewState,
  viewportBbox,
}: {
  readonly expressionCells: readonly OverviewCellDatum[]
  readonly viewState: OverviewViewState
  readonly viewportBbox: BBox | null
}): readonly OverviewCellDatum[] {
  if (expressionCells.length === 0) {
    return EMPTY_OVERVIEW_CELLS
  }

  const overlayCells = aggregateExpressionCells(expressionCells, viewState, {
    ...(viewportBbox === null ? {} : { bbox: viewportBbox }),
    binMicrometers: EXPRESSION_AGGREGATION_BIN_MICROMETERS,
    exactZoom: EXPRESSION_AGGREGATION_EXACT_ZOOM,
  })

  return overlayCells.length === 0 ? EMPTY_OVERVIEW_CELLS : overlayCells
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

function MeasurementOverlay({ model }: { readonly model: MeasurementOverlayModel }) {
  return (
    <div className="measurement-overlay">
      <svg className="measurement-svg" focusable="false" aria-hidden="true">
        <line
          className={`measurement-line${model.isDraft ? ' is-draft' : ''}`}
          x1={model.start.x}
          y1={model.start.y}
          x2={model.end.x}
          y2={model.end.y}
        />
        <circle
          className="measurement-endpoint"
          cx={model.start.x}
          cy={model.start.y}
          r="3"
        />
        <circle
          className="measurement-endpoint"
          cx={model.end.x}
          cy={model.end.y}
          r="3"
        />
      </svg>
      <span
        className={`measurement-label${model.isDraft ? ' is-draft' : ''}`}
        style={model.labelStyle}
      >
        {model.label}
      </span>
    </div>
  )
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
              : `${summary.cellCount.toLocaleString()} ${magicLensElementShortLabel(summary)} - ${summary.transcriptCount.toLocaleString()} ${magicLensPrimaryMetricShortLabel(summary)}`}
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

function GridCellHoverTooltip({
  detail,
}: {
  readonly detail: ViewerGridCellHoverDetail
}) {
  const cell = detail.cell

  return (
    <div
      className="transcript-hover-tooltip grid-cell-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{cell.id}</p>
      <dl>
        <div>
          <dt>Bin</dt>
          <dd>{formatGridCellBinSize(cell)}</dd>
        </div>
        <div>
          <dt>Array</dt>
          <dd>
            {cell.row.toLocaleString()}, {cell.col.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Image px</dt>
          <dd>{formatGridCellImageCoordinate(cell)}</dd>
        </div>
        <div>
          <dt>Tissue</dt>
          <dd>{formatGridCellTissue(cell)}</dd>
        </div>
        {cell.expressionCount === undefined ? null : (
          <div>
            <dt>Expression</dt>
            <dd>{formatCoordinateValue(cell.expressionCount)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function CellBoundaryHoverTooltip({
  detail,
}: {
  readonly detail: ViewerCellBoundaryHoverDetail
}) {
  const boundary = detail.boundary

  return (
    <div
      className="transcript-hover-tooltip grid-cell-hover-tooltip cell-boundary-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{boundary.id}</p>
      <dl>
        <div>
          <dt>Cell</dt>
          <dd>Segmented</dd>
        </div>
        {boundary.annotationLabel === undefined ? null : (
          <div>
            <dt>Annotation</dt>
            <dd>{boundary.annotationLabel}</dd>
          </div>
        )}
        <div>
          <dt>Vertices</dt>
          <dd>{boundary.polygon.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{formatBoundaryPolygonArea(boundary.polygon)}</dd>
        </div>
        {detail.expressionCount === undefined ? null : (
          <div>
            <dt>Expression</dt>
            <dd>{formatCoordinateValue(detail.expressionCount)}</dd>
          </div>
        )}
        {detail.expressionGenes === undefined ||
        detail.expressionGenes.length === 0 ? null : (
          <div>
            <dt>Genes</dt>
            <dd>{formatExpressionGeneList(detail.expressionGenes)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function TranscriptHoverTooltip({
  detail,
}: {
  readonly detail: ViewerTranscriptHoverDetail
}) {
  const aggregate = detail.aggregate

  if (aggregate !== undefined) {
    return (
      <div
        className="transcript-hover-tooltip"
        style={{
          left: detail.screen.x,
          top: detail.screen.y,
        }}
        aria-hidden="true"
      >
        <p>
          {aggregate.featureName === undefined
            ? 'Transcript density bin'
            : aggregate.featureName}
        </p>
        <dl>
          <div>
            <dt>Count</dt>
            <dd>{aggregate.count.toLocaleString()}</dd>
          </div>
          {aggregate.binTotalCount === undefined ? null : (
            <div>
              <dt>Total</dt>
              <dd>{aggregate.binTotalCount.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Level</dt>
            <dd>{aggregate.level.toLocaleString()}</dd>
          </div>
          <div>
            <dt>X/Y</dt>
            <dd>
              {formatCoordinateValue(aggregate.position[0] ?? 0)},{' '}
              {formatCoordinateValue(-(aggregate.position[1] ?? 0))} um
            </dd>
          </div>
          <div>
            <dt>Bin</dt>
            <dd>
              {aggregate.binX.toLocaleString()}, {aggregate.binY.toLocaleString()}
            </dd>
          </div>
          {aggregate.omittedFeatureCount === undefined ? null : (
            <div>
              <dt>Hidden</dt>
              <dd>{aggregate.omittedFeatureCount.toLocaleString()} genes</dd>
            </div>
          )}
        </dl>
      </div>
    )
  }

  const transcript = detail.transcript

  if (transcript === undefined) {
    return null
  }

  const transcriptCellLabel = transcriptCellDisplayLabel(transcript)

  return (
    <div
      className="transcript-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{transcript.featureName}</p>
      <dl>
        <div>
          <dt>ID</dt>
          <dd>{transcript.transcriptId ?? transcript.id}</dd>
        </div>
        <div>
          <dt>FOV</dt>
          <dd>{transcript.fovName ?? 'Unassigned'}</dd>
        </div>
        {transcriptCellLabel === null ? null : (
          <div>
            <dt>Cell</dt>
            <dd>{transcriptCellLabel}</dd>
          </div>
        )}
        <div>
          <dt>QV</dt>
          <dd>{formatCoordinateValue(transcript.qv)}</dd>
        </div>
        <div>
          <dt>X/Y</dt>
          <dd>
            {formatCoordinateValue(transcript.position[0] ?? 0)},{' '}
            {formatCoordinateValue(-(transcript.position[1] ?? 0))} um
          </dd>
        </div>
        {transcript.zLocation === undefined ? null : (
          <div>
            <dt>Z</dt>
            <dd>{formatCoordinateValue(transcript.zLocation)} um</dd>
          </div>
        )}
        {transcript.overlapsNucleus === undefined ? null : (
          <div>
            <dt>Nucleus</dt>
            <dd>{transcript.overlapsNucleus ? 'Overlap' : 'Outside'}</dd>
          </div>
        )}
        {transcript.nucleusDistance === undefined ? null : (
          <div>
            <dt>Distance</dt>
            <dd>{formatCoordinateValue(transcript.nucleusDistance)} um</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function transcriptCellDisplayLabel(transcript: TranscriptPointDatum): string | null {
  if (transcript.cellId !== null) {
    return transcript.cellId
  }

  return transcript.cellAssignment === 'unassigned' ? 'Unassigned' : null
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

function magicLensElementShortLabel(summary: ViewerMagicLensSummary): string {
  return summary.kind === 'expression' ? 'bins' : 'cells'
}

function magicLensPrimaryMetricShortLabel(summary: ViewerMagicLensSummary): string {
  return summary.kind === 'expression' ? 'UMI' : 'tx'
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

function formatMouseCoordinate(
  coordinate: MouseCoordinate,
  unit: ViewerCoordinateUnit,
  micrometersPerPixel: number,
): string {
  if (unit === 'px') {
    const pixelSize = safeMicrometersPerPixel(micrometersPerPixel)

    return `X ${formatCoordinateValue(coordinate.xMicrometers / pixelSize)} px | Y ${formatCoordinateValue(coordinate.yMicrometers / pixelSize)} px`
  }

  return `X ${formatCoordinateValue(coordinate.xMicrometers)} μm | Y ${formatCoordinateValue(coordinate.yMicrometers)} μm`
}

function formatGridCellBinSize(cell: GridCellDatum): string {
  return cell.binSizeMicrometers === undefined
    ? 'Unknown'
    : `${formatCoordinateValue(cell.binSizeMicrometers)} μm`
}

function formatGridCellImageCoordinate(cell: GridCellDatum): string {
  if (cell.fullresRow === undefined || cell.fullresCol === undefined) {
    return 'Unknown'
  }

  return `${formatCoordinateValue(cell.fullresRow)}, ${formatCoordinateValue(
    cell.fullresCol,
  )} px`
}

function formatGridCellTissue(cell: GridCellDatum): string {
  if (cell.inTissue === undefined) {
    return 'Unknown'
  }

  return cell.inTissue ? 'In tissue' : 'Out of tissue'
}

function formatBoundaryPolygonArea(polygon: readonly Position[]): string {
  return `${formatCoordinateValue(boundaryPolygonArea(polygon))} um^2`
}

function boundaryPolygonArea(polygon: readonly Position[]): number {
  if (polygon.length < 3) {
    return 0
  }

  let area = 0

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentX = current[0] ?? 0
    const currentY = current[1] ?? 0
    const nextX = next[0] ?? 0
    const nextY = next[1] ?? 0

    area += currentX * nextY - nextX * currentY
  }

  return Math.abs(area) / 2
}

function formatExpressionGeneList(genes: readonly string[]): string {
  const shownGenes = genes.slice(0, 3)
  const omittedCount = genes.length - shownGenes.length
  const suffix = omittedCount <= 0 ? '' : ` +${omittedCount.toLocaleString()}`

  return `${shownGenes.join(', ')}${suffix}`
}

function countGridCellsInBbox(gridCells: readonly GridCellDatum[], bbox: BBox): number {
  let count = 0

  for (const cell of gridCells) {
    if (gridCellIntersectsBbox(cell, bbox)) {
      count += 1
    }
  }

  return count
}

function gridCellIntersectsBbox(cell: GridCellDatum, bbox: BBox): boolean {
  if (cell.polygon.length === 0) {
    return false
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x = 0, deckY = 0] of cell.polygon) {
    const rawY = -deckY
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  return maxX >= bbox.minX && minX <= bbox.maxX && maxY >= bbox.minY && minY <= bbox.maxY
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
  loadingTaskIds: ReadonlySet<string>,
): { readonly kind: 'info' | 'error'; readonly text: string } | null {
  if (status === 'loading' && !loadingTaskIds.has(DATASET_LOADING_TASK_ID)) {
    return { kind: 'info', text: 'Loading overview cells…' }
  }

  if (status === 'error') {
    return {
      kind: 'error',
      text: messages.errorMessage ?? 'Dataset load failed.',
    }
  }

  if (imageStatus === 'loading' && !loadingTaskIds.has(MORPHOLOGY_LOADING_TASK_ID)) {
    return { kind: 'info', text: 'Reading OME-TIFF image…' }
  }

  if (imageStatus === 'error') {
    return {
      kind: 'error',
      text: messages.imageErrorMessage ?? 'OME-TIFF image load failed.',
    }
  }

  if (boundaryStatus === 'loading' && !loadingTaskIds.has(BOUNDARY_LOADING_TASK_ID)) {
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

function equivalentBoundaryStyleViewport(
  left: BoundaryStyleViewport | null,
  right: BoundaryStyleViewport,
): boolean {
  return (
    left !== null &&
    nearlyEqual(left.zoom, right.zoom, 0.001) &&
    nearlyEqual(left.bbox.minX, right.bbox.minX, 0.5) &&
    nearlyEqual(left.bbox.maxX, right.bbox.maxX, 0.5) &&
    nearlyEqual(left.bbox.minY, right.bbox.minY, 0.5) &&
    nearlyEqual(left.bbox.maxY, right.bbox.maxY, 0.5)
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

function isGridCellDatum(value: unknown): value is GridCellDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<GridCellDatum>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.gridId === 'string' &&
    typeof candidate.row === 'number' &&
    typeof candidate.col === 'number' &&
    Array.isArray(candidate.polygon)
  )
}

function isTranscriptPointDatum(value: unknown): value is TranscriptPointDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<TranscriptPointDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.featureName === 'string' &&
    typeof candidate.qv === 'number'
  )
}

function isTranscriptAggregateDatum(value: unknown): value is TranscriptAggregateDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<TranscriptAggregateDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.count === 'number' &&
    typeof candidate.radiusMicrometers === 'number'
  )
}

function cellForDeckCoordinate(
  coordinate: readonly number[] | undefined,
  boundaries: readonly CellBoundaryDatum[],
  cells: readonly OverviewCellDatum[],
  cellById: ReadonlyMap<string, OverviewCellDatum>,
): OverviewCellDatum | null {
  const x = coordinate?.[0]
  const y = coordinate?.[1]

  if (x === undefined || y === undefined) {
    return null
  }

  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index]

    if (boundary === undefined || !polygonContainsDeckPoint(boundary.polygon, x, y)) {
      continue
    }

    return cellById.get(boundary.id) ?? null
  }

  for (const cell of cells) {
    const [cellX = 0, cellY = 0] = cell.position
    const radius = Math.max(0, cell.radiusMicrometers ?? cell.radiusPixels)
    const dx = x - cellX
    const dy = y - cellY

    if (dx * dx + dy * dy <= radius * radius) {
      return cell
    }
  }

  return null
}

function polygonContainsDeckPoint(
  polygon: readonly Position[],
  x: number,
  y: number,
): boolean {
  if (polygon.length < 3) {
    return false
  }

  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]

    if (current === undefined || previous === undefined) {
      continue
    }

    const currentX = current[0] ?? 0
    const currentY = current[1] ?? 0
    const previousX = previous[0] ?? 0
    const previousY = previous[1] ?? 0
    const crossesY = currentY > y !== previousY > y

    if (
      crossesY &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    ) {
      inside = !inside
    }
  }

  return inside
}
