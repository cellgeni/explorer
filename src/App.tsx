import type { FormEvent } from 'react'
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
import {
  abortActiveRequest,
  appendDebugLogEntry,
  clearTimeoutRef,
  createLoadingTasks,
  createDebugLogEntry,
  downloadTextFile,
  formatElapsed,
  isAbortError,
  readTimestamp,
  shortDatasetLabel,
  shortIdentifier,
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
  CELL_GENE_EXPRESSION_LIMIT,
  cellExpressionSummaryFromStats,
  cellDetailStatusCopy,
  loadSelectedCellBoundary,
  overviewCellToDatasetCell,
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
  type MorphologyChannelSetting,
} from './features/morphology/morphologyChannels'
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
  defaultRoiName,
  roiGeneStatsStatusCopy,
  roiGeneViewportWarmupKey,
  roiStatusCopy,
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
  formatGeneExpressionTiming,
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
import { ALL_ANNOTATION_GROUP_ID } from './data/datasetAnnotations'
import type { WarmDatasetForRoiResult } from './data/datasetWarmup'
import {
  geneExpressionRequestKey,
  geneExpressionWaitingKey,
  planGeneExpressionLod,
} from './data/geneExpressionLod'
import { asCellId } from './data/cellid'
import {
  CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  DEFAULT_CELL_TRANSCRIPT_MIN_QV,
} from './data/cellTranscripts'
import {
  normalizeTranscriptExactPointLimit,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from './data/transcriptOverlay'
import { type RoiSelection } from './data/roiSelection'
import { parseCustomAnnotations } from './data/customAnnotations'
import { summarizeDatasetDiagnostics } from './data/datasetDiagnostics'
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
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  geneExpressionScoreDomainMax,
  overviewCellsToLayerData,
  bundledDeckVersion,
} from './rendering/deckLayers'
import {
  annotationPaletteColor,
  normalizeAnnotationColor,
} from './rendering/annotationPalette'
import { percentToOpacity } from './rendering/layerOpacity'
import { useViewerStore } from './store/viewerStore'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import type { MorphologyImage } from './data/morphologyImage'
import type { ObservationColorMode } from './rendering/cellStyling'
import type { AnalysisEmbeddingKind } from './data/analysisEmbeddings'
import type { Annotation, SpatialElement } from './datasets/spatialDataset'
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
      const expressionStartedAt = readTimestamp()
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

          const timingDetail = formatGeneExpressionTiming(batch.timing)

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
          recordTelemetry(
            telemetryEvent('gene-expression.load', 'success', {
              startedAt: expressionStartedAt,
              detail: `${geneExpressionModeLabel(expressionPlan.mode)}: ${batch.cells.length.toLocaleString()} positive cells across ${expressionPlan.sourceCellCount.toLocaleString()} source cells (${timingDetail})`,
            }),
          )
          appendDebugEvent(
            `${geneExpressionModeLabel(expressionPlan.mode)} ready: ${batch.cells.length.toLocaleString()} positive cells in ${formatElapsed(
              expressionStartedAt,
            )} (${timingDetail})`,
            { coalesceKey: 'gene-expression-query' },
          )
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
          recordTelemetry(
            telemetryEvent('gene-expression.load', 'failure', {
              startedAt: expressionStartedAt,
              detail: readErrorMessage(error),
            }),
          )
          appendDebugEvent('Gene expression load failed', {
            coalesceKey: 'gene-expression-query',
          })
        })
        .finally(() => {
          if (geneExpressionAbortRef.current === expressionAbortController) {
            geneExpressionAbortRef.current = null
          }
        })
    },
    [
      appendDebugEvent,
      boundaryCellLimit,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
      loadBoundaryElements,
      loadGeneExpression,
      loadState,
      geneExpressionDetailMode,
      overviewExtent,
      recordTelemetry,
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
        boundary: boundaryElement,
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

    if (
      cellDetailState.status === 'error' &&
      cellDetailState.cellId === selectedCell.id
    ) {
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestId.current += 1
      const requestId = cellTranscriptDistributionRequestId.current
      const error = new Error(
        'Cell details failed before the selected-cell transcript z distribution could load.',
      )
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestId.current === requestId) {
          setCellTranscriptDistributionState({
            status: 'error',
            url: loadState.url,
            cellId: selectedCell.id,
            error: createStructuredLoadError('Cell transcripts', error),
          })
        }
      })
      return
    }

    if (
      cellDetailState.status !== 'ready' ||
      cellDetailState.cellId !== selectedCell.id
    ) {
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestId.current += 1
      const requestId = cellTranscriptDistributionRequestId.current
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestId.current === requestId) {
          setCellTranscriptDistributionState({
            status: 'loading',
            url: loadState.url,
            cellId: selectedCell.id,
          })
        }
      })
      return
    }

    const boundaryPolygon =
      cellDetailState.boundary?.geometry.kind === 'polygon'
        ? (cellDetailState.boundary.geometry.rings[0] ?? null)
        : null

    if (boundaryPolygon === null || boundaryPolygon.length < 3) {
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestId.current += 1
      const requestId = cellTranscriptDistributionRequestId.current
      const error = new Error(
        'Selected cell boundary is unavailable, so cell-only transcript z locations cannot be computed.',
      )
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestId.current === requestId) {
          setCellTranscriptDistributionState({
            status: 'error',
            url: loadState.url,
            cellId: selectedCell.id,
            error: createStructuredLoadError('Cell transcripts', error),
          })
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
      boundaryPolygon,
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
  }, [
    appendDebugEvent,
    cellDetailState,
    loadCellTranscriptDistribution,
    loadState,
    selectedCell,
  ])

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
      setMeasurementEnabled(false)
      setMeasurementResetKey((current) => current + 1)
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
          measurementEnabled,
          measurementUnit,
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

  function handleAnnotationGroupChange(nextGroupId: string) {
    setSelectedAnnotationGroupId(nextGroupId)
    appendDebugEvent(`Annotation set: ${shortIdentifier(nextGroupId)}`)
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
