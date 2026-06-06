import type { CSSProperties, FormEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ViewerCore,
  type ViewerCoordinateUnit,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import { scaffoldDeckLayerCount } from './components/viewerCoreModel'
import {
  ALL_ANNOTATION_GROUP_ID,
  loadDatasetAnnotationGroups as defaultLoadDatasetAnnotationGroups,
  loadDatasetAnnotations as defaultLoadDatasetAnnotations,
} from './data/datasetAnnotations'
import { loadDatasetBoundaryElements as defaultLoadBoundaryElements } from './data/datasetBoundaries'
import { loadDatasetAnalysisEmbeddings as defaultLoadAnalysisEmbeddings } from './data/analysisEmbeddings'
import { loadDatasetGeneExpression as defaultLoadDatasetGeneExpression } from './data/geneExpression'
import { loadDatasetOverview as defaultLoadDatasetOverview } from './data/datasetOverview'
import {
  warmDatasetForRoi as defaultWarmDatasetForRoi,
  type WarmDatasetForRoiOptions,
  type WarmDatasetForRoiResult,
} from './data/datasetWarmup'
import { loadGenePanel as defaultLoadGenePanel } from './data/genePanel'
import {
  geneExpressionRequestKey,
  geneExpressionWaitingKey,
  planGeneExpressionLod,
} from './data/geneExpressionLod'
import { loadMorphologyImage as defaultLoadMorphologyImage } from './data/morphologyImage'
import {
  ROI_CELL_EXPORT_LIMIT,
  loadDatasetRoiCells as defaultLoadDatasetRoiCells,
} from './data/roiCells'
import { asCellId } from './data/cellid'
import { loadDatasetRoiGeneStats as defaultLoadDatasetRoiGeneStats } from './data/roiGeneStats'
import { loadDatasetRoiTranscripts as defaultLoadDatasetRoiTranscripts } from './data/roiTranscripts'
import {
  MAX_TRANSCRIPT_EXACT_RENDER_LIMIT,
  MIN_TRANSCRIPT_EXACT_RENDER_LIMIT,
  TRANSCRIPT_GROUP_LIMIT,
  loadDatasetTranscriptCapabilities as defaultLoadDatasetTranscriptCapabilities,
  loadDatasetTranscriptAggregates as defaultLoadDatasetTranscriptAggregates,
  loadDatasetTranscriptViewport as defaultLoadDatasetTranscriptViewport,
  normalizeTranscriptExactPointLimit,
  transcriptAggregateRequestKey,
  planTranscriptLod,
  transcriptViewportRequestKey,
  type TranscriptCapabilities,
  type TranscriptAggregateBin,
  type TranscriptAggregateResult,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
  type TranscriptGroupSummary,
  type TranscriptPoint,
} from './data/transcriptOverlay'
import { micrometers } from './data/coords'
import {
  normalizeRoiSelection,
  type RoiSelection,
  type RoiSelectionInput,
} from './data/roiSelection'
import { parseCustomAnnotations } from './data/customAnnotations'
import {
  runDatasetDiagnostics as defaultRunDatasetDiagnostics,
  summarizeDatasetDiagnostics,
  type DatasetDiagnosticsReport,
} from './data/datasetDiagnostics'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import {
  formatShareableState,
  parseShareableState,
  shareableViewStateKey,
  viewStateToShareable,
  type ShareableState,
  type ShareableViewState,
} from './data/shareableState'
import {
  appendTelemetryEvent,
  telemetryEvent,
  type TelemetryEvent,
} from './data/telemetry'
import {
  MAX_BOUNDARY_VIEWPORT_CELL_LIMIT,
  boundaryViewportKey,
  normalizeBoundaryCellLimit,
  shouldLoadBoundaryPolygons,
} from './rendering/boundaryViewport'
import {
  boundaryElementsToLayerData,
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  geneExpressionCellsToLayerData,
  geneExpressionScoreDomainMax,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  isTranscriptDensityColorScale,
  overviewCellsToLayerData,
  styleGeneExpressionCellsByScale,
  transcriptAggregateBinsToLayerData,
  transcriptPointsToLayerData,
  bundledDeckVersion,
} from './rendering/deckLayers'
import { styleOverviewCellsByObservation } from './rendering/cellStyling'
import {
  annotationPaletteColor,
  normalizeAnnotationColor,
} from './rendering/annotationPalette'
import { opacityToPercent, percentToOpacity } from './rendering/layerOpacity'
import { useViewerStore } from './store/viewerStore'
import type { BBox, DataPoint } from './data/coords'
import type { ChannelAutoContrast, ChannelHistogram } from './data/morphologyContrast'
import type {
  DatasetCell,
  DatasetTranscript,
  GeneExpressionBatch,
} from './datasets/xeniumDataset'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage, MorphologyImageChannel } from './data/morphologyImage'
import type { MorphologyCanvasChannel } from './components/MorphologyCanvas'
import type { AnnotationColorStyle, ObservationColorMode } from './rendering/cellStyling'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
  AnalysisEmbeddingPoint,
} from './data/analysisEmbeddings'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from './data/datasetAnnotations'
import type { Annotation, ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type {
  GeneExpressionDetailMode,
  GeneExpressionLoadMode,
} from './data/geneExpressionLod'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
  TranscriptDensityColorScale,
} from './rendering/deckLayers'
import type { RoiGeneStats } from './data/roiGeneStats'
import type { OverviewCellDatum, TranscriptPointDatum } from './rendering/deckLayers'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerViewportDetail,
} from './components/ViewerCore'

const EMPTY_HISTOGRAM_BINS = Array.from({ length: 32 }, () => 0)
const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS = 12_000
const TRANSCRIPT_NATIVE_DENSITY_MAX_BINS = 700
const TRANSCRIPT_NATIVE_BIN_MAX_BINS = 1_500
const EMPTY_GENE_LIST: readonly string[] = []
const EMPTY_TRANSCRIPT_POINTS: readonly TranscriptPoint[] = []
const EMPTY_TRANSCRIPT_AGGREGATE_BINS: readonly TranscriptAggregateBin[] = []
const GENE_SET_SYMBOL_SPLIT_PATTERN = /[\s,;]+/
const DEBUG_LOG_LIMIT = 32
const MAGIC_LENS_CELL_LIMIT = 25_000
const MAGIC_LENS_TOP_GENE_LIMIT = 8
const MAGIC_LENS_GENE_STATS_LIMIT = 10_000
const CELL_GENE_EXPRESSION_LIMIT = 100_000
const CELL_DETAIL_BOUNDARY_RADIUS_MICROMETERS = 25
const ROI_GENE_STATS_PREVIEW_CELL_LIMIT = 32
const ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT = 5_000
const ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS = 120
const CONTROL_HUD_TABS = [
  { id: 'dataset', label: 'Dataset' },
  { id: 'layers', label: 'Layers' },
  { id: 'genes', label: 'Genes' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'magic-lens', label: 'Magic Lens' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'roi', label: 'ROI' },
  { id: 'cell', label: 'Cell' },
] as const

type ControlHudTab = (typeof CONTROL_HUD_TABS)[number]['id']

export type DatasetOverviewLoader = (
  baseUrl: string,
  options?: {
    readonly limit?: number | null
    readonly includeCellIds?: boolean
    readonly signal?: AbortSignal
  },
) => Promise<readonly CellOverviewPoint[]>

export type MorphologyImageLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<MorphologyImage>
export type BoundaryElementsLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: { readonly signal?: AbortSignal },
) => Promise<ElementBatch>
export type GenePanelLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly string[]>
export type AnnotationLoader = (
  baseUrl: string,
  options?: LoadDatasetAnnotationsOptions,
) => Promise<readonly Annotation[]>
export type AnnotationGroupLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly AnnotationGroupOption[]>
export type AnalysisEmbeddingsLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly AnalysisEmbedding[]>
export type RoiCellsLoader = (
  baseUrl: string,
  selection: RoiSelectionInput,
  options?: { readonly signal?: AbortSignal; readonly limit?: number },
) => Promise<readonly DatasetCell[]>
export type RoiGeneStatsLoader = (
  baseUrl: string,
  cells: readonly DatasetCell[],
  options?: {
    readonly signal?: AbortSignal
    readonly cellLimit?: number
    readonly geneLimit?: number
    readonly sampleStrategy?: 'stratified' | 'head'
  },
) => Promise<RoiGeneStats>
export type RoiTranscriptsLoader = (
  baseUrl: string,
  selection: RoiSelectionInput,
  options?: {
    readonly signal?: AbortSignal
    readonly limit?: number
    readonly minQv?: number
  },
) => Promise<readonly DatasetTranscript[]>
export type TranscriptCapabilitiesLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<TranscriptCapabilities>
export type TranscriptAggregateLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: {
    readonly signal?: AbortSignal
    readonly mode?: 'density' | 'bins'
    readonly featureNames?: readonly string[]
    readonly maxBins?: number
  },
) => Promise<TranscriptAggregateResult>
export type TranscriptViewportLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: {
    readonly signal?: AbortSignal
    readonly pointLimit?: number
    readonly groupLimit?: number
    readonly minQv?: number
    readonly geneOnly?: boolean
    readonly featureNames?: readonly string[]
  },
) => Promise<{
  readonly points: readonly TranscriptPoint[]
  readonly groups: readonly TranscriptGroupSummary[]
  readonly hitPointLimit: boolean
}>
export type GeneExpressionLoader = (
  baseUrl: string,
  bbox: BBox,
  genes: readonly string[],
  options?: {
    readonly limit?: number
    readonly sampleStride?: number
    readonly signal?: AbortSignal
  },
) => Promise<GeneExpressionBatch>
export type AutoChannelContrastLoader = (
  channel: MorphologyImageChannel,
  options?: { readonly signal?: AbortSignal },
) => Promise<ChannelAutoContrast>
export type DatasetWarmupLoader = (
  baseUrl: string,
  options?: Pick<WarmDatasetForRoiOptions, 'signal' | 'onCellFeatureMatrixCapability'>,
) => Promise<WarmDatasetForRoiResult | void>
export type DatasetDiagnosticsRunner = typeof defaultRunDatasetDiagnostics

type DatasetLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type DatasetWarmupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error'; readonly url: string }

type CellFeatureMatrixCapabilityState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly hasCellMajorCsc: boolean
    }

type DatasetDiagnosticsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly report: DatasetDiagnosticsReport
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type MorphologyLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type BoundaryLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type GenePanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly genes: readonly string[] }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type AnnotationState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly annotations: readonly Annotation[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type AnnotationGroupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly groups: readonly AnnotationGroupOption[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type AnalysisEmbeddingState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly embeddings: readonly AnalysisEmbedding[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type GeneExpressionState =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting'; readonly message: string }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly genes: readonly string[]
      readonly mode: GeneExpressionLoadMode
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly genes: readonly string[]
      readonly cellCount: number
      readonly mode: GeneExpressionLoadMode
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type RoiState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly bbox: BBox
      readonly selection: RoiSelection
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly bbox: BBox
      readonly selection: RoiSelection
      readonly cells: readonly DatasetCell[]
      readonly hitCellLimit: boolean
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly bbox: BBox
      readonly selection: RoiSelection
      readonly error: StructuredLoadError
    }

type RoiGeneStatsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly stats: RoiGeneStats
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type RoiGeneViewportWarmupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly key: string }
  | { readonly status: 'ready'; readonly key: string }
  | { readonly status: 'error'; readonly key: string }

type RoiTranscriptExportState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type TranscriptCapabilityState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly capabilities: TranscriptCapabilities
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type TranscriptLayerState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'waiting'
      readonly message: string
      readonly visibleTranscriptEstimate: number
    }
  | {
      readonly status: 'aggregate'
      readonly message: string
      readonly source: 'cell-summary' | 'native-zarr'
      readonly mode: 'density' | 'bins'
      readonly bins: readonly TranscriptAggregateBin[]
      readonly visibleTranscriptEstimate: number
      readonly durationMs?: number
    }
  | {
      readonly status: 'unavailable'
      readonly message: string
      readonly visibleTranscriptEstimate: number
    }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly visibleTranscriptEstimate: number
      readonly previousLayer?: TranscriptRetainedLayerState
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly points: readonly TranscriptPoint[]
      readonly groups: readonly TranscriptGroupSummary[]
      readonly visibleTranscriptEstimate: number
      readonly hitPointLimit: boolean
      readonly durationMs: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type TranscriptRetainedLayerState =
  | {
      readonly kind: 'exact'
      readonly points: readonly TranscriptPoint[]
    }
  | {
      readonly kind: 'aggregate'
      readonly bins: readonly TranscriptAggregateBin[]
    }

type MagicLensScope = 'cursor' | 'viewport' | 'roi'

type MagicLensState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly scope: MagicLensScope }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly scope: MagicLensScope
      readonly summary: MagicLensSummary
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly scope: MagicLensScope
      readonly error: StructuredLoadError
    }

type CellDetailState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellId: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly cellId: string
      readonly expression: CellGeneExpressionSummary
      readonly shape: CellShapeMetrics
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly cellId: string
      readonly error: StructuredLoadError
    }

interface CellGeneExpressionSummary {
  readonly genes: readonly CellGeneExpressionGene[]
  readonly totalCount: number
  readonly hitGeneLimit: boolean
}

interface CellGeneExpressionGene {
  readonly gene: string
  readonly count: number
  readonly percentTotal: number
}

interface CellShapeMetrics {
  readonly areaMicrometersSquared?: number
  readonly equivalentDiameterMicrometers?: number
  readonly boundaryAreaMicrometersSquared?: number
  readonly boundaryEquivalentDiameterMicrometers?: number
  readonly perimeterMicrometers?: number
  readonly majorAxisMicrometers?: number
  readonly minorAxisMicrometers?: number
  readonly eccentricity?: number
  readonly circularity?: number
  readonly boundaryPointCount?: number
}

type LoadErrorCode =
  | 'network'
  | 'http'
  | 'range-not-supported'
  | 'unsupported'
  | 'parquet-decode'
  | 'manifest'
  | 'decode'
  | 'unknown'

type LoadErrorSource =
  | 'Dataset overview'
  | 'Morphology image'
  | 'Image tiles'
  | 'Cell boundaries'
  | 'Gene panel'
  | 'Annotations'
  | 'Embeddings'
  | 'ROI cells'
  | 'ROI genes'
  | 'ROI transcripts'
  | 'Transcripts'
  | 'Gene expression'
  | 'Magic lens'
  | 'Cell details'
  | 'Dataset diagnostics'

interface StructuredLoadError {
  readonly source: LoadErrorSource
  readonly code: LoadErrorCode
  readonly title: string
  readonly message: string
  readonly action: string
  readonly detail?: string
}

interface DebugLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
  readonly coalesceKey?: string
}

interface LoadingTask {
  readonly id: string
  readonly tabId: ControlHudTab
  readonly label: string
  readonly detail?: string
}

interface MorphologyChannelSetting {
  readonly id: string
  readonly enabled: boolean
  readonly color: readonly [number, number, number]
  readonly contrastMin: number
  readonly contrastMax: number
  readonly histogram?: ChannelHistogram
}

interface SavedGeneSet {
  readonly id: string
  readonly name: string
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
}

interface GeneExpressionScaleDomain {
  readonly key: string
  readonly max: number
}

interface RoiSummary {
  readonly cellCount: number
  readonly meanTranscriptCount: number
  readonly meanCellArea: number | undefined
}

interface MagicLensSummary {
  readonly transcriptCount: number
  readonly cellCount: number
  readonly geneCount: number
  readonly selectedGeneTranscriptCount: number
  readonly topGenes: readonly MagicLensGeneSummary[]
  readonly hitLimit: boolean
}

interface MagicLensGeneSummary {
  readonly gene: string
  readonly count: number
  readonly percentTotal: number
  readonly selected: boolean
}

interface MagicLensCircleFilter {
  readonly center: DataPoint
  readonly radiusMicrometers: number
}

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
  readonly loadBoundaryElements?: BoundaryElementsLoader
  readonly loadGenePanel?: GenePanelLoader
  readonly loadAnnotations?: AnnotationLoader
  readonly loadAnnotationGroups?: AnnotationGroupLoader
  readonly loadAnalysisEmbeddings?: AnalysisEmbeddingsLoader
  readonly loadRoiCells?: RoiCellsLoader
  readonly loadRoiGeneStats?: RoiGeneStatsLoader
  readonly loadRoiTranscripts?: RoiTranscriptsLoader
  readonly loadTranscriptCapabilities?: TranscriptCapabilitiesLoader
  readonly loadTranscriptAggregates?: TranscriptAggregateLoader
  readonly loadTranscriptViewport?: TranscriptViewportLoader
  readonly loadGeneExpression?: GeneExpressionLoader
  readonly warmDatasetForRoi?: DatasetWarmupLoader
  readonly runDatasetDiagnostics?: DatasetDiagnosticsRunner
  readonly computeAutoChannelContrast?: AutoChannelContrastLoader
}

