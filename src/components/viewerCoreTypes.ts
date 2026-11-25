import type { LegendCategoryVisibilityChange } from './ViewerLegend'
import type { LinkedViewChannel } from './linkedView'
import type { BBox, DataPoint } from '../data/coords'
import type { RoiSelection } from '../data/roiSelection'
import type { ViewerLegendSection } from './viewerLegendTypes'
import type { ViewerSelectionHighlight } from './viewerSelectionModel'
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
  GeometricAnnotationDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import type { GridCellColumns } from '../rendering/gridCellColumns'
import type { LoadingTaskSummary } from './AppStatusPanels'
import type { ScreenshotRunner } from '../features/screenshot/screenshotRunner'
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
  // False leaves the view out of the Tab order, as when a window covers it.
  readonly keyboardFocusable?: boolean
  readonly overviewCellSourceLabel?: string
  // Grid bins (Visium HD), as columns.
  readonly gridCells?: GridCellColumns
  readonly fitGridCells?: GridCellColumns
  readonly fitImageExtent?: BBox | null
  readonly transcriptAggregateBins?: readonly TranscriptAggregateDatum[]
  readonly transcriptPoints?: readonly TranscriptPointDatum[]
  readonly geometricAnnotations?: readonly GeometricAnnotationDatum[]
  readonly imageLoader?: ImagePyramidLoader | null
  readonly imageChannels?: readonly MorphologyCanvasChannel[]
  readonly flatImage?: FlatMorphologyCanvasImage | null
  readonly imageOpacity?: number
  // False hides cells, boundaries and bins, and stops them being picked.
  readonly cellLayersVisible?: boolean
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  // Multiplier on cell point sizes, from the Cells section.
  readonly cellPointScale?: number
  readonly pointSizeFullViewScale?: number
  // Draw points at their physical radius at every zoom (Visium spots).
  readonly trueSizePoints?: boolean
  readonly cellPointPickable?: boolean
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
  readonly observationColorMode?: ObservationColorMode
  readonly annotationStyleColors?: readonly AnnotationColorStyle[]
  readonly cellMetadataTrack?: CellMetadataColorStyle | null
  readonly loadingTasks?: readonly LoadingTaskSummary[]
  // Cancel in the loading list (15.3-D), with the task's id. The list sits
  // outside deck.gl, so cancelling does not redraw layers.
  readonly onCancelLoadingTask?: (id: string) => void
  // The canvas legend, bottom left above the loading indicator.
  readonly legendSections?: readonly ViewerLegendSection[]
  // Settings › Show legend; off hides the legend but not the loading list.
  readonly legend?: boolean
  // The selected cell, spot or bin, marked over the canvas. Esc on the canvas
  // calls onClearSelection.
  readonly selectionHighlight?: ViewerSelectionHighlight | null
  readonly onClearSelection?: () => void
  // The zoom number is for debugging (?debug=1).
  readonly showZoomLevel?: boolean
  readonly onLegendCategoryVisibilityChange?: LegendCategoryVisibilityChange
  // The legend's "+N more in …", with the legend section's id.
  readonly onLegendShowMore?: (sectionId: string) => void
  readonly coordinateUnit?: ViewerCoordinateUnit
  readonly measurementEnabled?: boolean
  readonly measurementUnit?: ViewerCoordinateUnit
  readonly measurementResetKey?: number
  readonly micrometersPerPixel?: number
  // Label for data distances; "units" when the dataset's scale is unknown.
  readonly physicalUnitLabel?: string
  readonly status?: ViewerLoadStatus
  readonly imageStatus?: ViewerLoadStatus
  readonly boundaryStatus?: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly roiMode?: RoiDrawMode
  readonly roiBbox?: BBox | null
  readonly roiSelection?: RoiSelection | null
  // Saved selections to outline (plan 15.4-A). The active one
  // gives roiSelection its colour; the rest are drawn dashed.
  readonly selectionOutlines?: readonly ViewerSelectionOutline[]
  readonly magicLensActive?: boolean
  readonly magicLensRadiusMicrometers?: number
  readonly magicLensStatus?: ViewerMagicLensStatus
  readonly magicLensSummary?: ViewerMagicLensSummary | null
  readonly initialViewStateOverride?: InitialViewStateOverride
  readonly viewResetKey?: string | number
  readonly focusRequest?: ViewerFocusRequest | null
  // The view shared with the panels of registered sections shown beside this
  // one: each change is published to it, and the panels' changes followed.
  readonly linkedView?: LinkedViewChannel | null
  // The zoom −, + and Fit buttons (plan 15.2-E).
  readonly navigationControls?: boolean
  // The minimap at the bottom right (15.4-D).
  readonly minimap?: boolean
  // Rulers along the top and left edges, in the scale bar's unit (15.4-E).
  readonly axes?: boolean
  // The scale bar at the bottom right.
  readonly scaleBar?: boolean
  // Fits the data to the view whenever it changes (the F key).
  readonly fitRequestKey?: number
  // Takes screenshots of the view (plan 27): the viewer connects its
  // snapshot to it. One runner for the life of the app, so it never changes.
  readonly screenshot?: ScreenshotRunner | null
  readonly overviewRenderCellLimit?: number | null
  // When overviewRenderCellLimit is null and every cell draws, the cells
  // drawn while the view moves, so pans and zooms do not draw them all on
  // every frame.
  readonly movingOverviewRenderCellLimit?: number
  readonly clipOverviewCellsToViewport?: boolean
  readonly maxConcurrentTileRequests?: number
  readonly tileCacheMaxTiles?: number
  readonly onImageTileError?: (error: Error) => void
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
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

// Centres the view on a deck.gl point, keeping the zoom, or shows a region
// in data µm (zoomToBbox, for the cards' Go To buttons).
export type ViewerFocusRequest =
  | { readonly key: number; readonly target: readonly [number, number, number] }
  | { readonly key: number; readonly bbox: BBox }

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
  readonly annotationLabels?: readonly string[]
  readonly screen: ScreenPoint
}

export interface ViewerCellBoundaryHoverDetail {
  readonly boundary: CellBoundaryDatum
  // Set when the outline is a nucleus.
  readonly nucleus?: ViewerNucleusOrdinal
  readonly cell?: OverviewCellDatum
  readonly annotationLabels?: readonly string[]
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
  readonly screen: ScreenPoint
}

// A nucleus's place among the nuclei drawn for its cell, when it has one.
export interface ViewerNucleusOrdinal {
  readonly ordinal?: number
  readonly count?: number
}

export interface ViewerOverviewCellHoverDetail {
  readonly cell: OverviewCellDatum
  readonly annotationLabels?: readonly string[]
  readonly screen: ScreenPoint
}

export type RoiDrawMode = 'idle' | 'box' | 'lasso'

export interface ViewerSelectionOutline {
  readonly id: string
  readonly color: string
  readonly active: boolean
  readonly selection: RoiSelection
}
