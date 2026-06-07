import type { CSSProperties, FormEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ViewerCore,
  type ViewerCoordinateUnit,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import { LoadingIndicator } from './components/AppStatusPanels'
import { DatasetHudPanel } from './features/control-hud/DatasetHudPanel'
import { LayerHudPanel } from './features/control-hud/LayerHudPanel'
import { CellHudPanel } from './features/control-hud/CellHudPanel'
import { RoiHudPanel } from './features/control-hud/RoiHudPanel'
import { TranscriptStatusPanel } from './features/transcripts/TranscriptStatusPanel'
import { transcriptCapabilityLabel } from './features/transcripts/transcriptLabels'
import {
  CONTROL_HUD_TABS,
  isObservationColorMode,
  parseControlHudTab,
  parseObservationColorMode,
  parseViewerCoordinateUnit,
  readShareableStateFromLocation,
  type ControlHudTab,
} from './features/app-shell/appShellModel'
import {
  abortActiveRequest,
  appendDebugLogEntry,
  clearTimeoutRef,
  createDebugLogEntry,
  formatElapsed,
  isAbortError,
  readTimestamp,
  shortDatasetLabel,
  shortIdentifier,
  type DebugLogAppendOptions,
  type DebugLogEntry,
  type LoadingTask,
} from './features/app-shell/appRuntimeModel'
import {
  TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
  TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS,
  TRANSCRIPT_NATIVE_DENSITY_MAX_BINS,
  buildCellSummaryTranscriptBins,
  estimateVisibleTranscriptsFromCells,
  isTranscriptDetailMode,
  isTranscriptExactManualLoadRequired,
  isTranscriptFeatureFilterMode,
  maxTranscriptAggregateCount,
  normalizeTranscriptMinQv,
  normalizeTranscriptPointSize,
  parseTranscriptDensityColorScale,
  parseTranscriptDetailMode,
  parseTranscriptFeatureFilterMode,
  parseTranscriptPointColorMode,
  retainedTranscriptLayerState,
  transcriptAggregateBinsForRendering,
  transcriptAggregateFallbackMessage,
  transcriptAggregateScaleMaxForRendering,
  transcriptDensityScaleAriaLabel,
  transcriptDensityScaleValueLabels,
  transcriptExactManualLoadMessage,
  transcriptNativeAggregateMessage,
  transcriptPointsForRendering,
  transcriptStatusCopy,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './features/transcripts/transcriptLayerModel'
import {
  CELL_GENE_EXPRESSION_LIMIT,
  cellExpressionSummaryFromStats,
  cellDetailStatusCopy,
  loadSelectedCellBoundary,
  overviewCellToDatasetCell,
  overviewCellsToBbox,
  summarizeCellShape,
  type CellDetailState,
  type CellTranscriptDistributionState,
} from './features/cells/cellDetailModel'
import {
  analysisEmbeddingStatusCopy,
  type AnalysisEmbeddingState,
} from './features/analysis/analysisEmbeddingModel'
import {
  createMorphologyChannelSettings,
  morphologyPatchLabel,
  normalizeChannelContrast,
  type MorphologyChannelSetting,
} from './features/morphology/morphologyChannels'
import { MagicLensPanel } from './features/roi/RoiPanels'
import {
  MAGIC_LENS_CELL_LIMIT,
  MAGIC_LENS_GENE_STATS_LIMIT,
  magicLensScopeLabel,
  filterCellsForCircle,
  magicLensDetailQueryKey,
  magicLensStatusCopy,
  normalizeMagicLensMinQv,
  normalizeMagicLensRadius,
  resolveMagicLensSelection,
  summarizeMagicLensCells,
  type MagicLensCircleFilter,
  type MagicLensScope,
  type MagicLensState,
} from './features/roi/magicLensModel'
import {
  ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
  ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT,
  ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS,
  defaultRoiName,
  deferRoiGeneRefinement,
  emptyRoiGeneStats,
  roiCellsToCsv,
  roiGeneStatsStatusCopy,
  roiGeneViewportWarmupKey,
  roiSelectionLabel,
  roiStatusCopy,
  roiTranscriptsToCsv,
  summarizeRoiCells,
  type RoiGeneStatsState,
  type RoiGeneViewportWarmupState,
  type RoiState,
  type RoiTranscriptExportState,
} from './features/roi/roiModel'
import { createDiagnosticsDump } from './features/diagnostics/diagnosticsDump'
import {
  annotationStatusCopy,
  colorsForAnnotations,
  customAnnotationFilePrefix,
  hasReadyAnnotationsAfterRemove,
  mergeImportedAnnotations,
  removeAnnotationColor,
  removeAnnotationColorsByPrefix,
  type AnnotationGroupState,
  type AnnotationState,
} from './features/annotations/annotationModel'
import {
  defaultGeneSetName,
  filterGeneOptions,
  formatGeneScaleValue,
  type GeneExpressionScaleDomain,
  type GeneExpressionState,
  geneExpressionModeLabel,
  geneExpressionScaleKeyFor,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
  type GenePanelState,
  isGeneExpressionDetailMode,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
  parseGeneSetSymbols,
  type SavedGeneSet,
} from './features/genes/geneControlsModel'
import {
  createStructuredLoadError,
  formatStructuredError,
  isStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from './features/errors/loadErrorModel'
import type {
  BoundaryLoadState,
  CellFeatureMatrixCapabilityState,
  DatasetDiagnosticsState,
  DatasetLoadState,
  DatasetWarmupState,
  MorphologyLoadState,
} from './features/dataset/datasetLoadModel'
import { slug } from './utils/slug'
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
import { asCellId, type CellId } from './data/cellid'
import { loadDatasetRoiGeneStats as defaultLoadDatasetRoiGeneStats } from './data/roiGeneStats'
import { loadDatasetRoiTranscripts as defaultLoadDatasetRoiTranscripts } from './data/roiTranscripts'
import {
  CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  DEFAULT_CELL_TRANSCRIPT_MIN_QV,
  loadDatasetCellTranscriptDistribution as defaultLoadDatasetCellTranscriptDistribution,
  type CellTranscriptZDistribution,
} from './data/cellTranscripts'
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
  type TranscriptAggregateResult,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
  type TranscriptGroupSummary,
  type TranscriptPoint,
} from './data/transcriptOverlay'
import {
  normalizeRoiSelection,
  type RoiSelection,
  type RoiSelectionInput,
} from './data/roiSelection'
import { parseCustomAnnotations } from './data/customAnnotations'
import {
  runDatasetDiagnostics as defaultRunDatasetDiagnostics,
  summarizeDatasetDiagnostics,
} from './data/datasetDiagnostics'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import {
  formatShareableState,
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
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  TRANSCRIPT_POINT_COLOR_MODE_OPTIONS,
  geneExpressionCellsToLayerData,
  geneExpressionScoreDomainMax,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  isTranscriptDensityColorScale,
  isTranscriptPointColorMode,
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
import type { BBox } from './data/coords'
import type { ChannelAutoContrast } from './data/morphologyContrast'
import type {
  DatasetCell,
  DatasetTranscript,
  GeneExpressionBatch,
} from './datasets/xeniumDataset'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage, MorphologyImageChannel } from './data/morphologyImage'
import type { MorphologyCanvasChannel } from './components/MorphologyCanvas'
import type { AnnotationColorStyle, ObservationColorMode } from './rendering/cellStyling'
import type { AnalysisEmbedding, AnalysisEmbeddingKind } from './data/analysisEmbeddings'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from './data/datasetAnnotations'
import type { Annotation, ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type { GeneExpressionDetailMode } from './data/geneExpressionLod'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from './rendering/deckLayers'
import type { RoiGeneStats } from './data/roiGeneStats'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerViewportDetail,
} from './components/ViewerCore'

const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const EMPTY_GENE_LIST: readonly string[] = []

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
export type CellTranscriptDistributionLoader = (
  baseUrl: string,
  cellId: CellId,
  options?: {
    readonly signal?: AbortSignal
    readonly limit?: number
    readonly minQv?: number
    readonly binCount?: number
  },
) => Promise<CellTranscriptZDistribution>
export type TranscriptCapabilitiesLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<TranscriptCapabilities>
export type TranscriptAggregateLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: {
    readonly signal?: AbortSignal
    readonly mode?: 'density'
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
  readonly loadCellTranscriptDistribution?: CellTranscriptDistributionLoader
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
  loadCellTranscriptDistribution = defaultLoadDatasetCellTranscriptDistribution,
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
  const transcriptPointColorInputId = useId()
  const transcriptPointBudgetInputId = useId()
  const transcriptMinQvInputId = useId()
  const transcriptFeatureFilterInputId = useId()
  const transcriptFeatureSearchInputId = useId()
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
  const [loadState, setLoadState] = useState<DatasetLoadState<StructuredLoadError>>({
    status: 'idle',
  })
  const [datasetWarmupState, setDatasetWarmupState] = useState<DatasetWarmupState>({
    status: 'idle',
  })
  const [cellFeatureMatrixCapabilityState, setCellFeatureMatrixCapabilityState] =
    useState<CellFeatureMatrixCapabilityState>({
      status: 'idle',
    })
  const [diagnosticsState, setDiagnosticsState] = useState<
    DatasetDiagnosticsState<StructuredLoadError>
  >({ status: 'idle' })
  const [morphologyState, setMorphologyState] = useState<
    MorphologyLoadState<StructuredLoadError>
  >({ status: 'idle' })
  const [boundaryState, setBoundaryState] = useState<
    BoundaryLoadState<StructuredLoadError>
  >({ status: 'idle' })
  const [genePanelState, setGenePanelState] = useState<
    GenePanelState<StructuredLoadError>
  >({
    status: 'idle',
  })
  const [annotationState, setAnnotationState] = useState<
    AnnotationState<StructuredLoadError>
  >({
    status: 'idle',
  })
  const [annotationGroupState, setAnnotationGroupState] = useState<
    AnnotationGroupState<StructuredLoadError>
  >({ status: 'idle' })
  const [analysisEmbeddingState, setAnalysisEmbeddingState] = useState<
    AnalysisEmbeddingState<StructuredLoadError>
  >({
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
  const [roiState, setRoiState] = useState<RoiState<StructuredLoadError>>({
    status: 'idle',
  })
  const [roiGeneStatsState, setRoiGeneStatsState] = useState<
    RoiGeneStatsState<StructuredLoadError>
  >({ status: 'idle' })
  const [roiGeneViewportWarmupState, setRoiGeneViewportWarmupState] =
    useState<RoiGeneViewportWarmupState>({ status: 'idle' })
  const [roiTranscriptExportState, setRoiTranscriptExportState] = useState<
    RoiTranscriptExportState<StructuredLoadError>
  >({ status: 'idle' })
  const [transcriptCapabilityState, setTranscriptCapabilityState] = useState<
    TranscriptCapabilityState<StructuredLoadError>
  >({ status: 'idle' })
  const [transcriptLayerState, setTranscriptLayerState] = useState<
    TranscriptLayerState<StructuredLoadError>
  >({
    status: 'idle',
  })
  const [magicLensState, setMagicLensState] = useState<
    MagicLensState<StructuredLoadError>
  >({ status: 'idle' })
  const [cellDetailState, setCellDetailState] = useState<
    CellDetailState<StructuredLoadError>
  >({ status: 'idle' })
  const [cellTranscriptDistributionState, setCellTranscriptDistributionState] = useState<
    CellTranscriptDistributionState<StructuredLoadError>
  >({
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
  const [transcriptPointColorMode, setTranscriptPointColorMode] =
    useState<TranscriptPointColorMode>(
      () =>
        parseTranscriptPointColorMode(initialShareableState.transcriptPointColorMode) ??
        DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
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
  const [pinnedTranscript, setPinnedTranscript] =
    useState<ViewerTranscriptHoverDetail | null>(null)
  const [manualTranscriptExactRequestKey, setManualTranscriptExactRequestKey] = useState<
    string | null
  >(null)
  const [transcriptFeatureSearch, setTranscriptFeatureSearch] = useState('')
  const [debugLog, setDebugLog] = useState<readonly DebugLogEntry[]>([])
  const [telemetryEvents, setTelemetryEvents] = useState<readonly TelemetryEvent[]>([])
  const [isControlHudCollapsed, setIsControlHudCollapsed] = useState(false)
  const [activeControlHudTab, setActiveControlHudTab] = useState<ControlHudTab>(
    () => parseControlHudTab(initialShareableState.activeTab) ?? 'dataset',
  )
  const [geneExpressionState, setGeneExpressionState] = useState<
    GeneExpressionState<StructuredLoadError>
  >({ status: 'idle' })
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
    initialShareableState.shouldLoadMorphology ?? true,
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
  const effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode =
    selectedGenes.length === 0 ? 'all' : transcriptFeatureFilterMode
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
  const cellTranscriptDistributionRequestId = useRef(0)
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
  const cellTranscriptDistributionAbortRef = useRef<AbortController | null>(null)
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
  const startDatasetLoadRef = useRef<
    ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null
  >(null)
  const initialShouldLoadMorphologyRef = useRef(shouldLoadMorphology)
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
    () =>
      transcriptPointsToLayerData(
        transcriptPointsForRendering(transcriptLayerState),
        transcriptPointColorMode,
      ),
    [transcriptLayerState, transcriptPointColorMode],
  )
  const transcriptDensityScaleMax =
    transcriptAggregateScaleMaxForRendering(transcriptLayerState)
  const transcriptDensityScaleLabels = transcriptDensityScaleValueLabels(
    transcriptDensityScaleMax,
  )
  const transcriptLayerAggregateBins = useMemo(() => {
    return transcriptAggregateBinsToLayerData(
      transcriptAggregateBinsForRendering(transcriptLayerState),
      transcriptDensityColorScale,
      transcriptDensityScaleMax === undefined
        ? {}
        : { scaleMax: transcriptDensityScaleMax },
    )
  }, [transcriptDensityColorScale, transcriptDensityScaleMax, transcriptLayerState])
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
  const filteredTranscriptFeatures = useMemo(
    () => filterGeneOptions(geneOptions, transcriptFeatureSearch, selectedGenes),
    [geneOptions, selectedGenes, transcriptFeatureSearch],
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

    if (cellTranscriptDistributionState.status === 'loading') {
      tasks.push({
        id: 'cell-transcripts',
        tabId: 'cell',
        label: 'Loading cell z distribution',
        detail: shortIdentifier(cellTranscriptDistributionState.cellId),
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
    cellTranscriptDistributionState,
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
    (message: string, options: DebugLogAppendOptions = {}) => {
      debugLogIdRef.current += 1
      const entry = createDebugLogEntry(debugLogIdRef.current, message, options)

      setDebugLog((current) => appendDebugLogEntry(current, entry))
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
        cellTranscriptDistributionState.status === 'error'
          ? cellTranscriptDistributionState.error
          : null,
      ].filter(isStructuredLoadError),
    [
      annotationState,
      annotationGroupState,
      analysisEmbeddingState,
      boundaryState,
      cellDetailState,
      cellTranscriptDistributionState,
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
      effectiveTranscriptFeatureFilterMode === 'selected'
        ? selectedGenes
        : EMPTY_GENE_LIST
    const aggregateFeatureNames = EMPTY_GENE_LIST
    const hasSelectedFeatureFilter =
      effectiveTranscriptFeatureFilterMode !== 'selected' || featureNames.length > 0
    const plan = planTranscriptLod(currentViewportDetail, {
      detailMode: transcriptDetailMode,
      visibleTranscriptEstimate,
      exactLimit: transcriptExactPointLimit,
      hasRawParquet: transcriptCapabilityState.capabilities.rawParquet,
      hasNativeZarr: transcriptCapabilityState.capabilities.nativeZarr,
      hasSelectedFeatureFilter,
    })

    if (plan.kind === 'native-zarr') {
      const maxBins = TRANSCRIPT_NATIVE_DENSITY_MAX_BINS
      const requestKey = transcriptAggregateRequestKey(
        loadState.url,
        currentViewportDetail.bbox,
        {
          mode: plan.mode,
          featureNames: aggregateFeatureNames,
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
        featureNames: aggregateFeatureNames,
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
            ...(result.scaleMax === undefined ? {} : { scaleMax: result.scaleMax }),
            durationMs,
          })
          appendDebugEvent(
            `Native transcript aggregate ready: ${result.bins.length.toLocaleString()} squares in ${formatElapsed(
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
      transcriptDetailMode !== 'exact' &&
      visibleTranscriptEstimate > 0
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const aggregateRequestId = transcriptRequestId.current
      const fallbackMode = 'density'
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
              featureFilterMode: effectiveTranscriptFeatureFilterMode,
              selectedFeatureCount: featureNames.length,
            }),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            scaleMax: maxTranscriptAggregateCount(bins),
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

    if (
      isTranscriptExactManualLoadRequired(
        plan.visibleTranscriptEstimate,
        transcriptExactPointLimit,
      ) &&
      manualTranscriptExactRequestKey !== requestKey
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestId.current += 1
      const waitingRequestId = transcriptRequestId.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestId.current === waitingRequestId) {
          setTranscriptLayerState({
            status: 'waiting',
            message: transcriptExactManualLoadMessage(
              plan.visibleTranscriptEstimate,
              transcriptExactPointLimit,
            ),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            exactLoadRequestKey: requestKey,
            exactLoadEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      appendDebugEvent('Transcript exact query waiting for manual viewport load', {
        coalesceKey: 'transcript-query',
      })
      return
    }

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
    effectiveTranscriptFeatureFilterMode,
    loadState,
    loadTranscriptAggregates,
    loadTranscriptViewport,
    manualTranscriptExactRequestKey,
    overviewCells,
    selectedGenes,
    showTranscriptOverlay,
    transcriptCapabilityState,
    transcriptDetailMode,
    transcriptExactPointLimit,
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
        transcriptPointColorMode,
        transcriptExactPointLimit,
        transcriptMinQv,
        transcriptGeneOnly,
        transcriptFeatureFilterMode: effectiveTranscriptFeatureFilterMode,
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
    effectiveTranscriptFeatureFilterMode,
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
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
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
    if (selectedCell === null || loadState.status !== 'ready') {
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestId.current += 1
      const requestId = cellTranscriptDistributionRequestId.current
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestId.current === requestId) {
          setCellTranscriptDistributionState({ status: 'idle' })
        }
      })
      return
    }

    const requestId = cellTranscriptDistributionRequestId.current + 1
    const distributionStartedAt = readTimestamp()
    const abortController = new AbortController()
    abortActiveRequest(cellTranscriptDistributionAbortRef)
    cellTranscriptDistributionRequestId.current = requestId
    cellTranscriptDistributionAbortRef.current = abortController

    queueMicrotask(() => {
      if (
        abortController.signal.aborted ||
        cellTranscriptDistributionRequestId.current !== requestId
      ) {
        return
      }

      setCellTranscriptDistributionState({
        status: 'loading',
        url: loadState.url,
        cellId: selectedCell.id,
      })
    })
    appendDebugEvent(
      `Cell transcript z distribution started: ${shortIdentifier(selectedCell.id)}`,
      { coalesceKey: 'cell-transcripts' },
    )

    void loadCellTranscriptDistribution(loadState.url, asCellId(selectedCell.id), {
      signal: abortController.signal,
      limit: CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
      minQv: DEFAULT_CELL_TRANSCRIPT_MIN_QV,
      binCount: CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
    })
      .then((distribution) => {
        if (
          abortController.signal.aborted ||
          cellTranscriptDistributionRequestId.current !== requestId
        ) {
          return
        }

        setCellTranscriptDistributionState({
          status: 'ready',
          url: loadState.url,
          cellId: selectedCell.id,
          distribution,
        })
        appendDebugEvent(
          `Cell transcript z distribution ready: ${distribution.zCount.toLocaleString()} z records in ${formatElapsed(
            distributionStartedAt,
          )}`,
          { coalesceKey: 'cell-transcripts' },
        )
      })
      .catch((error) => {
        if (
          isAbortError(error) ||
          cellTranscriptDistributionRequestId.current !== requestId
        ) {
          return
        }

        setCellTranscriptDistributionState({
          status: 'error',
          url: loadState.url,
          cellId: selectedCell.id,
          error: createStructuredLoadError('Cell transcripts', error),
        })
        appendDebugEvent(
          `Cell transcript z distribution failed (${formatElapsed(
            distributionStartedAt,
          )})`,
          { coalesceKey: 'cell-transcripts' },
        )
      })
      .finally(() => {
        if (cellTranscriptDistributionAbortRef.current === abortController) {
          cellTranscriptDistributionAbortRef.current = null
        }
      })

    return () => {
      if (cellTranscriptDistributionAbortRef.current === abortController) {
        abortActiveRequest(cellTranscriptDistributionAbortRef)
      }
    }
  }, [appendDebugEvent, loadCellTranscriptDistribution, loadState, selectedCell])

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
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      clearTimeoutRef(magicLensDebounceRef)
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    }
  }, [])

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

  async function startDatasetLoad(datasetUrl: string, loadImage: boolean) {
    const requestedUrl = datasetUrl.trim()

    if (requestedUrl !== '') {
      const requestId = loadRequestId.current + 1
      const loadStartedAt = readTimestamp()
      const sharedState = initialShareableStateRef.current
      const shouldRestoreSharedState =
        sharedState?.datasetUrl !== undefined &&
        sharedState.datasetUrl.trim() === requestedUrl
      const sharedSelectedGenes = shouldRestoreSharedState
        ? (sharedState.selectedGenes ?? [])
        : []
      if (!shouldRestoreSharedState) {
        initialShareableStateRef.current = null
      }
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
      abortActiveRequest(cellTranscriptDistributionAbortRef)
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
      setTranscriptFeatureSearch('')
      setHoveredTranscript(null)
      setPinnedTranscript(null)
      setManualTranscriptExactRequestKey(null)
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
      setTranscriptPointColorMode(
        shouldRestoreSharedState
          ? (parseTranscriptPointColorMode(sharedState?.transcriptPointColorMode) ??
              transcriptPointColorMode)
          : transcriptPointColorMode,
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
      setCellTranscriptDistributionState({ status: 'idle' })
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
      cellTranscriptDistributionRequestId.current += 1
      magicLensLastDetailRef.current = null
      magicLensLastQueryKeyRef.current = null
      boundaryViewportKeyRef.current = null
      geneExpressionViewportKeyRef.current = null
      transcriptViewportKeyRef.current = null
      lastViewportDetailRef.current = null
      initialSharedRoiSelectionRef.current = shouldRestoreSharedState
        ? (sharedState?.roiSelection ?? null)
        : null
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
        initialShareableStateRef.current = null
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
        initialShareableStateRef.current = null
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

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')
    const loadImage = formData.get('loadMorphologyImage') === 'on'

    if (typeof datasetUrl === 'string') {
      await startDatasetLoad(datasetUrl, loadImage)
    }
  }

  useEffect(() => {
    startDatasetLoadRef.current = startDatasetLoad
  })

  useEffect(() => {
    const initialDatasetUrl = initialShareableState.datasetUrl?.trim()

    if (initialDatasetUrl === undefined || initialDatasetUrl === '') {
      return
    }

    void startDatasetLoadRef.current?.(
      initialDatasetUrl,
      initialShouldLoadMorphologyRef.current,
    )
  }, [initialShareableState.datasetUrl])

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
          hoveredTranscript,
          loadState,
          manualTranscriptExactRequestKey,
          observationColorMode,
          performanceBudget,
          pinnedTranscript,
          selectedGenes,
          shareableViewState,
          shouldLoadMorphology,
          telemetryEvents,
          showTranscriptOverlay,
          transcriptCapabilityState,
          transcriptDetailMode,
          transcriptDensityColorScale,
          transcriptExactPointLimit,
          transcriptExactManualLoadRatio: TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
          transcriptFeatureFilterMode: effectiveTranscriptFeatureFilterMode,
          transcriptGeneOnly,
          transcriptLayerState,
          transcriptMinQv,
          transcriptOpacity,
          transcriptPointColorMode,
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
    setManualTranscriptExactRequestKey(null)
    setSelectedGenes((current) =>
      isSelected
        ? current.filter((selectedGene) => selectedGene !== gene)
        : [...current, gene].sort((a, b) => a.localeCompare(b)),
    )
  }

  function handleLoadExactViewport(requestKey: string) {
    setManualTranscriptExactRequestKey(requestKey)
    transcriptViewportKeyRef.current = null
    appendDebugEvent('Transcript exact viewport manually approved', {
      coalesceKey: 'transcript-query',
    })
  }

  function handlePinTranscript(detail: ViewerTranscriptHoverDetail) {
    setPinnedTranscript(detail)
    setActiveControlHudTab('transcripts')
    appendDebugEvent(
      detail.transcript === undefined
        ? 'Pinned transcript density bin'
        : `Pinned transcript ${detail.transcript.transcriptId ?? detail.transcript.id}`,
      { coalesceKey: 'transcript-pin' },
    )
  }

  function pickTranscriptFeature(gene: string) {
    if (!geneOptions.includes(gene)) {
      return
    }

    appendDebugEvent(`Transcript feature filter added ${gene}`, {
      coalesceKey: 'transcript-feature-picker',
    })
    resetGeneExpressionSelectionState()
    transcriptViewportKeyRef.current = null
    setManualTranscriptExactRequestKey(null)
    setTranscriptFeatureFilterMode('selected')
    setSelectedGenes((current) =>
      current.includes(gene)
        ? current
        : [...current, gene].sort((a, b) => a.localeCompare(b)),
    )
    setTranscriptFeatureSearch('')
  }

  function applyGeneSetSymbols() {
    const genes = parseGeneSetSymbols(geneSetSymbols, geneOptions)

    if (genes.length === 0) {
      return
    }

    appendDebugEvent(`Applied symbols: ${genes.length.toLocaleString()} genes`)
    setSelectedGenes(genes)
    resetGeneExpressionSelectionState()
    transcriptViewportKeyRef.current = null
    setManualTranscriptExactRequestKey(null)
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
    transcriptViewportKeyRef.current = null
    setManualTranscriptExactRequestKey(null)
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
            <DatasetHudPanel
              active={activeControlHudTab === 'dataset'}
              datasetInputId={datasetInputId}
              morphologyInputId={morphologyInputId}
              boundaryLimitInputId={boundaryLimitInputId}
              datasetUrl={datasetUrl}
              shouldLoadMorphology={shouldLoadMorphology}
              boundaryCellLimit={boundaryCellLimit}
              maxBoundaryCellLimit={MAX_BOUNDARY_VIEWPORT_CELL_LIMIT}
              isLoading={isLoading}
              diagnosticsState={diagnosticsState}
              cellFeatureMatrixCapabilityState={cellFeatureMatrixCapabilityState}
              activeErrors={activeErrors}
              debugLog={debugLog}
              onSubmit={handleDatasetSubmit}
              onDatasetUrlChange={setDatasetUrl}
              onShouldLoadMorphologyChange={(checked) => {
                setShouldLoadMorphology(checked)
                appendDebugEvent(
                  checked ? 'Morphology image enabled' : 'Morphology image disabled',
                )
              }}
              onBoundaryCellLimitChange={(value) => {
                const nextLimit = normalizeBoundaryCellLimit(value)
                setBoundaryCellLimit(nextLimit)
                appendDebugEvent(`Boundary limit: ${nextLimit.toLocaleString()}`, {
                  coalesceKey: 'boundary-limit',
                })
              }}
              onRunDatasetDiagnostics={() => {
                void handleRunDatasetDiagnostics()
              }}
              onDownloadDiagnostics={handleDownloadDiagnostics}
              onClearDebugLog={() => {
                setDebugLog([])
              }}
            />

            <LayerHudPanel
              active={activeControlHudTab === 'layers'}
              scaffoldDeckLayerCount={scaffoldDeckLayerCount}
              bundledDeckVersion={bundledDeckVersion}
              performanceBudget={performanceBudget}
              imageOpacityInputId={imageOpacityInputId}
              cellFillOpacityInputId={cellFillOpacityInputId}
              cellBoundaryOpacityInputId={cellBoundaryOpacityInputId}
              coordinateUnitInputId={coordinateUnitInputId}
              imageLayerOpacity={imageLayerOpacity}
              cellFillOpacity={cellFillOpacity}
              cellBoundaryOpacity={cellBoundaryOpacity}
              coordinateUnit={coordinateUnit}
              morphologyChannels={morphologyImage?.channelLoaders ?? []}
              morphologyChannelSettings={morphologyChannelSettings}
              autoContrastChannelIds={autoContrastChannelIds}
              onImageLayerOpacityPercentChange={(nextPercent) => {
                setImageLayerOpacity(percentToOpacity(nextPercent))
                appendDebugEvent(`Image opacity: ${nextPercent}%`, {
                  coalesceKey: 'image-opacity',
                })
              }}
              onCellFillOpacityPercentChange={(nextPercent) => {
                setCellFillOpacity(percentToOpacity(nextPercent))
                appendDebugEvent(`Cell fill opacity: ${nextPercent}%`, {
                  coalesceKey: 'cell-fill-opacity',
                })
              }}
              onCellBoundaryOpacityPercentChange={(nextPercent) => {
                setCellBoundaryOpacity(percentToOpacity(nextPercent))
                appendDebugEvent(`Cell boundary opacity: ${nextPercent}%`, {
                  coalesceKey: 'cell-boundary-opacity',
                })
              }}
              onCoordinateUnitChange={(nextUnit) => {
                if (coordinateUnit === nextUnit) {
                  return
                }

                setCoordinateUnit(nextUnit)
                appendDebugEvent(
                  `Mouse coordinates: ${nextUnit === 'um' ? 'μm' : 'px'}`,
                  { coalesceKey: 'coordinate-unit' },
                )
              }}
              onAutoContrast={handleAutoContrast}
              onUpdateMorphologyChannel={updateMorphologyChannel}
            />

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
                      setManualTranscriptExactRequestKey(null)
                      appendDebugEvent(`Transcript detail: ${nextMode}`, {
                        coalesceKey: 'transcript-detail',
                      })
                    }
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="density">Density</option>
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
                    setManualTranscriptExactRequestKey(null)
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
                  value={effectiveTranscriptFeatureFilterMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isTranscriptFeatureFilterMode(nextMode)) {
                      setTranscriptFeatureFilterMode(nextMode)
                      transcriptViewportKeyRef.current = null
                      setManualTranscriptExactRequestKey(null)
                      appendDebugEvent(`Transcript feature filter: ${nextMode}`, {
                        coalesceKey: 'transcript-feature-filter',
                      })
                    }
                  }}
                >
                  <option value="selected" disabled={selectedGenes.length === 0}>
                    Selected genes
                  </option>
                  <option value="all">All features</option>
                </select>

                {selectedGenes.length === 0 ? null : (
                  <div
                    className="gene-chip-row"
                    aria-label="Transcript selected features"
                  >
                    {selectedGenes.map((gene) => (
                      <button
                        key={gene}
                        type="button"
                        className="gene-chip"
                        onClick={() => {
                          toggleGene(gene)
                          transcriptViewportKeyRef.current = null
                        }}
                      >
                        {gene}
                      </button>
                    ))}
                  </div>
                )}

                <label htmlFor={transcriptFeatureSearchInputId}>Feature search</label>
                <input
                  id={transcriptFeatureSearchInputId}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={transcriptFeatureSearch}
                  disabled={genePanelState.status !== 'ready'}
                  placeholder="Search transcript features"
                  onChange={(event) => {
                    setTranscriptFeatureSearch(event.currentTarget.value)
                  }}
                />

                {transcriptFeatureSearch.trim() === '' ? null : (
                  <div
                    className="gene-option-list"
                    aria-label="Transcript feature options"
                  >
                    {filteredTranscriptFeatures.length === 0 ? (
                      <span className="option-empty">No matching features</span>
                    ) : (
                      filteredTranscriptFeatures.map((gene) => (
                        <button
                          key={gene}
                          type="button"
                          onClick={() => {
                            pickTranscriptFeature(gene)
                          }}
                        >
                          {gene}
                        </button>
                      ))
                    )}
                  </div>
                )}

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
                  <div
                    className="transcript-density-scale-preview-wrap"
                    aria-label={transcriptDensityScaleAriaLabel(
                      transcriptDensityScaleMax,
                    )}
                  >
                    <span
                      className={`transcript-density-scale-preview transcript-density-scale-preview-${transcriptDensityColorScale}`}
                      aria-hidden="true"
                    />
                    <span className="transcript-density-scale-values" aria-hidden="true">
                      <span>{transcriptDensityScaleLabels[0]}</span>
                      <span>{transcriptDensityScaleLabels[1]}</span>
                      <span>{transcriptDensityScaleLabels[2]}</span>
                    </span>
                  </div>
                </div>

                <label htmlFor={transcriptPointColorInputId}>Point color</label>
                <select
                  id={transcriptPointColorInputId}
                  value={transcriptPointColorMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isTranscriptPointColorMode(nextMode)) {
                      setTranscriptPointColorMode(nextMode)
                      appendDebugEvent(`Transcript point color: ${nextMode}`, {
                        coalesceKey: 'transcript-point-color',
                      })
                    }
                  }}
                >
                  {TRANSCRIPT_POINT_COLOR_MODE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

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
                    setManualTranscriptExactRequestKey(null)
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
                      setManualTranscriptExactRequestKey(null)
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
                  pinnedTranscript={pinnedTranscript}
                  onPinTranscript={handlePinTranscript}
                  onClearPinnedTranscript={() => {
                    setPinnedTranscript(null)
                  }}
                  onLoadExactViewport={handleLoadExactViewport}
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

            <CellHudPanel
              active={activeControlHudTab === 'cell'}
              embeddingViewInputId={embeddingViewInputId}
              embeddingCopy={embeddingCopy}
              analysisEmbeddingState={analysisEmbeddingState}
              activeEmbedding={activeEmbedding}
              selectedEmbeddingKind={selectedEmbeddingKind}
              roiCellIds={roiCellIds}
              selectedCell={selectedCell}
              cellDetailCopy={cellDetailCopy}
              cellDetailState={cellDetailState}
              cellTranscriptDistributionState={cellTranscriptDistributionState}
              loadEnabled={loadState.status === 'ready'}
              onEmbeddingKindChange={(nextEmbeddingKind) => {
                setSelectedEmbeddingKind(nextEmbeddingKind)
                appendDebugEvent(`Embedding view: ${nextEmbeddingKind}`)
              }}
              onLoadAnalysisEmbeddings={handleLoadAnalysisEmbeddings}
              onSelectEmbeddingCell={handleEmbeddingCellSelect}
            />

            <RoiHudPanel
              active={activeControlHudTab === 'roi'}
              roiNameInputId={roiNameInputId}
              roiHeaderCopy={roiHeaderCopy}
              isLoading={isRoiTabLoading}
              canDrawRoi={canDrawRoi}
              roiMode={roiMode}
              roiName={roiName}
              loadEnabled={loadState.status === 'ready'}
              roiState={roiState}
              roiSummary={roiSummary}
              roiGeneStatsCopy={roiGeneStatsCopy}
              roiGeneStatsState={roiGeneStatsState}
              roiTranscriptExportState={roiTranscriptExportState}
              onRoiModeChange={(nextMode) => {
                setRoiMode(nextMode)
                appendDebugEvent(
                  nextMode === 'idle'
                    ? 'ROI draw cancelled'
                    : nextMode === 'box'
                      ? 'ROI draw mode enabled'
                      : 'ROI lasso mode enabled',
                )
              }}
              onClearRoi={handleClearRoi}
              onRoiNameChange={setRoiName}
              onSaveRoiAnnotation={handleSaveRoiAnnotation}
              onExportRoiCells={handleExportRoiCells}
              onExportRoiTranscripts={handleExportRoiTranscripts}
            />
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
          onTranscriptClick={handlePinTranscript}
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
