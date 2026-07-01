import type { BBox, DataPoint } from '../data/coords'
import type { RoiSelection } from '../data/roiSelection'
import type {
  AnnotationColorStyle,
  CellMetadataColorStyle,
  ObservationColorMode,
} from '../rendering/cellStyling'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
  OverviewViewState,
  TranscriptAggregateDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { LoadingTaskSummary } from './AppStatusPanels'
import type {
  FlatMorphologyCanvasImage,
  MorphologyCanvasChannel,
} from './MorphologyCanvas'
import type { ScreenPoint, ViewerDistanceUnit } from './viewerMeasurements'

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ViewerCoordinateUnit = ViewerDistanceUnit

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly fitCells?: readonly OverviewCellDatum[]
  readonly expressionElements?: readonly OverviewCellDatum[]
  readonly geneExpressionActive?: boolean
  readonly geneExpressionOverlayEnabled?: boolean
  readonly boundaries?: readonly CellBoundaryDatum[]
  readonly nucleusBoundaries?: readonly CellBoundaryDatum[]
  readonly cellBoundaryHoverEnabled?: boolean
  readonly hoverTooltipsEnabled?: boolean
  readonly overviewCellSourceLabel?: string
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
  readonly pointSizeFullViewScale?: number
  readonly cellPointPickable?: boolean
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
  readonly overviewRenderCellLimit?: number | null
  readonly clipOverviewCellsToViewport?: boolean
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
  readonly cell?: OverviewCellDatum
  readonly annotationLabels?: readonly string[]
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
  readonly screen: ScreenPoint
}

export interface ViewerOverviewCellHoverDetail {
  readonly cell: OverviewCellDatum
  readonly annotationLabels?: readonly string[]
  readonly screen: ScreenPoint
}

export type RoiDrawMode = 'idle' | 'box' | 'lasso'
