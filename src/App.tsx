import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ViewerCore,
  type ViewerCoordinateUnit,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import { ControlHudShell } from './features/control-hud/ControlHudShell'
import { DatasetHudPanel } from './features/control-hud/DatasetHudPanel'
import { LayerHudPanel } from './features/control-hud/LayerHudPanel'
import { CellHudPanel } from './features/control-hud/CellHudPanel'
import { RoiHudPanel } from './features/control-hud/RoiHudPanel'
import { TranscriptHudPanel } from './features/transcripts/TranscriptHudPanel'
import { useTranscriptWorkflow } from './features/transcripts/useTranscriptWorkflow'
import { GeneHudPanel } from './features/genes/GeneHudPanel'
import { useGeneExpressionLayerTelemetry } from './features/genes/useGeneExpressionLayerTelemetry'
import { AnnotationHudPanel } from './features/annotations/AnnotationHudPanel'
import {
  parseControlHudTab,
  parseObservationColorMode,
  parseViewerCoordinateUnit,
  readShareableStateFromLocation,
  type ControlHudTab,
} from './features/app-shell/appShellModel'
import {
  defaultAppDependencies,
  type AppProps,
} from './features/app-shell/appDependencies'
import { useAppControlIds } from './features/app-shell/useAppControlIds'
import { useViewerLayerData } from './features/app-shell/useViewerLayerData'
import { useDatasetLifecycle } from './features/app-shell/useDatasetLifecycle'
import { useViewportDataWorkflow } from './features/app-shell/useViewportDataWorkflow'
import {
  abortActiveRequest,
  appendDebugLogEntry,
  createLoadingTasks,
  createDebugLogEntry,
  type DebugLogAppendOptions,
  type DebugLogEntry,
} from './features/app-shell/appRuntimeModel'
import {
  TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
  normalizeTranscriptMinQv,
  normalizeTranscriptPointSize,
  parseTranscriptDensityColorScale,
  parseTranscriptDetailMode,
  parseTranscriptFeatureFilterMode,
  parseTranscriptPointColorMode,
  transcriptStatusCopy,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './features/transcripts/transcriptLayerModel'
import {
  cellDetailStatusCopy,
  type CellDetailState,
  type CellTranscriptDistributionState,
} from './features/cells/cellDetailModel'
import { useCellDetailWorkflow } from './features/cells/useCellDetailWorkflow'
import {
  analysisEmbeddingStatusCopy,
  type AnalysisEmbeddingState,
} from './features/analysis/analysisEmbeddingModel'
import { useAnalysisEmbeddingWorkflow } from './features/analysis/useAnalysisEmbeddingWorkflow'
import type { MorphologyChannelSetting } from './features/morphology/morphologyChannels'
import { useMorphologyWorkflow } from './features/morphology/useMorphologyWorkflow'
import { MagicLensHudPanel } from './features/roi/MagicLensHudPanel'
import {
  magicLensScopeLabel,
  magicLensStatusCopy,
  type MagicLensScope,
  type MagicLensState,
} from './features/roi/magicLensModel'
import { useMagicLensWorkflow } from './features/roi/useMagicLensWorkflow'
import { useRoiWorkflow } from './features/roi/useRoiWorkflow'
import {
  ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
  roiGeneStatsStatusCopy,
  roiGeneViewportWarmupKey,
  roiStatusCopy,
  summarizeRoiCells,
  type RoiGeneStatsState,
  type RoiGeneViewportWarmupState,
  type RoiState,
  type RoiTranscriptExportState,
} from './features/roi/roiModel'
import { useDatasetDiagnosticsWorkflow } from './features/diagnostics/useDatasetDiagnosticsWorkflow'
import {
  annotationStatusCopy,
  type AnnotationGroupState,
  type AnnotationState,
} from './features/annotations/annotationModel'
import { useAnnotationWorkflow } from './features/annotations/useAnnotationWorkflow'
import {
  defaultGeneSetName,
  filterGeneOptions,
  type GeneExpressionScaleDomain,
  type GeneExpressionState,
  geneExpressionModeLabel,
  geneExpressionScaleKeyFor,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
  type GenePanelState,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
  parseGeneSetSymbols,
  type SavedGeneSet,
} from './features/genes/geneControlsModel'
import {
  collectStructuredLoadErrors,
  createStructuredLoadError,
  formatStructuredError,
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
import { scaffoldDeckLayerCount } from './components/viewerCoreModel'
import { ALL_ANNOTATION_GROUP_ID } from './data/datasetAnnotations'
import {
  normalizeTranscriptExactPointLimit,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from './data/transcriptOverlay'
import { type RoiSelection } from './data/roiSelection'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import {
  formatShareableState,
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
  normalizeBoundaryCellLimit,
} from './rendering/boundaryViewport'
import {
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  geneExpressionScoreDomainMax,
  bundledDeckVersion,
} from './rendering/deckLayers'
import { percentToOpacity } from './rendering/layerOpacity'
import { useViewerStore } from './store/viewerStore'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import type { MorphologyImage } from './data/morphologyImage'
import type { ObservationColorMode } from './rendering/cellStyling'
import type { AnalysisEmbeddingKind } from './data/analysisEmbeddings'
import type { SpatialElement } from './datasets/spatialDataset'
import type { GeneExpressionDetailMode } from './data/geneExpressionLod'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from './rendering/deckLayers'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerViewportDetail,
} from './components/ViewerCore'

export type {
  AnalysisEmbeddingsLoader,
  AnnotationGroupLoader,
  AnnotationLoader,
  AutoChannelContrastLoader,
  BoundaryElementsLoader,
  CellTranscriptDistributionLoader,
  DatasetDiagnosticsRunner,
  DatasetOverviewLoader,
  DatasetWarmupLoader,
  GeneExpressionLoader,
  GenePanelLoader,
  MorphologyImageLoader,
  RoiCellsLoader,
  RoiGeneStatsLoader,
  RoiTranscriptsLoader,
  TranscriptAggregateLoader,
  TranscriptCapabilitiesLoader,
  TranscriptViewportLoader,
} from './features/app-shell/appDependencies'

export function App({
  loadDatasetOverview = defaultAppDependencies.loadDatasetOverview,
  loadMorphologyImage = defaultAppDependencies.loadMorphologyImage,
  loadBoundaryElements = defaultAppDependencies.loadBoundaryElements,
  loadGenePanel = defaultAppDependencies.loadGenePanel,
  loadAnnotations = defaultAppDependencies.loadAnnotations,
  loadAnnotationGroups = defaultAppDependencies.loadAnnotationGroups,
  loadAnalysisEmbeddings = defaultAppDependencies.loadAnalysisEmbeddings,
  loadRoiCells = defaultAppDependencies.loadRoiCells,
  loadRoiGeneStats = defaultAppDependencies.loadRoiGeneStats,
  loadRoiTranscripts = defaultAppDependencies.loadRoiTranscripts,
  loadCellTranscriptDistribution = defaultAppDependencies.loadCellTranscriptDistribution,
  loadTranscriptCapabilities = defaultAppDependencies.loadTranscriptCapabilities,
  loadTranscriptAggregates = defaultAppDependencies.loadTranscriptAggregates,
  loadTranscriptViewport = defaultAppDependencies.loadTranscriptViewport,
  loadGeneExpression = defaultAppDependencies.loadGeneExpression,
  warmDatasetForRoi = defaultAppDependencies.warmDatasetForRoi,
  runDatasetDiagnostics = defaultAppDependencies.runDatasetDiagnostics,
  computeAutoChannelContrast = defaultAppDependencies.computeAutoChannelContrast,
}: AppProps) {
  const controlIds = useAppControlIds()
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
  const [measurementEnabled, setMeasurementEnabled] = useState(false)
  const [measurementUnit, setMeasurementUnit] = useState<ViewerCoordinateUnit>(
    () =>
      parseViewerCoordinateUnit(initialShareableState.measurementUnit) ??
      parseViewerCoordinateUnit(initialShareableState.coordinateUnit) ??
      'um',
  )
  const [measurementResetKey, setMeasurementResetKey] = useState(0)
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
  const geneExpressionLayerTimingKeyRef = useRef<string | null>(null)
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
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const {
    activeAnnotationStyleColors,
    annotationStyleColors,
    boundaryLayerData,
    geneExpressionLayerDataDurationMs,
    geneExpressionRestyleDurationMs,
    geneExpressionScaleKey,
    geneExpressionScaleMax,
    morphologyCanvasChannels,
    morphologyMicrometersPerPixel,
    overviewExtent,
    styledGeneExpressionCells,
    styledOverviewCells,
    transcriptDensityScaleLabels,
    transcriptDensityScaleMax,
    transcriptLayerAggregateBins,
    transcriptLayerPoints,
    viewerObservationColorMode,
    visibleTranscriptEstimate,
  } = useViewerLayerData({
    annotationColors,
    annotationState,
    boundaryElements,
    currentViewportBbox: currentViewportDetail?.bbox ?? null,
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionScaleDatasetUrl,
    geneExpressionScaleDomain,
    geneExpressionScoreMode,
    morphologyChannelSettings,
    morphologyImage,
    observationColorMode,
    overviewCells,
    selectedGenes,
    transcriptDensityColorScale,
    transcriptLayerState,
    transcriptPointColorMode,
  })
  const geneOptions = useMemo(
    () => (genePanelState.status === 'ready' ? genePanelState.genes : []),
    [genePanelState],
  )
  const filteredGenes = useMemo(
    () => filterGeneOptions(geneOptions, geneSearch, selectedGenes),
    [geneOptions, geneSearch, selectedGenes],
  )
  const filteredTranscriptFeatures = useMemo(
    () =>
      filterGeneOptions(geneOptions, transcriptFeatureSearch, selectedGenes, {
        limit: 24,
      }),
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
  const loadingTasks = useMemo(
    () =>
      createLoadingTasks({
        analysisEmbeddingState,
        annotationGroupState,
        annotationState,
        autoContrastChannelCount: autoContrastChannelIds.length,
        boundaryState,
        cellDetailState,
        cellTranscriptDistributionState,
        datasetWarmupState,
        diagnosticsState,
        geneExpressionState,
        geneExpressionLoadingLabel:
          geneExpressionState.status === 'loading'
            ? geneExpressionModeLabel(geneExpressionState.mode)
            : undefined,
        genePanelState,
        isRoiGeneViewportWarmupLoading,
        loadState,
        magicLensState,
        magicLensLoadingScopeLabel:
          magicLensState.status === 'loading'
            ? magicLensScopeLabel(magicLensState.scope)
            : undefined,
        morphologyState,
        roiGeneStatsState,
        roiState,
        roiTranscriptExportState,
        transcriptCapabilityState,
        transcriptLayerState,
      }),
    [
      analysisEmbeddingState,
      annotationGroupState,
      annotationState,
      autoContrastChannelIds.length,
      boundaryState,
      cellDetailState,
      cellTranscriptDistributionState,
      datasetWarmupState,
      diagnosticsState,
      geneExpressionState,
      genePanelState,
      isRoiGeneViewportWarmupLoading,
      loadState,
      magicLensState,
      morphologyState,
      roiGeneStatsState,
      roiState,
      roiTranscriptExportState,
      transcriptCapabilityState,
      transcriptLayerState,
    ],
  )
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
  useGeneExpressionLayerTelemetry({
    appendDebugEvent,
    geneExpressionBatch,
    geneExpressionLayerDataDurationMs,
    geneExpressionRestyleDurationMs,
    geneExpressionState,
    recordTelemetry,
    timingKeyRef: geneExpressionLayerTimingKeyRef,
  })
  const activeErrors = useMemo(
    () =>
      collectStructuredLoadErrors([
        loadState,
        diagnosticsState,
        morphologyState,
        boundaryState,
        genePanelState,
        annotationState,
        annotationGroupState,
        analysisEmbeddingState,
        roiState,
        roiGeneStatsState,
        roiTranscriptExportState,
        geneExpressionState,
        transcriptCapabilityState,
        transcriptLayerState,
        magicLensState,
        cellDetailState,
        cellTranscriptDistributionState,
      ]),
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
  const { handleDownloadDiagnostics, handleRunDatasetDiagnostics } =
    useDatasetDiagnosticsWorkflow({
      activeControlHudTab,
      activeErrors,
      appendDebugEvent,
      boundaryCellLimit,
      coordinateUnit,
      datasetUrl,
      debugLog,
      diagnosticsAbortRef,
      diagnosticsState,
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScoreMode,
      hoveredTranscript,
      loadState,
      manualTranscriptExactRequestKey,
      measurementEnabled,
      measurementUnit,
      observationColorMode,
      performanceBudget,
      pinnedTranscript,
      recordTelemetry,
      runDatasetDiagnostics,
      selectedGenes,
      setDiagnosticsState,
      shareableViewState,
      shouldLoadMorphology,
      showTranscriptOverlay,
      telemetryEvents,
      transcriptCapabilityState,
      transcriptDensityColorScale,
      transcriptDetailMode,
      transcriptExactManualLoadRatio: TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
      transcriptExactPointLimit,
      transcriptFeatureFilterMode: effectiveTranscriptFeatureFilterMode,
      transcriptGeneOnly,
      transcriptLayerState,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    })
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
  const { handleViewportChange } = useViewportDataWorkflow({
    appendDebugEvent,
    boundaryAbortRef,
    boundaryCellLimit,
    boundaryRequestIdRef: boundaryRequestId,
    boundaryViewportKeyRef,
    geneExpressionAbortRef,
    geneExpressionDetailMode,
    geneExpressionRequestIdRef: geneExpressionRequestId,
    geneExpressionScaleKey,
    geneExpressionScoreMode,
    geneExpressionViewportKeyRef,
    lastViewportDetailRef,
    loadBoundaryElements,
    loadGeneExpression,
    loadState,
    overviewExtent,
    recordTelemetry,
    rememberGeneExpressionScaleMax,
    selectedGenes,
    setBoundaryElements,
    setBoundaryState,
    setCurrentViewportDetail,
    setGeneExpressionBatch,
    setGeneExpressionState,
    setShareableViewState,
  })

  useTranscriptWorkflow({
    activeControlHudTab,
    appendDebugEvent,
    currentViewportDetail,
    effectiveTranscriptFeatureFilterMode,
    loadRequestIdRef: loadRequestId,
    loadState,
    loadTranscriptAggregates,
    loadTranscriptCapabilities,
    loadTranscriptViewport,
    manualTranscriptExactRequestKey,
    overviewCells,
    selectedGenes,
    setTranscriptCapabilityState,
    setTranscriptLayerState,
    showTranscriptOverlay,
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef: transcriptCapabilityRequestId,
    transcriptCapabilityState,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptRequestIdRef: transcriptRequestId,
    transcriptViewportKeyRef,
    visibleTranscriptEstimate,
  })

  useCellDetailWorkflow({
    appendDebugEvent,
    cellDetailAbortRef,
    cellDetailRequestIdRef: cellDetailRequestId,
    cellDetailState,
    cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef: cellTranscriptDistributionRequestId,
    loadBoundaryElements,
    loadCellTranscriptDistribution,
    loadRoiGeneStats,
    loadState,
    selectedCell,
    setCellDetailState,
    setCellTranscriptDistributionState,
  })

  const {
    handleClearRoi,
    handleExportRoiCells,
    handleExportRoiTranscripts,
    handleRoiComplete,
  } = useRoiWorkflow({
    appendDebugEvent,
    currentViewportDetail,
    initialSharedRoiSelectionRef,
    loadRoiCells,
    loadRoiGeneStats,
    loadRoiTranscripts,
    loadState,
    magicLensAbortRef,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensRequestIdRef: magicLensRequestId,
    magicLensScope,
    roiAbortRef,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupTimeoutRef,
    roiIdRef,
    roiName,
    roiRequestIdRef: roiRequestId,
    roiState,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef: roiTranscriptExportRequestId,
    setMagicLensState,
    setRoiGeneStatsState,
    setRoiGeneViewportWarmupState,
    setRoiMode,
    setRoiName,
    setRoiState,
    setRoiTranscriptExportState,
  })

  const {
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleClearAnnotations,
    handleImportAnnotations,
    handleLoadAnnotations,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
  } = useAnnotationWorkflow({
    annotationState,
    appendDebugEvent,
    datasetAbortRef,
    datasetUrl,
    loadAnnotations,
    loadRequestIdRef: loadRequestId,
    loadState,
    roiIdRef,
    roiName,
    roiState,
    selectedAnnotationGroupId,
    setAnnotationColors,
    setAnnotationState,
    setObservationColorMode,
    setRoiName,
    setSelectedAnnotationGroupId,
  })

  const { handleEmbeddingCellSelect, handleLoadAnalysisEmbeddings } =
    useAnalysisEmbeddingWorkflow({
      analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
      analysisEmbeddingState,
      appendDebugEvent,
      loadAnalysisEmbeddings,
      loadState,
      overviewCellById,
      selectedEmbeddingKind,
      setAnalysisEmbeddingState,
      setSelectedCell,
      setSelectedEmbeddingKind,
    })

  const {
    handleMagicLensCursorActiveChange,
    handleMagicLensLeave,
    handleMagicLensMinQvChange,
    handleMagicLensMove,
    handleMagicLensRadiusChange,
    handleMagicLensScopeChange,
    handleRunMagicLens,
  } = useMagicLensWorkflow({
    activeRoiSelection,
    appendDebugEvent,
    currentViewportDetail,
    loadRoiCells,
    loadRoiGeneStats,
    loadState,
    magicLensAbortRef,
    magicLensActive,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensMinQv,
    magicLensRequestIdRef: magicLensRequestId,
    magicLensScope,
    selectedGenes,
    setMagicLensActive,
    setMagicLensMinQv,
    setMagicLensRadiusMicrometers,
    setMagicLensScope,
    setMagicLensState,
    setMeasurementEnabled,
    setMeasurementResetKey,
  })

  const { handleAutoContrast, queueAutoContrast, updateMorphologyChannel } =
    useMorphologyWorkflow({
      appendDebugEvent,
      autoContrastChannelIdsRef,
      computeAutoChannelContrast,
      datasetAbortRef,
      loadRequestIdRef: loadRequestId,
      setAutoContrastChannelIds,
      setMorphologyChannelSettings,
      setMorphologyState,
    })

  const { handleDatasetSubmit } = useDatasetLifecycle({
    analysisEmbeddingAbortRef,
    analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
    appendDebugEvent,
    autoContrastChannelIdsRef,
    boundaryAbortRef,
    boundaryRequestIdRef: boundaryRequestId,
    boundaryViewportKeyRef,
    cellDetailAbortRef,
    cellDetailRequestIdRef: cellDetailRequestId,
    cellFeatureMatrixCapabilityKeyRef,
    cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef: cellTranscriptDistributionRequestId,
    datasetAbortRef,
    datasetWarmupAbortRef,
    diagnosticsAbortRef,
    didApplyInitialDatasetUrlRef,
    geneExpressionAbortRef,
    geneExpressionColorScale,
    geneExpressionRequestIdRef: geneExpressionRequestId,
    geneExpressionViewportKeyRef,
    initialShareableState,
    initialShareableStateRef,
    initialSharedRoiSelectionRef,
    initialShouldLoadMorphologyRef,
    lastViewportDetailRef,
    loadAnnotationGroups,
    loadDatasetOverview,
    loadGenePanel,
    loadMorphologyImage,
    loadRequestIdRef: loadRequestId,
    magicLensAbortRef,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensRequestIdRef: magicLensRequestId,
    queueAutoContrast,
    recordTelemetry,
    roiAbortRef,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupTimeoutRef,
    roiRequestIdRef: roiRequestId,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef: roiTranscriptExportRequestId,
    setAnalysisEmbeddingState,
    setAnnotationColors,
    setAnnotationGroupState,
    setAnnotationState,
    setAutoContrastChannelIds,
    setBoundaryElements,
    setBoundaryState,
    setCellDetailState,
    setCellFeatureMatrixCapabilityState,
    setCellTranscriptDistributionState,
    setCurrentViewportDetail,
    setDatasetUrl,
    setDatasetWarmupState,
    setDiagnosticsState,
    setGeneExpressionBatch,
    setGeneExpressionColorScale,
    setGeneExpressionDetailMode,
    setGeneExpressionScaleDomain,
    setGeneExpressionScoreMode,
    setGeneExpressionState,
    setGenePanelState,
    setGeneSearch,
    setGeneSetName,
    setGeneSetSymbols,
    setHoveredTranscript,
    setLoadState,
    setMagicLensActive,
    setMagicLensState,
    setManualTranscriptExactRequestKey,
    setMeasurementEnabled,
    setMeasurementResetKey,
    setMorphologyChannelSettings,
    setMorphologyImage,
    setMorphologyState,
    setObservationColorMode,
    setOverviewCells,
    setPinnedTranscript,
    setRoiGeneStatsState,
    setRoiGeneViewportWarmupState,
    setRoiMode,
    setRoiName,
    setRoiState,
    setRoiTranscriptExportState,
    setSavedGeneSets,
    setSelectedAnnotationGroupId,
    setSelectedCell,
    setSelectedEmbeddingKind,
    setSelectedGenes,
    setTranscriptCapabilityState,
    setTranscriptDensityColorScale,
    setTranscriptExactPointLimit,
    setTranscriptFeatureSearch,
    setTranscriptLayerState,
    setTranscriptPointColorMode,
    setViewportCellCount,
    startDatasetLoadRef,
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef: transcriptCapabilityRequestId,
    transcriptDensityColorScale,
    transcriptExactPointLimit,
    transcriptPointColorMode,
    transcriptRequestIdRef: transcriptRequestId,
    transcriptViewportKeyRef,
    warmDatasetForRoi,
  })

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
        measurementUnit,
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
    measurementUnit,
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

  function resetTranscriptViewportRequest() {
    transcriptViewportKeyRef.current = null
    setManualTranscriptExactRequestKey(null)
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

  function handleTranscriptOverlayChange(checked: boolean) {
    setShowTranscriptOverlay(checked)
    appendDebugEvent(
      checked ? 'Transcript overlay enabled' : 'Transcript overlay disabled',
      { coalesceKey: 'transcript-overlay-toggle' },
    )
  }

  function handleTranscriptDetailModeChange(nextMode: TranscriptDetailMode) {
    setTranscriptDetailMode(nextMode)
    resetTranscriptViewportRequest()
    appendDebugEvent(`Transcript detail: ${nextMode}`, {
      coalesceKey: 'transcript-detail',
    })
  }

  function handleTranscriptExactPointLimitChange(value: number) {
    const nextLimit = normalizeTranscriptExactPointLimit(value)

    setTranscriptExactPointLimit(nextLimit)
    resetTranscriptViewportRequest()
    appendDebugEvent(`Transcript exact budget: ${nextLimit.toLocaleString()}`, {
      coalesceKey: 'transcript-exact-budget',
    })
  }

  function handleTranscriptFeatureFilterModeChange(
    nextMode: TranscriptFeatureFilterMode,
  ) {
    setTranscriptFeatureFilterMode(nextMode)
    resetTranscriptViewportRequest()
    appendDebugEvent(`Transcript feature filter: ${nextMode}`, {
      coalesceKey: 'transcript-feature-filter',
    })
  }

  function handleToggleTranscriptSelectedFeature(gene: string) {
    toggleGene(gene)
    transcriptViewportKeyRef.current = null
  }

  function handleTranscriptDensityColorScaleChange(
    nextScale: TranscriptDensityColorScale,
  ) {
    setTranscriptDensityColorScale(nextScale)
    appendDebugEvent(`Transcript density color: ${nextScale}`, {
      coalesceKey: 'transcript-density-color',
    })
  }

  function handleTranscriptPointColorModeChange(nextMode: TranscriptPointColorMode) {
    setTranscriptPointColorMode(nextMode)
    appendDebugEvent(`Transcript point color: ${nextMode}`, {
      coalesceKey: 'transcript-point-color',
    })
  }

  function handleTranscriptMinQvChange(value: number) {
    const nextMinQv = normalizeTranscriptMinQv(value)

    setTranscriptMinQv(nextMinQv)
    resetTranscriptViewportRequest()
    appendDebugEvent(`Transcript min QV: ${nextMinQv}`, {
      coalesceKey: 'transcript-min-qv',
    })
  }

  function handleTranscriptGeneOnlyChange(checked: boolean) {
    setTranscriptGeneOnly(checked)
    resetTranscriptViewportRequest()
    appendDebugEvent(
      checked
        ? 'Transcript gene-only filter enabled'
        : 'Transcript gene-only filter disabled',
      { coalesceKey: 'transcript-gene-only' },
    )
  }

  function handleTranscriptOpacityPercentChange(nextPercent: number) {
    setTranscriptOpacity(percentToOpacity(nextPercent))
    appendDebugEvent(`Transcript opacity: ${nextPercent}%`, {
      coalesceKey: 'transcript-opacity',
    })
  }

  function handleTranscriptPointSizeChange(value: number) {
    const nextSize = normalizeTranscriptPointSize(value)

    setTranscriptPointSize(nextSize)
    appendDebugEvent(`Transcript point size: ${nextSize}px`, {
      coalesceKey: 'transcript-point-size',
    })
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

  function handleGeneExpressionColorScaleChange(nextScale: GeneExpressionColorScale) {
    setGeneExpressionColorScale(nextScale)
    appendDebugEvent(`Gene scale: ${nextScale}`)
  }

  function handleGeneExpressionDetailModeChange(nextMode: GeneExpressionDetailMode) {
    setGeneExpressionDetailMode(nextMode)
    appendDebugEvent(`Expression detail: ${nextMode}`)
  }

  function handleObservationColorModeChange(nextMode: ObservationColorMode) {
    setObservationColorMode(nextMode)
    appendDebugEvent(`Cell color: ${nextMode}`)
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

  return (
    <main className="app-shell">
      <a className="skip-link" href="#viewer-heading">
        Skip To Spatial View
      </a>
      <ControlHudShell
        collapsed={isControlHudCollapsed}
        activeTab={activeControlHudTab}
        loadingTabIds={loadingTabIds}
        loadingTasks={loadingTasks}
        onCollapsedChange={(nextCollapsed) => {
          setIsControlHudCollapsed(nextCollapsed)
          appendDebugEvent(nextCollapsed ? 'HUD collapsed' : 'HUD expanded')
        }}
        onActiveTabChange={(tabId, tabLabel) => {
          setActiveControlHudTab(tabId)
          appendDebugEvent(`HUD tab: ${tabLabel}`, {
            coalesceKey: 'hud-tab',
          })
        }}
      >
        <DatasetHudPanel
          active={activeControlHudTab === 'dataset'}
          datasetInputId={controlIds.datasetInputId}
          morphologyInputId={controlIds.morphologyInputId}
          boundaryLimitInputId={controlIds.boundaryLimitInputId}
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
          imageOpacityInputId={controlIds.imageOpacityInputId}
          cellFillOpacityInputId={controlIds.cellFillOpacityInputId}
          cellBoundaryOpacityInputId={controlIds.cellBoundaryOpacityInputId}
          coordinateUnitInputId={controlIds.coordinateUnitInputId}
          measurementModeInputId={controlIds.measurementModeInputId}
          measurementUnitInputId={controlIds.measurementUnitInputId}
          imageLayerOpacity={imageLayerOpacity}
          cellFillOpacity={cellFillOpacity}
          cellBoundaryOpacity={cellBoundaryOpacity}
          coordinateUnit={coordinateUnit}
          measurementEnabled={measurementEnabled}
          measurementUnit={measurementUnit}
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
            appendDebugEvent(`Mouse coordinates: ${nextUnit === 'um' ? 'μm' : 'px'}`, {
              coalesceKey: 'coordinate-unit',
            })
          }}
          onMeasurementEnabledChange={(nextEnabled) => {
            if (measurementEnabled === nextEnabled) {
              return
            }

            setMeasurementEnabled(nextEnabled)

            if (nextEnabled) {
              setRoiMode('idle')
              setMagicLensActive(false)
              handleMagicLensLeave()
            } else {
              setMeasurementResetKey((current) => current + 1)
            }

            appendDebugEvent(
              nextEnabled ? 'Distance measure enabled' : 'Distance measure disabled',
              { coalesceKey: 'measurement-mode' },
            )
          }}
          onMeasurementUnitChange={(nextUnit) => {
            if (measurementUnit === nextUnit) {
              return
            }

            setMeasurementUnit(nextUnit)
            appendDebugEvent(`Measure unit: ${nextUnit === 'um' ? 'μm' : 'px'}`, {
              coalesceKey: 'measurement-unit',
            })
          }}
          onClearMeasurement={() => {
            setMeasurementResetKey((current) => current + 1)
            appendDebugEvent('Distance measure cleared', {
              coalesceKey: 'measurement-clear',
            })
          }}
          onAutoContrast={handleAutoContrast}
          onUpdateMorphologyChannel={updateMorphologyChannel}
        />

        <GeneHudPanel
          active={activeControlHudTab === 'genes'}
          geneSearchInputId={controlIds.geneSearchInputId}
          geneSetSymbolsInputId={controlIds.geneSetSymbolsInputId}
          geneSetNameInputId={controlIds.geneSetNameInputId}
          geneSetScoreInputId={controlIds.geneSetScoreInputId}
          geneScaleInputId={controlIds.geneScaleInputId}
          geneExpressionDetailInputId={controlIds.geneExpressionDetailInputId}
          observationModeInputId={controlIds.observationModeInputId}
          analysisHeaderCopy={analysisHeaderCopy}
          geneExpressionCopy={geneExpressionCopy}
          genePanelState={genePanelState}
          geneExpressionState={geneExpressionState}
          geneSearch={geneSearch}
          geneSetSymbols={geneSetSymbols}
          geneSetName={geneSetName}
          geneExpressionScoreMode={geneExpressionScoreMode}
          savedGeneSets={savedGeneSets}
          selectedGenes={selectedGenes}
          filteredGenes={filteredGenes}
          geneExpressionColorScale={geneExpressionColorScale}
          geneExpressionScaleMax={geneExpressionScaleMax}
          geneExpressionDetailMode={geneExpressionDetailMode}
          observationColorMode={observationColorMode}
          hasAnnotationColors={annotationStyleColors.length > 0}
          onGeneSearchChange={setGeneSearch}
          onToggleGene={toggleGene}
          onGeneSetSymbolsChange={setGeneSetSymbols}
          onApplyGeneSetSymbols={applyGeneSetSymbols}
          onSaveSelectedGeneSet={saveSelectedGeneSet}
          onGeneSetNameChange={setGeneSetName}
          onGeneExpressionScoreModeChange={handleGeneExpressionScoreModeChange}
          onApplySavedGeneSet={applySavedGeneSet}
          onRemoveSavedGeneSet={removeSavedGeneSet}
          onGeneExpressionColorScaleChange={handleGeneExpressionColorScaleChange}
          onGeneExpressionDetailModeChange={handleGeneExpressionDetailModeChange}
          onObservationColorModeChange={handleObservationColorModeChange}
        />

        <TranscriptHudPanel
          active={activeControlHudTab === 'transcripts'}
          transcriptDetailInputId={controlIds.transcriptDetailInputId}
          transcriptDensityScaleInputId={controlIds.transcriptDensityScaleInputId}
          transcriptPointColorInputId={controlIds.transcriptPointColorInputId}
          transcriptPointBudgetInputId={controlIds.transcriptPointBudgetInputId}
          transcriptMinQvInputId={controlIds.transcriptMinQvInputId}
          transcriptFeatureFilterInputId={controlIds.transcriptFeatureFilterInputId}
          transcriptFeatureSearchInputId={controlIds.transcriptFeatureSearchInputId}
          transcriptOpacityInputId={controlIds.transcriptOpacityInputId}
          transcriptPointSizeInputId={controlIds.transcriptPointSizeInputId}
          transcriptCopy={transcriptCopy}
          loadEnabled={loadState.status === 'ready'}
          featureSearchEnabled={genePanelState.status === 'ready'}
          showTranscriptOverlay={showTranscriptOverlay}
          transcriptDetailMode={transcriptDetailMode}
          transcriptExactPointLimit={transcriptExactPointLimit}
          effectiveTranscriptFeatureFilterMode={effectiveTranscriptFeatureFilterMode}
          selectedGenes={selectedGenes}
          transcriptFeatureSearch={transcriptFeatureSearch}
          filteredTranscriptFeatures={filteredTranscriptFeatures}
          transcriptDensityColorScale={transcriptDensityColorScale}
          transcriptDensityScaleMax={transcriptDensityScaleMax}
          transcriptDensityScaleLabels={transcriptDensityScaleLabels}
          transcriptPointColorMode={transcriptPointColorMode}
          transcriptMinQv={transcriptMinQv}
          transcriptGeneOnly={transcriptGeneOnly}
          transcriptOpacity={transcriptOpacity}
          transcriptPointSize={transcriptPointSize}
          transcriptCapabilityState={transcriptCapabilityState}
          transcriptLayerState={transcriptLayerState}
          visibleTranscriptEstimate={visibleTranscriptEstimate}
          hoveredTranscript={hoveredTranscript}
          pinnedTranscript={pinnedTranscript}
          onShowTranscriptOverlayChange={handleTranscriptOverlayChange}
          onTranscriptDetailModeChange={handleTranscriptDetailModeChange}
          onTranscriptExactPointLimitChange={handleTranscriptExactPointLimitChange}
          onTranscriptFeatureFilterModeChange={handleTranscriptFeatureFilterModeChange}
          onToggleSelectedFeature={handleToggleTranscriptSelectedFeature}
          onTranscriptFeatureSearchChange={setTranscriptFeatureSearch}
          onPickTranscriptFeature={pickTranscriptFeature}
          onTranscriptDensityColorScaleChange={handleTranscriptDensityColorScaleChange}
          onTranscriptPointColorModeChange={handleTranscriptPointColorModeChange}
          onTranscriptMinQvChange={handleTranscriptMinQvChange}
          onTranscriptGeneOnlyChange={handleTranscriptGeneOnlyChange}
          onTranscriptOpacityPercentChange={handleTranscriptOpacityPercentChange}
          onTranscriptPointSizeChange={handleTranscriptPointSizeChange}
          onPinTranscript={handlePinTranscript}
          onClearPinnedTranscript={() => {
            setPinnedTranscript(null)
          }}
          onLoadExactViewport={handleLoadExactViewport}
        />

        <MagicLensHudPanel
          active={activeControlHudTab === 'magic-lens'}
          magicLensScopeInputId={controlIds.magicLensScopeInputId}
          magicLensRadiusInputId={controlIds.magicLensRadiusInputId}
          magicLensMinQvInputId={controlIds.magicLensMinQvInputId}
          magicLensCopy={magicLensCopy}
          loadEnabled={loadState.status === 'ready'}
          roiAvailable={activeRoiSelection !== null}
          magicLensScope={magicLensScope}
          magicLensState={magicLensState}
          magicLensRadiusMicrometers={magicLensRadiusMicrometers}
          magicLensMinQv={magicLensMinQv}
          magicLensIsCursorActive={magicLensIsCursorActive}
          magicLensCanScan={magicLensCanScan}
          onScopeChange={handleMagicLensScopeChange}
          onRadiusChange={handleMagicLensRadiusChange}
          onMinQvChange={handleMagicLensMinQvChange}
          onCursorActiveChange={handleMagicLensCursorActiveChange}
          onRunMagicLens={handleRunMagicLens}
        />

        <AnnotationHudPanel
          active={activeControlHudTab === 'annotations'}
          annotationGroupInputId={controlIds.annotationGroupInputId}
          annotationImportInputId={controlIds.annotationImportInputId}
          annotationHeaderCopy={annotationHeaderCopy}
          loadEnabled={loadState.status === 'ready'}
          selectedAnnotationGroupId={selectedAnnotationGroupId}
          annotationGroupOptions={annotationGroupOptions}
          annotationState={annotationState}
          annotationGroupState={annotationGroupState}
          annotationColors={annotationColors}
          onAnnotationGroupChange={handleAnnotationGroupChange}
          onLoadAnnotations={handleLoadAnnotations}
          onClearAnnotations={handleClearAnnotations}
          onImportAnnotations={(file) => {
            void handleImportAnnotations(file)
          }}
          onAnnotationColorChange={handleAnnotationColorChange}
          onRemoveAnnotation={handleRemoveAnnotation}
        />

        <CellHudPanel
          active={activeControlHudTab === 'cell'}
          embeddingViewInputId={controlIds.embeddingViewInputId}
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
          roiNameInputId={controlIds.roiNameInputId}
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
            if (nextMode !== 'idle') {
              setMeasurementEnabled(false)
              setMeasurementResetKey((current) => current + 1)
            }

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
      </ControlHudShell>

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
          measurementEnabled={measurementEnabled}
          measurementUnit={measurementUnit}
          measurementResetKey={measurementResetKey}
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
