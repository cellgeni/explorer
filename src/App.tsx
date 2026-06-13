import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ViewerCore,
  type ViewerCoordinateUnit,
  type ViewerFocusRequest,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import { AppControlHud } from './features/app-shell/AppControlHud'
import { AppDatasetHudPanel } from './features/app-shell/AppDatasetHudPanel'
import { AppGeneHudPanel } from './features/app-shell/AppGeneHudPanel'
import { AppLayerHudPanel } from './features/app-shell/AppLayerHudPanel'
import { AppTranscriptHudPanel } from './features/app-shell/AppTranscriptHudPanel'
import { useTranscriptWorkflow } from './features/transcripts/useTranscriptWorkflow'
import { useGeneExpressionLayerTelemetry } from './features/genes/useGeneExpressionLayerTelemetry'
import { AnnotationHudPanel } from './features/annotations/AnnotationHudPanel'
import { CellHudPanel } from './features/control-hud/CellHudPanel'
import { RoiHudPanel } from './features/control-hud/RoiHudPanel'
import { MagicLensHudPanel } from './features/roi/MagicLensHudPanel'
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
import { useShareableUrlHash } from './features/app-shell/useShareableUrlHash'
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
import {
  customMorphologyLayerChannels,
  type CustomMorphologyLayer,
  type CustomMorphologyLayerLoadState,
} from './features/morphology/customMorphologyLayers'
import { useCustomMorphologyLayerWorkflow } from './features/morphology/useCustomMorphologyLayerWorkflow'
import {
  magicLensScopeLabel,
  magicLensStatusCopy,
  normalizeMagicLensMinQv,
  normalizeMagicLensRadius,
  parseMagicLensScope,
  type MagicLensScope,
  type MagicLensState,
} from './features/roi/magicLensModel'
import { useMagicLensWorkflow } from './features/roi/useMagicLensWorkflow'
import { useRoiWorkflow } from './features/roi/useRoiWorkflow'
import {
  roiGeneDatasetWarmupKey,
  roiGeneStatsStatusCopy,
  roiStatusCopy,
  summarizeRoiCells,
  type RoiGeneStatsState,
  type RoiGeneViewportWarmupState,
  type RoiState,
  type RoiTranscriptExportState,
} from './features/roi/roiModel'
import { useDatasetDiagnosticsWorkflow } from './features/diagnostics/useDatasetDiagnosticsWorkflow'
import {
  annotationLabelsForCell,
  annotationStatusCopy,
  filterAnnotationsByVisibleSets,
  type AnnotationGroupState,
  type AnnotationState,
} from './features/annotations/annotationModel'
import { useAnnotationWorkflow } from './features/annotations/useAnnotationWorkflow'
import {
  type GeneExpressionScaleDomain,
  type GeneExpressionState,
  geneExpressionModeLabel,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
  type GenePanelState,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
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
import { ALL_ANNOTATION_GROUP_ID } from './data/datasetAnnotations'
import {
  normalizeTranscriptExactPointLimit,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from './data/transcriptOverlay'
import { type RoiSelection } from './data/roiSelection'
import type { ContinuousCellMetadataTrack } from './data/customAnnotations'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import { type ShareableState, type ShareableViewState } from './data/shareableState'
import {
  appendTelemetryEvent,
  telemetryEvent,
  type TelemetryEvent,
} from './data/telemetry'
import { normalizeBoundaryCellLimit } from './rendering/boundaryViewport'
import {
  DEFAULT_CELL_FILL_OPACITY,
  normalizeLayerOpacity,
} from './rendering/layerOpacity'
import {
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  geneExpressionScoreDomainMax,
} from './rendering/deckLayers'
import { useViewerStore } from './store/viewerStore'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import {
  normalizeCustomMorphologyLayerUrl,
  type MorphologyImage,
} from './data/morphologyImage'
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
  CustomMorphologyLayerLoader,
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
  loadCustomMorphologyLayer = defaultAppDependencies.loadCustomMorphologyLayer,
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
  const [annotationImportUrl, setAnnotationImportUrl] = useState(
    initialShareableState.annotationUrl ?? '',
  )
  const [hiddenAnnotationSetIds, setHiddenAnnotationSetIds] = useState<readonly string[]>(
    [],
  )
  const [cellMetadataTracks, setCellMetadataTracks] = useState<
    readonly ContinuousCellMetadataTrack[]
  >([])
  const [selectedCellMetadataTrackId, setSelectedCellMetadataTrackId] = useState<
    string | null
  >(null)
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
  const [magicLensScope, setMagicLensScope] = useState<MagicLensScope>(
    () => parseMagicLensScope(initialShareableState.magicLensScope) ?? 'cursor',
  )
  const [magicLensActive, setMagicLensActive] = useState(
    initialShareableState.magicLensActive ?? false,
  )
  const [magicLensRadiusMicrometers, setMagicLensRadiusMicrometers] = useState(() =>
    normalizeMagicLensRadius(initialShareableState.magicLensRadiusMicrometers ?? 80),
  )
  const [magicLensMinQv, setMagicLensMinQv] = useState(() =>
    normalizeMagicLensMinQv(initialShareableState.magicLensMinQv ?? 20),
  )
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
  const [customMorphologyLayers, setCustomMorphologyLayers] = useState<
    readonly CustomMorphologyLayer[]
  >([])
  const [customMorphologyLayerState, setCustomMorphologyLayerState] = useState<
    CustomMorphologyLayerLoadState<StructuredLoadError>
  >({ status: 'idle' })
  const [customImageLayerOpacities, setCustomImageLayerOpacities] = useState<
    Readonly<Record<string, number>>
  >({})
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
  const [imageLayerOpacity, setImageLayerOpacity] = useState(() =>
    normalizeLayerOpacity(initialShareableState.imageOpacity ?? 1),
  )
  const [cellFillOpacity, setCellFillOpacity] = useState(() =>
    normalizeLayerOpacity(
      initialShareableState.cellFillOpacity ?? DEFAULT_CELL_FILL_OPACITY,
    ),
  )
  const [cellBoundaryOpacity, setCellBoundaryOpacity] = useState(() =>
    normalizeLayerOpacity(initialShareableState.cellBoundaryOpacity ?? 1),
  )
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
  const [spatialFocusRequest, setSpatialFocusRequest] =
    useState<ViewerFocusRequest | null>(null)
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
  const spatialFocusRequestIdRef = useRef(0)
  const magicLensAbortRef = useRef<AbortController | null>(null)
  const cellDetailAbortRef = useRef<AbortController | null>(null)
  const cellTranscriptDistributionAbortRef = useRef<AbortController | null>(null)
  const customMorphologyLayerAbortRef = useRef<AbortController | null>(null)
  const autoContrastChannelIdsRef = useRef<Set<string>>(new Set())
  const customMorphologyLayerIdRef = useRef(0)
  const customMorphologyLayerRequestIdRef = useRef(0)
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
  const initialCustomImageUrlsRef = useRef<readonly string[]>(
    initialShareableState.customImageUrls ?? [],
  )
  const initialCustomImageOpacitiesRef = useRef<readonly number[]>(
    initialShareableState.customImageOpacities ?? [],
  )
  const initialShouldLoadMorphologyRef = useRef(shouldLoadMorphology)
  const isLoading = loadState.status === 'loading'
  const loadedDatasetUrl = loadState.status === 'ready' ? loadState.url : null
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const selectedCellMetadataTrack = useMemo(
    () =>
      cellMetadataTracks.find((track) => track.id === selectedCellMetadataTrackId) ??
      cellMetadataTracks[0] ??
      null,
    [cellMetadataTracks, selectedCellMetadataTrackId],
  )
  const hiddenAnnotationSetIdSet = useMemo(
    () => new Set(hiddenAnnotationSetIds),
    [hiddenAnnotationSetIds],
  )
  const visibleAnnotationState = useMemo<AnnotationState<StructuredLoadError>>(
    () =>
      annotationState.status === 'ready'
        ? {
            ...annotationState,
            annotations: filterAnnotationsByVisibleSets(
              annotationState.annotations,
              hiddenAnnotationSetIdSet,
            ),
          }
        : annotationState,
    [annotationState, hiddenAnnotationSetIdSet],
  )
  const morphologyChannels = useMemo(
    () => [
      ...(morphologyImage?.channelLoaders ?? []),
      ...customMorphologyLayerChannels(customMorphologyLayers),
    ],
    [customMorphologyLayers, morphologyImage],
  )
  const customImageUrls = useMemo(
    () => customMorphologyLayers.map((layer) => layer.image.url),
    [customMorphologyLayers],
  )
  const customImageOpacities = useMemo(() => {
    if (customMorphologyLayers.length === 0) {
      return undefined
    }

    const opacities = customMorphologyLayers.map((layer) =>
      normalizeLayerOpacity(customImageLayerOpacities[layer.image.url] ?? 1),
    )

    return opacities.some((opacity) => opacity !== 1) ? opacities : undefined
  }, [customImageLayerOpacities, customMorphologyLayers])
  const morphologyChannelOpacities = useMemo(() => {
    const opacities = new Map<string, number>()

    for (const channel of morphologyImage?.channelLoaders ?? []) {
      opacities.set(channel.info.id, imageLayerOpacity)
    }

    for (const layer of customMorphologyLayers) {
      const opacity = normalizeLayerOpacity(
        customImageLayerOpacities[layer.image.url] ?? 1,
      )

      for (const channel of layer.channels) {
        opacities.set(channel.info.id, opacity)
      }
    }

    return opacities
  }, [
    customImageLayerOpacities,
    customMorphologyLayers,
    imageLayerOpacity,
    morphologyImage,
  ])
  const baseMorphologyChannelIds = useMemo(
    () =>
      new Set((morphologyImage?.channelLoaders ?? []).map((channel) => channel.info.id)),
    [morphologyImage],
  )
  const {
    activeAnnotationStyleColors,
    activeCellMetadataTrack,
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
    annotationState: visibleAnnotationState,
    boundaryElements,
    cellMetadataTrack: selectedCellMetadataTrack,
    currentViewportBbox: currentViewportDetail?.bbox ?? null,
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionScaleDatasetUrl,
    geneExpressionScaleDomain,
    geneExpressionScoreMode,
    morphologyChannelSettings,
    morphologyChannelOpacities,
    morphologyChannels,
    morphologyImage,
    observationColorMode,
    overviewCells,
    selectedGenes,
    transcriptDensityColorScale,
    transcriptLayerState,
    transcriptPointColorMode,
  })
  const viewerImageStatus =
    customMorphologyLayerState.status === 'error' ||
    (customMorphologyLayerState.status === 'loading' &&
      morphologyState.status !== 'loading')
      ? customMorphologyLayerState.status
      : morphologyState.status
  const viewerImageError =
    customMorphologyLayerState.status === 'error'
      ? customMorphologyLayerState.error
      : morphologyState.status === 'error'
        ? morphologyState.error
        : null
  const geneOptions = useMemo(
    () => (genePanelState.status === 'ready' ? genePanelState.genes : []),
    [genePanelState],
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
  const selectedCellAnnotationLabels = useMemo(
    () =>
      selectedCell === null
        ? []
        : annotationLabelsForCell(visibleAnnotationState, selectedCell.id),
    [selectedCell, visibleAnnotationState],
  )
  const handleAnnotationSetVisibilityChange = useCallback(
    (setId: string, visible: boolean) => {
      setHiddenAnnotationSetIds((current) => {
        if (visible) {
          return current.filter((hiddenSetId) => hiddenSetId !== setId)
        }

        return current.includes(setId) ? current : [...current, setId]
      })
    },
    [],
  )
  const focusSpatialViewOnCell = useCallback((cell: OverviewCellDatum) => {
    spatialFocusRequestIdRef.current += 1
    setSpatialFocusRequest({
      key: spatialFocusRequestIdRef.current,
      target: [cell.position[0] ?? 0, cell.position[1] ?? 0, cell.position[2] ?? 0],
    })
  }, [])
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
    loadState.status === 'ready' ? roiGeneDatasetWarmupKey(loadState.url) : null
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
        customMorphologyLayerState,
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
      customMorphologyLayerState,
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
  const shareableMorphologyEnabledChannelIds = useMemo(() => {
    if (baseMorphologyChannelIds.size === 0) {
      return undefined
    }

    if (morphologyChannelSettings.length > 0) {
      return morphologyChannelSettings
        .filter((setting) => setting.enabled && baseMorphologyChannelIds.has(setting.id))
        .map((setting) => setting.id)
    }

    return morphologyState.status === 'loading'
      ? initialShareableState.morphologyEnabledChannelIds
      : undefined
  }, [
    initialShareableState.morphologyEnabledChannelIds,
    baseMorphologyChannelIds,
    morphologyChannelSettings,
    morphologyState.status,
  ])
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
        customMorphologyLayerState,
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
      customMorphologyLayerState,
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
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScoreMode,
      geneExpressionState,
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
  const resetGeneExpressionSelectionState = useCallback(() => {
    abortActiveRequest(geneExpressionAbortRef)
    geneExpressionRequestId.current += 1
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain({ key: '', max: 0 })
    setGeneExpressionState({ status: 'idle' })
  }, [])

  const toggleGene = useCallback(
    (gene: string) => {
      const isSelected = selectedGenes.includes(gene)

      appendDebugEvent(isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`)
      resetGeneExpressionSelectionState()
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes((current) =>
        isSelected
          ? current.filter((selectedGene) => selectedGene !== gene)
          : [...current, gene].sort((a, b) => a.localeCompare(b)),
      )
    },
    [appendDebugEvent, resetGeneExpressionSelectionState, selectedGenes],
  )
  const handlePinTranscript = useCallback(
    (detail: ViewerTranscriptHoverDetail) => {
      setPinnedTranscript(detail)
      setActiveControlHudTab('transcripts')
      appendDebugEvent(
        detail.transcript === undefined
          ? 'Pinned transcript density bin'
          : `Pinned transcript ${detail.transcript.transcriptId ?? detail.transcript.id}`,
        { coalesceKey: 'transcript-pin' },
      )
    },
    [appendDebugEvent],
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
    handleImportAnnotationUrl,
    handleImportAnnotations,
    handleLoadAnnotations,
    handleRemoveCellMetadataTrack,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
  } = useAnnotationWorkflow({
    annotationState,
    appendDebugEvent,
    cellMetadataTracks,
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
    setHiddenAnnotationSetIds,
    setCellMetadataTracks,
    setAnnotationState,
    setObservationColorMode,
    setRoiName,
    setSelectedAnnotationGroupId,
    setSelectedCellMetadataTrackId,
  })

  const { handleEmbeddingCellSelect, handleLoadAnalysisEmbeddings } =
    useAnalysisEmbeddingWorkflow({
      analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
      analysisEmbeddingState,
      appendDebugEvent,
      loadAnalysisEmbeddings,
      loadState,
      onSelectedCellFocus: focusSpatialViewOnCell,
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
  const { handleLoadCustomLayer, handleRemoveCustomLayer } =
    useCustomMorphologyLayerWorkflow({
      appendDebugEvent,
      customLayers: customMorphologyLayers,
      customLayerAbortRef: customMorphologyLayerAbortRef,
      customLayerIdRef: customMorphologyLayerIdRef,
      customLayerRequestIdRef: customMorphologyLayerRequestIdRef,
      loadCustomMorphologyLayer,
      loadRequestIdRef: loadRequestId,
      setCustomLayerLoadState: setCustomMorphologyLayerState,
      setCustomLayers: setCustomMorphologyLayers,
      setMorphologyChannelSettings,
    })
  const handleCustomImageLayerOpacityChange = useCallback(
    (imageUrl: string, opacity: number) => {
      setCustomImageLayerOpacities((current) => ({
        ...current,
        [imageUrl]: normalizeLayerOpacity(opacity),
      }))
    },
    [],
  )
  const handleRemoveCustomImageLayer = useCallback(
    (layerId: string) => {
      const layer = customMorphologyLayers.find((candidate) => candidate.id === layerId)
      handleRemoveCustomLayer(layerId)

      if (layer === undefined) {
        return
      }

      setCustomImageLayerOpacities((current) => {
        const remaining = { ...current }
        delete remaining[layer.image.url]
        return remaining
      })
    },
    [customMorphologyLayers, handleRemoveCustomLayer],
  )

  useEffect(() => {
    if (loadedDatasetUrl === null || initialCustomImageUrlsRef.current.length === 0) {
      return
    }

    const initialDatasetUrl = initialShareableState.datasetUrl?.trim()

    if (
      initialDatasetUrl !== undefined &&
      initialDatasetUrl !== '' &&
      initialDatasetUrl !== loadedDatasetUrl
    ) {
      return
    }

    const customImageUrls = initialCustomImageUrlsRef.current
    const customImageOpacities = initialCustomImageOpacitiesRef.current
    initialCustomImageUrlsRef.current = []
    initialCustomImageOpacitiesRef.current = []

    void (async () => {
      for (const [index, customImageUrl] of customImageUrls.entries()) {
        const loaded = await handleLoadCustomLayer(customImageUrl)
        const opacity = customImageOpacities[index]

        if (!loaded || opacity === undefined) {
          continue
        }

        try {
          const normalizedUrl = normalizeCustomMorphologyLayerUrl(customImageUrl)
          handleCustomImageLayerOpacityChange(normalizedUrl, opacity)
        } catch {
          // The load workflow already surfaced invalid URLs.
        }
      }
    })()
  }, [
    handleCustomImageLayerOpacityChange,
    handleLoadCustomLayer,
    initialShareableState.datasetUrl,
    loadedDatasetUrl,
  ])

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
    customMorphologyLayerAbortRef,
    customMorphologyLayerRequestIdRef,
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
    setHiddenAnnotationSetIds,
    setCellMetadataTracks,
    setSelectedCellMetadataTrackId,
    setAutoContrastChannelIds,
    setBoundaryElements,
    setBoundaryState,
    setCellDetailState,
    setCellFeatureMatrixCapabilityState,
    setCellTranscriptDistributionState,
    setCurrentViewportDetail,
    setCustomMorphologyLayerState,
    setCustomMorphologyLayers,
    setCustomImageLayerOpacities,
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
    setSelectedAnnotationGroupId,
    setSelectedCell,
    setSelectedEmbeddingKind,
    setSelectedGenes,
    setTranscriptCapabilityState,
    setTranscriptDensityColorScale,
    setTranscriptExactPointLimit,
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

  useShareableUrlHash({
    activeControlHudTab,
    activeRoiSelection,
    annotationUrl: annotationImportUrl,
    boundaryCellLimit,
    coordinateUnit,
    customImageOpacities,
    customImageUrls,
    datasetUrl,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    imageOpacity: imageLayerOpacity,
    cellFillOpacity,
    cellBoundaryOpacity,
    morphologyEnabledChannelIds: shareableMorphologyEnabledChannelIds,
    magicLensActive,
    magicLensMinQv,
    magicLensRadiusMicrometers,
    magicLensScope,
    measurementUnit,
    observationColorMode,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    transcriptDetailMode,
    transcriptDensityColorScale,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode: effectiveTranscriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
  })

  return (
    <main className="app-shell">
      <a className="skip-link" href="#viewer-heading">
        Skip To Spatial View
      </a>
      <AppControlHud
        activeControlHudTab={activeControlHudTab}
        appendDebugEvent={appendDebugEvent}
        isControlHudCollapsed={isControlHudCollapsed}
        loadingTabIds={loadingTabIds}
        setActiveControlHudTab={setActiveControlHudTab}
        setIsControlHudCollapsed={setIsControlHudCollapsed}
      >
        <AppDatasetHudPanel
          active={activeControlHudTab === 'dataset'}
          activeErrors={activeErrors}
          appendDebugEvent={appendDebugEvent}
          boundaryCellLimit={boundaryCellLimit}
          cellFeatureMatrixCapabilityState={cellFeatureMatrixCapabilityState}
          controlIds={controlIds}
          datasetUrl={datasetUrl}
          debugLog={debugLog}
          diagnosticsState={diagnosticsState}
          handleDatasetSubmit={handleDatasetSubmit}
          handleDownloadDiagnostics={handleDownloadDiagnostics}
          handleRunDatasetDiagnostics={handleRunDatasetDiagnostics}
          isLoading={isLoading}
          setBoundaryCellLimit={setBoundaryCellLimit}
          setDatasetUrl={setDatasetUrl}
          setDebugLog={setDebugLog}
          setShouldLoadMorphology={setShouldLoadMorphology}
          shouldLoadMorphology={shouldLoadMorphology}
        />

        <AppLayerHudPanel
          active={activeControlHudTab === 'layers'}
          appendDebugEvent={appendDebugEvent}
          autoContrastChannelIds={autoContrastChannelIds}
          cellBoundaryOpacity={cellBoundaryOpacity}
          cellFillOpacity={cellFillOpacity}
          controlIds={controlIds}
          coordinateUnit={coordinateUnit}
          customLayerLoadState={customMorphologyLayerState}
          customLayers={customMorphologyLayers}
          customLayerOpacities={customImageLayerOpacities}
          handleAutoContrast={handleAutoContrast}
          handleLoadCustomLayer={handleLoadCustomLayer}
          handleMagicLensLeave={handleMagicLensLeave}
          handleRemoveCustomLayer={handleRemoveCustomImageLayer}
          imageLayerOpacity={imageLayerOpacity}
          loadEnabled={loadState.status === 'ready'}
          measurementEnabled={measurementEnabled}
          measurementUnit={measurementUnit}
          morphologyChannelSettings={morphologyChannelSettings}
          morphologyChannels={morphologyChannels}
          performanceBudget={performanceBudget}
          setCellBoundaryOpacity={setCellBoundaryOpacity}
          setCellFillOpacity={setCellFillOpacity}
          setCoordinateUnit={setCoordinateUnit}
          setCustomLayerOpacity={handleCustomImageLayerOpacityChange}
          setImageLayerOpacity={setImageLayerOpacity}
          setMagicLensActive={setMagicLensActive}
          setMeasurementEnabled={setMeasurementEnabled}
          setMeasurementResetKey={setMeasurementResetKey}
          setMeasurementUnit={setMeasurementUnit}
          setRoiMode={setRoiMode}
          updateMorphologyChannel={updateMorphologyChannel}
        />

        <AppGeneHudPanel
          active={activeControlHudTab === 'genes'}
          analysisHeaderCopy={analysisHeaderCopy}
          appendDebugEvent={appendDebugEvent}
          controlIds={controlIds}
          geneExpressionColorScale={geneExpressionColorScale}
          geneExpressionBatch={geneExpressionBatch}
          geneExpressionCopy={geneExpressionCopy}
          geneExpressionDetailMode={geneExpressionDetailMode}
          geneExpressionScaleMax={geneExpressionScaleMax}
          geneExpressionScaleDatasetUrl={geneExpressionScaleDatasetUrl}
          geneExpressionScoreMode={geneExpressionScoreMode}
          geneExpressionState={geneExpressionState}
          genePanelState={genePanelState}
          geneOptions={geneOptions}
          hasAnnotationColors={
            annotationState.status === 'ready' && annotationState.annotations.length > 0
          }
          cellMetadataTracks={cellMetadataTracks}
          selectedCellMetadataTrackId={selectedCellMetadataTrack?.id ?? null}
          observationColorMode={observationColorMode}
          rememberGeneExpressionScaleMax={rememberGeneExpressionScaleMax}
          resetGeneExpressionSelectionState={resetGeneExpressionSelectionState}
          selectedGenes={selectedGenes}
          setGeneExpressionColorScale={setGeneExpressionColorScale}
          setGeneExpressionDetailMode={setGeneExpressionDetailMode}
          setGeneExpressionScaleDomain={setGeneExpressionScaleDomain}
          setGeneExpressionScoreMode={setGeneExpressionScoreMode}
          setManualTranscriptExactRequestKey={setManualTranscriptExactRequestKey}
          setSelectedCellMetadataTrackId={setSelectedCellMetadataTrackId}
          setObservationColorMode={setObservationColorMode}
          setSelectedGenes={setSelectedGenes}
          toggleGene={toggleGene}
          transcriptViewportKeyRef={transcriptViewportKeyRef}
        />

        <AppTranscriptHudPanel
          active={activeControlHudTab === 'transcripts'}
          appendDebugEvent={appendDebugEvent}
          controlIds={controlIds}
          effectiveTranscriptFeatureFilterMode={effectiveTranscriptFeatureFilterMode}
          geneOptions={geneOptions}
          genePanelState={genePanelState}
          handlePinTranscript={handlePinTranscript}
          hoveredTranscript={hoveredTranscript}
          loadEnabled={loadState.status === 'ready'}
          pinnedTranscript={pinnedTranscript}
          resetGeneExpressionSelectionState={resetGeneExpressionSelectionState}
          selectedGenes={selectedGenes}
          setManualTranscriptExactRequestKey={setManualTranscriptExactRequestKey}
          setPinnedTranscript={setPinnedTranscript}
          setSelectedGenes={setSelectedGenes}
          setShowTranscriptOverlay={setShowTranscriptOverlay}
          setTranscriptDensityColorScale={setTranscriptDensityColorScale}
          setTranscriptDetailMode={setTranscriptDetailMode}
          setTranscriptExactPointLimit={setTranscriptExactPointLimit}
          setTranscriptFeatureFilterMode={setTranscriptFeatureFilterMode}
          setTranscriptGeneOnly={setTranscriptGeneOnly}
          setTranscriptMinQv={setTranscriptMinQv}
          setTranscriptOpacity={setTranscriptOpacity}
          setTranscriptPointColorMode={setTranscriptPointColorMode}
          setTranscriptPointSize={setTranscriptPointSize}
          showTranscriptOverlay={showTranscriptOverlay}
          toggleGene={toggleGene}
          transcriptCapabilityState={transcriptCapabilityState}
          transcriptCopy={transcriptCopy}
          transcriptDensityColorScale={transcriptDensityColorScale}
          transcriptDensityScaleLabels={transcriptDensityScaleLabels}
          transcriptDensityScaleMax={transcriptDensityScaleMax}
          transcriptDetailMode={transcriptDetailMode}
          transcriptExactPointLimit={transcriptExactPointLimit}
          transcriptGeneOnly={transcriptGeneOnly}
          transcriptLayerState={transcriptLayerState}
          transcriptMinQv={transcriptMinQv}
          transcriptOpacity={transcriptOpacity}
          transcriptPointColorMode={transcriptPointColorMode}
          transcriptPointSize={transcriptPointSize}
          transcriptViewportKeyRef={transcriptViewportKeyRef}
          visibleTranscriptEstimate={visibleTranscriptEstimate}
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
          annotationImportUrlInputId={controlIds.annotationImportUrlInputId}
          annotationImportUrl={annotationImportUrl}
          annotationHeaderCopy={annotationHeaderCopy}
          loadEnabled={loadState.status === 'ready'}
          selectedAnnotationGroupId={selectedAnnotationGroupId}
          annotationGroupOptions={annotationGroupOptions}
          annotationState={annotationState}
          annotationGroupState={annotationGroupState}
          annotationColors={annotationColors}
          hiddenAnnotationSetIds={hiddenAnnotationSetIds}
          cellMetadataTracks={cellMetadataTracks}
          onAnnotationGroupChange={handleAnnotationGroupChange}
          onLoadAnnotations={handleLoadAnnotations}
          onClearAnnotations={handleClearAnnotations}
          onImportAnnotations={(file) => {
            void handleImportAnnotations(file)
          }}
          onAnnotationImportUrlChange={setAnnotationImportUrl}
          onImportAnnotationUrl={handleImportAnnotationUrl}
          onAnnotationColorChange={handleAnnotationColorChange}
          onAnnotationSetVisibilityChange={handleAnnotationSetVisibilityChange}
          onRemoveAnnotation={handleRemoveAnnotation}
          onRemoveCellMetadataTrack={handleRemoveCellMetadataTrack}
        />

        <CellHudPanel
          active={activeControlHudTab === 'cell'}
          embeddingViewInputId={controlIds.embeddingViewInputId}
          embeddingCopy={embeddingCopy}
          analysisEmbeddingState={analysisEmbeddingState}
          activeEmbedding={activeEmbedding}
          annotationStyles={annotationStyleColors}
          selectedEmbeddingKind={selectedEmbeddingKind}
          roiCellIds={roiCellIds}
          selectedCell={selectedCell}
          selectedCellAnnotationLabels={selectedCellAnnotationLabels}
          cellDetailCopy={cellDetailCopy}
          cellDetailState={cellDetailState}
          cellTranscriptDistributionState={cellTranscriptDistributionState}
          loadEnabled={loadState.status === 'ready'}
          onEmbeddingKindChange={(nextEmbeddingKind) => {
            setSelectedEmbeddingKind(nextEmbeddingKind)
            appendDebugEvent(`Embedding view: ${nextEmbeddingKind}`)
          }}
          onLoadAnalysisEmbeddings={handleLoadAnalysisEmbeddings}
          onClearSelectedCell={() => {
            setSelectedCell(null)
          }}
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
      </AppControlHud>

      <section className="viewer-region" aria-labelledby="viewer-heading">
        <h2 id="viewer-heading" className="visually-hidden">
          Spatial View
        </h2>

        <ViewerCore
          cells={styledOverviewCells}
          expressionCells={styledGeneExpressionCells}
          geneExpressionActive={geneExpressionState.status === 'ready'}
          boundaries={boundaryLayerData}
          transcriptAggregateBins={transcriptLayerAggregateBins}
          transcriptPoints={transcriptLayerPoints}
          imageLoader={morphologyImage?.loader ?? null}
          imageChannels={morphologyCanvasChannels}
          imageOpacity={morphologyCanvasChannels.length === 0 ? imageLayerOpacity : 1}
          cellFillOpacity={cellFillOpacity}
          cellBoundaryOpacity={cellBoundaryOpacity}
          transcriptOpacity={transcriptOpacity}
          transcriptPointSize={transcriptPointSize}
          observationColorMode={viewerObservationColorMode}
          annotationStyleColors={activeAnnotationStyleColors}
          cellMetadataTrack={activeCellMetadataTrack}
          loadingTasks={loadingTasks}
          coordinateUnit={coordinateUnit}
          measurementEnabled={measurementEnabled}
          measurementUnit={measurementUnit}
          measurementResetKey={measurementResetKey}
          status={loadState.status}
          imageStatus={viewerImageStatus}
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
          focusRequest={spatialFocusRequest}
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
          {...(viewerImageError === null
            ? {}
            : { imageErrorMessage: formatStructuredError(viewerImageError) })}
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