export function App({
  loadDatasetOverview = defaultLoadDatasetOverview,
  loadMorphologyImage = defaultLoadMorphologyImage,
  loadBoundaryElements = defaultLoadBoundaryElements,
  loadGenePanel = defaultLoadGenePanel,
  loadAnnotations = defaultLoadDatasetAnnotations,
  loadAnnotationGroups = defaultLoadDatasetAnnotationGroups,
  loadAnalysisEmbeddings = defaultLoadAnalysisEmbeddings,
  loadRoiCells = defaultLoadDatasetRoiCells,
  loadRoiGeneStats = defaultLoadDatasetRoiGeneStats,
  loadRoiTranscripts = defaultLoadDatasetRoiTranscripts,
  loadTranscriptCapabilities = defaultLoadDatasetTranscriptCapabilities,
  loadTranscriptAggregates = defaultLoadDatasetTranscriptAggregates,
  loadTranscriptViewport = defaultLoadDatasetTranscriptViewport,
  loadGeneExpression = defaultLoadDatasetGeneExpression,
  warmDatasetForRoi = defaultWarmDatasetForRoi,
  runDatasetDiagnostics = defaultRunDatasetDiagnostics,
  computeAutoChannelContrast = defaultComputeAutoChannelContrast,
}: AppProps) {
  const datasetInputId = useId()
  const morphologyInputId = useId()
  const boundaryLimitInputId = useId()
  const imageOpacityInputId = useId()
  const cellFillOpacityInputId = useId()
  const cellBoundaryOpacityInputId = useId()
  const coordinateUnitInputId = useId()
  const geneSearchInputId = useId()
  const geneSetSymbolsInputId = useId()
  const geneSetNameInputId = useId()
  const geneSetScoreInputId = useId()
  const geneScaleInputId = useId()
  const geneExpressionDetailInputId = useId()
  const annotationImportInputId = useId()
  const annotationGroupInputId = useId()
  const embeddingViewInputId = useId()
  const roiNameInputId = useId()
  const observationModeInputId = useId()
  const transcriptDetailInputId = useId()
  const transcriptDensityScaleInputId = useId()
  const transcriptPointBudgetInputId = useId()
  const transcriptMinQvInputId = useId()
  const transcriptFeatureFilterInputId = useId()
  const transcriptOpacityInputId = useId()
  const transcriptPointSizeInputId = useId()
  const magicLensScopeInputId = useId()
  const magicLensRadiusInputId = useId()
  const magicLensMinQvInputId = useId()
  const [initialShareableState] = useState<ShareableState>(() =>
    readShareableStateFromLocation(),
  )
  const [performanceBudget] = useState<PerformanceBudget>(() => detectPerformanceBudget())
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const [loadState, setLoadState] = useState<DatasetLoadState>({ status: 'idle' })
  const [datasetWarmupState, setDatasetWarmupState] = useState<DatasetWarmupState>({
    status: 'idle',
  })
  const [cellFeatureMatrixCapabilityState, setCellFeatureMatrixCapabilityState] =
    useState<CellFeatureMatrixCapabilityState>({
      status: 'idle',
    })
  const [diagnosticsState, setDiagnosticsState] = useState<DatasetDiagnosticsState>({
    status: 'idle',
  })
  const [morphologyState, setMorphologyState] = useState<MorphologyLoadState>({
    status: 'idle',
  })
  const [boundaryState, setBoundaryState] = useState<BoundaryLoadState>({
    status: 'idle',
  })
  const [genePanelState, setGenePanelState] = useState<GenePanelState>({
    status: 'idle',
  })
  const [annotationState, setAnnotationState] = useState<AnnotationState>({
    status: 'idle',
  })
  const [annotationGroupState, setAnnotationGroupState] = useState<AnnotationGroupState>({
    status: 'idle',
  })
  const [analysisEmbeddingState, setAnalysisEmbeddingState] =
    useState<AnalysisEmbeddingState>({
      status: 'idle',
    })
  const [annotationColors, setAnnotationColors] = useState<
    Readonly<Record<string, string>>
  >({})
  const [selectedAnnotationGroupId, setSelectedAnnotationGroupId] = useState(
    ALL_ANNOTATION_GROUP_ID,
  )
  const [selectedEmbeddingKind, setSelectedEmbeddingKind] =
    useState<AnalysisEmbeddingKind>('umap')
  const [roiState, setRoiState] = useState<RoiState>({ status: 'idle' })
  const [roiGeneStatsState, setRoiGeneStatsState] = useState<RoiGeneStatsState>({
    status: 'idle',
  })
  const [roiGeneViewportWarmupState, setRoiGeneViewportWarmupState] =
    useState<RoiGeneViewportWarmupState>({ status: 'idle' })
  const [roiTranscriptExportState, setRoiTranscriptExportState] =
    useState<RoiTranscriptExportState>({ status: 'idle' })
  const [transcriptCapabilityState, setTranscriptCapabilityState] =
    useState<TranscriptCapabilityState>({ status: 'idle' })
  const [transcriptLayerState, setTranscriptLayerState] = useState<TranscriptLayerState>({
    status: 'idle',
  })
  const [magicLensState, setMagicLensState] = useState<MagicLensState>({
    status: 'idle',
  })
  const [cellDetailState, setCellDetailState] = useState<CellDetailState>({
    status: 'idle',
  })
  const [magicLensScope, setMagicLensScope] = useState<MagicLensScope>('cursor')
  const [magicLensActive, setMagicLensActive] = useState(false)
  const [magicLensRadiusMicrometers, setMagicLensRadiusMicrometers] = useState(80)
  const [magicLensMinQv, setMagicLensMinQv] = useState(20)
  const [showTranscriptOverlay, setShowTranscriptOverlay] = useState(
    initialShareableState.transcriptOverlay ?? false,
  )
  const [transcriptDetailMode, setTranscriptDetailMode] = useState<TranscriptDetailMode>(
    () => parseTranscriptDetailMode(initialShareableState.transcriptDetailMode) ?? 'auto',
  )
  const [transcriptMinQv, setTranscriptMinQv] = useState(
    initialShareableState.transcriptMinQv ?? 20,
  )
  const [transcriptGeneOnly, setTranscriptGeneOnly] = useState(
    initialShareableState.transcriptGeneOnly ?? true,
  )
  const [transcriptFeatureFilterMode, setTranscriptFeatureFilterMode] =
    useState<TranscriptFeatureFilterMode>(
      () =>
        parseTranscriptFeatureFilterMode(
          initialShareableState.transcriptFeatureFilterMode,
        ) ?? 'selected',
    )
  const [transcriptDensityColorScale, setTranscriptDensityColorScale] =
    useState<TranscriptDensityColorScale>(
      () =>
        parseTranscriptDensityColorScale(
          initialShareableState.transcriptDensityColorScale,
        ) ?? DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
    )
  const [transcriptExactPointLimit, setTranscriptExactPointLimit] = useState(() =>
    normalizeTranscriptExactPointLimit(initialShareableState.transcriptExactPointLimit),
  )
  const [transcriptOpacity, setTranscriptOpacity] = useState(
    initialShareableState.transcriptOpacity ?? 0.85,
  )
  const [transcriptPointSize, setTranscriptPointSize] = useState(
    initialShareableState.transcriptPointSize ?? 2,
  )
  const [hoveredTranscript, setHoveredTranscript] =
    useState<ViewerTranscriptHoverDetail | null>(null)
  const [debugLog, setDebugLog] = useState<readonly DebugLogEntry[]>([])
  const [telemetryEvents, setTelemetryEvents] = useState<readonly TelemetryEvent[]>([])
  const [isControlHudCollapsed, setIsControlHudCollapsed] = useState(false)
  const [activeControlHudTab, setActiveControlHudTab] = useState<ControlHudTab>(
    () => parseControlHudTab(initialShareableState.activeTab) ?? 'dataset',
  )
  const [geneExpressionState, setGeneExpressionState] = useState<GeneExpressionState>({
    status: 'idle',
  })
  const [overviewCells, setOverviewCells] = useState<readonly OverviewCellDatum[]>([])
  const [geneExpressionBatch, setGeneExpressionBatch] =
    useState<GeneExpressionBatch | null>(null)
  const [geneExpressionScaleDomain, setGeneExpressionScaleDomain] =
    useState<GeneExpressionScaleDomain>({ key: '', max: 0 })
  const [morphologyImage, setMorphologyImage] = useState<MorphologyImage | null>(null)
  const [morphologyChannelSettings, setMorphologyChannelSettings] = useState<
    readonly MorphologyChannelSetting[]
  >([])
  const [autoContrastChannelIds, setAutoContrastChannelIds] = useState<readonly string[]>(
    [],
  )
  const [boundaryElements, setBoundaryElements] = useState<readonly SpatialElement[]>([])
  const [shouldLoadMorphology, setShouldLoadMorphology] = useState(
    initialShareableState.shouldLoadMorphology ?? false,
  )
  const [boundaryCellLimit, setBoundaryCellLimit] = useState(() =>
    normalizeBoundaryCellLimit(
      initialShareableState.boundaryCellLimit ?? performanceBudget.boundaryCellLimit,
    ),
  )
  const [imageLayerOpacity, setImageLayerOpacity] = useState(1)
  const [cellFillOpacity, setCellFillOpacity] = useState(1)
  const [cellBoundaryOpacity, setCellBoundaryOpacity] = useState(1)
  const [coordinateUnit, setCoordinateUnit] = useState<ViewerCoordinateUnit>(
    () => parseViewerCoordinateUnit(initialShareableState.coordinateUnit) ?? 'um',
  )
  const [geneSearch, setGeneSearch] = useState('')
  const [geneSetSymbols, setGeneSetSymbols] = useState('')
  const [geneSetName, setGeneSetName] = useState('')
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    useState<GeneExpressionColorScale>(
      () =>
        parseGeneExpressionColorScale(initialShareableState.geneExpressionColorScale) ??
        DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
    )
  const [geneExpressionScoreMode, setGeneExpressionScoreMode] =
    useState<GeneExpressionScoreMode>(
      () =>
        parseGeneExpressionScoreMode(initialShareableState.geneExpressionScoreMode) ??
        DEFAULT_GENE_EXPRESSION_SCORE_MODE,
    )
  const [geneExpressionDetailMode, setGeneExpressionDetailMode] =
    useState<GeneExpressionDetailMode>(
      () =>
        parseGeneExpressionDetailMode(initialShareableState.geneExpressionDetailMode) ??
        'auto',
    )
  const [savedGeneSets, setSavedGeneSets] = useState<readonly SavedGeneSet[]>([])
  const [selectedGenes, setSelectedGenes] = useState<readonly string[]>(
    initialShareableState.selectedGenes ?? [],
  )
  const [roiMode, setRoiMode] = useState<RoiDrawMode>('idle')
  const [roiName, setRoiName] = useState('ROI 1')
  const [observationColorMode, setObservationColorMode] = useState<ObservationColorMode>(
    () =>
      parseObservationColorMode(initialShareableState.observationColorMode) ??
      'transcript-count',
  )
  const [shareableViewState, setShareableViewState] = useState<
    ShareableViewState | undefined
  >(initialShareableState.viewState)
  const [selectedCell, setSelectedCell] = useState<OverviewCellDatum | null>(null)
  const [currentViewportDetail, setCurrentViewportDetail] =
    useState<ViewerViewportDetail | null>(null)
  const [, setViewportCellCount] = useState<number | null>(null)
  const loadRequestId = useRef(0)
  const analysisEmbeddingRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const geneExpressionRequestId = useRef(0)
  const roiRequestId = useRef(0)
  const roiTranscriptExportRequestId = useRef(0)
  const transcriptCapabilityRequestId = useRef(0)
  const transcriptRequestId = useRef(0)
  const magicLensRequestId = useRef(0)
  const cellDetailRequestId = useRef(0)
  const magicLensDebounceRef = useRef<number | null>(null)
  const magicLensLastDetailRef = useRef<ViewerMagicLensDetail | null>(null)
  const magicLensLastQueryKeyRef = useRef<string | null>(null)
  const debugLogIdRef = useRef(0)
  const datasetAbortRef = useRef<AbortController | null>(null)
  const datasetWarmupAbortRef = useRef<AbortController | null>(null)
  const diagnosticsAbortRef = useRef<AbortController | null>(null)
  const analysisEmbeddingAbortRef = useRef<AbortController | null>(null)
  const boundaryAbortRef = useRef<AbortController | null>(null)
  const geneExpressionAbortRef = useRef<AbortController | null>(null)
  const roiAbortRef = useRef<AbortController | null>(null)
  const roiTranscriptExportAbortRef = useRef<AbortController | null>(null)
  const transcriptCapabilityAbortRef = useRef<AbortController | null>(null)
  const transcriptAbortRef = useRef<AbortController | null>(null)
  const roiGeneViewportWarmupAbortRef = useRef<AbortController | null>(null)
  const roiGeneViewportWarmupTimeoutRef = useRef<number | null>(null)
  const roiGeneViewportWarmupKeyRef = useRef<string | null>(null)
  const cellFeatureMatrixCapabilityKeyRef = useRef<string | null>(null)
  const magicLensAbortRef = useRef<AbortController | null>(null)
  const cellDetailAbortRef = useRef<AbortController | null>(null)
  const autoContrastChannelIdsRef = useRef<Set<string>>(new Set())
  const geneSetIdRef = useRef(0)
  const roiIdRef = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const transcriptViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const initialShareableStateRef = useRef<ShareableState | null>(initialShareableState)
  const initialSharedRoiSelectionRef = useRef<RoiSelection | null>(
    initialShareableState.roiSelection ?? null,
  )
  const didApplyInitialDatasetUrlRef = useRef(false)
  const isLoading = loadState.status === 'loading'
  const annotationStyleColors = useMemo(
    () =>
      annotationState.status === 'ready'
        ? annotationState.annotations.map((annotation, annotationIndex) => ({
            id: annotation.id,
            cellIds: annotation.cellIds,
            color:
              annotationColors[annotation.id] ?? annotationPaletteColor(annotationIndex),
          }))
        : [],
    [annotationColors, annotationState],
  )
  const activeAnnotationStyleColors =
    observationColorMode === 'annotations'
      ? annotationStyleColors
      : EMPTY_ANNOTATION_STYLE_COLORS
  const viewerObservationColorMode: ObservationColorMode =
    observationColorMode === 'annotations' ? 'annotations' : 'transcript-count'
  const styledOverviewCells = useMemo(() => {
    if (observationColorMode !== 'cell-area') {
      return overviewCells
    }

    return styleOverviewCellsByObservation(overviewCells, 'cell-area')
  }, [observationColorMode, overviewCells])
  const overviewExtent = useMemo(
    () => overviewCellsToBbox(overviewCells),
    [overviewCells],
  )
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const geneExpressionScaleKey = useMemo(
    () =>
      geneExpressionScaleKeyFor(
        geneExpressionScaleDatasetUrl,
        geneExpressionScoreMode,
        selectedGenes,
      ),
    [geneExpressionScaleDatasetUrl, geneExpressionScoreMode, selectedGenes],
  )
  const currentGeneExpressionScaleMax = useMemo(
    () =>
      geneExpressionBatch === null
        ? 0
        : geneExpressionScoreDomainMax(
            geneExpressionBatch.cells,
            geneExpressionBatch.genes,
            geneExpressionScoreMode,
          ),
    [geneExpressionBatch, geneExpressionScoreMode],
  )
  const storedGeneExpressionScaleMax =
    geneExpressionScaleDomain.key === geneExpressionScaleKey
      ? geneExpressionScaleDomain.max
      : 0
  const geneExpressionScaleMax = Math.max(
    storedGeneExpressionScaleMax,
    currentGeneExpressionScaleMax,
  )
  const geneExpressionCells = useMemo(
    () =>
      geneExpressionBatch === null
        ? []
        : geneExpressionCellsToLayerData(
            geneExpressionBatch.cells,
            geneExpressionBatch.genes,
            geneExpressionColorScale,
            geneExpressionScoreMode,
            { scaleMax: geneExpressionScaleMax },
          ),
    [
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionScaleMax,
      geneExpressionScoreMode,
    ],
  )
  const styledGeneExpressionCells = useMemo(
    () =>
      styleGeneExpressionCellsByScale(geneExpressionCells, geneExpressionColorScale, {
        scaleMax: geneExpressionScaleMax,
      }),
    [geneExpressionCells, geneExpressionColorScale, geneExpressionScaleMax],
  )
  const transcriptLayerPoints = useMemo(
    () => transcriptPointsToLayerData(transcriptPointsForRendering(transcriptLayerState)),
    [transcriptLayerState],
  )
  const transcriptLayerAggregateBins = useMemo(
    () =>
      transcriptAggregateBinsToLayerData(
        transcriptAggregateBinsForRendering(transcriptLayerState),
        transcriptDensityColorScale,
      ),
    [transcriptDensityColorScale, transcriptLayerState],
  )
  const visibleTranscriptEstimate = useMemo(
    () =>
      currentViewportDetail === null
        ? 0
        : estimateVisibleTranscriptsFromCells(overviewCells, currentViewportDetail.bbox),
    [currentViewportDetail, overviewCells],
  )
  const morphologyCanvasChannels = useMemo<readonly MorphologyCanvasChannel[]>(
    () =>
      morphologyImage === null
        ? []
        : morphologyImage.channelLoaders.map((channel) => {
            const setting = morphologyChannelSettings.find(
              (candidate) => candidate.id === channel.info.id,
            )
            const contrast = normalizeChannelContrast({
              min: setting?.contrastMin ?? channel.info.contrast.min,
              max: setting?.contrastMax ?? channel.info.contrast.max,
            })

            return {
              id: channel.info.id,
              loader: channel.loader,
              enabled: setting?.enabled ?? false,
              color: setting?.color ?? channel.info.color,
              contrast,
            }
          }),
    [morphologyChannelSettings, morphologyImage],
  )
  const morphologyMicrometersPerPixel = morphologyImage?.loader.units?.micrometersPerPixel
  const boundaryLayerData = useMemo(
    () => boundaryElementsToLayerData(boundaryElements),
    [boundaryElements],
  )
  const geneOptions = useMemo(
    () => (genePanelState.status === 'ready' ? genePanelState.genes : []),
    [genePanelState],
  )
  const filteredGenes = useMemo(
    () => filterGeneOptions(geneOptions, geneSearch, selectedGenes),
    [geneOptions, geneSearch, selectedGenes],
  )
  const genePanelCopy = genePanelStatusCopy(genePanelState)
  const annotationCopy = annotationStatusCopy(annotationState)
  const annotationGroupOptions =
    annotationGroupState.status === 'ready' ? annotationGroupState.groups : []
  const overviewCellById = useMemo(() => {
    const cellById = new Map<string, OverviewCellDatum>()

    for (const cell of overviewCells) {
      cellById.set(cell.id, cell)
    }

    return cellById
  }, [overviewCells])
  const activeEmbedding = useMemo(
    () =>
      analysisEmbeddingState.status === 'ready'
        ? (analysisEmbeddingState.embeddings.find(
            (embedding) => embedding.kind === selectedEmbeddingKind,
          ) ??
          analysisEmbeddingState.embeddings[0] ??
          null)
        : null,
    [analysisEmbeddingState, selectedEmbeddingKind],
  )
  const roiCellIds = useMemo(
    () => (roiState.status === 'ready' ? roiState.cells.map((cell) => cell.id) : []),
    [roiState],
  )
  const embeddingCopy = analysisEmbeddingStatusCopy(
    analysisEmbeddingState,
    activeEmbedding,
    roiCellIds,
    selectedCell,
  )
  const cellDetailCopy = cellDetailStatusCopy(cellDetailState, selectedCell)
  const geneExpressionCopy = geneExpressionStatusCopy(geneExpressionState)
  const roiCopy = roiStatusCopy(roiState, roiMode)
  const roiGeneStatsCopy = roiGeneStatsStatusCopy(roiGeneStatsState)
  const analysisHeaderCopy =
    geneExpressionState.status === 'loading'
      ? geneExpressionModeLabel(geneExpressionState.mode)
      : genePanelCopy
  const annotationHeaderCopy =
    annotationGroupState.status === 'loading' ? 'Loading sets' : annotationCopy
  const roiGeneViewportWarmupRequiredKey =
    loadState.status === 'ready' &&
    currentViewportDetail !== null &&
    currentViewportDetail.visibleCellCount > ROI_GENE_STATS_PREVIEW_CELL_LIMIT
      ? roiGeneViewportWarmupKey(loadState.url, currentViewportDetail)
      : null
  const isRoiGeneViewportWarmupLoading =
    roiGeneViewportWarmupRequiredKey !== null &&
    roiGeneViewportWarmupState.status === 'loading' &&
    roiGeneViewportWarmupState.key === roiGeneViewportWarmupRequiredKey
  const isDatasetPreparationPending =
    loadState.status === 'ready' && datasetWarmupState.status === 'loading'
  const canDrawRoi = loadState.status === 'ready' && !isDatasetPreparationPending
  const roiHeaderCopy = isDatasetPreparationPending
    ? 'Preparing'
    : roiGeneStatsState.status === 'loading'
      ? 'Querying genes'
      : roiTranscriptExportState.status === 'loading'
        ? 'Exporting'
        : isRoiGeneViewportWarmupLoading
          ? 'Preparing genes'
          : roiCopy
  const isRoiTabLoading =
    roiState.status === 'loading' ||
    roiGeneStatsState.status === 'loading' ||
    roiTranscriptExportState.status === 'loading' ||
    isRoiGeneViewportWarmupLoading
  const roiSummary = useMemo(
    () => (roiState.status === 'ready' ? summarizeRoiCells(roiState.cells) : null),
    [roiState],
  )
  const loadingTasks = useMemo<readonly LoadingTask[]>(() => {
    const tasks: LoadingTask[] = []

    if (loadState.status === 'loading') {
      tasks.push({
        id: 'dataset',
        tabId: 'dataset',
        label: 'Loading dataset',
        detail: shortDatasetLabel(loadState.url),
      })
    }

    if (datasetWarmupState.status === 'loading') {
      tasks.push({
        id: 'dataset-warmup',
        tabId: 'dataset',
        label: 'Preparing dataset',
        detail: shortDatasetLabel(datasetWarmupState.url),
      })
    }

    if (diagnosticsState.status === 'loading') {
      tasks.push({
        id: 'dataset-diagnostics',
        tabId: 'dataset',
        label: 'Diagnosing dataset',
        detail: shortDatasetLabel(diagnosticsState.url),
      })
    }

    if (genePanelState.status === 'loading') {
      tasks.push({ id: 'gene-panel', tabId: 'genes', label: 'Loading gene panel' })
    }

    if (morphologyState.status === 'loading') {
      tasks.push({ id: 'morphology', tabId: 'layers', label: 'Loading image' })
    }

    if (annotationGroupState.status === 'loading') {
      tasks.push({
        id: 'annotation-sets',
        tabId: 'annotations',
        label: 'Loading annotation sets',
      })
    }

    if (boundaryState.status === 'loading') {
      tasks.push({ id: 'boundaries', tabId: 'layers', label: 'Loading boundaries' })
    }

    if (geneExpressionState.status === 'loading') {
      tasks.push({
        id: 'gene-expression',
        tabId: 'genes',
        label: geneExpressionModeLabel(geneExpressionState.mode),
        detail: geneExpressionState.genes.join(', '),
      })
    }

    if (transcriptCapabilityState.status === 'loading') {
      tasks.push({
        id: 'transcript-capabilities',
        tabId: 'transcripts',
        label: 'Checking transcripts',
      })
    }

    if (transcriptLayerState.status === 'loading') {
      tasks.push({
        id: 'transcript-overlay',
        tabId: 'transcripts',
        label: 'Loading transcripts',
        detail: `${transcriptLayerState.visibleTranscriptEstimate.toLocaleString()} estimated`,
      })
    }

    if (magicLensState.status === 'loading') {
      tasks.push({
        id: 'magic-lens',
        tabId: 'magic-lens',
        label: 'Scanning magic lens',
        detail: magicLensScopeLabel(magicLensState.scope),
      })
    }

    if (annotationState.status === 'loading') {
      tasks.push({
        id: 'annotations',
        tabId: 'annotations',
        label: 'Loading annotations',
      })
    }

    if (analysisEmbeddingState.status === 'loading') {
      tasks.push({ id: 'embeddings', tabId: 'cell', label: 'Loading embeddings' })
    }

    if (cellDetailState.status === 'loading') {
      tasks.push({
        id: 'cell-details',
        tabId: 'cell',
        label: 'Loading cell details',
        detail: shortIdentifier(cellDetailState.cellId),
      })
    }

    if (roiState.status === 'loading') {
      tasks.push({ id: 'roi-cells', tabId: 'roi', label: 'Querying ROI cells' })
    }

    if (isRoiGeneViewportWarmupLoading) {
      tasks.push({
        id: 'roi-gene-warmup',
        tabId: 'roi',
        label: 'Preparing ROI genes',
      })
    }

    if (roiGeneStatsState.status === 'loading') {
      tasks.push({
        id: 'roi-genes',
        tabId: 'roi',
        label: 'Querying ROI genes',
        detail: `${roiGeneStatsState.cellCount.toLocaleString()} cells`,
      })
    }

    if (roiTranscriptExportState.status === 'loading') {
      tasks.push({
        id: 'roi-transcripts',
        tabId: 'roi',
        label: 'Exporting ROI transcripts',
      })
    }

    if (autoContrastChannelIds.length > 0) {
      const channelNoun = autoContrastChannelIds.length === 1 ? 'channel' : 'channels'
      tasks.push({
        id: 'auto-contrast',
        tabId: 'layers',
        label: 'Auto contrast',
        detail: `${autoContrastChannelIds.length.toLocaleString()} ${channelNoun}`,
      })
    }

    return tasks
  }, [
    analysisEmbeddingState,
    annotationGroupState,
    annotationState,
    autoContrastChannelIds,
    boundaryState,
    cellDetailState,
    datasetWarmupState,
    diagnosticsState,
    geneExpressionState,
    genePanelState,
    loadState,
    magicLensState,
    morphologyState,
    roiGeneStatsState,
    isRoiGeneViewportWarmupLoading,
    roiState,
    roiTranscriptExportState,
    transcriptCapabilityState,
    transcriptLayerState,
  ])
  const loadingTabIds = useMemo(
    () => new Set(loadingTasks.map((task) => task.tabId)),
    [loadingTasks],
  )
  const activeRoiSelection = roiState.status === 'idle' ? null : roiState.selection
  const magicLensIsCursorActive =
    magicLensScope === 'cursor' && magicLensActive && loadState.status === 'ready'
  const magicLensCanScan =
    loadState.status === 'ready' &&
    magicLensState.status !== 'loading' &&
    (magicLensScope === 'cursor'
      ? true
      : magicLensScope === 'roi'
        ? activeRoiSelection !== null
        : currentViewportDetail !== null)
  const magicLensViewerSummary =
    magicLensState.status === 'ready' || magicLensState.status === 'loading'
      ? magicLensState.status === 'ready'
        ? magicLensState.summary
        : null
      : magicLensState.status === 'error'
        ? null
        : null
  const magicLensViewerStatus: ViewerMagicLensStatus =
    magicLensState.status === 'loading'
      ? 'loading'
      : magicLensState.status === 'ready'
        ? 'ready'
        : magicLensState.status === 'error'
          ? 'error'
          : 'idle'
  const magicLensCopy = magicLensStatusCopy(
    magicLensState,
    magicLensScope,
    loadState.status,
    magicLensCanScan,
    magicLensActive,
  )
  const transcriptCopy = transcriptStatusCopy(
    transcriptCapabilityState,
    transcriptLayerState,
    showTranscriptOverlay,
  )
  const appendDebugEvent = useCallback(
    (message: string, options: { readonly coalesceKey?: string } = {}) => {
      debugLogIdRef.current += 1
      const entry: DebugLogEntry = {
        id: debugLogIdRef.current,
        timestamp: Date.now(),
        message,
        ...(options.coalesceKey === undefined
          ? {}
          : { coalesceKey: options.coalesceKey }),
      }

      setDebugLog((current) => {
        const first = current[0]

        if (
          first !== undefined &&
          entry.coalesceKey !== undefined &&
          first.coalesceKey === entry.coalesceKey
        ) {
          return [entry, ...current.slice(1)]
        }

        return [entry, ...current].slice(0, DEBUG_LOG_LIMIT)
      })
    },
    [],
  )
  const recordTelemetry = useCallback(
    (event: TelemetryEvent) => {
      setTelemetryEvents((current) =>
        appendTelemetryEvent(current, event, performanceBudget.telemetryEventLimit),
      )
    },
    [performanceBudget.telemetryEventLimit],
  )
  const handleTileCacheEviction = useCallback(
    (evictedTileCount: number) => {
      recordTelemetry(
        telemetryEvent('tile-cache.eviction', 'info', {
          detail: `${evictedTileCount.toLocaleString()} tiles`,
        }),
      )
    },
    [recordTelemetry],
  )
  const activeErrors = useMemo(
    () =>
      [
        loadState.status === 'error' ? loadState.error : null,
        diagnosticsState.status === 'error' ? diagnosticsState.error : null,
        morphologyState.status === 'error' ? morphologyState.error : null,
        boundaryState.status === 'error' ? boundaryState.error : null,
        genePanelState.status === 'error' ? genePanelState.error : null,
        annotationState.status === 'error' ? annotationState.error : null,
        annotationGroupState.status === 'error' ? annotationGroupState.error : null,
        analysisEmbeddingState.status === 'error' ? analysisEmbeddingState.error : null,
        roiState.status === 'error' ? roiState.error : null,
        roiGeneStatsState.status === 'error' ? roiGeneStatsState.error : null,
        roiTranscriptExportState.status === 'error'
          ? roiTranscriptExportState.error
          : null,
        geneExpressionState.status === 'error' ? geneExpressionState.error : null,
        transcriptCapabilityState.status === 'error'
          ? transcriptCapabilityState.error
          : null,
        transcriptLayerState.status === 'error' ? transcriptLayerState.error : null,
        magicLensState.status === 'error' ? magicLensState.error : null,
        cellDetailState.status === 'error' ? cellDetailState.error : null,
      ].filter(isStructuredLoadError),
    [
      annotationState,
      annotationGroupState,
      analysisEmbeddingState,
      boundaryState,
      cellDetailState,
      diagnosticsState,
      geneExpressionState,
      genePanelState,
      loadState,
      magicLensState,
      morphologyState,
      roiState,
      roiGeneStatsState,
      roiTranscriptExportState,
      transcriptCapabilityState,
      transcriptLayerState,
    ],
  )
  const handleImageTileError = useCallback((error: Error) => {
    setMorphologyState((current) => {
      if (current.status !== 'ready') {
        return current
      }

      return {
        status: 'error',
        url: current.url,
        error: createStructuredLoadError('Image tiles', error),
      }
    })
  }, [])
  const rememberGeneExpressionScaleMax = useCallback(
    (key: string, batch: GeneExpressionBatch, scoreMode: GeneExpressionScoreMode) => {
      const max = geneExpressionScoreDomainMax(batch.cells, batch.genes, scoreMode)

      if (max <= 0) {
        return
      }

      setGeneExpressionScaleDomain((current) => {
        const currentMax = current.key === key ? current.max : 0

        if (currentMax >= max) {
          return current
        }

        return { key, max }
      })
    },
    [],
  )
  const handleViewportChange = useCallback(
    (detail: ViewerViewportDetail) => {
      if (loadState.status !== 'ready') {
        return
      }

      lastViewportDetailRef.current = detail
      setCurrentViewportDetail(detail)
      const nextShareableViewState = viewStateToShareable(detail.viewState)
      setShareableViewState((current) =>
        shareableViewStateKey(current) === shareableViewStateKey(nextShareableViewState)
          ? current
          : nextShareableViewState,
      )

      if (!shouldLoadBoundaryPolygons(detail, { cellLimit: boundaryCellLimit })) {
        abortActiveRequest(boundaryAbortRef)
        boundaryRequestId.current += 1
        boundaryViewportKeyRef.current = null
        setBoundaryElements((current) => (current.length === 0 ? current : []))
        setBoundaryState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
      } else {
        const requestKey = boundaryViewportKey(loadState.url, detail.bbox)

        if (requestKey !== boundaryViewportKeyRef.current) {
          abortActiveRequest(boundaryAbortRef)
          const requestId = boundaryRequestId.current + 1
          const abortController = new AbortController()
          boundaryRequestId.current = requestId
          boundaryAbortRef.current = abortController
          boundaryViewportKeyRef.current = requestKey
          setBoundaryState({ status: 'loading', url: loadState.url })

          void loadBoundaryElements(loadState.url, detail.bbox, {
            signal: abortController.signal,
          })
            .then((batch) => {
              if (boundaryRequestId.current !== requestId) {
                return
              }

              setBoundaryElements(batch.elements)
              setBoundaryState({
                status: 'ready',
                url: loadState.url,
                cellCount: batch.elements.length,
              })
            })
            .catch((error) => {
              if (isAbortError(error)) {
                return
              }

              if (boundaryRequestId.current !== requestId) {
                return
              }

              setBoundaryElements([])
              setBoundaryState({
                status: 'error',
                url: loadState.url,
                error: createStructuredLoadError('Cell boundaries', error),
              })
            })
            .finally(() => {
              if (boundaryAbortRef.current === abortController) {
                boundaryAbortRef.current = null
              }
            })
        }
      }

      if (selectedGenes.length === 0) {
        abortActiveRequest(geneExpressionAbortRef)
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionBatch(null)
        setGeneExpressionState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
        return
      }

      const expressionPlan = planGeneExpressionLod(detail, {
        detailMode: geneExpressionDetailMode,
        slideBbox: overviewExtent,
        totalCellCount: loadState.cellCount,
      })

      if (expressionPlan.kind === 'waiting') {
        const waitingKey = geneExpressionWaitingKey(
          loadState.url,
          detail,
          selectedGenes,
          geneExpressionDetailMode,
        )

        if (waitingKey === geneExpressionViewportKeyRef.current) {
          return
        }

        abortActiveRequest(geneExpressionAbortRef)
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = waitingKey
        setGeneExpressionBatch(null)
        setGeneExpressionState({ status: 'waiting', message: expressionPlan.message })
        return
      }

      const expressionKey = geneExpressionRequestKey(
        loadState.url,
        detail,
        expressionPlan,
        selectedGenes,
      )

      if (expressionKey === geneExpressionViewportKeyRef.current) {
        return
      }

      const expressionRequestId = geneExpressionRequestId.current + 1
      abortActiveRequest(geneExpressionAbortRef)
      const expressionAbortController = new AbortController()
      geneExpressionRequestId.current = expressionRequestId
      geneExpressionAbortRef.current = expressionAbortController
      geneExpressionViewportKeyRef.current = expressionKey
      setGeneExpressionState({
        status: 'loading',
        url: loadState.url,
        genes: selectedGenes,
        mode: expressionPlan.mode,
        visibleCellCount: expressionPlan.sourceCellCount,
      })

      void loadGeneExpression(loadState.url, expressionPlan.bbox, selectedGenes, {
        signal: expressionAbortController.signal,
        limit: expressionPlan.cellLimit,
        sampleStride: expressionPlan.sampleStride,
      })
        .then((batch) => {
          if (geneExpressionRequestId.current !== expressionRequestId) {
            return
          }

          rememberGeneExpressionScaleMax(
            geneExpressionScaleKey,
            batch,
            geneExpressionScoreMode,
          )
          setGeneExpressionBatch(batch)
          setGeneExpressionState({
            status: 'ready',
            url: loadState.url,
            genes: batch.genes,
            cellCount: batch.cells.length,
            mode: expressionPlan.mode,
            visibleCellCount: expressionPlan.sourceCellCount,
          })
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (geneExpressionRequestId.current !== expressionRequestId) {
            return
          }

          setGeneExpressionBatch(null)
          setGeneExpressionState({
            status: 'error',
            url: loadState.url,
            error: createStructuredLoadError('Gene expression', error),
          })
        })
        .finally(() => {
          if (geneExpressionAbortRef.current === expressionAbortController) {
            geneExpressionAbortRef.current = null
          }
        })
    },
    [
      boundaryCellLimit,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
      loadBoundaryElements,
      loadGeneExpression,
      loadState,
      geneExpressionDetailMode,
      overviewExtent,
      rememberGeneExpressionScaleMax,
      selectedGenes,
    ],
  )

  useEffect(() => {
    const detail = lastViewportDetailRef.current

    if (detail !== null) {
      handleViewportChange(detail)
    }
  }, [handleViewportChange])

  useEffect(() => {
    if (
      loadState.status !== 'ready' ||
      transcriptCapabilityState.status !== 'idle' ||
      (!showTranscriptOverlay && activeControlHudTab !== 'transcripts')
    ) {
      return
    }

    const requestedUrl = loadState.url
    const requestId = loadRequestId.current
    const abortController = new AbortController()
    const transcriptStartedAt = readTimestamp()
    abortActiveRequest(transcriptCapabilityAbortRef)
    transcriptCapabilityRequestId.current += 1
    transcriptCapabilityAbortRef.current = abortController
    queueMicrotask(() => {
      if (transcriptCapabilityAbortRef.current === abortController) {
        setTranscriptCapabilityState({ status: 'loading', url: requestedUrl })
      }
    })
    appendDebugEvent('Transcript output check started')

    void loadTranscriptCapabilities(requestedUrl, {
      signal: abortController.signal,
    })
      .then((capabilities) => {
        if (loadRequestId.current !== requestId || abortController.signal.aborted) {
          return
        }

        setTranscriptCapabilityState({
          status: 'ready',
          url: requestedUrl,
          capabilities,
        })
        appendDebugEvent(
          `Transcript outputs: ${transcriptCapabilityLabel(capabilities)} (${formatElapsed(
            transcriptStartedAt,
          )})`,
          { coalesceKey: 'transcript-capability' },
        )
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setTranscriptCapabilityState({
          status: 'error',
          url: requestedUrl,
          error: createStructuredLoadError('Transcripts', error),
        })
        appendDebugEvent('Transcript output check failed', {
          coalesceKey: 'transcript-capability',
        })
      })
      .finally(() => {
        if (transcriptCapabilityAbortRef.current === abortController) {
          transcriptCapabilityAbortRef.current = null
        }
      })
  }, [
    activeControlHudTab,
    appendDebugEvent,
    loadState,
    loadTranscriptCapabilities,
    showTranscriptOverlay,
    transcriptCapabilityState.status,
  ])

  useEffect(() => {
    if (
      !showTranscriptOverlay ||
      loadState.status !== 'ready' ||
      currentViewportDetail === null
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const clearRequestId = transcriptRequestId.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === clearRequestId) {
          setTranscriptLayerState((current) =>
            current.status === 'idle' ? current : { status: 'idle' },
          )
        }
      })
      return
    }

    if (
      transcriptCapabilityState.status === 'idle' ||
      transcriptCapabilityState.status === 'loading'
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const waitingRequestId = transcriptRequestId.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === waitingRequestId) {
          setTranscriptLayerState({
            status: 'waiting',
            message: 'Checking transcript outputs for this dataset.',
            visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    if (transcriptCapabilityState.status === 'error') {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const errorRequestId = transcriptRequestId.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === errorRequestId) {
          setTranscriptLayerState({
            status: 'error',
            url: loadState.url,
            error: transcriptCapabilityState.error,
          })
        }
      })
      return
    }

    const featureNames =
      transcriptFeatureFilterMode === 'selected' ? selectedGenes : EMPTY_GENE_LIST
    const plan = planTranscriptLod(currentViewportDetail, {
      detailMode: transcriptDetailMode,
      visibleTranscriptEstimate,
      exactLimit: transcriptExactPointLimit,
      hasRawParquet: transcriptCapabilityState.capabilities.rawParquet,
      hasNativeZarr: transcriptCapabilityState.capabilities.nativeZarr,
      hasSelectedFeatureFilter:
        transcriptFeatureFilterMode !== 'selected' || featureNames.length > 0,
    })

    if (plan.kind === 'native-zarr') {
      const maxBins =
        plan.mode === 'density'
          ? TRANSCRIPT_NATIVE_DENSITY_MAX_BINS
          : TRANSCRIPT_NATIVE_BIN_MAX_BINS
      const requestKey = transcriptAggregateRequestKey(
        loadState.url,
        currentViewportDetail.bbox,
        {
          mode: plan.mode,
          featureNames,
          maxBins,
        },
      )

      if (requestKey === transcriptViewportKeyRef.current) {
        return
      }

      abortActiveRequest(transcriptAbortRef)
      const requestId = transcriptRequestId.current + 1
      const abortController = new AbortController()
      const transcriptStartedAt = readTimestamp()
      transcriptRequestId.current = requestId
      transcriptAbortRef.current = abortController
      transcriptViewportKeyRef.current = requestKey
      queueMicrotask(() => {
        if (transcriptRequestId.current === requestId) {
          setTranscriptLayerState((current) => {
            const previousLayer = retainedTranscriptLayerState(current)

            return {
              status: 'loading',
              url: loadState.url,
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              ...(previousLayer === undefined ? {} : { previousLayer }),
            }
          })
        }
      })
      appendDebugEvent('Native transcript aggregate query started', {
        coalesceKey: 'transcript-query',
      })

      void loadTranscriptAggregates(loadState.url, currentViewportDetail.bbox, {
        signal: abortController.signal,
        mode: plan.mode,
        featureNames,
        maxBins,
      })
        .then((result) => {
          if (transcriptRequestId.current !== requestId) {
            return
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          setTranscriptLayerState({
            status: 'aggregate',
            source: result.source,
            mode: plan.mode,
            bins: result.bins,
            message: transcriptNativeAggregateMessage({
              mode: plan.mode,
              selectedFeatureCount: result.selectedFeatureNames.length,
              binCount: result.bins.length,
            }),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            durationMs,
          })
          appendDebugEvent(
            `Native transcript aggregate ready: ${result.bins.length.toLocaleString()} bins in ${formatElapsed(
              transcriptStartedAt,
            )}`,
            { coalesceKey: 'transcript-query' },
          )
        })
        .catch((error) => {
          if (isAbortError(error) || transcriptRequestId.current !== requestId) {
            return
          }

          transcriptViewportKeyRef.current = null
          setTranscriptLayerState({
            status: 'error',
            url: loadState.url,
            error: createStructuredLoadError('Transcripts', error),
          })
          appendDebugEvent('Native transcript aggregate query failed', {
            coalesceKey: 'transcript-query',
          })
        })
        .finally(() => {
          if (transcriptAbortRef.current === abortController) {
            transcriptAbortRef.current = null
          }
        })

      return () => {
        if (transcriptAbortRef.current === abortController) {
          abortActiveRequest(transcriptAbortRef)
        }
      }
    }

    if (
      (plan.kind === 'waiting' || plan.kind === 'unavailable') &&
      !transcriptCapabilityState.capabilities.nativeZarr &&
      transcriptFeatureFilterMode === 'all' &&
      visibleTranscriptEstimate > 0
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const aggregateRequestId = transcriptRequestId.current
      const fallbackMode = transcriptDetailMode === 'bins' ? 'bins' : 'density'
      const bins = buildCellSummaryTranscriptBins(
        overviewCells,
        currentViewportDetail.bbox,
        fallbackMode,
      )
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === aggregateRequestId) {
          setTranscriptLayerState({
            status: 'aggregate',
            source: 'cell-summary',
            mode: fallbackMode,
            bins,
            message: transcriptAggregateFallbackMessage({
              mode: fallbackMode,
              featureFilterMode: transcriptFeatureFilterMode,
              selectedFeatureCount: featureNames.length,
            }),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    if (plan.kind === 'waiting') {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const waitingRequestId = transcriptRequestId.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === waitingRequestId) {
          setTranscriptLayerState({
            status: 'waiting',
            message: plan.message,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    if (plan.kind === 'unavailable') {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const unavailableRequestId = transcriptRequestId.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === unavailableRequestId) {
          setTranscriptLayerState({
            status: 'unavailable',
            message: plan.message,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    const requestKey = transcriptViewportRequestKey(
      loadState.url,
      currentViewportDetail.bbox,
      {
        minQv: transcriptMinQv,
        geneOnly: transcriptGeneOnly,
        featureNames,
        pointLimit: transcriptExactPointLimit,
      },
    )

    if (requestKey === transcriptViewportKeyRef.current) {
      return
    }

    abortActiveRequest(transcriptAbortRef)
    const requestId = transcriptRequestId.current + 1
    const abortController = new AbortController()
    const transcriptStartedAt = readTimestamp()
    transcriptRequestId.current = requestId
    transcriptAbortRef.current = abortController
    transcriptViewportKeyRef.current = requestKey
    queueMicrotask(() => {
      if (transcriptRequestId.current === requestId) {
        setTranscriptLayerState((current) => {
          const previousLayer = retainedTranscriptLayerState(current)

          return {
            status: 'loading',
            url: loadState.url,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            ...(previousLayer === undefined ? {} : { previousLayer }),
          }
        })
      }
    })
    appendDebugEvent(
      `Transcript exact query started: ${plan.visibleTranscriptEstimate.toLocaleString()} estimated`,
      { coalesceKey: 'transcript-query' },
    )

    let didExactQueryTimeOut = false
    let exactQueryTimeout: number | null = null
    const startTimeout = window.setTimeout(() => {
      exactQueryTimeout = window.setTimeout(() => {
        if (transcriptRequestId.current !== requestId) {
          return
        }

        didExactQueryTimeOut = true
        transcriptViewportKeyRef.current = null

        if (transcriptAbortRef.current === abortController) {
          transcriptAbortRef.current = null
        }

        abortController.abort()
        setTranscriptLayerState({
          status: 'waiting',
          message:
            'Exact transcript loading exceeded 12 seconds. Use Density/Auto for this zoom level, zoom closer, or filter to fewer genes.',
          visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
        })
        appendDebugEvent('Transcript exact query timed out', {
          coalesceKey: 'transcript-query',
        })
      }, TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS)

      void loadTranscriptViewport(loadState.url, currentViewportDetail.bbox, {
        signal: abortController.signal,
        pointLimit: transcriptExactPointLimit,
        groupLimit: TRANSCRIPT_GROUP_LIMIT,
        minQv: transcriptMinQv,
        geneOnly: transcriptGeneOnly,
        featureNames,
      })
        .then((result) => {
          if (didExactQueryTimeOut || transcriptRequestId.current !== requestId) {
            return
          }

          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          if (result.hitPointLimit) {
            transcriptViewportKeyRef.current = null
            setTranscriptLayerState({
              status: 'waiting',
              message: `Exact transcript viewport exceeded the ${transcriptExactPointLimit.toLocaleString()} point budget. Use Density/Auto for this zoom level, zoom closer, or filter to fewer genes.`,
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            })
            appendDebugEvent('Transcript exact query exceeded point budget', {
              coalesceKey: 'transcript-query',
            })
            return
          }

          setTranscriptLayerState({
            status: 'ready',
            url: loadState.url,
            points: result.points,
            groups: result.groups,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            hitPointLimit: result.hitPointLimit,
            durationMs,
          })
          appendDebugEvent(
            `Transcript exact query ready: ${result.points.length.toLocaleString()} points in ${formatElapsed(
              transcriptStartedAt,
            )}`,
            { coalesceKey: 'transcript-query' },
          )
        })
        .catch((error) => {
          if (
            didExactQueryTimeOut ||
            isAbortError(error) ||
            transcriptRequestId.current !== requestId
          ) {
            return
          }

          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          setTranscriptLayerState({
            status: 'error',
            url: loadState.url,
            error: createStructuredLoadError('Transcripts', error),
          })
          appendDebugEvent('Transcript query failed', {
            coalesceKey: 'transcript-query',
          })
        })
        .finally(() => {
          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          if (transcriptAbortRef.current === abortController) {
            transcriptAbortRef.current = null
          }
        })
    }, 220)

    return () => {
      window.clearTimeout(startTimeout)
      if (exactQueryTimeout !== null) {
        window.clearTimeout(exactQueryTimeout)
      }

      if (transcriptAbortRef.current === abortController) {
        abortActiveRequest(transcriptAbortRef)
      }
    }
  }, [
    appendDebugEvent,
    currentViewportDetail,
    loadState,
    loadTranscriptAggregates,
    loadTranscriptViewport,
    overviewCells,
    selectedGenes,
    showTranscriptOverlay,
    transcriptCapabilityState,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptMinQv,
    visibleTranscriptEstimate,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const detail = currentViewportDetail
    const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

    if (
      readyDatasetUrl === null ||
      detail === null ||
      roiState.status !== 'idle' ||
      detail.visibleCellCount <= ROI_GENE_STATS_PREVIEW_CELL_LIMIT
    ) {
      const hadPendingWarmup =
        roiGeneViewportWarmupTimeoutRef.current !== null ||
        roiGeneViewportWarmupAbortRef.current !== null
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      abortActiveRequest(roiGeneViewportWarmupAbortRef)

      if (hadPendingWarmup) {
        roiGeneViewportWarmupKeyRef.current = null
      }

      return
    }

    const warmupKey = roiGeneViewportWarmupKey(readyDatasetUrl, detail)

    if (warmupKey === roiGeneViewportWarmupKeyRef.current) {
      return
    }

    clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    abortActiveRequest(roiGeneViewportWarmupAbortRef)
    setRoiGeneViewportWarmupState({ status: 'loading', key: warmupKey })

    roiGeneViewportWarmupTimeoutRef.current = window.setTimeout(() => {
      const abortController = new AbortController()
      const selection = { kind: 'box' as const, bbox: detail.bbox }
      const warmupStartedAt = readTimestamp()
      roiGeneViewportWarmupAbortRef.current = abortController
      roiGeneViewportWarmupKeyRef.current = warmupKey

      void (async () => {
        try {
          const cellsStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI warmup cells started: ${detail.visibleCellCount.toLocaleString()} visible, limit ${ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT.toLocaleString()}`,
          )
          const cells = await loadRoiCells(readyDatasetUrl, selection, {
            signal: abortController.signal,
            limit: ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT,
          })

          if (abortController.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup cells ready: ${cells.length.toLocaleString()} in ${formatElapsed(cellsStartedAt)}`,
          )

          if (cells.length === 0) {
            appendDebugEvent(
              `ROI gene viewport warmup ready: no cells (${formatElapsed(warmupStartedAt)})`,
              {
                coalesceKey: 'roi-gene-warmup',
              },
            )
            setRoiGeneViewportWarmupState({ status: 'ready', key: warmupKey })
            return
          }

          const genesStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI warmup genes started: sample ${Math.min(
              cells.length,
              ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            ).toLocaleString()} of ${cells.length.toLocaleString()} cells`,
          )
          const stats = await loadRoiGeneStats(readyDatasetUrl, cells, {
            signal: abortController.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
          })

          if (abortController.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
              genesStartedAt,
            )}`,
          )
          appendDebugEvent(
            `ROI gene viewport warmup ready (${formatElapsed(warmupStartedAt)})`,
            {
              coalesceKey: 'roi-gene-warmup',
            },
          )
          setRoiGeneViewportWarmupState({ status: 'ready', key: warmupKey })
        } catch (error) {
          if (isAbortError(error)) {
            return
          }

          if (roiGeneViewportWarmupKeyRef.current === warmupKey) {
            roiGeneViewportWarmupKeyRef.current = null
          }

          appendDebugEvent(
            `ROI gene viewport warmup skipped (${formatElapsed(warmupStartedAt)})`,
            {
              coalesceKey: 'roi-gene-warmup',
            },
          )
          setRoiGeneViewportWarmupState({ status: 'error', key: warmupKey })
        } finally {
          if (roiGeneViewportWarmupAbortRef.current === abortController) {
            roiGeneViewportWarmupAbortRef.current = null
          }
        }
      })()
    }, ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)

    return () => {
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    }
  }, [
    appendDebugEvent,
    currentViewportDetail,
    loadRoiCells,
    loadRoiGeneStats,
    loadState,
    roiState.status,
  ])

  useEffect(() => {
    if (didApplyInitialDatasetUrlRef.current) {
      return
    }

    didApplyInitialDatasetUrlRef.current = true

    if (
      initialShareableState.datasetUrl !== undefined &&
      initialShareableState.datasetUrl.trim() !== ''
    ) {
      setDatasetUrl(initialShareableState.datasetUrl)
    }
  }, [initialShareableState.datasetUrl, setDatasetUrl])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const timeout = window.setTimeout(() => {
      const hash = formatShareableState({
        datasetUrl,
        selectedGenes,
        ...(shareableViewState === undefined ? {} : { viewState: shareableViewState }),
        ...(activeRoiSelection === null ? {} : { roiSelection: activeRoiSelection }),
        activeTab: activeControlHudTab,
        geneExpressionColorScale,
        geneExpressionScoreMode,
        geneExpressionDetailMode,
        observationColorMode,
        coordinateUnit,
        shouldLoadMorphology,
        boundaryCellLimit,
        transcriptOverlay: showTranscriptOverlay,
        transcriptDetailMode,
        transcriptDensityColorScale,
        transcriptExactPointLimit,
        transcriptMinQv,
        transcriptGeneOnly,
        transcriptFeatureFilterMode,
        transcriptOpacity,
        transcriptPointSize,
      })

      if (window.location.hash !== hash) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${hash}`,
        )
      }
    }, 160)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    activeControlHudTab,
    activeRoiSelection,
    boundaryCellLimit,
    coordinateUnit,
    datasetUrl,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    observationColorMode,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    transcriptDetailMode,
    transcriptDensityColorScale,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointSize,
  ])

  useEffect(() => {
    if (selectedCell === null || loadState.status !== 'ready') {
      abortActiveRequest(cellDetailAbortRef)
      cellDetailRequestId.current += 1
      return
    }

    const requestId = cellDetailRequestId.current + 1
    const detailStartedAt = readTimestamp()
    const abortController = new AbortController()
    abortActiveRequest(cellDetailAbortRef)
    cellDetailRequestId.current = requestId
    cellDetailAbortRef.current = abortController
    queueMicrotask(() => {
      if (abortController.signal.aborted || cellDetailRequestId.current !== requestId) {
        return
      }

      setCellDetailState({
        status: 'loading',
        url: loadState.url,
        cellId: selectedCell.id,
      })
    })
    appendDebugEvent(`Cell details started: ${shortIdentifier(selectedCell.id)}`, {
      coalesceKey: 'cell-details',
    })

    void (async () => {
      const datasetCell = overviewCellToDatasetCell(selectedCell)
      const [stats, boundaryElement] = await Promise.all([
        loadRoiGeneStats(loadState.url, [datasetCell], {
          signal: abortController.signal,
          cellLimit: 1,
          geneLimit: CELL_GENE_EXPRESSION_LIMIT,
          sampleStrategy: 'head',
        }),
        loadSelectedCellBoundary(
          loadState.url,
          selectedCell,
          loadBoundaryElements,
          abortController.signal,
        ),
      ])

      if (abortController.signal.aborted || cellDetailRequestId.current !== requestId) {
        return
      }

      setCellDetailState({
        status: 'ready',
        url: loadState.url,
        cellId: selectedCell.id,
        expression: cellExpressionSummaryFromStats(stats),
        shape: summarizeCellShape(selectedCell, boundaryElement),
      })
      appendDebugEvent(
        `Cell details ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
          detailStartedAt,
        )}`,
        { coalesceKey: 'cell-details' },
      )
    })()
      .catch((error) => {
        if (isAbortError(error) || cellDetailRequestId.current !== requestId) {
          return
        }

        setCellDetailState({
          status: 'error',
          url: loadState.url,
          cellId: selectedCell.id,
          error: createStructuredLoadError('Cell details', error),
        })
        appendDebugEvent(`Cell details failed (${formatElapsed(detailStartedAt)})`, {
          coalesceKey: 'cell-details',
        })
      })
      .finally(() => {
        if (cellDetailAbortRef.current === abortController) {
          cellDetailAbortRef.current = null
        }
      })

    return () => {
      if (cellDetailAbortRef.current === abortController) {
        abortActiveRequest(cellDetailAbortRef)
      }
    }
  }, [appendDebugEvent, loadBoundaryElements, loadRoiGeneStats, loadState, selectedCell])

  useEffect(() => {
    return () => {
      abortActiveRequest(datasetAbortRef)
      abortActiveRequest(datasetWarmupAbortRef)
      abortActiveRequest(diagnosticsAbortRef)
      abortActiveRequest(analysisEmbeddingAbortRef)
      abortActiveRequest(boundaryAbortRef)
      abortActiveRequest(geneExpressionAbortRef)
      abortActiveRequest(roiAbortRef)
      abortActiveRequest(roiTranscriptExportAbortRef)
      abortActiveRequest(transcriptCapabilityAbortRef)
      abortActiveRequest(transcriptAbortRef)
      abortActiveRequest(roiGeneViewportWarmupAbortRef)
      abortActiveRequest(magicLensAbortRef)
      abortActiveRequest(cellDetailAbortRef)
      clearTimeoutRef(magicLensDebounceRef)
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    }
  }, [])

  function startDatasetWarmup(requestedUrl: string, requestId: number) {
    abortActiveRequest(datasetWarmupAbortRef)
    const warmupStartedAt = readTimestamp()
    const abortController = new AbortController()
    datasetWarmupAbortRef.current = abortController
    setDatasetWarmupState({ status: 'loading', url: requestedUrl })
    appendDebugEvent('Dataset prep started')
    const applyCellFeatureMatrixCapability = (result: WarmDatasetForRoiResult | void) => {
      const capability = result?.cellFeatureMatrix

      if (
        capability === undefined ||
        capability === null ||
        loadRequestId.current !== requestId ||
        abortController.signal.aborted
      ) {
        return
      }

      const capabilityKey = `${requestedUrl}:${capability.hasCellMajorCsc}`

      if (cellFeatureMatrixCapabilityKeyRef.current === capabilityKey) {
        return
      }

      cellFeatureMatrixCapabilityKeyRef.current = capabilityKey
      setCellFeatureMatrixCapabilityState({
        status: 'ready',
        url: requestedUrl,
        hasCellMajorCsc: capability.hasCellMajorCsc,
      })

      if (!capability.hasCellMajorCsc) {
        appendDebugEvent(
          'Cell-feature matrix is not CSC; ROI gene stats will use H5 fallback when needed',
          { coalesceKey: 'cell-feature-matrix-csc' },
        )
      }
    }

    void warmDatasetForRoi(requestedUrl, {
      signal: abortController.signal,
      onCellFeatureMatrixCapability: (capability) => {
        applyCellFeatureMatrixCapability({ cellFeatureMatrix: capability })
      },
    })
      .then((result) => {
        if (loadRequestId.current !== requestId) {
          return
        }

        applyCellFeatureMatrixCapability(result)
        setDatasetWarmupState({ status: 'ready', url: requestedUrl })
        appendDebugEvent(`Dataset prep ready (${formatElapsed(warmupStartedAt)})`)
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setDatasetWarmupState({ status: 'error', url: requestedUrl })
        appendDebugEvent(`Dataset prep incomplete (${formatElapsed(warmupStartedAt)})`)
      })
      .finally(() => {
        if (datasetWarmupAbortRef.current === abortController) {
          datasetWarmupAbortRef.current = null
        }
      })
  }

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')
    const loadImage = formData.get('loadMorphologyImage') === 'on'

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      const requestedUrl = datasetUrl.trim()
      const requestId = loadRequestId.current + 1
      const loadStartedAt = readTimestamp()
      const sharedState = initialShareableStateRef.current
      const shouldRestoreSharedState =
        sharedState?.datasetUrl !== undefined &&
        sharedState.datasetUrl.trim() === requestedUrl
      const sharedSelectedGenes = shouldRestoreSharedState
        ? (sharedState.selectedGenes ?? [])
        : []
      appendDebugEvent(`Loading dataset ${shortDatasetLabel(requestedUrl)}`)
      abortActiveRequest(datasetAbortRef)
      abortActiveRequest(datasetWarmupAbortRef)
      abortActiveRequest(diagnosticsAbortRef)
      abortActiveRequest(analysisEmbeddingAbortRef)
      abortActiveRequest(boundaryAbortRef)
      abortActiveRequest(geneExpressionAbortRef)
      abortActiveRequest(roiAbortRef)
      abortActiveRequest(roiTranscriptExportAbortRef)
      abortActiveRequest(transcriptCapabilityAbortRef)
      abortActiveRequest(transcriptAbortRef)
      abortActiveRequest(roiGeneViewportWarmupAbortRef)
      abortActiveRequest(magicLensAbortRef)
      abortActiveRequest(cellDetailAbortRef)
      clearTimeoutRef(magicLensDebounceRef)
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      roiGeneViewportWarmupKeyRef.current = null
      const abortController = new AbortController()
      loadRequestId.current = requestId
      datasetAbortRef.current = abortController

      setDatasetUrl(requestedUrl)
      setDatasetWarmupState({ status: 'idle' })
      setCellFeatureMatrixCapabilityState({ status: 'idle' })
      cellFeatureMatrixCapabilityKeyRef.current = null
      setOverviewCells([])
      setGeneExpressionBatch(null)
      setGeneExpressionScaleDomain({ key: '', max: 0 })
      setMorphologyImage(null)
      setMorphologyChannelSettings([])
      autoContrastChannelIdsRef.current.clear()
      setAutoContrastChannelIds([])
      setBoundaryElements([])
      setGeneSearch('')
      setGeneSetSymbols('')
      setGeneSetName('')
      setSavedGeneSets([])
      setAnnotationColors({})
      setAnnotationGroupState({ status: 'loading', url: requestedUrl })
      setSelectedAnnotationGroupId(ALL_ANNOTATION_GROUP_ID)
      setAnalysisEmbeddingState({ status: 'idle' })
      setSelectedEmbeddingKind('umap')
      setObservationColorMode(
        shouldRestoreSharedState
          ? (parseObservationColorMode(sharedState?.observationColorMode) ??
              'transcript-count')
          : 'transcript-count',
      )
      setGeneExpressionScoreMode(
        shouldRestoreSharedState
          ? (parseGeneExpressionScoreMode(sharedState?.geneExpressionScoreMode) ??
              DEFAULT_GENE_EXPRESSION_SCORE_MODE)
          : DEFAULT_GENE_EXPRESSION_SCORE_MODE,
      )
      setGeneExpressionDetailMode(
        shouldRestoreSharedState
          ? (parseGeneExpressionDetailMode(sharedState?.geneExpressionDetailMode) ??
              'auto')
          : 'auto',
      )
      setGeneExpressionColorScale(
        shouldRestoreSharedState
          ? (parseGeneExpressionColorScale(sharedState?.geneExpressionColorScale) ??
              geneExpressionColorScale)
          : geneExpressionColorScale,
      )
      setTranscriptDensityColorScale(
        shouldRestoreSharedState
          ? (parseTranscriptDensityColorScale(sharedState?.transcriptDensityColorScale) ??
              transcriptDensityColorScale)
          : transcriptDensityColorScale,
      )
      setTranscriptExactPointLimit(
        shouldRestoreSharedState
          ? sharedState?.transcriptExactPointLimit === undefined
            ? transcriptExactPointLimit
            : normalizeTranscriptExactPointLimit(sharedState.transcriptExactPointLimit)
          : transcriptExactPointLimit,
      )
      setSelectedGenes(sharedSelectedGenes)
      setRoiMode('idle')
      setRoiName('ROI 1')
      setRoiState({ status: 'idle' })
      setRoiGeneStatsState({ status: 'idle' })
      setRoiGeneViewportWarmupState({ status: 'idle' })
      setRoiTranscriptExportState({ status: 'idle' })
      setTranscriptCapabilityState({ status: 'idle' })
      setTranscriptLayerState({ status: 'idle' })
      setMagicLensState({ status: 'idle' })
      setCellDetailState({ status: 'idle' })
      setMagicLensActive(false)
      setSelectedCell(null)
      setCurrentViewportDetail(null)
      setViewportCellCount(null)
      setLoadState({ status: 'loading', url: requestedUrl })
      setMorphologyState(
        loadImage ? { status: 'loading', url: requestedUrl } : { status: 'idle' },
      )
      setDiagnosticsState({ status: 'idle' })
      setBoundaryState({ status: 'idle' })
      setGenePanelState({ status: 'loading', url: requestedUrl })
      setAnnotationState({ status: 'idle' })
      setGeneExpressionState({ status: 'idle' })
      boundaryRequestId.current += 1
      analysisEmbeddingRequestId.current += 1
      geneExpressionRequestId.current += 1
      roiRequestId.current += 1
      roiTranscriptExportRequestId.current += 1
      transcriptCapabilityRequestId.current += 1
      transcriptRequestId.current += 1
      magicLensRequestId.current += 1
      cellDetailRequestId.current += 1
      magicLensLastDetailRef.current = null
      magicLensLastQueryKeyRef.current = null
      boundaryViewportKeyRef.current = null
      geneExpressionViewportKeyRef.current = null
      transcriptViewportKeyRef.current = null
      lastViewportDetailRef.current = null
      initialSharedRoiSelectionRef.current = shouldRestoreSharedState
        ? (sharedState?.roiSelection ?? null)
        : null
      initialShareableStateRef.current = null
      startDatasetWarmup(requestedUrl, requestId)

      void loadGenePanel(requestedUrl, { signal: abortController.signal })
        .then((genes) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({ status: 'ready', url: requestedUrl, genes })
          appendDebugEvent(`Gene panel ready: ${genes.length.toLocaleString()} genes`)
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({
            status: 'error',
            url: requestedUrl,
            error: createStructuredLoadError('Gene panel', error),
          })
          appendDebugEvent('Gene panel failed')
        })

      void loadAnnotationGroups(requestedUrl, { signal: abortController.signal })
        .then((groups) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setAnnotationGroupState({
            status: 'ready',
            url: requestedUrl,
            groups,
          })
          appendDebugEvent(
            `Annotation sets ready: ${groups.length.toLocaleString()} groups`,
          )
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (loadRequestId.current !== requestId) {
            return
          }

          setAnnotationGroupState({
            status: 'error',
            url: requestedUrl,
            error: createStructuredLoadError('Annotations', error),
          })
          appendDebugEvent('Annotation sets failed')
        })

      try {
        const cells = await loadDatasetOverview(requestedUrl, {
          includeCellIds: true,
          limit: null,
          signal: abortController.signal,
        })

        if (loadRequestId.current !== requestId) {
          return
        }

        setOverviewCells(overviewCellsToLayerData(cells))
        setLoadState({
          status: 'ready',
          url: requestedUrl,
          cellCount: cells.length,
        })
        appendDebugEvent(
          `Dataset ready: ${cells.length.toLocaleString()} cells in ${formatElapsed(
            loadStartedAt,
          )}`,
        )
        recordTelemetry(
          telemetryEvent('dataset.load', 'success', {
            startedAt: loadStartedAt,
            detail: `${cells.length.toLocaleString()} cells`,
          }),
        )

        if (!loadImage) {
          return
        }

        void loadMorphologyImage(requestedUrl, { signal: abortController.signal })
          .then((image) => {
            if (loadRequestId.current !== requestId) {
              return
            }

            setMorphologyImage(image)
            setMorphologyChannelSettings(createMorphologyChannelSettings(image))
            setMorphologyState({
              status: 'ready',
              url: image.url,
            })
            appendDebugEvent('Morphology image ready')
            queueAutoContrast(image.channelLoaders, {
              requestId,
              signal: abortController.signal,
            })
          })
          .catch((error) => {
            if (isAbortError(error)) {
              return
            }

            if (loadRequestId.current !== requestId) {
              return
            }

            setMorphologyState({
              status: 'error',
              url: requestedUrl,
              error: createStructuredLoadError('Morphology image', error),
            })
            appendDebugEvent('Morphology image failed')
          })
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        if (loadRequestId.current !== requestId) {
          return
        }

        setLoadState({
          status: 'error',
          url: requestedUrl,
          error: createStructuredLoadError('Dataset overview', error),
        })
        appendDebugEvent('Dataset load failed')
        recordTelemetry(
          telemetryEvent('dataset.load', 'failure', {
            startedAt: loadStartedAt,
            detail: readErrorMessage(error),
          }),
        )
        abortActiveRequest(datasetWarmupAbortRef)
        setDatasetWarmupState({ status: 'idle' })
        setCellFeatureMatrixCapabilityState({ status: 'idle' })
        cellFeatureMatrixCapabilityKeyRef.current = null
        setMorphologyState({ status: 'idle' })
        setGenePanelState({ status: 'idle' })
        setAnnotationGroupState({ status: 'idle' })
        setTranscriptCapabilityState({ status: 'idle' })
        setTranscriptLayerState({ status: 'idle' })
      }
    }
  }

  async function handleRunDatasetDiagnostics() {
    const requestedUrl = datasetUrl.trim()

    if (requestedUrl === '') {
      return
    }

    const diagnosticsStartedAt = readTimestamp()
    abortActiveRequest(diagnosticsAbortRef)
    const abortController = new AbortController()
    diagnosticsAbortRef.current = abortController
    setDiagnosticsState({ status: 'loading', url: requestedUrl })
    appendDebugEvent(`Diagnosing dataset ${shortDatasetLabel(requestedUrl)}`)

    try {
      const report = await runDatasetDiagnostics(requestedUrl, {
        signal: abortController.signal,
      })

      if (diagnosticsAbortRef.current !== abortController) {
        return
      }

      const summary = summarizeDatasetDiagnostics(report)
      setDiagnosticsState({ status: 'ready', url: requestedUrl, report })
      appendDebugEvent(`Diagnostics: ${summary}`)
      recordTelemetry(
        telemetryEvent('dataset.diagnostics', 'success', {
          startedAt: diagnosticsStartedAt,
          detail: summary,
        }),
      )
    } catch (error) {
      if (isAbortError(error) || diagnosticsAbortRef.current !== abortController) {
        return
      }

      setDiagnosticsState({
        status: 'error',
        url: requestedUrl,
        error: createStructuredLoadError('Dataset diagnostics', error),
      })
      appendDebugEvent('Diagnostics failed')
      recordTelemetry(
        telemetryEvent('dataset.diagnostics', 'failure', {
          startedAt: diagnosticsStartedAt,
          detail: readErrorMessage(error),
        }),
      )
    } finally {
      if (diagnosticsAbortRef.current === abortController) {
        diagnosticsAbortRef.current = null
      }
    }
  }

  function handleDownloadDiagnostics() {
    downloadTextFile(
      'xenium-diagnostics.json',
      JSON.stringify(
        createDiagnosticsDump({
          activeControlHudTab,
          activeErrors,
          boundaryCellLimit,
          coordinateUnit,
          datasetUrl,
          debugLog,
          diagnosticsState,
          geneExpressionColorScale,
          geneExpressionDetailMode,
          geneExpressionScoreMode,
          loadState,
          observationColorMode,
          performanceBudget,
          selectedGenes,
          shareableViewState,
          shouldLoadMorphology,
          telemetryEvents,
          showTranscriptOverlay,
          transcriptCapabilityState,
          transcriptDetailMode,
          transcriptDensityColorScale,
          transcriptExactPointLimit,
          transcriptFeatureFilterMode,
          transcriptGeneOnly,
          transcriptLayerState,
          transcriptMinQv,
          transcriptOpacity,
          transcriptPointSize,
        }),
        null,
        2,
      ),
      'application/json;charset=utf-8',
    )
    appendDebugEvent('Downloaded diagnostics')
  }

  function toggleGene(gene: string) {
    const isSelected = selectedGenes.includes(gene)
    appendDebugEvent(isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`)
    resetGeneExpressionSelectionState()
    setSelectedGenes((current) =>
      isSelected
        ? current.filter((selectedGene) => selectedGene !== gene)
        : [...current, gene].sort((a, b) => a.localeCompare(b)),
    )
  }

  function applyGeneSetSymbols() {
    const genes = parseGeneSetSymbols(geneSetSymbols, geneOptions)

    if (genes.length === 0) {
      return
    }

    appendDebugEvent(`Applied symbols: ${genes.length.toLocaleString()} genes`)
    setSelectedGenes(genes)
    resetGeneExpressionSelectionState()
    setGeneSearch('')
  }

  function saveSelectedGeneSet() {
    if (selectedGenes.length === 0) {
      return
    }

    const name = geneSetName.trim() || defaultGeneSetName(selectedGenes)
    const normalizedName = name.toLowerCase()
    const savedSet: SavedGeneSet = {
      id: `gene-set-${geneSetIdRef.current + 1}`,
      name,
      genes: selectedGenes,
      scoreMode: geneExpressionScoreMode,
    }

    geneSetIdRef.current += 1
    appendDebugEvent(`Saved gene set ${name}`)
    setSavedGeneSets((current) => [
      savedSet,
      ...current.filter((geneSet) => geneSet.name.toLowerCase() !== normalizedName),
    ])
    setGeneSetName('')
  }

  function applySavedGeneSet(geneSet: SavedGeneSet) {
    appendDebugEvent(`Applied gene set ${geneSet.name}`)
    resetGeneExpressionSelectionState()
    setSelectedGenes(geneSet.genes)
    setGeneExpressionScoreMode(geneSet.scoreMode)
    setGeneSearch('')
  }

  function handleGeneExpressionScoreModeChange(nextScoreMode: GeneExpressionScoreMode) {
    appendDebugEvent(`Signature score: ${nextScoreMode}`)
    setGeneExpressionScoreMode(nextScoreMode)

    if (geneExpressionBatch === null) {
      setGeneExpressionScaleDomain({ key: '', max: 0 })
      return
    }

    rememberGeneExpressionScaleMax(
      geneExpressionScaleKeyFor(
        geneExpressionScaleDatasetUrl,
        nextScoreMode,
        selectedGenes,
      ),
      geneExpressionBatch,
      nextScoreMode,
    )
  }

  function resetGeneExpressionSelectionState() {
    abortActiveRequest(geneExpressionAbortRef)
    geneExpressionRequestId.current += 1
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain({ key: '', max: 0 })
    setGeneExpressionState({ status: 'idle' })
  }

  function removeSavedGeneSet(id: string) {
    const removedSet = savedGeneSets.find((geneSet) => geneSet.id === id)

    if (removedSet !== undefined) {
      appendDebugEvent(`Removed gene set ${removedSet.name}`)
    }

    setSavedGeneSets((current) => current.filter((geneSet) => geneSet.id !== id))
  }

  function handleLoadAnnotations() {
    if (loadState.status !== 'ready' || annotationState.status === 'loading') {
      return
    }

    const requestId = loadRequestId.current
    const signal = datasetAbortRef.current?.signal
    const groupId =
      selectedAnnotationGroupId === ALL_ANNOTATION_GROUP_ID
        ? undefined
        : selectedAnnotationGroupId
    appendDebugEvent(
      groupId === undefined ? 'Loading annotations' : `Loading annotations ${groupId}`,
    )
    setAnnotationState({ status: 'loading', url: loadState.url })

    void loadAnnotations(loadState.url, {
      ...(signal === undefined ? {} : { signal }),
      ...(groupId === undefined ? {} : { groupId }),
    })
      .then((annotations) => {
        if (loadRequestId.current !== requestId) {
          return
        }

        setAnnotationState({
          status: 'ready',
          url: loadState.url,
          annotations,
        })
        setAnnotationColors((current) => colorsForAnnotations(annotations, current))
        if (annotations.length > 0) {
          setObservationColorMode('annotations')
        }
        appendDebugEvent(
          `Annotations loaded: ${annotations.length.toLocaleString()} labels`,
        )
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setAnnotationState({
          status: 'error',
          url: loadState.url,
          error: createStructuredLoadError('Annotations', error),
        })
        appendDebugEvent('Annotations failed')
      })
  }

  function handleLoadAnalysisEmbeddings() {
    if (loadState.status !== 'ready' || analysisEmbeddingState.status === 'loading') {
      return
    }

    const requestId = analysisEmbeddingRequestId.current + 1
    abortActiveRequest(analysisEmbeddingAbortRef)
    const abortController = new AbortController()
    analysisEmbeddingRequestId.current = requestId
    analysisEmbeddingAbortRef.current = abortController
    setAnalysisEmbeddingState({ status: 'loading', url: loadState.url })
    appendDebugEvent('Loading embeddings')

    void loadAnalysisEmbeddings(loadState.url, { signal: abortController.signal })
      .then((embeddings) => {
        if (analysisEmbeddingRequestId.current !== requestId) {
          return
        }

        setAnalysisEmbeddingState({
          status: 'ready',
          url: loadState.url,
          embeddings,
        })

        if (
          embeddings.length > 0 &&
          !embeddings.some((embedding) => embedding.kind === selectedEmbeddingKind)
        ) {
          setSelectedEmbeddingKind(embeddings[0]?.kind ?? 'umap')
        }
        appendDebugEvent(`Embeddings loaded: ${embeddings.length.toLocaleString()} views`)
      })
      .catch((error) => {
        if (isAbortError(error) || analysisEmbeddingRequestId.current !== requestId) {
          return
        }

        setAnalysisEmbeddingState({
          status: 'error',
          url: loadState.url,
          error: createStructuredLoadError('Embeddings', error),
        })
        appendDebugEvent('Embeddings failed')
      })
      .finally(() => {
        if (analysisEmbeddingAbortRef.current === abortController) {
          analysisEmbeddingAbortRef.current = null
        }
      })
  }

  function handleEmbeddingCellSelect(cellId: string) {
    const cell = overviewCellById.get(cellId)

    if (cell !== undefined) {
      setSelectedCell(cell)
    }
  }

  async function handleImportAnnotations(file: File | null) {
    if (file === null) {
      return
    }

    try {
      const importedAnnotations = parseCustomAnnotations(await file.text(), file.name)
      const importedPrefix = customAnnotationFilePrefix(file.name)

      setAnnotationState((current) => ({
        status: 'ready',
        url: loadState.status === 'ready' ? loadState.url : datasetUrl,
        annotations: mergeImportedAnnotations(
          current.status === 'ready' ? current.annotations : [],
          importedAnnotations,
          importedPrefix,
        ),
      }))
      setAnnotationColors((current) =>
        colorsForAnnotations(
          importedAnnotations,
          removeAnnotationColorsByPrefix(current, importedPrefix),
        ),
      )
      if (importedAnnotations.length > 0) {
        setObservationColorMode('annotations')
      }
      appendDebugEvent(
        `Imported annotations: ${importedAnnotations.length.toLocaleString()} labels`,
      )
    } catch (error) {
      setAnnotationState({
        status: 'error',
        url: loadState.status === 'ready' ? loadState.url : datasetUrl,
        error: createStructuredLoadError('Annotations', error),
      })
      appendDebugEvent('Annotation import failed')
    }
  }

  function handleAnnotationColorChange(annotationId: string, color: string) {
    const normalizedColor = normalizeAnnotationColor(color)

    if (normalizedColor === null) {
      return
    }

    setAnnotationColors((current) => ({ ...current, [annotationId]: normalizedColor }))
    appendDebugEvent(`Annotation color ${shortIdentifier(annotationId)}`, {
      coalesceKey: `annotation-color:${annotationId}`,
    })
  }

  function handleRemoveAnnotation(annotationId: string) {
    const removedAnnotation =
      annotationState.status === 'ready'
        ? annotationState.annotations.find((annotation) => annotation.id === annotationId)
        : undefined

    setAnnotationState((current) => {
      if (current.status !== 'ready') {
        return current
      }

      const annotations = current.annotations.filter(
        (annotation) => annotation.id !== annotationId,
      )

      return annotations.length === 0 ? { status: 'idle' } : { ...current, annotations }
    })
    setAnnotationColors((current) => removeAnnotationColor(current, annotationId))
    setObservationColorMode((current) =>
      hasReadyAnnotationsAfterRemove(annotationState, annotationId)
        ? current
        : 'transcript-count',
    )

    appendDebugEvent(
      `Removed annotation ${removedAnnotation?.label ?? shortIdentifier(annotationId)}`,
    )
  }

  function handleClearAnnotations() {
    setAnnotationState({ status: 'idle' })
    setAnnotationColors({})
    setObservationColorMode('transcript-count')
    appendDebugEvent('Cleared annotations')
  }

  const handleRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (loadState.status !== 'ready') {
        return
      }

      const bbox = selection.bbox
      const requestId = roiRequestId.current + 1
      const roiStartedAt = readTimestamp()
      const roiCellsStartedAt = roiStartedAt
      abortActiveRequest(roiAbortRef)
      clearTimeoutRef(magicLensDebounceRef)
      magicLensLastDetailRef.current = null
      magicLensLastQueryKeyRef.current = null
      abortActiveRequest(magicLensAbortRef)
      magicLensRequestId.current += 1
      const abortController = new AbortController()
      roiRequestId.current = requestId
      roiAbortRef.current = abortController
      setRoiMode('idle')
      setRoiName((current) => current.trim() || defaultRoiName(roiIdRef.current + 1))
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      abortActiveRequest(roiGeneViewportWarmupAbortRef)
      roiGeneViewportWarmupKeyRef.current = null
      setRoiGeneViewportWarmupState({ status: 'idle' })
      setRoiState({ status: 'loading', url: loadState.url, bbox, selection })
      setRoiGeneStatsState({ status: 'idle' })
      setRoiTranscriptExportState({ status: 'idle' })
      setMagicLensState({ status: 'idle' })
      appendDebugEvent(`${roiSelectionLabel(selection)} drawn: ROI cells started`)

      void loadRoiCells(loadState.url, selection, { signal: abortController.signal })
        .then((cells) => {
          if (roiRequestId.current !== requestId) {
            return
          }

          setRoiState({
            status: 'ready',
            url: loadState.url,
            bbox,
            selection,
            cells,
            hitCellLimit: cells.length >= ROI_CELL_EXPORT_LIMIT,
          })
          appendDebugEvent(
            `ROI cells ready: ${cells.length.toLocaleString()}${
              cells.length >= ROI_CELL_EXPORT_LIMIT ? '+' : ''
            } in ${formatElapsed(roiCellsStartedAt)}`,
          )

          if (cells.length === 0) {
            setRoiGeneStatsState({
              status: 'ready',
              url: loadState.url,
              stats: emptyRoiGeneStats(),
            })
            return undefined
          }

          setRoiGeneStatsState({
            status: 'loading',
            url: loadState.url,
            cellCount: cells.length,
          })
          const previewStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI genes preview started: sample ${Math.min(
              cells.length,
              ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            ).toLocaleString()} of ${cells.length.toLocaleString()} cells`,
          )

          return loadRoiGeneStats(loadState.url, cells, {
            signal: abortController.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
          })
            .then((previewStats) => {
              if (roiRequestId.current !== requestId) {
                return
              }

              setRoiGeneStatsState({
                status: 'ready',
                url: loadState.url,
                stats: previewStats,
              })
              appendDebugEvent(
                `ROI genes preview ready: ${previewStats.genes.length.toLocaleString()} genes in ${formatElapsed(
                  previewStartedAt,
                )}`,
              )

              if (cells.length <= ROI_GENE_STATS_PREVIEW_CELL_LIMIT) {
                return undefined
              }

              const refinementStartedAt = readTimestamp()
              appendDebugEvent(
                `ROI genes refinement started: ${cells.length.toLocaleString()} cells`,
              )
              return deferRoiGeneRefinement()
                .then(() => {
                  if (roiRequestId.current !== requestId) {
                    return undefined
                  }

                  return loadRoiGeneStats(loadState.url, cells, {
                    signal: abortController.signal,
                  })
                })
                .then((stats) => {
                  if (roiRequestId.current !== requestId) {
                    return
                  }

                  if (stats === undefined) {
                    return
                  }

                  setRoiGeneStatsState({
                    status: 'ready',
                    url: loadState.url,
                    stats,
                  })
                  appendDebugEvent(
                    `ROI genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
                      refinementStartedAt,
                    )} (total ${formatElapsed(roiStartedAt)})`,
                  )
                })
                .catch((error) => {
                  if (isAbortError(error) || roiRequestId.current !== requestId) {
                    return
                  }

                  appendDebugEvent(
                    `ROI gene refinement failed (${formatElapsed(refinementStartedAt)})`,
                  )
                })
            })
            .catch((error) => {
              if (isAbortError(error) || roiRequestId.current !== requestId) {
                return
              }

              setRoiGeneStatsState({
                status: 'error',
                url: loadState.url,
                error: createStructuredLoadError('ROI genes', error),
              })
              appendDebugEvent(
                `ROI genes unsupported (${formatElapsed(previewStartedAt)})`,
              )
            })
        })
        .catch((error) => {
          if (isAbortError(error) || roiRequestId.current !== requestId) {
            return
          }

          setRoiState({
            status: 'error',
            url: loadState.url,
            bbox,
            selection,
            error: createStructuredLoadError('ROI cells', error),
          })
          setRoiGeneStatsState({ status: 'idle' })
          appendDebugEvent(`ROI cells failed (${formatElapsed(roiCellsStartedAt)})`)
        })
        .finally(() => {
          if (roiAbortRef.current === abortController) {
            roiAbortRef.current = null
          }
        })
    },
    [appendDebugEvent, loadRoiCells, loadRoiGeneStats, loadState],
  )

  useEffect(() => {
    const selection = initialSharedRoiSelectionRef.current

    if (
      selection === null ||
      loadState.status !== 'ready' ||
      roiState.status !== 'idle'
    ) {
      return
    }

    initialSharedRoiSelectionRef.current = null
    setRoiName('Shared ROI')
    handleRoiComplete(selection)
  }, [handleRoiComplete, loadState.status, roiState.status])

  function handleClearRoi() {
    abortActiveRequest(roiAbortRef)
    abortActiveRequest(roiTranscriptExportAbortRef)
    if (magicLensScope === 'roi') {
      abortActiveRequest(magicLensAbortRef)
      magicLensRequestId.current += 1
      setMagicLensState({ status: 'idle' })
    }
    roiRequestId.current += 1
    roiTranscriptExportRequestId.current += 1
    setRoiMode('idle')
    setRoiState({ status: 'idle' })
    setRoiGeneStatsState({ status: 'idle' })
    setRoiTranscriptExportState({ status: 'idle' })
    appendDebugEvent('Cleared ROI')
  }

  function handleSaveRoiAnnotation() {
    if (loadState.status !== 'ready' || roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    const annotation: Annotation = {
      id: `roi:${roiIdRef.current + 1}:${slug(name)}`,
      label: name,
      cellIds: roiState.cells.map((cell) => cell.id),
    }

    roiIdRef.current += 1
    appendDebugEvent(`Saved ROI annotation ${name}`)
    setAnnotationState((current) => ({
      status: 'ready',
      url: loadState.url,
      annotations: [
        annotation,
        ...(current.status === 'ready' ? current.annotations : []),
      ],
    }))
    setAnnotationColors((current) => ({
      ...current,
      [annotation.id]: annotationPaletteColor(Object.keys(current).length),
    }))
    setObservationColorMode('annotations')
    setRoiName(defaultRoiName(roiIdRef.current + 1))
  }

  function handleExportRoiCells() {
    if (roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    downloadTextFile(`${slug(name)}-cells.csv`, roiCellsToCsv(roiState.cells))
    appendDebugEvent(`Exported ROI cells ${name}`)
  }

  function handleExportRoiTranscripts() {
    if (roiState.status !== 'ready') {
      return
    }

    const requestId = roiTranscriptExportRequestId.current + 1
    abortActiveRequest(roiTranscriptExportAbortRef)
    const abortController = new AbortController()
    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    roiTranscriptExportRequestId.current = requestId
    roiTranscriptExportAbortRef.current = abortController
    setRoiTranscriptExportState({ status: 'loading', url: roiState.url })
    appendDebugEvent(`Exporting ROI transcripts ${name}`)

    void loadRoiTranscripts(roiState.url, roiState.selection, {
      signal: abortController.signal,
    })
      .then((transcripts) => {
        if (roiTranscriptExportRequestId.current !== requestId) {
          return
        }

        downloadTextFile(
          `${slug(name)}-transcripts.csv`,
          roiTranscriptsToCsv(transcripts),
        )
        setRoiTranscriptExportState({ status: 'idle' })
        appendDebugEvent(
          `Exported ROI transcripts: ${transcripts.length.toLocaleString()} rows`,
        )
      })
      .catch((error) => {
        if (isAbortError(error) || roiTranscriptExportRequestId.current !== requestId) {
          return
        }

        setRoiTranscriptExportState({
          status: 'error',
          url: roiState.url,
          error: createStructuredLoadError('ROI transcripts', error),
        })
        appendDebugEvent('ROI transcript export failed')
      })
      .finally(() => {
        if (roiTranscriptExportAbortRef.current === abortController) {
          roiTranscriptExportAbortRef.current = null
        }
      })
  }

  function runMagicLensQuery(
    selection: RoiSelectionInput,
    scope: MagicLensScope,
    circleFilter: MagicLensCircleFilter | null = null,
  ) {
    if (loadState.status !== 'ready') {
      return
    }

    const requestId = magicLensRequestId.current + 1
    abortActiveRequest(magicLensAbortRef)
    const abortController = new AbortController()
    magicLensRequestId.current = requestId
    magicLensAbortRef.current = abortController
    setMagicLensState({
      status: 'loading',
      url: loadState.url,
      scope,
    })
    appendDebugEvent(
      `Scanning magic lens ${magicLensScopeLabel(scope)}`,
      scope === 'cursor' ? { coalesceKey: 'magic-lens-cursor-scan' } : {},
    )

    const normalizedSelection = normalizeRoiSelection(selection)

    void loadRoiCells(loadState.url, normalizedSelection, {
      signal: abortController.signal,
      limit: MAGIC_LENS_CELL_LIMIT,
    })
      .then((cells) => {
        if (magicLensRequestId.current !== requestId) {
          return undefined
        }

        const lensCells =
          circleFilter === null ? cells : filterCellsForCircle(cells, circleFilter)

        if (lensCells.length === 0) {
          setMagicLensState({
            status: 'ready',
            url: loadState.url,
            scope,
            summary: summarizeMagicLensCells(
              lensCells,
              emptyRoiGeneStats(),
              selectedGenes,
              {
                hitLimit: cells.length >= MAGIC_LENS_CELL_LIMIT,
              },
            ),
          })
          appendDebugEvent(
            'Magic lens ready: 0 cells',
            scope === 'cursor' ? { coalesceKey: 'magic-lens-cursor-ready' } : {},
          )
          return undefined
        }

        return loadRoiGeneStats(loadState.url, lensCells, {
          signal: abortController.signal,
          cellLimit: MAGIC_LENS_CELL_LIMIT,
          geneLimit: MAGIC_LENS_GENE_STATS_LIMIT,
        }).then((stats) => {
          if (magicLensRequestId.current !== requestId) {
            return
          }

          setMagicLensState({
            status: 'ready',
            url: loadState.url,
            scope,
            summary: summarizeMagicLensCells(lensCells, stats, selectedGenes, {
              hitLimit: cells.length >= MAGIC_LENS_CELL_LIMIT || stats.hitCellLimit,
            }),
          })
          appendDebugEvent(
            `Magic lens ready: ${lensCells.length.toLocaleString()} cells`,
            scope === 'cursor' ? { coalesceKey: 'magic-lens-cursor-ready' } : {},
          )
        })
      })
      .catch((error) => {
        if (isAbortError(error) || magicLensRequestId.current !== requestId) {
          return
        }

        setMagicLensState({
          status: 'error',
          url: loadState.url,
          scope,
          error: createStructuredLoadError('Magic lens', error),
        })
        appendDebugEvent('Magic lens failed')
      })
      .finally(() => {
        if (magicLensAbortRef.current === abortController) {
          magicLensAbortRef.current = null
        }
      })
  }

  function handleRunMagicLens() {
    if (loadState.status !== 'ready') {
      return
    }

    const selection = resolveMagicLensSelection(
      magicLensScope,
      currentViewportDetail,
      activeRoiSelection,
    )

    if (selection === null) {
      appendDebugEvent('Magic lens scope unavailable')
      return
    }

    runMagicLensQuery(selection, magicLensScope)
  }

  function handleMagicLensMove(detail: ViewerMagicLensDetail) {
    if (loadState.status !== 'ready' || magicLensScope !== 'cursor' || !magicLensActive) {
      return
    }

    magicLensLastDetailRef.current = detail
    const queryKey = magicLensDetailQueryKey(detail, magicLensMinQv, selectedGenes)

    if (magicLensLastQueryKeyRef.current === queryKey) {
      return
    }

    clearTimeoutRef(magicLensDebounceRef)

    if (typeof window === 'undefined') {
      magicLensLastQueryKeyRef.current = queryKey
      runMagicLensQuery(detail.bbox, 'cursor', {
        center: detail.center,
        radiusMicrometers: detail.radiusMicrometers,
      })
      return
    }

    magicLensDebounceRef.current = window.setTimeout(() => {
      const latestDetail = magicLensLastDetailRef.current

      if (latestDetail === null) {
        return
      }

      const latestQueryKey = magicLensDetailQueryKey(
        latestDetail,
        magicLensMinQv,
        selectedGenes,
      )
      magicLensLastQueryKeyRef.current = latestQueryKey
      runMagicLensQuery(latestDetail.bbox, 'cursor', {
        center: latestDetail.center,
        radiusMicrometers: latestDetail.radiusMicrometers,
      })
    }, 320)
  }

  function handleMagicLensLeave() {
    clearTimeoutRef(magicLensDebounceRef)
    magicLensLastDetailRef.current = null
    magicLensLastQueryKeyRef.current = null

    if (magicLensScope !== 'cursor') {
      return
    }

    abortActiveRequest(magicLensAbortRef)
    magicLensRequestId.current += 1
    setMagicLensState({ status: 'idle' })
  }

  function updateMorphologyChannel(
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) {
    setMorphologyChannelSettings((current) =>
      current.map((setting) => (setting.id === id ? { ...setting, ...patch } : setting)),
    )
    appendDebugEvent(`${morphologyPatchLabel(patch)} ${shortIdentifier(id)}`, {
      coalesceKey: `morphology-channel:${id}`,
    })
  }

  function handleAutoContrast(channel: MorphologyImageChannel) {
    appendDebugEvent(`Auto contrast ${shortIdentifier(channel.info.id)}`)
    queueAutoContrast([channel])
  }

  function queueAutoContrast(
    channels: readonly MorphologyImageChannel[],
    options: {
      readonly requestId?: number
      readonly signal?: AbortSignal
    } = {},
  ) {
    const requestId = options.requestId ?? loadRequestId.current
    const signal = options.signal ?? datasetAbortRef.current?.signal
    const channelsToLoad: MorphologyImageChannel[] = []

    for (const channel of channels) {
      const channelId = channel.info.id

      if (autoContrastChannelIdsRef.current.has(channelId)) {
        continue
      }

      autoContrastChannelIdsRef.current.add(channelId)
      channelsToLoad.push(channel)
    }

    if (channelsToLoad.length === 0) {
      return
    }

    setAutoContrastChannelIds([...autoContrastChannelIdsRef.current])

    for (const channel of channelsToLoad) {
      startAutoContrast(channel, requestId, signal)
    }
  }

  function startAutoContrast(
    channel: MorphologyImageChannel,
    requestId: number,
    signal: AbortSignal | undefined,
  ) {
    const channelId = channel.info.id
    void computeAutoChannelContrast(channel, signal === undefined ? {} : { signal })
      .then((contrast) => {
        if (loadRequestId.current !== requestId) {
          return
        }

        updateMorphologyChannel(channelId, {
          contrastMin: contrast.min,
          contrastMax: contrast.max,
          histogram: contrast.histogram,
        })
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setMorphologyState({
          status: 'error',
          url: channel.loader.url,
          error: createStructuredLoadError('Image tiles', error),
        })
      })
      .finally(() => {
        if (loadRequestId.current !== requestId) {
          return
        }

        autoContrastChannelIdsRef.current.delete(channelId)
        setAutoContrastChannelIds([...autoContrastChannelIdsRef.current])
      })
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#viewer-heading">
        Skip To Spatial View
      </a>
      <aside
        className={`control-hud${isControlHudCollapsed ? ' is-collapsed' : ''}`}
        aria-label="Dataset controls"
      >
        <div className="hud-top-bar">
          <LoadingIndicator tasks={loadingTasks} />
          <button
            type="button"
            className="hud-toggle"
            aria-controls="control-hud-content"
            aria-expanded={!isControlHudCollapsed}
            onClick={() => {
              const nextCollapsed = !isControlHudCollapsed
              setIsControlHudCollapsed(nextCollapsed)
              appendDebugEvent(nextCollapsed ? 'HUD collapsed' : 'HUD expanded')
            }}
          >
            {isControlHudCollapsed ? 'Show Controls' : 'Hide Controls'}
          </button>
        </div>
        <div
          id="control-hud-content"
          className="control-hud-content"
          hidden={isControlHudCollapsed}
        >
          <div className="hud-tab-list" role="tablist" aria-label="Control categories">
            {CONTROL_HUD_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`hud-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeControlHudTab === tab.id}
                aria-controls={`hud-panel-${tab.id}`}
                aria-busy={loadingTabIds.has(tab.id)}
                className={
                  [
                    activeControlHudTab === tab.id ? 'active' : '',
                    loadingTabIds.has(tab.id) ? 'is-loading' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onClick={() => {
                  setActiveControlHudTab(tab.id)
                  appendDebugEvent(`HUD tab: ${tab.label}`, {
                    coalesceKey: 'hud-tab',
                  })
                }}
              >
                <span>{tab.label}</span>
                {loadingTabIds.has(tab.id) ? (
                  <span className="tab-loading-dot" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>

          <div className="hud-tab-panels">
            <div
              id="hud-panel-dataset"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-dataset"
              hidden={activeControlHudTab !== 'dataset'}
            >
              <form className="dataset-form" onSubmit={handleDatasetSubmit}>
                <label htmlFor={datasetInputId}>Dataset URL</label>
                <input
                  id={datasetInputId}
                  name="datasetUrl"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={datasetUrl}
                  placeholder="https://bucket.example/output…"
                  onChange={(event) => {
                    setDatasetUrl(event.currentTarget.value)
                  }}
                />
                <label className="dataset-toggle" htmlFor={morphologyInputId}>
                  <input
                    id={morphologyInputId}
                    name="loadMorphologyImage"
                    type="checkbox"
                    checked={shouldLoadMorphology}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setShouldLoadMorphology(checked)
                      appendDebugEvent(
                        checked
                          ? 'Morphology image enabled'
                          : 'Morphology image disabled',
                      )
                    }}
                  />
                  <span>Morphology image</span>
                </label>
                <label htmlFor={boundaryLimitInputId}>Boundary limit</label>
                <input
                  id={boundaryLimitInputId}
                  name="boundaryCellLimit"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={MAX_BOUNDARY_VIEWPORT_CELL_LIMIT}
                  step="1"
                  autoComplete="off"
                  value={boundaryCellLimit}
                  onChange={(event) => {
                    const nextLimit = normalizeBoundaryCellLimit(
                      event.currentTarget.valueAsNumber,
                    )
                    setBoundaryCellLimit(nextLimit)
                    appendDebugEvent(`Boundary limit: ${nextLimit.toLocaleString()}`, {
                      coalesceKey: 'boundary-limit',
                    })
                  }}
                />
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Loading…' : 'Load Dataset'}
                </button>
              </form>
              <div className="dataset-action-row">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    diagnosticsState.status === 'loading' || datasetUrl.trim() === ''
                  }
                  onClick={() => {
                    void handleRunDatasetDiagnostics()
                  }}
                >
                  {diagnosticsState.status === 'loading'
                    ? 'Diagnosing...'
                    : 'Diagnose Dataset'}
                </button>
                <button
                  type="button"
                  className="secondary-action icon-action"
                  aria-label="Download diagnostics"
                  title="Download diagnostics"
                  onClick={handleDownloadDiagnostics}
                >
                  <DownloadIcon />
                </button>
              </div>
              <DatasetDiagnosticsPanel state={diagnosticsState} />
              <CellFeatureMatrixCompatibilityNotice
                state={cellFeatureMatrixCapabilityState}
              />

              <ErrorSummary errors={activeErrors} />
              <ActivityLog
                entries={debugLog}
                onClear={() => {
                  setDebugLog([])
                }}
              />
            </div>

            <div
              id="hud-panel-layers"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-layers"
              hidden={activeControlHudTab !== 'layers'}
            >
              <section className="layer-section" aria-labelledby="layer-heading">
                <h2 id="layer-heading">Layer Stack</h2>
                <p>
                  {scaffoldDeckLayerCount} Deck Layer - deck.gl {bundledDeckVersion}
                </p>
                <p>
                  Budget {performanceBudget.profile} -{' '}
                  {performanceBudget.overviewRenderCellLimit.toLocaleString()} cells -{' '}
                  {performanceBudget.maxConcurrentTileRequests} tile requests
                </p>
                <div className="layer-opacity-controls">
                  <div className="layer-opacity-control">
                    <div className="layer-opacity-header">
                      <label htmlFor={imageOpacityInputId}>Image opacity</label>
                      <span>{opacityToPercent(imageLayerOpacity)}%</span>
                    </div>
                    <input
                      id={imageOpacityInputId}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={opacityToPercent(imageLayerOpacity)}
                      aria-valuetext={`${opacityToPercent(imageLayerOpacity)}%`}
                      onChange={(event) => {
                        const nextPercent = event.currentTarget.valueAsNumber
                        setImageLayerOpacity(percentToOpacity(nextPercent))
                        appendDebugEvent(`Image opacity: ${nextPercent}%`, {
                          coalesceKey: 'image-opacity',
                        })
                      }}
                    />
                  </div>
                  <div className="layer-opacity-control">
                    <div className="layer-opacity-header">
                      <label htmlFor={cellFillOpacityInputId}>Cell fill opacity</label>
                      <span>{opacityToPercent(cellFillOpacity)}%</span>
                    </div>
                    <input
                      id={cellFillOpacityInputId}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={opacityToPercent(cellFillOpacity)}
                      aria-valuetext={`${opacityToPercent(cellFillOpacity)}%`}
                      onChange={(event) => {
                        const nextPercent = event.currentTarget.valueAsNumber
                        setCellFillOpacity(percentToOpacity(nextPercent))
                        appendDebugEvent(`Cell fill opacity: ${nextPercent}%`, {
                          coalesceKey: 'cell-fill-opacity',
                        })
                      }}
                    />
                  </div>
                  <div className="layer-opacity-control">
                    <div className="layer-opacity-header">
                      <label htmlFor={cellBoundaryOpacityInputId}>
                        Cell boundary opacity
                      </label>
                      <span>{opacityToPercent(cellBoundaryOpacity)}%</span>
                    </div>
                    <input
                      id={cellBoundaryOpacityInputId}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={opacityToPercent(cellBoundaryOpacity)}
                      aria-valuetext={`${opacityToPercent(cellBoundaryOpacity)}%`}
                      onChange={(event) => {
                        const nextPercent = event.currentTarget.valueAsNumber
                        setCellBoundaryOpacity(percentToOpacity(nextPercent))
                        appendDebugEvent(`Cell boundary opacity: ${nextPercent}%`, {
                          coalesceKey: 'cell-boundary-opacity',
                        })
                      }}
                    />
                  </div>
                </div>
                <div className="coordinate-unit-control">
                  <span id={coordinateUnitInputId}>Mouse coordinates</span>
                  <div
                    className="coordinate-unit-segmented"
                    role="group"
                    aria-labelledby={coordinateUnitInputId}
                  >
                    <button
                      type="button"
                      aria-pressed={coordinateUnit === 'um'}
                      onClick={() => {
                        if (coordinateUnit === 'um') {
                          return
                        }

                        setCoordinateUnit('um')
                        appendDebugEvent('Mouse coordinates: μm', {
                          coalesceKey: 'coordinate-unit',
                        })
                      }}
                    >
                      μm
                    </button>
                    <button
                      type="button"
                      aria-pressed={coordinateUnit === 'px'}
                      onClick={() => {
                        if (coordinateUnit === 'px') {
                          return
                        }

                        setCoordinateUnit('px')
                        appendDebugEvent('Mouse coordinates: px', {
                          coalesceKey: 'coordinate-unit',
                        })
                      }}
                    >
                      px
                    </button>
                  </div>
                </div>
                <MorphologyChannelControls
                  channels={morphologyImage?.channelLoaders ?? []}
                  settings={morphologyChannelSettings}
                  autoContrastChannelIds={autoContrastChannelIds}
                  onAutoContrast={handleAutoContrast}
                  onUpdate={updateMorphologyChannel}
                />
              </section>
            </div>

            <div
              id="hud-panel-genes"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-genes"
              hidden={activeControlHudTab !== 'genes'}
            >
              <section className="analysis-section" aria-labelledby="analysis-heading">
                <div className="section-heading-row">
                  <h2 id="analysis-heading">Analysis</h2>
                  <span
                    className={
                      genePanelState.status === 'loading' ||
                      geneExpressionState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {analysisHeaderCopy}
                  </span>
                </div>

                <label htmlFor={geneSearchInputId}>Gene selection</label>
                <input
                  id={geneSearchInputId}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={geneSearch}
                  disabled={genePanelState.status !== 'ready'}
                  placeholder="Search genes"
                  onChange={(event) => {
                    setGeneSearch(event.currentTarget.value)
                  }}
                />

                {selectedGenes.length === 0 ? null : (
                  <div className="gene-chip-row" aria-label="Selected genes">
                    {selectedGenes.map((gene) => (
                      <button
                        key={gene}
                        type="button"
                        className="gene-chip"
                        onClick={() => {
                          toggleGene(gene)
                        }}
                      >
                        {gene}
                      </button>
                    ))}
                  </div>
                )}

                <div className="gene-option-list" aria-label="Gene options">
                  {filteredGenes.map((gene) => (
                    <button
                      key={gene}
                      type="button"
                      className={selectedGenes.includes(gene) ? 'selected' : undefined}
                      onClick={() => {
                        toggleGene(gene)
                      }}
                    >
                      {gene}
                    </button>
                  ))}
                </div>

                <label htmlFor={geneSetSymbolsInputId}>Gene set symbols</label>
                <textarea
                  id={geneSetSymbolsInputId}
                  className="gene-set-symbols"
                  autoComplete="off"
                  spellCheck={false}
                  rows={3}
                  value={geneSetSymbols}
                  disabled={genePanelState.status !== 'ready'}
                  placeholder="Actb, Gad1, Slc17a7"
                  onChange={(event) => {
                    setGeneSetSymbols(event.currentTarget.value)
                  }}
                />
                <div className="gene-set-actions">
                  <button
                    type="button"
                    disabled={
                      genePanelState.status !== 'ready' || geneSetSymbols.trim() === ''
                    }
                    onClick={applyGeneSetSymbols}
                  >
                    Apply Symbols
                  </button>
                  <button
                    type="button"
                    disabled={selectedGenes.length === 0}
                    onClick={saveSelectedGeneSet}
                  >
                    Save Set
                  </button>
                </div>

                <label htmlFor={geneSetNameInputId}>Set name</label>
                <input
                  id={geneSetNameInputId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={geneSetName}
                  placeholder={defaultGeneSetName(selectedGenes)}
                  onChange={(event) => {
                    setGeneSetName(event.currentTarget.value)
                  }}
                />

                <label htmlFor={geneSetScoreInputId}>Signature score</label>
                <select
                  id={geneSetScoreInputId}
                  value={geneExpressionScoreMode}
                  onChange={(event) => {
                    const nextScoreMode = event.currentTarget.value

                    if (isGeneExpressionScoreMode(nextScoreMode)) {
                      handleGeneExpressionScoreModeChange(nextScoreMode)
                    }
                  }}
                >
                  {GENE_EXPRESSION_SCORE_MODE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

                {savedGeneSets.length === 0 ? null : (
                  <div className="gene-set-list" aria-label="Saved gene sets">
                    {savedGeneSets.map((geneSet) => (
                      <div key={geneSet.id} className="gene-set-row">
                        <button
                          type="button"
                          className="gene-set-apply"
                          aria-label={`Apply ${geneSet.name}`}
                          onClick={() => {
                            applySavedGeneSet(geneSet)
                          }}
                        >
                          <span>{geneSet.name}</span>
                          <small>{geneSet.scoreMode}</small>
                        </button>
                        <button
                          type="button"
                          className="gene-set-remove"
                          aria-label={`Remove ${geneSet.name}`}
                          onClick={() => {
                            removeSavedGeneSet(geneSet.id)
                          }}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label htmlFor={geneScaleInputId}>Gene scale</label>
                <div className="gene-scale-control">
                  <select
                    id={geneScaleInputId}
                    value={geneExpressionColorScale}
                    onChange={(event) => {
                      const nextScale = event.currentTarget.value

                      if (isGeneExpressionColorScale(nextScale)) {
                        setGeneExpressionColorScale(nextScale)
                        appendDebugEvent(`Gene scale: ${nextScale}`)
                      }
                    }}
                  >
                    {GENE_EXPRESSION_COLOR_SCALE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`gene-scale-preview gene-scale-preview-${geneExpressionColorScale}`}
                    aria-hidden="true"
                  />
                  <div className="gene-scale-values" aria-label="Gene scale values">
                    <span>0</span>
                    <span>{formatGeneScaleValue(geneExpressionScaleMax / 2)}</span>
                    <span>{formatGeneScaleValue(geneExpressionScaleMax)}</span>
                  </div>
                </div>

                <label htmlFor={geneExpressionDetailInputId}>Expression detail</label>
                <select
                  id={geneExpressionDetailInputId}
                  value={geneExpressionDetailMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isGeneExpressionDetailMode(nextMode)) {
                      setGeneExpressionDetailMode(nextMode)
                      appendDebugEvent(`Expression detail: ${nextMode}`)
                    }
                  }}
                >
                  <option value="auto">Auto LOD</option>
                  <option value="exact-region">Exact region</option>
                </select>

                <label htmlFor={observationModeInputId}>Cell color</label>
                <select
                  id={observationModeInputId}
                  value={observationColorMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isObservationColorMode(nextMode)) {
                      setObservationColorMode(nextMode)
                      appendDebugEvent(`Cell color: ${nextMode}`)
                    }
                  }}
                >
                  <option value="transcript-count">Transcript count</option>
                  <option value="cell-area">Cell area</option>
                  {annotationStyleColors.length === 0 ? null : (
                    <option value="annotations">Annotations</option>
                  )}
                </select>

                <p className="analysis-status" aria-live="polite">
                  {geneExpressionCopy}
                </p>
              </section>
            </div>

            <div
              id="hud-panel-transcripts"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-transcripts"
              hidden={activeControlHudTab !== 'transcripts'}
            >
              <section
                className="analysis-section transcript-section"
                aria-labelledby="transcript-heading"
              >
                <div className="section-heading-row">
                  <h2 id="transcript-heading">Transcripts</h2>
                  <span
                    className={
                      transcriptCapabilityState.status === 'loading' ||
                      transcriptLayerState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {transcriptCopy}
                  </span>
                </div>

                <label className="dataset-toggle" htmlFor="show-transcripts-overlay">
                  <input
                    id="show-transcripts-overlay"
                    type="checkbox"
                    checked={showTranscriptOverlay}
                    disabled={loadState.status !== 'ready'}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setShowTranscriptOverlay(checked)
                      appendDebugEvent(
                        checked
                          ? 'Transcript overlay enabled'
                          : 'Transcript overlay disabled',
                        { coalesceKey: 'transcript-overlay-toggle' },
                      )
                    }}
                  />
                  <span>Show transcripts</span>
                </label>

                <label htmlFor={transcriptDetailInputId}>Detail</label>
                <select
                  id={transcriptDetailInputId}
                  value={transcriptDetailMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isTranscriptDetailMode(nextMode)) {
                      setTranscriptDetailMode(nextMode)
                      transcriptViewportKeyRef.current = null
                      appendDebugEvent(`Transcript detail: ${nextMode}`, {
                        coalesceKey: 'transcript-detail',
                      })
                    }
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="density">Density</option>
                  <option value="bins">Bins</option>
                  <option value="exact">Exact</option>
                </select>

                <label htmlFor={transcriptPointBudgetInputId}>Exact budget</label>
                <input
                  id={transcriptPointBudgetInputId}
                  type="number"
                  inputMode="numeric"
                  min={MIN_TRANSCRIPT_EXACT_RENDER_LIMIT}
                  max={MAX_TRANSCRIPT_EXACT_RENDER_LIMIT}
                  step="1000"
                  value={transcriptExactPointLimit}
                  onChange={(event) => {
                    const nextLimit = normalizeTranscriptExactPointLimit(
                      event.currentTarget.valueAsNumber,
                    )
                    setTranscriptExactPointLimit(nextLimit)
                    transcriptViewportKeyRef.current = null
                    appendDebugEvent(
                      `Transcript exact budget: ${nextLimit.toLocaleString()}`,
                      {
                        coalesceKey: 'transcript-exact-budget',
                      },
                    )
                  }}
                />

                <label htmlFor={transcriptFeatureFilterInputId}>Feature filter</label>
                <select
                  id={transcriptFeatureFilterInputId}
                  value={transcriptFeatureFilterMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isTranscriptFeatureFilterMode(nextMode)) {
                      setTranscriptFeatureFilterMode(nextMode)
                      transcriptViewportKeyRef.current = null
                      appendDebugEvent(`Transcript feature filter: ${nextMode}`, {
                        coalesceKey: 'transcript-feature-filter',
                      })
                    }
                  }}
                >
                  <option value="selected">Selected genes</option>
                  <option value="all">All features</option>
                </select>

                <label htmlFor={transcriptDensityScaleInputId}>Density color</label>
                <div className="transcript-density-scale-control">
                  <select
                    id={transcriptDensityScaleInputId}
                    value={transcriptDensityColorScale}
                    onChange={(event) => {
                      const nextScale = event.currentTarget.value

                      if (isTranscriptDensityColorScale(nextScale)) {
                        setTranscriptDensityColorScale(nextScale)
                        appendDebugEvent(`Transcript density color: ${nextScale}`, {
                          coalesceKey: 'transcript-density-color',
                        })
                      }
                    }}
                  >
                    {TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`transcript-density-scale-preview transcript-density-scale-preview-${transcriptDensityColorScale}`}
                    aria-hidden="true"
                  />
                </div>

                <label htmlFor={transcriptMinQvInputId}>Min QV</label>
                <input
                  id={transcriptMinQvInputId}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="40"
                  step="1"
                  value={transcriptMinQv}
                  onChange={(event) => {
                    const nextMinQv = normalizeTranscriptMinQv(
                      event.currentTarget.valueAsNumber,
                    )
                    setTranscriptMinQv(nextMinQv)
                    transcriptViewportKeyRef.current = null
                    appendDebugEvent(`Transcript min QV: ${nextMinQv}`, {
                      coalesceKey: 'transcript-min-qv',
                    })
                  }}
                />

                <label className="dataset-toggle" htmlFor="transcript-gene-only">
                  <input
                    id="transcript-gene-only"
                    type="checkbox"
                    checked={transcriptGeneOnly}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setTranscriptGeneOnly(checked)
                      transcriptViewportKeyRef.current = null
                      appendDebugEvent(
                        checked
                          ? 'Transcript gene-only filter enabled'
                          : 'Transcript gene-only filter disabled',
                        { coalesceKey: 'transcript-gene-only' },
                      )
                    }}
                  />
                  <span>Gene-only calls</span>
                </label>

                <div className="layer-opacity-control">
                  <div className="layer-opacity-header">
                    <label htmlFor={transcriptOpacityInputId}>Transcript opacity</label>
                    <span>{opacityToPercent(transcriptOpacity)}%</span>
                  </div>
                  <input
                    id={transcriptOpacityInputId}
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={opacityToPercent(transcriptOpacity)}
                    aria-valuetext={`${opacityToPercent(transcriptOpacity)}%`}
                    onChange={(event) => {
                      const nextPercent = event.currentTarget.valueAsNumber
                      setTranscriptOpacity(percentToOpacity(nextPercent))
                      appendDebugEvent(`Transcript opacity: ${nextPercent}%`, {
                        coalesceKey: 'transcript-opacity',
                      })
                    }}
                  />
                </div>

                <div className="layer-opacity-control">
                  <div className="layer-opacity-header">
                    <label htmlFor={transcriptPointSizeInputId}>Point size</label>
                    <span>{transcriptPointSize}px</span>
                  </div>
                  <input
                    id={transcriptPointSizeInputId}
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    value={transcriptPointSize}
                    aria-valuetext={`${transcriptPointSize}px`}
                    onChange={(event) => {
                      const nextSize = normalizeTranscriptPointSize(
                        event.currentTarget.valueAsNumber,
                      )
                      setTranscriptPointSize(nextSize)
                      appendDebugEvent(`Transcript point size: ${nextSize}px`, {
                        coalesceKey: 'transcript-point-size',
                      })
                    }}
                  />
                </div>

                <TranscriptStatusPanel
                  capabilityState={transcriptCapabilityState}
                  layerState={transcriptLayerState}
                  exactPointLimit={transcriptExactPointLimit}
                  visibleTranscriptEstimate={visibleTranscriptEstimate}
                  hoveredTranscript={hoveredTranscript}
                />
              </section>
            </div>

            <div
              id="hud-panel-magic-lens"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-magic-lens"
              hidden={activeControlHudTab !== 'magic-lens'}
            >
              <section
                className="analysis-section magic-lens-section"
                aria-labelledby="magic-lens-heading"
              >
                <div className="section-heading-row">
                  <h2 id="magic-lens-heading">Magic Lens</h2>
                  <span
                    className={
                      magicLensState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {magicLensCopy}
                  </span>
                </div>

                <div className="magic-lens-scope">
                  <span id={magicLensScopeInputId}>Scope</span>
                  <div
                    className="magic-lens-scope-segmented"
                    role="group"
                    aria-labelledby={magicLensScopeInputId}
                  >
                    <button
                      type="button"
                      aria-pressed={magicLensScope === 'cursor'}
                      onClick={() => {
                        setMagicLensScope('cursor')
                        setMagicLensState({ status: 'idle' })
                        magicLensLastQueryKeyRef.current = null
                        appendDebugEvent('Magic lens scope: cursor', {
                          coalesceKey: 'magic-lens-scope',
                        })
                      }}
                    >
                      Cursor
                    </button>
                    <button
                      type="button"
                      aria-pressed={magicLensScope === 'viewport'}
                      onClick={() => {
                        handleMagicLensLeave()
                        setMagicLensActive(false)
                        setMagicLensScope('viewport')
                        appendDebugEvent('Magic lens scope: viewport', {
                          coalesceKey: 'magic-lens-scope',
                        })
                      }}
                    >
                      Viewport
                    </button>
                    <button
                      type="button"
                      aria-pressed={magicLensScope === 'roi'}
                      disabled={activeRoiSelection === null}
                      onClick={() => {
                        handleMagicLensLeave()
                        setMagicLensActive(false)
                        setMagicLensScope('roi')
                        appendDebugEvent('Magic lens scope: ROI', {
                          coalesceKey: 'magic-lens-scope',
                        })
                      }}
                    >
                      ROI
                    </button>
                  </div>
                </div>

                <label htmlFor={magicLensRadiusInputId}>Radius</label>
                <div className="magic-lens-radius-control">
                  <input
                    id={magicLensRadiusInputId}
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={magicLensRadiusMicrometers}
                    disabled={magicLensScope !== 'cursor'}
                    onChange={(event) => {
                      const nextRadius = normalizeMagicLensRadius(
                        event.currentTarget.valueAsNumber,
                      )
                      setMagicLensRadiusMicrometers(nextRadius)
                      magicLensLastQueryKeyRef.current = null
                      appendDebugEvent(`Magic lens radius: ${nextRadius} um`, {
                        coalesceKey: 'magic-lens-radius',
                      })
                    }}
                  />
                  <output htmlFor={magicLensRadiusInputId}>
                    {magicLensRadiusMicrometers.toLocaleString()} um
                  </output>
                </div>

                <label htmlFor={magicLensMinQvInputId}>Min QV</label>
                <input
                  id={magicLensMinQvInputId}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="40"
                  step="1"
                  value={magicLensMinQv}
                  onChange={(event) => {
                    const nextMinQv = normalizeMagicLensMinQv(
                      event.currentTarget.valueAsNumber,
                    )
                    setMagicLensMinQv(nextMinQv)
                    magicLensLastQueryKeyRef.current = null
                    appendDebugEvent(`Magic lens min QV: ${nextMinQv}`, {
                      coalesceKey: 'magic-lens-min-qv',
                    })
                  }}
                />

                {magicLensScope === 'cursor' ? (
                  <button
                    type="button"
                    className="secondary-action"
                    aria-pressed={magicLensIsCursorActive}
                    disabled={loadState.status !== 'ready'}
                    onClick={() => {
                      const nextActive = !magicLensActive

                      setMagicLensActive(nextActive)

                      if (!nextActive) {
                        handleMagicLensLeave()
                      } else {
                        setMagicLensState({ status: 'idle' })
                        magicLensLastQueryKeyRef.current = null
                        appendDebugEvent('Magic lens enabled')
                      }
                    }}
                  >
                    {magicLensIsCursorActive ? 'Disable Lens' : 'Enable Lens'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!magicLensCanScan}
                    onClick={handleRunMagicLens}
                  >
                    {magicLensState.status === 'loading' ? 'Scanning...' : 'Scan Lens'}
                  </button>
                )}

                <MagicLensPanel state={magicLensState} />
              </section>
            </div>

            <div
              id="hud-panel-annotations"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-annotations"
              hidden={activeControlHudTab !== 'annotations'}
            >
              <section className="analysis-section" aria-labelledby="annotation-heading">
                <div className="section-heading-row">
                  <h2 id="annotation-heading">Annotations</h2>
                  <span
                    className={
                      annotationState.status === 'loading' ||
                      annotationGroupState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {annotationHeaderCopy}
                  </span>
                </div>
                <label htmlFor={annotationGroupInputId}>Annotation set</label>
                <select
                  id={annotationGroupInputId}
                  value={selectedAnnotationGroupId}
                  disabled={loadState.status !== 'ready'}
                  onChange={(event) => {
                    const nextGroupId = event.currentTarget.value
                    setSelectedAnnotationGroupId(nextGroupId)
                    appendDebugEvent(`Annotation set: ${shortIdentifier(nextGroupId)}`)
                  }}
                >
                  <option value={ALL_ANNOTATION_GROUP_ID}>All</option>
                  {annotationGroupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    loadState.status !== 'ready' || annotationState.status === 'loading'
                  }
                  onClick={handleLoadAnnotations}
                >
                  {annotationState.status === 'loading' ? 'Loading…' : 'Load Annotations'}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={annotationState.status !== 'ready'}
                  onClick={handleClearAnnotations}
                >
                  Clear Annotations
                </button>
                <label
                  className="secondary-file-action"
                  htmlFor={annotationImportInputId}
                >
                  Import File
                </label>
                <input
                  id={annotationImportInputId}
                  className="visually-hidden-file"
                  type="file"
                  accept=".csv,.json,application/json,text/csv"
                  disabled={loadState.status !== 'ready'}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null
                    void handleImportAnnotations(file)
                    event.currentTarget.value = ''
                  }}
                />
                {annotationState.status === 'ready' &&
                annotationState.annotations.length > 0 ? (
                  <ul className="annotation-list" aria-label="Loaded annotations">
                    {annotationState.annotations.map((annotation, annotationIndex) => {
                      const annotationColor =
                        annotationColors[annotation.id] ??
                        annotationPaletteColor(annotationIndex)

                      return (
                        <li key={annotation.id}>
                          <label
                            className="annotation-color-picker"
                            style={
                              { '--annotation-color': annotationColor } as CSSProperties
                            }
                          >
                            <input
                              className="annotation-color-input"
                              type="color"
                              aria-label={`${annotation.label} color`}
                              value={annotationColor}
                              onChange={(event) => {
                                handleAnnotationColorChange(
                                  annotation.id,
                                  event.currentTarget.value,
                                )
                              }}
                            />
                            <span
                              className="annotation-color-swatch"
                              aria-hidden="true"
                            />
                          </label>
                          <span>{annotation.label}</span>
                          <small>{annotation.cellIds.length.toLocaleString()}</small>
                          <button
                            type="button"
                            className="annotation-remove"
                            aria-label={`Remove ${annotation.label}`}
                            onClick={() => {
                              handleRemoveAnnotation(annotation.id)
                            }}
                          >
                            x
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </section>
            </div>

            <div
              id="hud-panel-cell"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-cell"
              hidden={activeControlHudTab !== 'cell'}
            >
              <section className="analysis-section" aria-labelledby="embedding-heading">
                <div className="section-heading-row">
                  <h2 id="embedding-heading">UMAP/tSNE</h2>
                  <span
                    className={
                      analysisEmbeddingState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {embeddingCopy}
                  </span>
                </div>
                <div className="embedding-controls">
                  <label htmlFor={embeddingViewInputId}>Embedding view</label>
                  <select
                    id={embeddingViewInputId}
                    value={activeEmbedding?.kind ?? selectedEmbeddingKind}
                    disabled={
                      analysisEmbeddingState.status !== 'ready' ||
                      analysisEmbeddingState.embeddings.length === 0
                    }
                    onChange={(event) => {
                      const nextEmbeddingKind = event.currentTarget
                        .value as AnalysisEmbeddingKind
                      setSelectedEmbeddingKind(nextEmbeddingKind)
                      appendDebugEvent(`Embedding view: ${nextEmbeddingKind}`)
                    }}
                  >
                    {analysisEmbeddingState.status === 'ready' &&
                    analysisEmbeddingState.embeddings.length > 0 ? (
                      analysisEmbeddingState.embeddings.map((embedding) => (
                        <option key={embedding.kind} value={embedding.kind}>
                          {embedding.label}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="umap">UMAP</option>
                        <option value="tsne">t-SNE</option>
                      </>
                    )}
                  </select>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={
                      loadState.status !== 'ready' ||
                      analysisEmbeddingState.status === 'loading'
                    }
                    onClick={handleLoadAnalysisEmbeddings}
                  >
                    {analysisEmbeddingState.status === 'loading'
                      ? 'Loading...'
                      : 'Load Embeddings'}
                  </button>
                </div>
                <EmbeddingPanel
                  embedding={activeEmbedding}
                  roiCellIds={roiCellIds}
                  selectedCellId={selectedCell?.id ?? null}
                  onSelectCell={handleEmbeddingCellSelect}
                />
              </section>

              <section className="analysis-section" aria-labelledby="cell-info-heading">
                <div className="section-heading-row">
                  <h2 id="cell-info-heading">Cell Info</h2>
                  <span
                    className={
                      cellDetailState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {cellDetailCopy}
                  </span>
                </div>
                <CellInfoPanel
                  key={selectedCell?.id ?? 'none'}
                  cell={selectedCell}
                  state={cellDetailState}
                />
              </section>
            </div>

            <div
              id="hud-panel-roi"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-roi"
              hidden={activeControlHudTab !== 'roi'}
            >
              <section className="analysis-section" aria-labelledby="roi-heading">
                <div className="section-heading-row">
                  <h2 id="roi-heading">ROI</h2>
                  <span
                    className={isRoiTabLoading ? 'status-chip is-loading' : 'status-chip'}
                    aria-live="polite"
                  >
                    {roiHeaderCopy}
                  </span>
                </div>
                <div className="roi-action-row">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!canDrawRoi}
                    aria-pressed={roiMode === 'box'}
                    onClick={() => {
                      const nextMode = roiMode === 'box' ? 'idle' : 'box'
                      setRoiMode(nextMode)
                      appendDebugEvent(
                        nextMode === 'box'
                          ? 'ROI draw mode enabled'
                          : 'ROI draw cancelled',
                      )
                    }}
                  >
                    {roiMode === 'box' ? 'Drawing Box' : 'Draw Box'}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!canDrawRoi}
                    aria-pressed={roiMode === 'lasso'}
                    onClick={() => {
                      const nextMode = roiMode === 'lasso' ? 'idle' : 'lasso'
                      setRoiMode(nextMode)
                      appendDebugEvent(
                        nextMode === 'lasso'
                          ? 'ROI lasso mode enabled'
                          : 'ROI draw cancelled',
                      )
                    }}
                  >
                    {roiMode === 'lasso' ? 'Drawing Lasso' : 'Draw Lasso'}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={roiState.status === 'idle'}
                    onClick={handleClearRoi}
                  >
                    Clear
                  </button>
                </div>

                <label htmlFor={roiNameInputId}>ROI name</label>
                <input
                  id={roiNameInputId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={roiName}
                  disabled={loadState.status !== 'ready'}
                  onChange={(event) => {
                    setRoiName(event.currentTarget.value)
                  }}
                />

                {roiSummary === null ? null : (
                  <dl className="roi-summary-list" aria-label="ROI summary">
                    <div>
                      <dt>Cells</dt>
                      <dd>
                        {roiSummary.cellCount.toLocaleString()}
                        {roiState.status === 'ready' && roiState.hitCellLimit ? '+' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Mean transcripts</dt>
                      <dd>{formatNumber(roiSummary.meanTranscriptCount)}</dd>
                    </div>
                    <div>
                      <dt>Mean area</dt>
                      <dd>{formatNumber(roiSummary.meanCellArea)}</dd>
                    </div>
                  </dl>
                )}

                <RoiGeneStatsPanel copy={roiGeneStatsCopy} state={roiGeneStatsState} />

                <div className="roi-action-row">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={roiState.status !== 'ready'}
                    onClick={handleSaveRoiAnnotation}
                  >
                    Save ROI
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={roiState.status !== 'ready'}
                    onClick={handleExportRoiCells}
                  >
                    Export Cells
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={
                      roiState.status !== 'ready' ||
                      roiTranscriptExportState.status === 'loading'
                    }
                    onClick={handleExportRoiTranscripts}
                  >
                    {roiTranscriptExportState.status === 'loading'
                      ? 'Exporting...'
                      : 'Export Transcripts'}
                  </button>
                </div>
                {roiTranscriptExportState.status === 'loading' ? (
                  <p className="roi-gene-status" aria-live="polite">
                    Preparing ROI transcript CSV
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </aside>

      <section className="viewer-region" aria-labelledby="viewer-heading">
        <h2 id="viewer-heading" className="visually-hidden">
          Spatial View
        </h2>

        <ViewerCore
          cells={styledOverviewCells}
          expressionCells={styledGeneExpressionCells}
          boundaries={boundaryLayerData}
          transcriptAggregateBins={transcriptLayerAggregateBins}
          transcriptPoints={transcriptLayerPoints}
          imageLoader={morphologyImage?.loader ?? null}
          imageChannels={morphologyCanvasChannels}
          imageOpacity={imageLayerOpacity}
          cellFillOpacity={cellFillOpacity}
          cellBoundaryOpacity={cellBoundaryOpacity}
          transcriptOpacity={transcriptOpacity}
          transcriptPointSize={transcriptPointSize}
          observationColorMode={viewerObservationColorMode}
          annotationStyleColors={activeAnnotationStyleColors}
          coordinateUnit={coordinateUnit}
          status={loadState.status}
          imageStatus={morphologyState.status}
          boundaryStatus={boundaryState.status}
          overviewRenderCellLimit={performanceBudget.overviewRenderCellLimit}
          maxConcurrentTileRequests={performanceBudget.maxConcurrentTileRequests}
          tileCacheMaxTiles={performanceBudget.tileCacheMaxTiles}
          roiMode={roiMode}
          roiSelection={activeRoiSelection}
          magicLensActive={magicLensIsCursorActive}
          magicLensRadiusMicrometers={magicLensRadiusMicrometers}
          magicLensStatus={magicLensViewerStatus}
          magicLensSummary={magicLensViewerSummary}
          onImageTileError={handleImageTileError}
          onTileCacheEviction={handleTileCacheEviction}
          onViewportCellCountChange={setViewportCellCount}
          onViewportChange={handleViewportChange}
          onRoiComplete={handleRoiComplete}
          onTranscriptHover={setHoveredTranscript}
          onMagicLensMove={handleMagicLensMove}
          onMagicLensLeave={handleMagicLensLeave}
          onCellClick={(cell) => {
            setSelectedCell(cell)
          }}
          {...(initialShareableState.viewState === undefined
            ? {}
            : { initialViewStateOverride: initialShareableState.viewState })}
          {...(loadState.status === 'error'
            ? { errorMessage: formatStructuredError(loadState.error) }
            : {})}
          {...(morphologyState.status === 'error'
            ? { imageErrorMessage: formatStructuredError(morphologyState.error) }
            : {})}
          {...(morphologyMicrometersPerPixel === undefined
            ? {}
            : {
                micrometersPerPixel: morphologyMicrometersPerPixel,
              })}
          {...(boundaryState.status === 'error'
            ? { boundaryErrorMessage: formatStructuredError(boundaryState.error) }
            : {})}
        />
      </section>
    </main>
  )
}

async function defaultComputeAutoChannelContrast(
  channel: MorphologyImageChannel,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ChannelAutoContrast> {
  const morphologyContrast = await import('./data/morphologyContrast')
  return morphologyContrast.computeChannelAutoContrast(channel.loader, options)
}

function genePanelStatusCopy(genePanelState: GenePanelState): string {
  if (genePanelState.status === 'loading') {
    return 'Loading'
  }

  if (genePanelState.status === 'ready') {
    return `${genePanelState.genes.length.toLocaleString()} genes`
  }

  if (genePanelState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function annotationStatusCopy(annotationState: AnnotationState): string {
  if (annotationState.status === 'loading') {
    return 'Loading'
  }

  if (annotationState.status === 'ready') {
    const noun = annotationState.annotations.length === 1 ? 'label' : 'labels'
    return `${annotationState.annotations.length.toLocaleString()} ${noun}`
  }

  if (annotationState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function analysisEmbeddingStatusCopy(
  state: AnalysisEmbeddingState,
  activeEmbedding: AnalysisEmbedding | null,
  roiCellIds: readonly string[],
  selectedCell: OverviewCellDatum | null,
): string {
  if (state.status === 'loading') {
    return 'Loading'
  }

  if (state.status === 'ready') {
    if (activeEmbedding === null) {
      return 'No projection'
    }

    const linkedCount = roiCellIds.length + (selectedCell === null ? 0 : 1)

    return linkedCount === 0
      ? `${activeEmbedding.label}: ${activeEmbedding.points.length.toLocaleString()} cells`
      : `${activeEmbedding.label}: ${linkedCount.toLocaleString()} linked`
  }

  if (state.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function cellDetailStatusCopy(
  state: CellDetailState,
  selectedCell: OverviewCellDatum | null,
): string {
  if (selectedCell === null) {
    return 'No selection'
  }

  if (state.status === 'loading' && state.cellId === selectedCell.id) {
    return 'Loading'
  }

  if (state.status === 'ready' && state.cellId === selectedCell.id) {
    const noun = state.expression.genes.length === 1 ? 'gene' : 'genes'
    return `${state.expression.genes.length.toLocaleString()} ${noun}`
  }

  if (state.status === 'error' && state.cellId === selectedCell.id) {
    return state.error.title
  }

  return 'Selected'
}

function roiStatusCopy(roiState: RoiState, roiMode: RoiDrawMode): string {
  if (roiMode === 'box') {
    return 'Drawing box'
  }

  if (roiMode === 'lasso') {
    return 'Drawing lasso'
  }

  if (roiState.status === 'loading') {
    return 'Loading'
  }

  if (roiState.status === 'ready') {
    const noun = roiState.cells.length === 1 ? 'cell' : 'cells'
    return `${roiState.cells.length.toLocaleString()}${roiState.hitCellLimit ? '+' : ''} ${noun}`
  }

  if (roiState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function roiSelectionLabel(selection: RoiSelection): string {
  return selection.kind === 'lasso' ? 'ROI lasso' : 'ROI box'
}

function roiGeneStatsStatusCopy(roiGeneStatsState: RoiGeneStatsState): string {
  if (roiGeneStatsState.status === 'loading') {
    return `Genes loading for ${roiGeneStatsState.cellCount.toLocaleString()} cells`
  }

  if (roiGeneStatsState.status === 'ready') {
    if (roiGeneStatsState.stats.genes.length === 0) {
      return 'Genes: none'
    }

    return `Genes: top ${roiGeneStatsState.stats.genes.length}`
  }

  if (roiGeneStatsState.status === 'error') {
    return roiGeneStatsState.error.title
  }

  return 'Genes idle'
}

function transcriptStatusCopy(
  capabilityState: TranscriptCapabilityState,
  layerState: TranscriptLayerState,
  isEnabled: boolean,
): string {
  if (!isEnabled) {
    return 'Off'
  }

  if (capabilityState.status === 'loading') {
    return 'Checking'
  }

  if (layerState.status === 'loading') {
    return 'Loading'
  }

  if (layerState.status === 'ready') {
    return `${layerState.points.length.toLocaleString()} points`
  }

  if (layerState.status === 'aggregate') {
    return `${layerState.bins.length.toLocaleString()} bins`
  }

  if (layerState.status === 'waiting') {
    return 'Waiting'
  }

  if (layerState.status === 'unavailable' || layerState.status === 'error') {
    return 'Unavailable'
  }

  if (capabilityState.status === 'ready') {
    return transcriptCapabilityLabel(capabilityState.capabilities)
  }

  return 'Idle'
}

function transcriptPointsForRendering(
  layerState: TranscriptLayerState,
): readonly TranscriptPoint[] {
  if (layerState.status === 'ready') {
    return layerState.points
  }

  if (layerState.status === 'loading' && layerState.previousLayer?.kind === 'exact') {
    return layerState.previousLayer.points
  }

  return EMPTY_TRANSCRIPT_POINTS
}

function transcriptAggregateBinsForRendering(
  layerState: TranscriptLayerState,
): readonly TranscriptAggregateBin[] {
  if (layerState.status === 'aggregate') {
    return layerState.bins
  }

  if (layerState.status === 'loading' && layerState.previousLayer?.kind === 'aggregate') {
    return layerState.previousLayer.bins
  }

  return EMPTY_TRANSCRIPT_AGGREGATE_BINS
}

function retainedTranscriptLayerState(
  layerState: TranscriptLayerState,
): TranscriptRetainedLayerState | undefined {
  if (layerState.status === 'ready') {
    return {
      kind: 'exact',
      points: layerState.points,
    }
  }

  if (layerState.status === 'aggregate') {
    return {
      kind: 'aggregate',
      bins: layerState.bins,
    }
  }

  if (layerState.status === 'loading') {
    return layerState.previousLayer
  }

  return undefined
}

function transcriptCapabilityLabel(capabilities: TranscriptCapabilities): string {
  if (capabilities.nativeZarr && capabilities.rawParquet) {
    return 'Native LOD + exact'
  }

  if (capabilities.nativeZarr) {
    return 'Native LOD'
  }

  if (capabilities.rawParquet) {
    return 'Exact only'
  }

  return 'No transcripts'
}

function isObservationColorMode(value: string): value is ObservationColorMode {
  return value === 'transcript-count' || value === 'cell-area' || value === 'annotations'
}

function isTranscriptDetailMode(value: string): value is TranscriptDetailMode {
  return value === 'auto' || value === 'density' || value === 'bins' || value === 'exact'
}

function isTranscriptFeatureFilterMode(
  value: string,
): value is TranscriptFeatureFilterMode {
  return value === 'all' || value === 'selected'
}

function readShareableStateFromLocation(): ShareableState {
  return typeof window === 'undefined' ? {} : parseShareableState(window.location.hash)
}

function parseControlHudTab(value: string | undefined): ControlHudTab | undefined {
  return CONTROL_HUD_TABS.some((tab) => tab.id === value)
    ? (value as ControlHudTab)
    : undefined
}

function parseViewerCoordinateUnit(
  value: string | undefined,
): ViewerCoordinateUnit | undefined {
  return value === 'um' || value === 'px' ? value : undefined
}

function parseGeneExpressionColorScale(
  value: string | undefined,
): GeneExpressionColorScale | undefined {
  return value !== undefined && isGeneExpressionColorScale(value) ? value : undefined
}

function parseGeneExpressionScoreMode(
  value: string | undefined,
): GeneExpressionScoreMode | undefined {
  return value !== undefined && isGeneExpressionScoreMode(value) ? value : undefined
}

function parseTranscriptDensityColorScale(
  value: string | undefined,
): TranscriptDensityColorScale | undefined {
  return value !== undefined && isTranscriptDensityColorScale(value) ? value : undefined
}

function parseGeneExpressionDetailMode(
  value: string | undefined,
): GeneExpressionDetailMode | undefined {
  return value !== undefined && isGeneExpressionDetailMode(value) ? value : undefined
}

function parseObservationColorMode(
  value: string | undefined,
): ObservationColorMode | undefined {
  return value !== undefined && isObservationColorMode(value) ? value : undefined
}

function parseTranscriptDetailMode(
  value: string | undefined,
): TranscriptDetailMode | undefined {
  return value !== undefined && isTranscriptDetailMode(value) ? value : undefined
}

function parseTranscriptFeatureFilterMode(
  value: string | undefined,
): TranscriptFeatureFilterMode | undefined {
  return value !== undefined && isTranscriptFeatureFilterMode(value) ? value : undefined
}

function hasReadyAnnotationsAfterRemove(
  annotationState: AnnotationState,
  annotationId: string,
): boolean {
  return (
    annotationState.status === 'ready' &&
    annotationState.annotations.some((annotation) => annotation.id !== annotationId)
  )
}

function geneExpressionStatusCopy(geneExpressionState: GeneExpressionState): string {
  if (geneExpressionState.status === 'loading') {
    return `${geneExpressionModeLabel(geneExpressionState.mode)}: ${geneExpressionState.genes.join(', ')}`
  }

  if (geneExpressionState.status === 'ready') {
    const noun = geneExpressionState.cellCount === 1 ? 'cell' : 'cells'

    if (geneExpressionState.mode === 'exact-region') {
      return `Expression exact region: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
    }

    if (geneExpressionState.mode === 'overview-sampled') {
      return `Expression overview: ${geneExpressionState.cellCount.toLocaleString()} positive ${noun} across ${geneExpressionState.visibleCellCount.toLocaleString()} slide cells`
    }

    if (
      geneExpressionState.mode === 'sampled' &&
      geneExpressionState.visibleCellCount > geneExpressionState.cellCount
    ) {
      const visibleNoun = geneExpressionState.visibleCellCount === 1 ? 'cell' : 'cells'

      return `Expression sample: ${geneExpressionState.cellCount.toLocaleString()} of ${geneExpressionState.visibleCellCount.toLocaleString()} visible ${visibleNoun}`
    }

    return `Expression: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
  }

  if (geneExpressionState.status === 'waiting') {
    return geneExpressionState.message
  }

  if (geneExpressionState.status === 'error') {
    return `Expression failed - ${geneExpressionState.error.title}`
  }

  return 'Expression: none'
}

function geneExpressionModeLabel(mode: GeneExpressionLoadMode): string {
  if (mode === 'overview-sampled') {
    return 'Expression overview'
  }

  if (mode === 'sampled') {
    return 'Expression sample'
  }

  if (mode === 'exact-region') {
    return 'Expression exact region'
  }

  return 'Expression'
}

function isGeneExpressionDetailMode(value: string): value is GeneExpressionDetailMode {
  return value === 'auto' || value === 'exact-region'
}

function geneExpressionScaleKeyFor(
  datasetUrl: string,
  scoreMode: GeneExpressionScoreMode,
  genes: readonly string[],
): string {
  return [datasetUrl, scoreMode, genes.join('|')].join('::')
}

function overviewCellsToBbox(cells: readonly OverviewCellDatum[]): BBox | null {
  if (cells.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY

    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function estimateVisibleTranscriptsFromCells(
  cells: readonly OverviewCellDatum[],
  bbox: BBox,
): number {
  let transcriptCount = 0

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY

    if (x < bbox.minX || x > bbox.maxX || rawY < bbox.minY || rawY > bbox.maxY) {
      continue
    }

    transcriptCount += cell.transcriptCount ?? 0
  }

  return Math.max(0, Math.floor(transcriptCount))
}

function buildCellSummaryTranscriptBins(
  cells: readonly OverviewCellDatum[],
  bbox: BBox,
  mode: 'density' | 'bins',
): readonly TranscriptAggregateBin[] {
  const width = Math.max(1, bbox.maxX - bbox.minX)
  const height = Math.max(1, bbox.maxY - bbox.minY)
  const targetAxisBins = mode === 'bins' ? 44 : 72
  const minBinSize = mode === 'bins' ? 24 : 10
  const binSize = Math.max(minBinSize, Math.max(width, height) / targetAxisBins)
  const radiusMicrometers = Math.max(3, Math.min(90, binSize * 0.45))
  const level = Math.max(0, Math.floor(Math.log2(Math.max(1, binSize / 10))))
  const bins = new Map<
    string,
    {
      readonly binX: number
      readonly binY: number
      count: number
    }
  >()

  for (const cell of cells) {
    const transcriptCount = cell.transcriptCount ?? 0

    if (transcriptCount <= 0) {
      continue
    }

    const [x = 0, deckY = 0] = cell.position
    const y = -deckY

    if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) {
      continue
    }

    const binX = Math.floor((x - bbox.minX) / binSize)
    const binY = Math.floor((y - bbox.minY) / binSize)
    const key = `${binX}:${binY}`
    const existing = bins.get(key)

    if (existing === undefined) {
      bins.set(key, { binX, binY, count: transcriptCount })
    } else {
      existing.count += transcriptCount
    }
  }

  return [...bins.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4_096)
    .map((bin) => {
      const centerX = bbox.minX + (bin.binX + 0.5) * binSize
      const centerY = bbox.minY + (bin.binY + 0.5) * binSize

      return {
        id: `cell-summary:${mode}:${level}:${bin.binX}:${bin.binY}`,
        source: 'cell-summary',
        level,
        binX: bin.binX,
        binY: bin.binY,
        position: {
          x: micrometers(centerX),
          y: micrometers(centerY),
        },
        radiusMicrometers,
        binSizeMicrometers: binSize,
        count: Math.floor(bin.count),
      }
    })
}

function transcriptNativeAggregateMessage({
  mode,
  selectedFeatureCount,
  binCount,
}: {
  readonly mode: 'density' | 'bins'
  readonly selectedFeatureCount: number
  readonly binCount: number
}): string {
  const modeLabel = mode === 'bins' ? 'binned' : 'density'
  const featureLabel =
    selectedFeatureCount > 0
      ? `${selectedFeatureCount.toLocaleString()} selected-feature`
      : 'all-transcript'

  return `Showing native ${featureLabel} ${modeLabel} bins from transcripts.zarr.zip (${binCount.toLocaleString()} bins).`
}

function transcriptAggregateFallbackMessage({
  mode,
  featureFilterMode,
  selectedFeatureCount,
}: {
  readonly mode: 'density' | 'bins'
  readonly featureFilterMode: TranscriptFeatureFilterMode
  readonly selectedFeatureCount: number
}): string {
  const modeLabel = mode === 'bins' ? 'binned' : 'density'
  const filterNote =
    featureFilterMode === 'selected' && selectedFeatureCount > 0
      ? ' Selected-gene isolation needs the native transcript LOD reader.'
      : ''

  return `Showing all-gene cell-summary ${modeLabel} bins for this viewport. Min QV and gene-only filters need exact points or native transcript LOD.${filterNote}`
}

function filterGeneOptions(
  genes: readonly string[],
  search: string,
  selectedGenes: readonly string[],
): readonly string[] {
  const normalizedSearch = search.trim().toLowerCase()
  const selected = new Set(selectedGenes)
  const matches: string[] = []

  for (const gene of genes) {
    if (selected.has(gene)) {
      continue
    }

    if (normalizedSearch.length === 0 || gene.toLowerCase().includes(normalizedSearch)) {
      matches.push(gene)
    }

    if (matches.length >= 24) {
      break
    }
  }

  return matches
}

function parseGeneSetSymbols(
  value: string,
  availableGenes: readonly string[],
): readonly string[] {
  if (value.trim().length === 0 || availableGenes.length === 0) {
    return []
  }

  const availableGenesByNormalizedName = new Map<string, string>()

  for (const gene of availableGenes) {
    availableGenesByNormalizedName.set(gene.toLowerCase(), gene)
  }

  const selectedGenes = new Set<string>()
  const parsedGenes: string[] = []

  for (const symbol of value.split(GENE_SET_SYMBOL_SPLIT_PATTERN)) {
    const normalizedSymbol = symbol.trim().toLowerCase()

    if (normalizedSymbol.length === 0) {
      continue
    }

    const gene = availableGenesByNormalizedName.get(normalizedSymbol)

    if (gene === undefined || selectedGenes.has(gene)) {
      continue
    }

    selectedGenes.add(gene)
    parsedGenes.push(gene)
  }

  return parsedGenes.sort((left, right) => left.localeCompare(right))
}

function mergeImportedAnnotations(
  currentAnnotations: readonly Annotation[],
  importedAnnotations: readonly Annotation[],
  importedPrefix: string,
): readonly Annotation[] {
  return [
    ...currentAnnotations.filter(
      (annotation) => !annotation.id.startsWith(importedPrefix),
    ),
    ...importedAnnotations,
  ]
}

function colorsForAnnotations(
  annotations: readonly Annotation[],
  currentColors: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const nextColors: Record<string, string> = { ...currentColors }
  let colorIndex = Object.keys(nextColors).length

  for (const annotation of annotations) {
    if (nextColors[annotation.id] !== undefined) {
      continue
    }

    nextColors[annotation.id] = annotationPaletteColor(colorIndex)
    colorIndex += 1
  }

  return nextColors
}

function removeAnnotationColor(
  colors: Readonly<Record<string, string>>,
  annotationId: string,
): Readonly<Record<string, string>> {
  const remainingColors: Record<string, string> = {}

  for (const [candidateId, color] of Object.entries(colors)) {
    if (candidateId !== annotationId) {
      remainingColors[candidateId] = color
    }
  }

  return remainingColors
}

function removeAnnotationColorsByPrefix(
  colors: Readonly<Record<string, string>>,
  prefix: string,
): Readonly<Record<string, string>> {
  const remainingColors: Record<string, string> = {}

  for (const [annotationId, color] of Object.entries(colors)) {
    if (!annotationId.startsWith(prefix)) {
      remainingColors[annotationId] = color
    }
  }

  return remainingColors
}

function customAnnotationFilePrefix(fileName: string): string {
  return `custom:${slug(fileName)}:`
}

function slug(value: string): string {
  const slugged = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slugged.length === 0 ? 'annotation' : slugged
}

function defaultGeneSetName(genes: readonly string[]): string {
  if (genes.length === 0) {
    return 'Selected genes'
  }

  if (genes.length <= 3) {
    return genes.join(', ')
  }

  return `${genes.slice(0, 3).join(', ')} +${genes.length - 3}`
}

const EMBEDDING_RENDER_POINT_LIMIT = 120_000
const EMBEDDING_PLOT_FALLBACK_WIDTH = 320
const EMBEDDING_PLOT_FALLBACK_HEIGHT = 190
const EMBEDDING_PLOT_PADDING = 12

interface EmbeddingBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

function EmbeddingPanel({
  embedding,
  roiCellIds,
  selectedCellId,
  onSelectCell,
}: {
  readonly embedding: AnalysisEmbedding | null
  readonly roiCellIds: readonly string[]
  readonly selectedCellId: string | null
  readonly onSelectCell: (cellId: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampledPoints = useMemo(
    () =>
      embedding === null
        ? []
        : sampleEmbeddingPoints(embedding.points, EMBEDDING_RENDER_POINT_LIMIT),
    [embedding],
  )
  const bounds = useMemo(
    () => (embedding === null ? null : embeddingBounds(embedding.points)),
    [embedding],
  )
  const pointByCellId = useMemo(
    () =>
      embedding === null
        ? new Map<string, AnalysisEmbeddingPoint>()
        : mapEmbeddingPoints(embedding.points),
    [embedding],
  )
  const roiPoints = useMemo(
    () =>
      roiCellIds.flatMap((cellId) => {
        const point = pointByCellId.get(cellId)

        return point === undefined ? [] : [point]
      }),
    [pointByCellId, roiCellIds],
  )
  const selectedPoint =
    selectedCellId === null ? undefined : pointByCellId.get(selectedCellId)

  useEffect(() => {
    if (embedding === null || bounds === null) {
      return
    }

    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(
      1,
      Math.round(rect.width || canvas.clientWidth || EMBEDDING_PLOT_FALLBACK_WIDTH),
    )
    const height = Math.max(
      1,
      Math.round(rect.height || canvas.clientHeight || EMBEDDING_PLOT_FALLBACK_HEIGHT),
    )
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1)

    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    drawEmbeddingPlot(context, width, height, bounds, {
      basePoints: sampledPoints,
      roiPoints,
      selectedPoint,
    })
  }, [bounds, embedding, roiPoints, sampledPoints, selectedPoint])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (embedding === null || bounds === null) {
        return
      }

      const canvas = canvasRef.current

      if (canvas === null) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const width = rect.width || canvas.clientWidth || EMBEDDING_PLOT_FALLBACK_WIDTH
      const height = rect.height || canvas.clientHeight || EMBEDDING_PLOT_FALLBACK_HEIGHT
      const point = nearestEmbeddingPoint(
        embedding.points,
        bounds,
        event.clientX - rect.left,
        event.clientY - rect.top,
        width,
        height,
      )

      if (point !== null) {
        onSelectCell(point.id)
      }
    },
    [bounds, embedding, onSelectCell],
  )

  if (embedding === null) {
    return <p className="embedding-empty">No embedding loaded</p>
  }

  return (
    <div className="embedding-panel">
      <div className="embedding-plot-shell">
        <canvas
          ref={canvasRef}
          className="embedding-plot"
          role="img"
          aria-label={`${embedding.label} embedding, ${embedding.points.length.toLocaleString()} cells`}
          onPointerDown={handlePointerDown}
        />
      </div>
      <dl className="embedding-summary" aria-label="Embedding link summary">
        <div>
          <dt>Cells</dt>
          <dd>{embedding.points.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Shown</dt>
          <dd>{sampledPoints.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>ROI</dt>
          <dd>{roiPoints.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{selectedPoint === undefined ? '0' : '1'}</dd>
        </div>
      </dl>
    </div>
  )
}

function sampleEmbeddingPoints(
  points: readonly AnalysisEmbeddingPoint[],
  limit: number,
): readonly AnalysisEmbeddingPoint[] {
  if (points.length <= limit) {
    return points
  }

  const sampledPoints: AnalysisEmbeddingPoint[] = []
  const step = points.length / limit

  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.floor((index + 0.5) * step)]

    if (point !== undefined) {
      sampledPoints.push(point)
    }
  }

  return sampledPoints
}

function mapEmbeddingPoints(
  points: readonly AnalysisEmbeddingPoint[],
): ReadonlyMap<string, AnalysisEmbeddingPoint> {
  const pointByCellId = new Map<string, AnalysisEmbeddingPoint>()

  for (const point of points) {
    pointByCellId.set(point.id, point)
  }

  return pointByCellId
}

function embeddingBounds(points: readonly AnalysisEmbeddingPoint[]): EmbeddingBounds {
  if (points.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
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

  if (minX === maxX) {
    minX -= 0.5
    maxX += 0.5
  }

  if (minY === maxY) {
    minY -= 0.5
    maxY += 0.5
  }

  return { minX, maxX, minY, maxY }
}

function drawEmbeddingPlot(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: EmbeddingBounds,
  layers: {
    readonly basePoints: readonly AnalysisEmbeddingPoint[]
    readonly roiPoints: readonly AnalysisEmbeddingPoint[]
    readonly selectedPoint: AnalysisEmbeddingPoint | undefined
  },
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#171511'
  context.fillRect(0, 0, width, height)

  context.fillStyle = 'rgba(246, 242, 232, 0.28)'
  for (const point of layers.basePoints) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    context.fillRect(x, y, 1.2, 1.2)
  }

  context.fillStyle = 'rgba(240, 200, 75, 0.92)'
  for (const point of layers.roiPoints) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    context.beginPath()
    context.arc(x, y, 2.4, 0, Math.PI * 2)
    context.fill()
  }

  if (layers.selectedPoint !== undefined) {
    const [x, y] = embeddingPointToScreen(layers.selectedPoint, bounds, width, height)
    context.beginPath()
    context.arc(x, y, 4.4, 0, Math.PI * 2)
    context.fillStyle = 'rgba(215, 63, 124, 0.98)'
    context.fill()
    context.lineWidth = 1.5
    context.strokeStyle = 'rgba(255, 253, 247, 0.92)'
    context.stroke()
  }
}

function nearestEmbeddingPoint(
  points: readonly AnalysisEmbeddingPoint[],
  bounds: EmbeddingBounds,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): AnalysisEmbeddingPoint | null {
  let nearestPoint: AnalysisEmbeddingPoint | null = null
  let nearestDistanceSquared = 9 * 9

  for (const point of points) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    const dx = x - screenX
    const dy = y - screenY
    const distanceSquared = dx * dx + dy * dy

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared
      nearestPoint = point
    }
  }

  return nearestPoint
}

function embeddingPointToScreen(
  point: AnalysisEmbeddingPoint,
  bounds: EmbeddingBounds,
  width: number,
  height: number,
): readonly [number, number] {
  const plotWidth = Math.max(1, width - EMBEDDING_PLOT_PADDING * 2)
  const plotHeight = Math.max(1, height - EMBEDDING_PLOT_PADDING * 2)
  const xRatio = (point.x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX)
  const yRatio = (point.y - bounds.minY) / Math.max(1e-9, bounds.maxY - bounds.minY)

  return [
    EMBEDDING_PLOT_PADDING + xRatio * plotWidth,
    EMBEDDING_PLOT_PADDING + (1 - yRatio) * plotHeight,
  ]
}

function CellInfoPanel({
  cell,
  state,
}: {
  readonly cell: OverviewCellDatum | null
  readonly state: CellDetailState
}) {
  const geneSearchInputId = useId()
  const [geneSearch, setGeneSearch] = useState('')
  const readyState =
    cell !== null && state.status === 'ready' && state.cellId === cell.id ? state : null
  const loadingState =
    cell !== null && state.status === 'loading' && state.cellId === cell.id ? state : null
  const errorState =
    cell !== null && state.status === 'error' && state.cellId === cell.id ? state : null
  const shape =
    readyState === null || cell === null
      ? cell === null
        ? null
        : summarizeCellShape(cell, null)
      : readyState.shape
  const expression = readyState?.expression ?? null
  const filteredGenes = useMemo(
    () =>
      expression === null ? [] : filterCellExpressionGenes(expression.genes, geneSearch),
    [expression, geneSearch],
  )
  const maxExpressionCount =
    expression?.genes.reduce((max, gene) => Math.max(max, gene.count), 0) ?? 0

  if (cell === null) {
    return <p className="cell-info-empty">No cell selected</p>
  }

  return (
    <div className="cell-detail-panel">
      <dl className="cell-info-list">
        <div>
          <dt>ID</dt>
          <dd>{cell.id}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {formatNumber(cell.position[0])}, {formatNumber(-(cell.position[1] ?? 0))}
          </dd>
        </div>
        <div>
          <dt>Transcripts</dt>
          <dd>{formatOptionalNumber(cell.transcriptCount)}</dd>
        </div>
        <div>
          <dt>Cell Area</dt>
          <dd>{formatMetric(shape?.areaMicrometersSquared, 'um2')}</dd>
        </div>
        <div>
          <dt>Diameter</dt>
          <dd>{formatMetric(shape?.equivalentDiameterMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Eccentricity</dt>
          <dd>{formatMetric(shape?.eccentricity)}</dd>
        </div>
        <div>
          <dt>Major Axis</dt>
          <dd>{formatMetric(shape?.majorAxisMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Minor Axis</dt>
          <dd>{formatMetric(shape?.minorAxisMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Perimeter</dt>
          <dd>{formatMetric(shape?.perimeterMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Circularity</dt>
          <dd>{formatMetric(shape?.circularity)}</dd>
        </div>
      </dl>

      <div className="cell-expression-panel">
        <div className="cell-expression-heading">
          <span>Gene expression</span>
          <small>
            {expression === null
              ? loadingState === null
                ? 'Waiting'
                : 'Loading'
              : `${expression.totalCount.toLocaleString()} counts`}
          </small>
        </div>

        {loadingState === null ? null : (
          <p className="cell-expression-status" aria-live="polite">
            Loading full cell expression
          </p>
        )}

        {errorState === null ? null : (
          <p className="cell-expression-status is-error" aria-live="polite">
            {formatStructuredError(errorState.error)}
          </p>
        )}

        {expression === null ? null : (
          <>
            <label className="cell-expression-filter" htmlFor={geneSearchInputId}>
              Gene filter
            </label>
            <input
              id={geneSearchInputId}
              className="cell-expression-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={geneSearch}
              placeholder="Search expressed genes"
              onChange={(event) => {
                setGeneSearch(event.currentTarget.value)
              }}
            />
            {expression.genes.length === 0 ? (
              <p className="cell-expression-status">No expressed genes found</p>
            ) : filteredGenes.length === 0 ? (
              <p className="cell-expression-status">No matching genes</p>
            ) : (
              <ol className="cell-expression-list" aria-label="Cell gene expression">
                {filteredGenes.map((gene) => (
                  <li
                    key={gene.gene}
                    style={
                      {
                        '--cell-gene-width': `${expressionBarWidth(
                          gene.count,
                          maxExpressionCount,
                        )}%`,
                      } as CSSProperties
                    }
                  >
                    <div className="cell-expression-row">
                      <span>{gene.gene}</span>
                      <strong>{gene.count.toLocaleString()}</strong>
                    </div>
                    <div className="cell-expression-bar" aria-hidden="true" />
                    <small>{formatPercent(gene.percentTotal)} total</small>
                  </li>
                ))}
              </ol>
            )}
            {expression.hitGeneLimit ? (
              <p className="cell-expression-status">
                Showing first {CELL_GENE_EXPRESSION_LIMIT.toLocaleString()} genes
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function overviewCellToDatasetCell(cell: OverviewCellDatum): DatasetCell {
  return {
    id: asCellId(cell.id),
    position: overviewCellToDataPoint(cell),
    ...(cell.transcriptCount === undefined
      ? {}
      : { transcriptCount: cell.transcriptCount }),
    ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
  }
}

function overviewCellToDataPoint(cell: OverviewCellDatum): DataPoint {
  const [x = 0, deckY = 0] = cell.position

  return {
    x: micrometers(x),
    y: micrometers(-deckY),
  }
}

async function loadSelectedCellBoundary(
  baseUrl: string,
  cell: OverviewCellDatum,
  loadBoundaryElements: BoundaryElementsLoader,
  signal: AbortSignal,
): Promise<SpatialElement | null> {
  try {
    const batch = await loadBoundaryElements(baseUrl, selectedCellBoundaryBbox(cell), {
      signal,
    })

    if (signal.aborted) {
      throwAbortError('Selected cell boundary request aborted.')
    }

    return batch.elements.find((element) => element.id === cell.id) ?? null
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    return null
  }
}

function selectedCellBoundaryBbox(cell: OverviewCellDatum): BBox {
  const center = overviewCellToDataPoint(cell)
  const cellRadius =
    cell.radiusMicrometers ??
    optionalHalf(cellAreaToEquivalentDiameterMicrometers(cell.cellArea))
  const radius = Math.max(CELL_DETAIL_BOUNDARY_RADIUS_MICROMETERS, cellRadius ?? 0)

  return {
    minX: micrometers(center.x - radius),
    maxX: micrometers(center.x + radius),
    minY: micrometers(center.y - radius),
    maxY: micrometers(center.y + radius),
  }
}

function cellExpressionSummaryFromStats(stats: RoiGeneStats): CellGeneExpressionSummary {
  return {
    genes: stats.genes.map((gene) => ({
      gene: gene.gene,
      count: gene.count,
      percentTotal: gene.percentTotal,
    })),
    totalCount: stats.totalCount,
    hitGeneLimit: stats.genes.length >= CELL_GENE_EXPRESSION_LIMIT,
  }
}

function filterCellExpressionGenes(
  genes: readonly CellGeneExpressionGene[],
  search: string,
): readonly CellGeneExpressionGene[] {
  const normalizedSearch = search.trim().toLowerCase()

  if (normalizedSearch.length === 0) {
    return genes
  }

  return genes.filter((gene) => gene.gene.toLowerCase().includes(normalizedSearch))
}

function expressionBarWidth(count: number, maxCount: number): number {
  if (maxCount <= 0) {
    return 0
  }

  return Math.max(2, Math.min(100, (count / maxCount) * 100))
}

function summarizeCellShape(
  cell: OverviewCellDatum,
  boundaryElement: SpatialElement | null,
): CellShapeMetrics {
  const boundaryMetrics = polygonShapeMetrics(boundaryElement)
  const area = cell.cellArea ?? boundaryMetrics?.boundaryAreaMicrometersSquared

  return {
    ...(area === undefined ? {} : { areaMicrometersSquared: area }),
    ...optionalMetric(
      'equivalentDiameterMicrometers',
      cellAreaToEquivalentDiameterMicrometers(area),
    ),
    ...(boundaryMetrics ?? {}),
  }
}

function polygonShapeMetrics(
  boundaryElement: SpatialElement | null,
): CellShapeMetrics | null {
  if (
    boundaryElement === null ||
    boundaryElement.geometry.kind !== 'polygon' ||
    boundaryElement.geometry.rings.length === 0
  ) {
    return null
  }

  const ring = boundaryElement.geometry.rings[0]

  if (ring === undefined || ring.length < 3) {
    return null
  }

  return polygonRingShapeMetrics(ring)
}

function polygonRingShapeMetrics(points: readonly DataPoint[]): CellShapeMetrics | null {
  let twiceSignedArea = 0
  let centroidXNumerator = 0
  let centroidYNumerator = 0
  let ixxNumerator = 0
  let iyyNumerator = 0
  let ixyNumerator = 0
  let perimeter = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (current === undefined || next === undefined) {
      continue
    }

    const cross = current.x * next.y - next.x * current.y
    twiceSignedArea += cross
    centroidXNumerator += (current.x + next.x) * cross
    centroidYNumerator += (current.y + next.y) * cross
    ixxNumerator += (current.y * current.y + current.y * next.y + next.y * next.y) * cross
    iyyNumerator += (current.x * current.x + current.x * next.x + next.x * next.x) * cross
    ixyNumerator +=
      (2 * current.x * current.y +
        current.x * next.y +
        next.x * current.y +
        2 * next.x * next.y) *
      cross
    perimeter += Math.hypot(next.x - current.x, next.y - current.y)
  }

  const signedArea = twiceSignedArea / 2
  const boundaryArea = Math.abs(signedArea)

  if (boundaryArea <= 0 || perimeter <= 0) {
    return null
  }

  const centroidX = centroidXNumerator / (6 * signedArea)
  const centroidY = centroidYNumerator / (6 * signedArea)
  const ixx = ixxNumerator / 12
  const iyy = iyyNumerator / 12
  const ixy = ixyNumerator / 24
  const varianceX = Math.max(0, iyy / signedArea - centroidX * centroidX)
  const varianceY = Math.max(0, ixx / signedArea - centroidY * centroidY)
  const covarianceXY = ixy / signedArea - centroidX * centroidY
  const discriminant = Math.sqrt(
    Math.max(
      0,
      (varianceX - varianceY) * (varianceX - varianceY) + 4 * covarianceXY * covarianceXY,
    ),
  )
  const majorVariance = Math.max(0, (varianceX + varianceY + discriminant) / 2)
  const minorVariance = Math.max(0, (varianceX + varianceY - discriminant) / 2)
  const majorAxis = majorVariance > 0 ? 4 * Math.sqrt(majorVariance) : undefined
  const minorAxis = minorVariance > 0 ? 4 * Math.sqrt(minorVariance) : undefined
  const eccentricity =
    majorVariance > 0
      ? Math.sqrt(Math.max(0, 1 - minorVariance / majorVariance))
      : undefined

  return {
    boundaryAreaMicrometersSquared: boundaryArea,
    ...optionalMetric(
      'boundaryEquivalentDiameterMicrometers',
      cellAreaToEquivalentDiameterMicrometers(boundaryArea),
    ),
    perimeterMicrometers: perimeter,
    ...optionalMetric('majorAxisMicrometers', majorAxis),
    ...optionalMetric('minorAxisMicrometers', minorAxis),
    ...optionalMetric('eccentricity', eccentricity),
    circularity: (4 * Math.PI * boundaryArea) / (perimeter * perimeter),
    boundaryPointCount: points.length,
  }
}

function cellAreaToEquivalentDiameterMicrometers(
  area: number | undefined,
): number | undefined {
  if (area === undefined || area <= 0 || !Number.isFinite(area)) {
    return undefined
  }

  return Math.sqrt((4 * area) / Math.PI)
}

function optionalHalf(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 2
}

function optionalMetric<Key extends keyof CellShapeMetrics>(
  key: Key,
  value: CellShapeMetrics[Key] | undefined,
): Pick<CellShapeMetrics, Key> | Record<string, never> {
  return value === undefined || !Number.isFinite(Number(value))
    ? {}
    : ({ [key]: value } as Pick<CellShapeMetrics, Key>)
}

function throwAbortError(message: string): never {
  const error = new Error(message)
  error.name = 'AbortError'
  throw error
}

function formatMetric(value: number | undefined, unit?: string): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'Unavailable'
  }

  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: value < 1 ? 3 : 1,
  })

  return unit === undefined ? formatted : `${formatted} ${unit}`
}

function MorphologyChannelControls({
  autoContrastChannelIds,
  channels,
  onAutoContrast,
  settings,
  onUpdate,
}: {
  readonly autoContrastChannelIds: readonly string[]
  readonly channels: readonly MorphologyImageChannel[]
  readonly onAutoContrast: (channel: MorphologyImageChannel) => void
  readonly settings: readonly MorphologyChannelSetting[]
  readonly onUpdate: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
}) {
  if (channels.length === 0) {
    return null
  }

  return (
    <div className="channel-controls" aria-label="Image channels">
      {channels.map((channel) => {
        const setting = settings.find((candidate) => candidate.id === channel.info.id)
        const color = setting?.color ?? channel.info.color
        const contrastMin = setting?.contrastMin ?? channel.info.contrast.min
        const contrastMax = setting?.contrastMax ?? channel.info.contrast.max
        const isAutoContrastLoading = autoContrastChannelIds.includes(channel.info.id)
        const histogram = setting?.histogram

        return (
          <div className="channel-control" key={channel.info.id}>
            <label className="channel-toggle">
              <input
                type="checkbox"
                checked={setting?.enabled ?? false}
                onChange={(event) => {
                  onUpdate(channel.info.id, { enabled: event.currentTarget.checked })
                }}
              />
              <span>{channel.info.name}</span>
            </label>
            <input
              className="channel-color"
              type="color"
              aria-label={`${channel.info.name} color`}
              value={rgbToHex(color)}
              onChange={(event) => {
                onUpdate(channel.info.id, { color: hexToRgb(event.currentTarget.value) })
              }}
            />
            <button
              className="channel-auto-button"
              type="button"
              aria-label={`${channel.info.name} auto contrast`}
              disabled={isAutoContrastLoading}
              onClick={() => {
                onAutoContrast(channel)
              }}
            >
              {isAutoContrastLoading ? '...' : 'Auto'}
            </button>
            <div className="channel-contrast">
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${channel.info.name} minimum`}
                value={contrastMin}
                onChange={(event) => {
                  onUpdate(channel.info.id, {
                    contrastMin: event.currentTarget.valueAsNumber,
                  })
                }}
              />
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${channel.info.name} maximum`}
                value={contrastMax}
                onChange={(event) => {
                  onUpdate(channel.info.id, {
                    contrastMax: event.currentTarget.valueAsNumber,
                  })
                }}
              />
            </div>
            <ChannelHistogramView histogram={histogram} label={channel.info.name} />
          </div>
        )
      })}
    </div>
  )
}

function ChannelHistogramView({
  histogram,
  label,
}: {
  readonly histogram: ChannelHistogram | undefined
  readonly label: string
}) {
  const bins = histogram?.bins ?? EMPTY_HISTOGRAM_BINS
  const maxCount = histogram?.maxCount ?? 1

  return (
    <div
      className="channel-histogram"
      aria-label={`${label} histogram`}
      title={
        histogram === undefined
          ? `${label} histogram`
          : `${label} histogram, ${histogram.sampleCount.toLocaleString()} samples`
      }
    >
      {bins.map((count, index) => (
        <span
          className="channel-histogram-bar"
          key={index}
          style={{ transform: `scaleY(${Math.max(0.04, count / maxCount)})` }}
        />
      ))}
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  )
}

function CellFeatureMatrixCompatibilityNotice({
  state,
}: {
  readonly state: CellFeatureMatrixCapabilityState
}) {
  if (state.status !== 'ready' || state.hasCellMajorCsc) {
    return null
  }

  return (
    <section
      className="cell-feature-matrix-notice"
      role="status"
      aria-label="Cell-feature matrix warning"
    >
      <h2>Matrix Warning</h2>
      <p>
        <code>cell_feature_matrix.zarr.zip</code> is not in CSC format. Selected-gene
        reads may use the older feature-major Zarr layout; ROI gene stats will fall back
        to <code>cell_feature_matrix.h5</code>.
      </p>
    </section>
  )
}

function TranscriptStatusPanel({
  capabilityState,
  layerState,
  exactPointLimit,
  visibleTranscriptEstimate,
  hoveredTranscript,
}: {
  readonly capabilityState: TranscriptCapabilityState
  readonly layerState: TranscriptLayerState
  readonly exactPointLimit: number
  readonly visibleTranscriptEstimate: number
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
}) {
  const capabilities =
    capabilityState.status === 'ready' ? capabilityState.capabilities : null

  return (
    <div className="transcript-status-panel">
      <dl className="transcript-summary-list" aria-label="Transcript overlay summary">
        <div>
          <dt>Source</dt>
          <dd>
            {capabilities === null
              ? capabilityStateLabel(capabilityState)
              : transcriptCapabilityLabel(capabilities)}
          </dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>{visibleTranscriptEstimate.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Exact budget</dt>
          <dd>{exactPointLimit.toLocaleString()}</dd>
        </div>
        {layerState.status === 'ready' ? (
          <>
            <div>
              <dt>Rendered</dt>
              <dd>
                {layerState.points.length.toLocaleString()}
                {layerState.hitPointLimit ? '+' : ''}
              </dd>
            </div>
            <div>
              <dt>Query</dt>
              <dd>{layerState.durationMs.toLocaleString()} ms</dd>
            </div>
          </>
        ) : null}
        {layerState.status === 'aggregate' ? (
          <>
            <div>
              <dt>Rendered</dt>
              <dd>{layerState.bins.length.toLocaleString()} bins</dd>
            </div>
            <div>
              <dt>Layer</dt>
              <dd>{layerState.source === 'cell-summary' ? 'Cell summary' : 'Native'}</dd>
            </div>
            {layerState.durationMs === undefined ? null : (
              <div>
                <dt>Query</dt>
                <dd>{layerState.durationMs.toLocaleString()} ms</dd>
              </div>
            )}
          </>
        ) : null}
      </dl>

      {layerState.status === 'waiting' ||
      layerState.status === 'aggregate' ||
      layerState.status === 'unavailable' ? (
        <p className="transcript-status-message">{layerState.message}</p>
      ) : null}
      {layerState.status === 'error' ? (
        <p className="transcript-status-message">{layerState.error.message}</p>
      ) : null}

      {layerState.status === 'ready' && layerState.groups.length > 0 ? (
        <div className="transcript-group-panel">
          <div className="transcript-group-heading">
            <span>Gene</span>
            <span>FOV</span>
            <span>Count</span>
          </div>
          <ol className="transcript-group-list" aria-label="Top transcript groups">
            {layerState.groups.map((group) => (
              <li key={`${group.featureName}:${group.fovName ?? 'none'}`}>
                <span>{group.featureName}</span>
                <span>{group.fovName ?? 'Unassigned'}</span>
                <strong>{group.count.toLocaleString()}</strong>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {hoveredTranscript === null ? null : hoveredTranscript.transcript !== undefined ? (
        <div className="transcript-hover-panel">
          <p>{hoveredTranscript.transcript.featureName}</p>
          <dl>
            <div>
              <dt>ID</dt>
              <dd>
                {hoveredTranscript.transcript.transcriptId ??
                  hoveredTranscript.transcript.id}
              </dd>
            </div>
            <div>
              <dt>FOV</dt>
              <dd>{hoveredTranscript.transcript.fovName ?? 'Unassigned'}</dd>
            </div>
            {transcriptCellDisplayLabel(hoveredTranscript.transcript) === null ? null : (
              <div>
                <dt>Cell</dt>
                <dd>{transcriptCellDisplayLabel(hoveredTranscript.transcript)}</dd>
              </div>
            )}
            <div>
              <dt>QV</dt>
              <dd>{formatOptionalNumber(hoveredTranscript.transcript.qv)}</dd>
            </div>
            <div>
              <dt>X/Y</dt>
              <dd>
                {formatOptionalNumber(hoveredTranscript.transcript.position[0])},{' '}
                {formatOptionalNumber(
                  Math.abs(hoveredTranscript.transcript.position[1] ?? 0),
                )}
              </dd>
            </div>
            <div>
              <dt>Z</dt>
              <dd>{formatOptionalNumber(hoveredTranscript.transcript.zLocation)}</dd>
            </div>
            <div>
              <dt>Nucleus</dt>
              <dd>{formatBooleanLabel(hoveredTranscript.transcript.overlapsNucleus)}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{transcriptGeneStatusLabel(hoveredTranscript.transcript.isGene)}</dd>
            </div>
          </dl>
        </div>
      ) : hoveredTranscript.aggregate !== undefined ? (
        <div className="transcript-hover-panel">
          <p>Transcript density bin</p>
          <dl>
            <div>
              <dt>Count</dt>
              <dd>{hoveredTranscript.aggregate.count.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Level</dt>
              <dd>{hoveredTranscript.aggregate.level.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {hoveredTranscript.aggregate.source === 'native-zarr'
                  ? 'Native'
                  : 'Cell summary'}
              </dd>
            </div>
            <div>
              <dt>Bin size</dt>
              <dd>
                {formatOptionalNumber(hoveredTranscript.aggregate.binSizeMicrometers)} µm
              </dd>
            </div>
            {hoveredTranscript.aggregate.selectedGeneCount === undefined ? null : (
              <div>
                <dt>Selected</dt>
                <dd>{hoveredTranscript.aggregate.selectedGeneCount.toLocaleString()}</dd>
              </div>
            )}
            <div>
              <dt>Bin</dt>
              <dd>
                {hoveredTranscript.aggregate.binX.toLocaleString()},{' '}
                {hoveredTranscript.aggregate.binY.toLocaleString()}
              </dd>
            </div>
          </dl>
          {hoveredTranscript.aggregate.topFeatures === undefined ||
          hoveredTranscript.aggregate.topFeatures.length === 0 ? null : (
            <ol className="transcript-hover-feature-list">
              {hoveredTranscript.aggregate.topFeatures.map((feature) => (
                <li key={feature.featureName}>
                  <span>{feature.featureName}</span>
                  <strong>{feature.count.toLocaleString()}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  )
}

function capabilityStateLabel(state: TranscriptCapabilityState): string {
  if (state.status === 'loading') {
    return 'Checking'
  }

  if (state.status === 'error') {
    return 'Unavailable'
  }

  return 'Not checked'
}

function ErrorSummary({ errors }: { readonly errors: readonly StructuredLoadError[] }) {
  if (errors.length === 0) {
    return null
  }

  return (
    <section className="error-summary" role="alert" aria-label="Load issues">
      <h2>Issues</h2>
      <ul>
        {errors.map((error) => (
          <li key={`${error.source}:${error.code}:${error.message}`}>
            <div className="error-summary-heading">
              <strong>{error.source}</strong>
              <span>{error.title}</span>
            </div>
            <p>{error.message}</p>
            <p>{error.action}</p>
            {error.detail === undefined ? null : <p>{error.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DatasetDiagnosticsPanel({ state }: { readonly state: DatasetDiagnosticsState }) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <section className="dataset-diagnostics-panel" aria-label="Dataset diagnostics">
        <h2>Diagnostics</h2>
        <p role="status">Running checks</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="dataset-diagnostics-panel" aria-label="Dataset diagnostics">
        <h2>Diagnostics</h2>
        <p>{state.error.title}</p>
      </section>
    )
  }

  return (
    <section className="dataset-diagnostics-panel" aria-label="Dataset diagnostics">
      <div className="dataset-diagnostics-heading">
        <h2>Diagnostics</h2>
        <span>{summarizeDatasetDiagnostics(state.report)}</span>
      </div>
      <ol>
        {state.report.checks.map((check) => (
          <li key={check.id} className={`diagnostic-check-${check.status}`}>
            <span>{check.label}</span>
            <strong>{check.status}</strong>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LoadingIndicator({ tasks }: { readonly tasks: readonly LoadingTask[] }) {
  if (tasks.length === 0) {
    return null
  }

  const primaryTask = tasks[0]
  const secondaryTasks = tasks.slice(1)

  if (primaryTask === undefined) {
    return null
  }

  const visibleSecondaryTasks = secondaryTasks.slice(0, 3)
  const hiddenTaskCount = secondaryTasks.length - visibleSecondaryTasks.length

  return (
    <section
      className="loading-indicator"
      role="status"
      aria-label="Active loading tasks"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="loading-indicator-primary">
        <span className="loading-spinner" aria-hidden="true" />
        <span>{primaryTask.label}</span>
        {primaryTask.detail === undefined ? null : <small>{primaryTask.detail}</small>}
      </div>
      {visibleSecondaryTasks.length === 0 ? null : (
        <ol aria-label="Additional loading tasks">
          {visibleSecondaryTasks.map((task) => (
            <li key={task.id}>
              <span>{task.label}</span>
              {task.detail === undefined ? null : <small>{task.detail}</small>}
            </li>
          ))}
          {hiddenTaskCount > 0 ? <li>+{hiddenTaskCount} more</li> : null}
        </ol>
      )}
    </section>
  )
}

function ActivityLog({
  entries,
  onClear,
}: {
  readonly entries: readonly DebugLogEntry[]
  readonly onClear: () => void
}) {
  return (
    <section className="activity-log" aria-label="Activity log">
      <div className="activity-log-heading">
        <h2>Log</h2>
        <button type="button" disabled={entries.length === 0} onClick={onClear}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p>Idle</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <time dateTime={new Date(entry.timestamp).toISOString()}>
                {formatDebugTimestamp(entry.timestamp)}
              </time>
              <span title={entry.message}>{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function summarizeRoiCells(cells: readonly DatasetCell[]): RoiSummary {
  if (cells.length === 0) {
    return {
      cellCount: 0,
      meanTranscriptCount: 0,
      meanCellArea: undefined,
    }
  }

  let transcriptTotal = 0
  let cellAreaTotal = 0
  let cellAreaCount = 0

  for (const cell of cells) {
    transcriptTotal += cell.transcriptCount ?? 0

    if (cell.cellArea !== undefined) {
      cellAreaTotal += cell.cellArea
      cellAreaCount += 1
    }
  }

  return {
    cellCount: cells.length,
    meanTranscriptCount: transcriptTotal / cells.length,
    meanCellArea: cellAreaCount === 0 ? undefined : cellAreaTotal / cellAreaCount,
  }
}

function MagicLensPanel({ state }: { readonly state: MagicLensState }) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <p className="magic-lens-status" aria-live="polite">
        Scanning {magicLensScopeLabel(state.scope).toLowerCase()}
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="magic-lens-status" aria-live="polite">
        {state.error.title}
      </p>
    )
  }

  const maxCount = Math.max(
    ...state.summary.topGenes.map((geneSummary) => geneSummary.count),
    1,
  )

  return (
    <section className="magic-lens-results" aria-label="Magic lens results">
      <dl className="magic-lens-summary-list">
        <div>
          <dt>Scope</dt>
          <dd>{magicLensScopeLabel(state.scope)}</dd>
        </div>
        <div>
          <dt>Transcripts</dt>
          <dd>
            {state.summary.transcriptCount.toLocaleString()}
            {state.summary.hitLimit ? '+' : ''}
          </dd>
        </div>
        <div>
          <dt>Cells</dt>
          <dd>{state.summary.cellCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Genes</dt>
          <dd>{state.summary.geneCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{state.summary.selectedGeneTranscriptCount.toLocaleString()}</dd>
        </div>
      </dl>

      {state.summary.topGenes.length === 0 ? (
        <p className="magic-lens-status">No detected gene transcripts</p>
      ) : (
        <section
          className="magic-lens-gene-panel"
          aria-label="Magic lens gene distribution"
        >
          <div className="magic-lens-gene-heading">
            <span>Top lens genes</span>
            <small>{state.summary.topGenes.length.toLocaleString()}</small>
          </div>
          <ol className="magic-lens-gene-list">
            {state.summary.topGenes.map((geneSummary) => (
              <li
                key={geneSummary.gene}
                className={geneSummary.selected ? 'is-selected' : undefined}
                style={
                  {
                    '--magic-lens-gene-width': `${Math.max(
                      4,
                      (geneSummary.count / maxCount) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <div className="magic-lens-gene-row">
                  <span>{geneSummary.gene}</span>
                  <strong>{geneSummary.count.toLocaleString()}</strong>
                </div>
                <div className="magic-lens-gene-bar" aria-hidden="true" />
                <small>{formatPercent(geneSummary.percentTotal)} total</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  )
}

function RoiGeneStatsPanel({
  copy,
  state,
}: {
  readonly copy: string
  readonly state: RoiGeneStatsState
}) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <p className="roi-gene-status" aria-live="polite">
        {copy}
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="roi-gene-status" aria-live="polite">
        {copy}
      </p>
    )
  }

  if (state.stats.genes.length === 0) {
    return (
      <p className="roi-gene-status" aria-live="polite">
        No detected ROI gene expression
      </p>
    )
  }

  const maxCount = Math.max(...state.stats.genes.map((gene) => gene.count), 1)

  return (
    <section className="roi-gene-panel" aria-label="ROI gene distribution">
      <div className="roi-gene-heading">
        <span>Top ROI genes</span>
        <small>
          {state.stats.hitCellLimit
            ? `${state.stats.sampledCellCount.toLocaleString()} sampled`
            : `${state.stats.sampledCellCount.toLocaleString()} cells`}
        </small>
      </div>
      <ol className="roi-gene-list">
        {state.stats.genes.map((gene) => (
          <li
            key={gene.gene}
            style={
              {
                '--roi-gene-width': `${Math.max(4, (gene.count / maxCount) * 100)}%`,
              } as CSSProperties
            }
          >
            <div className="roi-gene-row">
              <span>{gene.gene}</span>
              <strong>{gene.count.toLocaleString()}</strong>
            </div>
            <div className="roi-gene-bar" aria-hidden="true" />
            <small>
              {formatPercent(gene.percentTotal)} total ·{' '}
              {formatPercent(gene.percentCells)} cells · {formatNumber(gene.meanPerCell)}
              /cell
            </small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function emptyRoiGeneStats(): RoiGeneStats {
  return {
    genes: [],
    cellCount: 0,
    sampledCellCount: 0,
    totalCount: 0,
    hitCellLimit: false,
  }
}

function roiGeneViewportWarmupKey(
  datasetUrl: string,
  detail: ViewerViewportDetail,
): string {
  const coordinateBucketMicrometers = 100
  const visibleCellBucket = ROI_GENE_STATS_PREVIEW_CELL_LIMIT
  const { bbox, viewState } = detail

  return [
    datasetUrl,
    Math.round(bbox.minX / coordinateBucketMicrometers),
    Math.round(bbox.maxX / coordinateBucketMicrometers),
    Math.round(bbox.minY / coordinateBucketMicrometers),
    Math.round(bbox.maxY / coordinateBucketMicrometers),
    Math.round(viewState.zoom * 10),
    Math.round(detail.visibleCellCount / visibleCellBucket),
  ].join(':')
}

function deferRoiGeneRefinement(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function resolveMagicLensSelection(
  scope: MagicLensScope,
  viewportDetail: ViewerViewportDetail | null,
  roiSelection: RoiSelection | null,
): RoiSelectionInput | null {
  if (scope === 'roi') {
    return roiSelection
  }

  if (scope === 'cursor') {
    return null
  }

  return viewportDetail?.bbox ?? null
}

function summarizeMagicLensCells(
  cells: readonly DatasetCell[],
  stats: RoiGeneStats,
  selectedGenes: readonly string[],
  options: {
    readonly hitLimit?: boolean
  },
): MagicLensSummary {
  const selectedGeneKeys = new Set(selectedGenes.map((gene) => gene.toLocaleLowerCase()))
  let selectedGeneTranscriptCount = 0
  let transcriptCount = 0

  for (const cell of cells) {
    transcriptCount += cell.transcriptCount ?? 0
  }

  for (const gene of stats.genes) {
    if (selectedGeneKeys.has(gene.gene.toLocaleLowerCase())) {
      selectedGeneTranscriptCount += gene.count
    }
  }

  const topGenes = stats.genes
    .map((gene) => ({
      gene: gene.gene,
      count: gene.count,
      percentTotal: gene.percentTotal,
      selected: selectedGeneKeys.has(gene.gene.toLocaleLowerCase()),
    }))
    .slice(0, MAGIC_LENS_TOP_GENE_LIMIT)

  return {
    transcriptCount,
    cellCount: cells.length,
    geneCount: stats.genes.length,
    selectedGeneTranscriptCount,
    topGenes,
    hitLimit: options.hitLimit ?? false,
  }
}

function magicLensScopeLabel(scope: MagicLensScope): string {
  if (scope === 'cursor') {
    return 'Cursor'
  }

  return scope === 'roi' ? 'ROI' : 'Viewport'
}

function magicLensStatusCopy(
  state: MagicLensState,
  scope: MagicLensScope,
  loadStatus: DatasetLoadState['status'],
  canScan: boolean,
  active: boolean,
): string {
  if (state.status === 'loading') {
    return `Scanning ${magicLensScopeLabel(state.scope)}`
  }

  if (state.status === 'ready') {
    return `${state.summary.transcriptCount.toLocaleString()} transcripts`
  }

  if (state.status === 'error') {
    return state.error.title
  }

  if (loadStatus !== 'ready') {
    return 'Load dataset'
  }

  if (scope === 'cursor') {
    return active ? 'Move cursor' : 'Lens off'
  }

  if (canScan) {
    return 'Ready'
  }

  return scope === 'roi' ? 'ROI required' : 'Viewport pending'
}

function filterCellsForCircle(
  cells: readonly DatasetCell[],
  filter: MagicLensCircleFilter,
): readonly DatasetCell[] {
  const radiusSquared = filter.radiusMicrometers * filter.radiusMicrometers

  return cells.filter((cell) => {
    const deltaX = cell.position.x - filter.center.x
    const deltaY = cell.position.y - filter.center.y

    return deltaX * deltaX + deltaY * deltaY <= radiusSquared
  })
}

function magicLensDetailQueryKey(
  detail: ViewerMagicLensDetail,
  minQv: number,
  selectedGenes: readonly string[],
): string {
  const roundedX = Math.round(detail.center.x / 4)
  const roundedY = Math.round(detail.center.y / 4)
  const selectedGeneKey = selectedGenes
    .map((gene) => gene.toLocaleLowerCase())
    .sort()
    .join(',')

  return [
    roundedX,
    roundedY,
    Math.round(detail.radiusMicrometers),
    minQv,
    selectedGeneKey,
  ].join(':')
}

function normalizeMagicLensRadius(value: number): number {
  if (!Number.isFinite(value)) {
    return 80
  }

  return Math.max(10, Math.min(500, Math.round(value)))
}

function normalizeMagicLensMinQv(value: number): number {
  if (!Number.isFinite(value)) {
    return 20
  }

  return Math.max(0, Math.min(40, Math.round(value)))
}

function normalizeTranscriptMinQv(value: number): number {
  if (!Number.isFinite(value)) {
    return 20
  }

  return Math.max(0, Math.min(40, Math.round(value)))
}

function normalizeTranscriptPointSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 2
  }

  return Math.max(1, Math.min(6, Math.round(value)))
}

function roiCellsToCsv(cells: readonly DatasetCell[]): string {
  const rows = [
    ['cell_id', 'x_centroid', 'y_centroid', 'transcript_counts', 'cell_area'],
    ...cells.map((cell) => [
      cell.id,
      String(cell.position.x),
      String(cell.position.y),
      String(cell.transcriptCount ?? ''),
      String(cell.cellArea ?? ''),
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

function roiTranscriptsToCsv(transcripts: readonly DatasetTranscript[]): string {
  const rows = [
    [
      'cell_id',
      'feature_name',
      'x_location',
      'y_location',
      'z_location',
      'qv',
      'overlaps_nucleus',
      'is_gene',
    ],
    ...transcripts.map((transcript) => [
      transcript.cellId ?? '',
      transcript.featureName,
      String(transcript.position.x),
      String(transcript.position.y),
      transcript.zLocation === undefined ? '' : String(transcript.zLocation),
      String(transcript.qv),
      transcript.overlapsNucleus === undefined ? '' : String(transcript.overlapsNucleus),
      transcript.isGene === undefined ? '' : String(transcript.isGene),
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function downloadTextFile(
  fileName: string,
  text: string,
  mimeType = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

interface DiagnosticsDumpOptions {
  readonly activeControlHudTab: ControlHudTab
  readonly activeErrors: readonly StructuredLoadError[]
  readonly boundaryCellLimit: number
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly datasetUrl: string
  readonly debugLog: readonly DebugLogEntry[]
  readonly diagnosticsState: DatasetDiagnosticsState
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly loadState: DatasetLoadState
  readonly observationColorMode: ObservationColorMode
  readonly performanceBudget: PerformanceBudget
  readonly selectedGenes: readonly string[]
  readonly shareableViewState: ShareableViewState | undefined
  readonly shouldLoadMorphology: boolean
  readonly telemetryEvents: readonly TelemetryEvent[]
  readonly showTranscriptOverlay: boolean
  readonly transcriptCapabilityState: TranscriptCapabilityState
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptExactPointLimit: number
  readonly transcriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly transcriptGeneOnly: boolean
  readonly transcriptLayerState: TranscriptLayerState
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointSize: number
}

function createDiagnosticsDump(options: DiagnosticsDumpOptions): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    datasetUrl: options.datasetUrl,
    location: readCurrentLocation(),
    performanceBudget: options.performanceBudget,
    controls: {
      activeControlHudTab: options.activeControlHudTab,
      boundaryCellLimit: options.boundaryCellLimit,
      coordinateUnit: options.coordinateUnit,
      geneExpressionColorScale: options.geneExpressionColorScale,
      geneExpressionDetailMode: options.geneExpressionDetailMode,
      geneExpressionScoreMode: options.geneExpressionScoreMode,
      observationColorMode: options.observationColorMode,
      selectedGenes: options.selectedGenes,
      shareableViewState: options.shareableViewState,
      shouldLoadMorphology: options.shouldLoadMorphology,
      showTranscriptOverlay: options.showTranscriptOverlay,
      transcriptDetailMode: options.transcriptDetailMode,
      transcriptDensityColorScale: options.transcriptDensityColorScale,
      transcriptExactPointLimit: options.transcriptExactPointLimit,
      transcriptFeatureFilterMode: options.transcriptFeatureFilterMode,
      transcriptGeneOnly: options.transcriptGeneOnly,
      transcriptMinQv: options.transcriptMinQv,
      transcriptOpacity: options.transcriptOpacity,
      transcriptPointSize: options.transcriptPointSize,
    },
    states: {
      dataset: summarizeDatasetLoadState(options.loadState),
      diagnostics: summarizeDiagnosticsState(options.diagnosticsState),
      transcripts: {
        capability: options.transcriptCapabilityState,
        layer: options.transcriptLayerState,
      },
    },
    activeErrors: options.activeErrors,
    activityLog: options.debugLog,
    telemetryEvents: options.telemetryEvents,
  }
}

function summarizeDatasetLoadState(state: DatasetLoadState): Record<string, unknown> {
  if (state.status === 'ready') {
    return {
      status: state.status,
      url: state.url,
      cellCount: state.cellCount,
    }
  }

  if (state.status === 'loading' || state.status === 'error') {
    return {
      status: state.status,
      url: state.url,
      ...(state.status === 'error' ? { error: state.error } : {}),
    }
  }

  return { status: state.status }
}

function summarizeDiagnosticsState(
  state: DatasetDiagnosticsState,
): Record<string, unknown> {
  if (state.status === 'ready') {
    return {
      status: state.status,
      url: state.url,
      summary: summarizeDatasetDiagnostics(state.report),
      report: state.report,
    }
  }

  if (state.status === 'loading' || state.status === 'error') {
    return {
      status: state.status,
      url: state.url,
      ...(state.status === 'error' ? { error: state.error } : {}),
    }
  }

  return { status: state.status }
}

function readCurrentLocation(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.href
}

function readTimestamp(): number {
  return Date.now()
}

function formatElapsed(startedAt: number): string {
  const elapsedMs = Math.max(0, readTimestamp() - startedAt)

  if (elapsedMs < 1_000) {
    return `${Math.round(elapsedMs)} ms`
  }

  return `${(elapsedMs / 1_000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} s`
}

function defaultRoiName(index: number): string {
  return `ROI ${index}`
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? 'None' : formatNumber(value)
}

function transcriptCellDisplayLabel(transcript: TranscriptPointDatum): string | null {
  if (transcript.cellId !== null) {
    return transcript.cellId
  }

  return transcript.cellAssignment === 'unassigned' ? 'Unassigned' : null
}

function formatBooleanLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return 'Unknown'
  }

  return value ? 'Yes' : 'No'
}

function transcriptGeneStatusLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return 'Unknown'
  }

  return value ? 'Gene' : 'Control'
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function formatGeneScaleValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 10 ? 2 : 1,
  })
}

function formatDebugTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function shortDatasetLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const lastPathSegment = parsed.pathname.split('/').filter(Boolean).at(-1)
    return shortIdentifier(lastPathSegment ?? parsed.host)
  } catch {
    return shortIdentifier(url)
  }
}

function shortIdentifier(value: string): string {
  const normalized = value.trim()

  if (normalized.length <= 24) {
    return normalized
  }

  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
}

function morphologyPatchLabel(
  patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
): string {
  if ('enabled' in patch) {
    return patch.enabled ? 'Channel enabled' : 'Channel disabled'
  }

  if ('color' in patch) {
    return 'Channel color'
  }

  if ('contrastMin' in patch || 'contrastMax' in patch) {
    return 'Channel contrast'
  }

  return 'Channel updated'
}

function abortActiveRequest(ref: { current: AbortController | null }): void {
  ref.current?.abort()
  ref.current = null
}

function clearTimeoutRef(ref: { current: number | null }): void {
  if (ref.current !== null && typeof window !== 'undefined') {
    window.clearTimeout(ref.current)
  }

  ref.current = null
}

function createMorphologyChannelSettings(
  image: MorphologyImage,
): readonly MorphologyChannelSetting[] {
  return image.channelLoaders.map((channel, index) => ({
    id: channel.info.id,
    enabled: index === 0,
    color: channel.info.color,
    contrastMin: channel.info.contrast.min,
    contrastMax: channel.info.contrast.max,
  }))
}

function normalizeChannelContrast(options: {
  readonly min: number
  readonly max: number
}): { readonly lo: number; readonly hi: number } {
  const lo = Number.isFinite(options.min) ? options.min : 0
  const hi = Number.isFinite(options.max) ? options.max : lo + 1

  return hi > lo ? { lo, hi } : { lo, hi: lo + 1 }
}

function rgbToHex(color: readonly [number, number, number]): string {
  return `#${color.map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(value: string): readonly [number, number, number] {
  const normalized = value.trim().replace(/^#/, '')

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return [255, 255, 255]
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isStructuredLoadError(
  error: StructuredLoadError | null,
): error is StructuredLoadError {
  return error !== null
}

function formatStructuredError(error: StructuredLoadError): string {
  return `${error.title}: ${error.message}`
}

function createStructuredLoadError(
  source: LoadErrorSource,
  error: unknown,
): StructuredLoadError {
  const message = readErrorMessage(error)
  const normalizedMessage = message.toLowerCase()
  const detail = readErrorDetail(error)

  if (
    normalizedMessage.includes('cannot be range-read') ||
    normalizedMessage.includes('expected http 206')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'range-not-supported',
        title: 'Byte-range requests blocked',
        message,
        action: 'Configure the host to return HTTP 206 for Range requests.',
      },
      detail,
    )
  }

  const httpStatus = /\bhttp\s+(\d{3})\b/i.exec(message)?.[1]

  if (httpStatus !== undefined) {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: `HTTP ${httpStatus} response`,
        message,
        action: 'Check the dataset URL and object permissions.',
      },
      detail,
    )
  }

  if (
    error instanceof TypeError ||
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('networkerror')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'network',
        title: 'Network request failed',
        message,
        action: 'Check dataset URL, CORS, and network access.',
      },
      detail,
    )
  }

  if (isCellsParquetDecodeError(source, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'parquet-decode',
        title: 'cells.parquet decode failed',
        message: normalizedMessage.includes('unable to decode cells.parquet')
          ? message
          : `The overview cells.parquet file was reachable, but the browser Parquet reader could not decode it: ${message}.`,
        action:
          'Rewrite cells.parquet with a browser-compatible Parquet encoding or use an alternate overview reader for this dataset.',
      },
      detail,
    )
  }

  if (
    source === 'ROI genes' &&
    isUnsupportedRoiGeneStatsError(error, normalizedMessage)
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'ROI gene matrix unavailable',
        message,
        action:
          'Host a readable cell_feature_matrix.h5 for older XOA output; native CSC Zarr remains the fast path when available.',
      },
      detail,
    )
  }

  if (
    normalizedMessage.includes('experiment.xenium') ||
    normalizedMessage.includes('no supported xenium ome-tiff')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'manifest',
        title: 'Dataset manifest is incomplete',
        message,
        action: 'Verify experiment.xenium lists the files needed by this layer.',
      },
      detail,
    )
  }

  if (normalizedMessage.includes('decode') || normalizedMessage.includes('tile')) {
    return withOptionalDetail(
      {
        source,
        code: 'decode',
        title: 'Image tile decode failed',
        message,
        action: 'Retry at this zoom level or disable the morphology image layer.',
      },
      detail,
    )
  }

  return withOptionalDetail(
    {
      source,
      code: 'unknown',
      title: 'Unexpected load error',
      message,
      action: 'Retry the request after checking the dataset URL.',
    },
    detail,
  )
}

function isUnsupportedRoiGeneStatsError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error && error.name === 'UnsupportedRoiGeneStatsMatrixError') ||
    normalizedMessage.includes('native csc arrays in cell_feature_matrix.zarr.zip') ||
    normalizedMessage.includes('readable cell_feature_matrix.h5 fallback')
  )
}

function isCellsParquetDecodeError(
  source: LoadErrorSource,
  normalizedMessage: string,
): boolean {
  if (source !== 'Dataset overview') {
    return false
  }

  return (
    normalizedMessage.includes('unable to decode cells.parquet') ||
    normalizedMessage.includes('offset is outside the bounds of the dataview') ||
    normalizedMessage.includes('invalid typed array length')
  )
}

function withOptionalDetail(
  error: Omit<StructuredLoadError, 'detail'>,
  detail: string | undefined,
): StructuredLoadError {
  return detail === undefined ? error : { ...error, detail }
}

function readErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name === 'Error') {
    return undefined
  }

  return error.name
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Unknown dataset error'
}
