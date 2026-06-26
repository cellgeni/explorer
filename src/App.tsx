import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ViewerCore,
  type ViewerCoordinateUnit,
  type ViewerFocusRequest,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import type { FlatMorphologyCanvasImage } from './components/MorphologyCanvas'
import { AppControlHud } from './features/app-shell/AppControlHud'
import { AppDatasetHudPanel } from './features/app-shell/AppDatasetHudPanel'
import { AppGeneHudPanel } from './features/app-shell/AppGeneHudPanel'
import { AppLayerHudPanel } from './features/app-shell/AppLayerHudPanel'
import { AppTranscriptHudPanel } from './features/app-shell/AppTranscriptHudPanel'
import { useTranscriptWorkflow } from './features/transcripts/useTranscriptWorkflow'
import { useGeneExpressionLayerTelemetry } from './features/genes/useGeneExpressionLayerTelemetry'
import {
  useVisiumHdExpressionProjectionWorkflow,
  type VisiumHdExpressionProjectionState,
} from './features/genes/useVisiumHdExpressionProjectionWorkflow'
import { AnnotationHudPanel } from './features/annotations/AnnotationHudPanel'
import { CellHudPanel } from './features/control-hud/CellHudPanel'
import { RoiHudPanel, VisiumHdRoiHudPanel } from './features/control-hud/RoiHudPanel'
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
  type BoundaryElementsLoader,
  type GeneExpressionLoader,
} from './features/app-shell/appDependencies'
import { useAppControlIds } from './features/app-shell/useAppControlIds'
import { useViewerLayerData } from './features/app-shell/useViewerLayerData'
import { useDatasetLifecycle } from './features/app-shell/useDatasetLifecycle'
import { useVisiumHdBinWorkflow } from './features/app-shell/useVisiumHdBinWorkflow'
import { useVisiumHdExpressionProfileWorkflow } from './features/app-shell/useVisiumHdExpressionProfileWorkflow'
import { useViewportDataWorkflow } from './features/app-shell/useViewportDataWorkflow'
import { useShareableUrlHash } from './features/app-shell/useShareableUrlHash'
import {
  formatMappingRowsScope,
  isSpatialGeneExpressionDataset,
  isSpatialSegmentationDataset,
} from './features/app-shell/visiumHdAppController'
import {
  appendFallbackNoticeEntry,
  appendDebugLogEntry,
  createLoadingTasks,
  createFallbackNoticeEntry,
  createDebugLogEntry,
  invalidateLatestRequest,
  type DebugLogAppendOptions,
  type DebugLogEntry,
  type FallbackNoticeEntry,
} from './features/app-shell/appRuntimeModel'
import {
  TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
  IDLE_TRANSCRIPT_CAPABILITY_STATE,
  IDLE_TRANSCRIPT_LAYER_STATE,
  parseTranscriptDensityColorScale,
  parseTranscriptDetailMode,
  parseTranscriptFeatureFilterMode,
  parseTranscriptPointColorMode,
  transcriptStatusCopy,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './features/transcripts/transcriptLayerModel'
import {
  IDLE_CELL_DETAIL_STATE,
  IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE,
  cellDetailStatusCopy,
  type CellDetailState,
  type CellTranscriptDistributionState,
} from './features/cells/cellDetailModel'
import {
  IDLE_CELL_EXPRESSION_PROFILE_STATE,
  cellExpressionProfileMatchesSelection,
  type CellExpressionProfileSelection,
  type CellExpressionProfileState,
} from './features/cells/cellExpressionProfileModel'
import type { CellGeneExpressionStatus } from './features/cells/cellGeneExpressionStatus'
import { useCellDetailWorkflow } from './features/cells/useCellDetailWorkflow'
import {
  IDLE_GRID_CELL_ASSIGNMENT_STATE,
  type GridCellAssignmentState,
} from './features/cells/gridCellAssignmentModel'
import { useGridCellAssignmentWorkflow } from './features/cells/useGridCellAssignmentWorkflow'
import {
  IDLE_ANALYSIS_EMBEDDING_STATE,
  analysisEmbeddingStatusCopy,
  type AnalysisEmbeddingState,
} from './features/analysis/analysisEmbeddingModel'
import { useAnalysisEmbeddingWorkflow } from './features/analysis/useAnalysisEmbeddingWorkflow'
import type { MorphologyChannelSetting } from './features/morphology/morphologyChannels'
import { useMorphologyWorkflow } from './features/morphology/useMorphologyWorkflow'
import {
  IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE,
  customMorphologyLayerChannels,
  type CustomMorphologyLayer,
  type CustomMorphologyLayerLoadState,
} from './features/morphology/customMorphologyLayers'
import { useCustomMorphologyLayerWorkflow } from './features/morphology/useCustomMorphologyLayerWorkflow'
import {
  IDLE_MAGIC_LENS_STATE,
  magicLensScopeLabel,
  magicLensStatusCopy,
  normalizeMagicLensMinQv,
  normalizeMagicLensRadius,
  parseMagicLensScope,
  type MagicLensScope,
  type MagicLensState,
} from './features/roi/magicLensModel'
import { useMagicLensWorkflow } from './features/roi/useMagicLensWorkflow'
import { useVisiumHdMagicLensSummary } from './features/roi/useVisiumHdMagicLensSummary'
import { useRoiWorkflow } from './features/roi/useRoiWorkflow'
import { useVisiumHdRoiWorkflow } from './features/roi/useVisiumHdRoiWorkflow'
import {
  IDLE_ROI_GENE_STATS_STATE,
  IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE,
  IDLE_ROI_STATE,
  IDLE_ROI_TRANSCRIPT_EXPORT_STATE,
  roiGeneDatasetWarmupKey,
  roiGeneStatsStatusCopy,
  roiStatusCopy,
  summarizeRoiCells,
  type RoiGeneStatsState,
  type RoiGeneViewportWarmupState,
  type RoiState,
  type RoiTranscriptExportState,
} from './features/roi/roiModel'
import {
  gridCellDatumDeckCenter,
  IDLE_VISIUM_HD_ROI_STATE,
  summarizeVisiumHdRoiBins,
  visiumHdRoiStatusCopy,
  type VisiumHdRoiState,
} from './features/roi/visiumHdRoiModel'
import { useDatasetDiagnosticsWorkflow } from './features/diagnostics/useDatasetDiagnosticsWorkflow'
import {
  IDLE_ANNOTATION_GROUP_STATE,
  IDLE_ANNOTATION_STATE,
  annotationLabelsForCell,
  annotationStatusCopy,
  filterAnnotationsByVisibleClasses,
  filterAnnotationsByVisibleSets,
  type AnnotationGroupState,
  type AnnotationState,
} from './features/annotations/annotationModel'
import { useAnnotationWorkflow } from './features/annotations/useAnnotationWorkflow'
import {
  IDLE_GENE_EXPRESSION_STATE,
  IDLE_GENE_PANEL_STATE,
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
import {
  IDLE_BOUNDARY_LOAD_STATE,
  IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE,
  IDLE_DATASET_DIAGNOSTICS_STATE,
  IDLE_DATASET_LOAD_STATE,
  IDLE_DATASET_WARMUP_STATE,
  IDLE_MORPHOLOGY_LOAD_STATE,
  morphologyLoadFailed,
  type BoundaryLoadState,
  type CellFeatureMatrixCapabilityState,
  type DatasetDiagnosticsState,
  type DatasetLoadState,
  type DatasetWarmupState,
  type MorphologyLoadState,
} from './features/dataset/datasetLoadModel'
import {
  IDLE_VISIUM_HD_CONTROL_STATE,
  type VisiumHdControlState,
} from './features/dataset/visiumHdModel'
import { ALL_ANNOTATION_GROUP_ID } from './data/datasetAnnotations'
import {
  normalizeTranscriptExactPointLimit,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from './data/transcriptOverlay'
import type { RoiSelection } from './data/roiSelection'
import type { ContinuousCellMetadataTrack } from './data/customAnnotations'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import { type ShareableState, type ShareableViewState } from './data/shareableState'
import {
  appendTelemetryEvent,
  telemetryEvent,
  type TelemetryEvent,
} from './data/telemetry'
import { normalizeBoundaryCellLimit } from './rendering/boundaryViewport'
import type { FallbackNotice } from './data/fallbackNotice'
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
  styleCellBoundariesByGeneExpression,
  styleGridCellsByGeneExpression,
} from './rendering/deckLayers'
import { useViewerStore } from './store/viewerStore'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import {
  normalizeCustomMorphologyLayerUrl,
  type MorphologyImage,
} from './data/morphologyImage'
import type { ObservationColorMode } from './rendering/cellStyling'
import type { AnalysisEmbeddingKind } from './data/analysisEmbeddings'
import type { Platform, SpatialElement } from './datasets/spatialDataset'
import type { GeneExpressionDetailMode } from './data/geneExpressionLod'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from './rendering/deckLayers'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from './rendering/deckLayers'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerViewportDetail,
} from './components/ViewerCore'

const EMPTY_CELL_BOUNDARY_DATA: readonly CellBoundaryDatum[] = []
const EMPTY_SPATIAL_ELEMENTS: readonly SpatialElement[] = []
const EMPTY_GENE_EXPRESSION_SCALE_DOMAIN: GeneExpressionScaleDomain = { key: '', max: 0 }

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
  SpatialDatasetDetector,
  SpatialDatasetLoader,
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
  detectSpatialDataset = defaultAppDependencies.detectSpatialDataset,
  getSpatialDataset = defaultAppDependencies.getSpatialDataset,
  computeAutoChannelContrast = defaultAppDependencies.computeAutoChannelContrast,
}: AppProps) {
  const controlIds = useAppControlIds()
  const [initialShareableState] = useState<ShareableState>(() =>
    readShareableStateFromLocation(),
  )
  const [performanceBudget] = useState<PerformanceBudget>(() => detectPerformanceBudget())
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const [loadState, setLoadState] = useState<DatasetLoadState<StructuredLoadError>>(
    IDLE_DATASET_LOAD_STATE,
  )
  const [datasetWarmupState, setDatasetWarmupState] = useState<DatasetWarmupState>(
    IDLE_DATASET_WARMUP_STATE,
  )
  const [cellFeatureMatrixCapabilityState, setCellFeatureMatrixCapabilityState] =
    useState<CellFeatureMatrixCapabilityState>(IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE)
  const [diagnosticsState, setDiagnosticsState] = useState<
    DatasetDiagnosticsState<StructuredLoadError>
  >(IDLE_DATASET_DIAGNOSTICS_STATE)
  const [morphologyState, setMorphologyState] = useState<
    MorphologyLoadState<StructuredLoadError>
  >(IDLE_MORPHOLOGY_LOAD_STATE)
  const [boundaryState, setBoundaryState] = useState<
    BoundaryLoadState<StructuredLoadError>
  >(IDLE_BOUNDARY_LOAD_STATE)
  const [genePanelState, setGenePanelState] =
    useState<GenePanelState<StructuredLoadError>>(IDLE_GENE_PANEL_STATE)
  const [annotationState, setAnnotationState] =
    useState<AnnotationState<StructuredLoadError>>(IDLE_ANNOTATION_STATE)
  const [annotationGroupState, setAnnotationGroupState] = useState<
    AnnotationGroupState<StructuredLoadError>
  >(IDLE_ANNOTATION_GROUP_STATE)
  const [analysisEmbeddingState, setAnalysisEmbeddingState] = useState<
    AnalysisEmbeddingState<StructuredLoadError>
  >(IDLE_ANALYSIS_EMBEDDING_STATE)
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
  const [hiddenAnnotationIds, setHiddenAnnotationIds] = useState<readonly string[]>([])
  const [cellMetadataTracks, setCellMetadataTracks] = useState<
    readonly ContinuousCellMetadataTrack[]
  >([])
  const [selectedCellMetadataTrackId, setSelectedCellMetadataTrackId] = useState<
    string | null
  >(null)
  const [selectedEmbeddingKind, setSelectedEmbeddingKind] =
    useState<AnalysisEmbeddingKind>('umap')
  const [roiState, setRoiState] = useState<RoiState<StructuredLoadError>>(IDLE_ROI_STATE)
  const [visiumHdRoiState, setVisiumHdRoiState] = useState<VisiumHdRoiState>(
    IDLE_VISIUM_HD_ROI_STATE,
  )
  const [roiGeneStatsState, setRoiGeneStatsState] = useState<
    RoiGeneStatsState<StructuredLoadError>
  >(IDLE_ROI_GENE_STATS_STATE)
  const [roiGeneViewportWarmupState, setRoiGeneViewportWarmupState] =
    useState<RoiGeneViewportWarmupState>(IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE)
  const [roiTranscriptExportState, setRoiTranscriptExportState] = useState<
    RoiTranscriptExportState<StructuredLoadError>
  >(IDLE_ROI_TRANSCRIPT_EXPORT_STATE)
  const [transcriptCapabilityState, setTranscriptCapabilityState] = useState<
    TranscriptCapabilityState<StructuredLoadError>
  >(IDLE_TRANSCRIPT_CAPABILITY_STATE)
  const [transcriptLayerState, setTranscriptLayerState] = useState<
    TranscriptLayerState<StructuredLoadError>
  >(IDLE_TRANSCRIPT_LAYER_STATE)
  const [magicLensState, setMagicLensState] =
    useState<MagicLensState<StructuredLoadError>>(IDLE_MAGIC_LENS_STATE)
  const [cellDetailState, setCellDetailState] =
    useState<CellDetailState<StructuredLoadError>>(IDLE_CELL_DETAIL_STATE)
  const [cellTranscriptDistributionState, setCellTranscriptDistributionState] = useState<
    CellTranscriptDistributionState<StructuredLoadError>
  >(IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE)
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
  const [fallbackNotices, setFallbackNotices] = useState<readonly FallbackNoticeEntry[]>(
    [],
  )
  const [telemetryEvents, setTelemetryEvents] = useState<readonly TelemetryEvent[]>([])
  const [isControlHudCollapsed, setIsControlHudCollapsed] = useState(false)
  const [activeControlHudTab, setActiveControlHudTab] = useState<ControlHudTab>(
    () => parseControlHudTab(initialShareableState.activeTab) ?? 'dataset',
  )
  const [geneExpressionState, setGeneExpressionState] = useState<
    GeneExpressionState<StructuredLoadError>
  >(IDLE_GENE_EXPRESSION_STATE)
  const [overviewCells, setOverviewCells] = useState<readonly OverviewCellDatum[]>([])
  const [spatialGridCells, setSpatialGridCells] = useState<readonly GridCellDatum[]>([])
  const [geneExpressionBatch, setGeneExpressionBatch] =
    useState<GeneExpressionBatch | null>(null)
  const [geneExpressionScaleDomain, setGeneExpressionScaleDomain] =
    useState<GeneExpressionScaleDomain>({ key: '', max: 0 })
  const [morphologyImage, setMorphologyImage] = useState<MorphologyImage | null>(null)
  const [flatMorphologyImage, setFlatMorphologyImage] =
    useState<FlatMorphologyCanvasImage | null>(null)
  const [customMorphologyLayers, setCustomMorphologyLayers] = useState<
    readonly CustomMorphologyLayer[]
  >([])
  const [customMorphologyLayerState, setCustomMorphologyLayerState] = useState<
    CustomMorphologyLayerLoadState<StructuredLoadError>
  >(IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE)
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
  const [nucleusBoundaryElements, setNucleusBoundaryElements] = useState<
    readonly SpatialElement[]
  >([])
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
  const [showCellBoundaries, setShowCellBoundaries] = useState(
    initialShareableState.showCellBoundaries ?? true,
  )
  const [showNucleusBoundaries, setShowNucleusBoundaries] = useState(
    initialShareableState.showNucleusBoundaries ?? true,
  )
  const [showHoverTooltips, setShowHoverTooltips] = useState(
    initialShareableState.showHoverTooltips ?? true,
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
  const [selectedGridCell, setSelectedGridCell] = useState<GridCellDatum | null>(null)
  const [selectedBoundaryCell, setSelectedBoundaryCell] =
    useState<CellBoundaryDatum | null>(null)
  const [spatialFocusRequest, setSpatialFocusRequest] =
    useState<ViewerFocusRequest | null>(null)
  const [currentViewportDetail, setCurrentViewportDetail] =
    useState<ViewerViewportDetail | null>(null)
  const [, setViewportCellCount] = useState<number | null>(null)
  const [datasetPlatform, setDatasetPlatform] = useState<Platform | null>(null)
  const [visiumHdControlState, setVisiumHdControlState] = useState<VisiumHdControlState>(
    IDLE_VISIUM_HD_CONTROL_STATE,
  )
  const [gridCellAssignmentState, setGridCellAssignmentState] = useState<
    GridCellAssignmentState<StructuredLoadError>
  >(IDLE_GRID_CELL_ASSIGNMENT_STATE)
  const [visiumHdExpressionProfileState, setVisiumHdExpressionProfileState] = useState<
    CellExpressionProfileState<StructuredLoadError>
  >(IDLE_CELL_EXPRESSION_PROFILE_STATE)
  const loadRequestId = useRef(0)
  const visiumHdBinRequestId = useRef(0)
  const analysisEmbeddingRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const geneExpressionRequestId = useRef(0)
  const roiRequestId = useRef(0)
  const roiTranscriptExportRequestId = useRef(0)
  const transcriptCapabilityRequestId = useRef(0)
  const transcriptRequestId = useRef(0)
  const magicLensRequestId = useRef(0)
  const cellDetailRequestId = useRef(0)
  const gridCellAssignmentRequestId = useRef(0)
  const visiumHdExpressionProfileRequestId = useRef(0)
  const cellTranscriptDistributionRequestId = useRef(0)
  const magicLensDebounceRef = useRef<number | null>(null)
  const magicLensLastDetailRef = useRef<ViewerMagicLensDetail | null>(null)
  const magicLensLastQueryKeyRef = useRef<string | null>(null)
  const debugLogIdRef = useRef(0)
  const fallbackNoticeIdRef = useRef(0)
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
  const gridCellAssignmentAbortRef = useRef<AbortController | null>(null)
  const visiumHdExpressionProfileAbortRef = useRef<AbortController | null>(null)
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
  const isVisiumHdDataset =
    loadState.status === 'ready' && datasetPlatform === 'visium-hd'
  const xeniumFeatureLoadEnabled = loadState.status === 'ready' && !isVisiumHdDataset
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const selectedCellMetadataTrack = useMemo(
    () =>
      cellMetadataTracks.find((track) => track.id === selectedCellMetadataTrackId) ??
      cellMetadataTracks[0] ??
      null,
    [cellMetadataTracks, selectedCellMetadataTrackId],
  )
  const diagnosticsVisiumHdBinSize =
    visiumHdControlState.status === 'idle'
      ? undefined
      : visiumHdControlState.selectedBinSize
  const activeVisiumHdBinSize = diagnosticsVisiumHdBinSize
  const visiumHdBarcodeMappingRowBudget: number | undefined = undefined
  const activeVisiumHdRoiState: VisiumHdRoiState =
    isVisiumHdDataset &&
    loadState.status === 'ready' &&
    visiumHdRoiState.status === 'ready' &&
    visiumHdRoiState.url === loadState.url &&
    visiumHdRoiState.binSizeMicrometers === activeVisiumHdBinSize
      ? visiumHdRoiState
      : IDLE_VISIUM_HD_ROI_STATE
  const hiddenAnnotationSetIdSet = useMemo(
    () => new Set(hiddenAnnotationSetIds),
    [hiddenAnnotationSetIds],
  )
  const hiddenAnnotationIdSet = useMemo(
    () => new Set(hiddenAnnotationIds),
    [hiddenAnnotationIds],
  )
  const visibleAnnotationState = useMemo<AnnotationState<StructuredLoadError>>(
    () =>
      annotationState.status === 'ready'
        ? {
            ...annotationState,
            annotations: filterAnnotationsByVisibleClasses(
              filterAnnotationsByVisibleSets(
                annotationState.annotations,
                hiddenAnnotationSetIdSet,
              ),
              hiddenAnnotationIdSet,
            ),
          }
        : annotationState,
    [annotationState, hiddenAnnotationIdSet, hiddenAnnotationSetIdSet],
  )
  const appendDebugEvent = useCallback(
    (message: string, options: DebugLogAppendOptions = {}) => {
      debugLogIdRef.current += 1
      const entry = createDebugLogEntry(debugLogIdRef.current, message, options)

      setDebugLog((current) => appendDebugLogEntry(current, entry))
    },
    [],
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
  const visibleCellBoundaryElements = showCellBoundaries
    ? boundaryElements
    : EMPTY_SPATIAL_ELEMENTS
  const visiumHdExpressionProjectionState = useVisiumHdExpressionProjectionWorkflow({
    callbacks: { appendDebugEvent },
    controls: {
      isVisiumHdDataset,
      rowBudget: visiumHdBarcodeMappingRowBudget,
      selectedBinSize: activeVisiumHdBinSize,
    },
    data: {
      boundaryElements: visibleCellBoundaryElements,
      geneExpressionBatch,
      loadState,
    },
    loaders: { getSpatialDataset },
  })
  const projectedVisiumHdExpressionBatch =
    visiumHdExpressionProjectionState.status === 'ready'
      ? visiumHdExpressionProjectionState.batch
      : null
  const isProjectedVisiumHdExpressionActive =
    isVisiumHdDataset &&
    visibleCellBoundaryElements.length > 0 &&
    projectedVisiumHdExpressionBatch !== null
  const viewerGeneExpressionBatch = isProjectedVisiumHdExpressionActive
    ? projectedVisiumHdExpressionBatch
    : geneExpressionBatch
  const viewerGeneExpressionScaleDomain = isProjectedVisiumHdExpressionActive
    ? EMPTY_GENE_EXPRESSION_SCALE_DOMAIN
    : geneExpressionScaleDomain
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
    nucleusBoundaryLayerData,
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
    annotations: {
      annotationColors,
      annotationState: visibleAnnotationState,
    },
    boundaries: {
      boundaryElements,
      nucleusBoundaryElements,
    },
    cells: {
      cellMetadataTrack: selectedCellMetadataTrack,
      currentViewportBbox: currentViewportDetail?.bbox ?? null,
      gridCells: spatialGridCells,
      observationColorMode,
      overviewCells,
    },
    geneExpression: {
      geneExpressionBatch: viewerGeneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionScaleDatasetUrl,
      geneExpressionScaleDomain: viewerGeneExpressionScaleDomain,
      geneExpressionScoreMode,
      selectedGenes,
    },
    morphology: {
      morphologyChannelSettings,
      morphologyChannelOpacities,
      morphologyChannels,
      morphologyImage,
    },
    transcripts: {
      transcriptDensityColorScale,
      transcriptLayerState,
      transcriptPointColorMode,
    },
  })
  const visibleBoundaryLayerData = showCellBoundaries
    ? boundaryLayerData
    : EMPTY_CELL_BOUNDARY_DATA
  const expressionStyledBoundaryLayerData = useMemo(
    () =>
      styleCellBoundariesByGeneExpression(
        visibleBoundaryLayerData,
        styledGeneExpressionCells,
      ),
    [styledGeneExpressionCells, visibleBoundaryLayerData],
  )
  const visibleNucleusBoundaryLayerData = showNucleusBoundaries
    ? nucleusBoundaryLayerData
    : EMPTY_CELL_BOUNDARY_DATA
  const isVisiumHdBoundarySurfaceReserved =
    isVisiumHdDataset &&
    showCellBoundaries &&
    (boundaryState.status === 'loading' || expressionStyledBoundaryLayerData.length > 0)
  const expressionStyledSpatialGridCells = useMemo(
    () =>
      styleGridCellsByGeneExpression(spatialGridCells, styledGeneExpressionCells, {
        styleUnmatchedCells: geneExpressionState.status === 'ready',
      }),
    [geneExpressionState.status, spatialGridCells, styledGeneExpressionCells],
  )
  const viewerGridCells = useMemo(
    () => (isVisiumHdBoundarySurfaceReserved ? [] : expressionStyledSpatialGridCells),
    [expressionStyledSpatialGridCells, isVisiumHdBoundarySurfaceReserved],
  )
  const boundaryLoadingEnabled =
    showCellBoundaries || (isVisiumHdDataset && showNucleusBoundaries)
  const boundaryOverlayRequestKey = `${boundaryLoadingEnabled ? 'enabled' : 'disabled'}:${
    isVisiumHdDataset && showNucleusBoundaries ? 'nucleus' : 'no-nucleus'
  }`
  const boundaryOverlayRequestKeyRef = useRef(boundaryOverlayRequestKey)
  const geneExpressionOverlayEnabled = !(isVisiumHdDataset && spatialGridCells.length > 0)
  const activeSelectedBoundaryCell = useMemo(() => {
    if (selectedBoundaryCell === null || !isVisiumHdDataset) {
      return null
    }

    return (
      expressionStyledBoundaryLayerData.find(
        (cell) => cell.id === selectedBoundaryCell.id,
      ) ?? null
    )
  }, [expressionStyledBoundaryLayerData, isVisiumHdDataset, selectedBoundaryCell])
  const viewerMicrometersPerPixel =
    morphologyMicrometersPerPixel ?? flatMorphologyImage?.micrometersPerPixel
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
  const viewerViewResetKey =
    loadState.status === 'idle' ? 'idle' : `${loadState.status}:${loadState.url}`
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
  const gridCellById = useMemo(() => {
    const cellById = new Map<string, GridCellDatum>()

    for (const cell of expressionStyledSpatialGridCells) {
      cellById.set(cell.id, cell)
    }

    return cellById
  }, [expressionStyledSpatialGridCells])
  const activeSelectedGridCell = useMemo(() => {
    if (selectedGridCell === null) {
      return null
    }

    const cell = gridCellById.get(selectedGridCell.id) ?? selectedGridCell

    if (
      isVisiumHdDataset &&
      selectedGenes.length > 0 &&
      geneExpressionState.status === 'ready' &&
      cell.expressionCount === undefined
    ) {
      return {
        ...cell,
        expressionCount: 0,
        expressionGenes: selectedGenes,
      }
    }

    return cell
  }, [
    geneExpressionState.status,
    gridCellById,
    isVisiumHdDataset,
    selectedGenes,
    selectedGridCell,
  ])
  const activeVisiumHdExpressionProfileSelection =
    useMemo<CellExpressionProfileSelection | null>(() => {
      if (!isVisiumHdDataset) {
        return null
      }

      if (activeSelectedBoundaryCell !== null) {
        return {
          id: activeSelectedBoundaryCell.id,
          kind: 'cell',
        }
      }

      if (activeSelectedGridCell !== null) {
        return {
          id: activeSelectedGridCell.id,
          kind: 'bin',
        }
      }

      return null
    }, [activeSelectedBoundaryCell, activeSelectedGridCell, isVisiumHdDataset])
  const activeVisiumHdExpressionProfileState = cellExpressionProfileMatchesSelection(
    visiumHdExpressionProfileState,
    activeVisiumHdExpressionProfileSelection,
  )
    ? visiumHdExpressionProfileState
    : IDLE_CELL_EXPRESSION_PROFILE_STATE
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
    () =>
      isVisiumHdDataset
        ? activeVisiumHdRoiState.status === 'ready'
          ? activeVisiumHdRoiState.bins.map((bin) => bin.barcode)
          : []
        : roiState.status === 'ready'
          ? roiState.cells.map((cell) => cell.id)
          : [],
    [activeVisiumHdRoiState, isVisiumHdDataset, roiState],
  )
  const selectedEmbeddingElementId = isVisiumHdDataset
    ? (activeSelectedGridCell?.id ?? null)
    : (selectedCell?.id ?? null)
  const embeddingElementLabel = isVisiumHdDataset ? 'bins' : 'cells'
  const embeddingCopy = analysisEmbeddingStatusCopy(
    analysisEmbeddingState,
    activeEmbedding,
    roiCellIds,
    selectedEmbeddingElementId,
    embeddingElementLabel,
  )
  const cellDetailCopy = cellDetailStatusCopy(cellDetailState, selectedCell)
  const selectedCellAnnotationLabels = useMemo(
    () =>
      selectedCell === null
        ? []
        : annotationLabelsForCell(visibleAnnotationState, selectedCell.id),
    [selectedCell, visibleAnnotationState],
  )
  const selectedGeneExpressionStatus = useMemo(
    () => selectionGeneExpressionStatus(selectedGenes, geneExpressionState),
    [geneExpressionState, selectedGenes],
  )
  const selectedGridCellExpressionStatus =
    activeSelectedGridCell !== null &&
    activeSelectedGridCell.expressionCount === undefined
      ? selectedGeneExpressionStatus
      : undefined
  const selectedBoundaryCellExpressionStatus = useMemo(
    () =>
      activeSelectedBoundaryCell === null ||
      activeSelectedBoundaryCell.expressionCount !== undefined
        ? undefined
        : boundarySelectionGeneExpressionStatus(
            selectedGeneExpressionStatus,
            geneExpressionState,
            visiumHdExpressionProjectionState,
          ),
    [
      activeSelectedBoundaryCell,
      geneExpressionState,
      selectedGeneExpressionStatus,
      visiumHdExpressionProjectionState,
    ],
  )
  const { clearVisiumHdExpressionProfileState, handleLoadVisiumHdExpressionProfile } =
    useVisiumHdExpressionProfileWorkflow({
      callbacks: { appendDebugEvent },
      controls: {
        activeBinSize: activeVisiumHdBinSize,
        isVisiumHdDataset,
        rowBudget: visiumHdBarcodeMappingRowBudget,
      },
      data: {
        activeSelection: activeVisiumHdExpressionProfileSelection,
        loadState,
        selectedGridCell: activeSelectedGridCell,
      },
      loaders: { getSpatialDataset },
      refs: {
        abortRef: visiumHdExpressionProfileAbortRef,
        requestIdRef: visiumHdExpressionProfileRequestId,
      },
      setters: { setExpressionProfileState: setVisiumHdExpressionProfileState },
    })
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
  const handleAnnotationVisibilityChange = useCallback(
    (annotationId: string, visible: boolean) => {
      setHiddenAnnotationIds((current) => {
        if (visible) {
          return current.filter(
            (hiddenAnnotationId) => hiddenAnnotationId !== annotationId,
          )
        }

        return current.includes(annotationId) ? current : [...current, annotationId]
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
  const focusSpatialViewOnGridCell = useCallback((cell: GridCellDatum) => {
    spatialFocusRequestIdRef.current += 1
    setSpatialFocusRequest({
      key: spatialFocusRequestIdRef.current,
      target: gridCellDatumDeckCenter(cell),
    })
  }, [])
  const geneExpressionCopy = geneExpressionStatusCopy(geneExpressionState)
  const roiCopy = roiStatusCopy(roiState, roiMode)
  const visiumHdRoiCopy = visiumHdRoiStatusCopy(activeVisiumHdRoiState, roiMode)
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
  const canDrawRoi = isVisiumHdDataset
    ? loadState.status === 'ready' &&
      spatialGridCells.length > 0 &&
      visiumHdControlState.status !== 'loading'
    : xeniumFeatureLoadEnabled && !isDatasetPreparationPending
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
  const visiumHdRoiSummary = useMemo(
    () =>
      activeVisiumHdRoiState.status === 'ready'
        ? summarizeVisiumHdRoiBins(activeVisiumHdRoiState.bins)
        : null,
    [activeVisiumHdRoiState],
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
        visiumHdExpressionProfileState: activeVisiumHdExpressionProfileState,
        datasetWarmupState,
        diagnosticsState,
        geneExpressionState,
        geneExpressionLoadingLabel:
          geneExpressionState.status === 'loading'
            ? geneExpressionModeLabel(geneExpressionState.mode)
            : undefined,
        visiumHdExpressionProjectionState,
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
      activeVisiumHdExpressionProfileState,
      datasetWarmupState,
      diagnosticsState,
      geneExpressionState,
      genePanelState,
      visiumHdExpressionProjectionState,
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
  const activeRoiSelection = isVisiumHdDataset
    ? activeVisiumHdRoiState.status === 'idle'
      ? null
      : activeVisiumHdRoiState.selection
    : roiState.status === 'idle'
      ? null
      : roiState.selection
  const effectiveShowTranscriptOverlay = showTranscriptOverlay && !isVisiumHdDataset
  const visiumHdMagicLensBinsReady =
    isVisiumHdDataset && loadState.status === 'ready' && spatialGridCells.length > 0
  const visiumHdMagicLensUnavailableReason =
    isVisiumHdDataset && loadState.status === 'ready'
      ? spatialGridCells.length === 0
        ? 'Bins pending'
        : undefined
      : undefined
  const magicLensLoadEnabled = isVisiumHdDataset
    ? visiumHdMagicLensBinsReady
    : xeniumFeatureLoadEnabled
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
    magicLensScope === 'cursor' && magicLensActive && magicLensLoadEnabled
  const magicLensCanScan =
    magicLensLoadEnabled &&
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
    visiumHdMagicLensUnavailableReason,
  )
  const transcriptCopy = transcriptStatusCopy(
    transcriptCapabilityState,
    transcriptLayerState,
    effectiveShowTranscriptOverlay,
  )
  const appendFallbackNotice = useCallback(
    (notice: FallbackNotice) => {
      fallbackNoticeIdRef.current += 1
      const entry = createFallbackNoticeEntry(fallbackNoticeIdRef.current, notice)

      setFallbackNotices((current) => appendFallbackNoticeEntry(current, entry))
      appendDebugEvent(`Fallback: ${notice.source}: ${notice.message}`, {
        ...(notice.coalesceKey === undefined ? {} : { coalesceKey: notice.coalesceKey }),
      })
    },
    [appendDebugEvent],
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
    callbacks: {
      appendDebugEvent,
      recordTelemetry,
    },
    data: {
      geneExpressionBatch,
      geneExpressionState,
    },
    refs: {
      timingKeyRef: geneExpressionLayerTimingKeyRef,
    },
    timings: {
      geneExpressionLayerDataDurationMs,
      geneExpressionRestyleDurationMs,
    },
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
        activeVisiumHdExpressionProfileState,
      ]),
    [
      annotationState,
      annotationGroupState,
      analysisEmbeddingState,
      boundaryState,
      cellDetailState,
      cellTranscriptDistributionState,
      activeVisiumHdExpressionProfileState,
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
      callbacks: {
        appendDebugEvent,
        recordTelemetry,
      },
      controls: {
        ...(diagnosticsVisiumHdBinSize === undefined
          ? {}
          : { visiumHdBinSizeMicrometers: diagnosticsVisiumHdBinSize }),
      },
      dump: {
        activeControlHudTab,
        activeErrors,
        boundaryCellLimit,
        coordinateUnit,
        datasetUrl,
        debugLog,
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
        selectedGenes,
        shareableViewState,
        shouldLoadMorphology,
        showTranscriptOverlay: effectiveShowTranscriptOverlay,
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
      },
      loaders: { runDatasetDiagnostics },
      refs: { diagnosticsAbortRef },
      setters: { setDiagnosticsState },
    })
  const handleImageTileError = useCallback((error: Error) => {
    setMorphologyState((current) => {
      if (current.status !== 'ready') {
        return current
      }

      return morphologyLoadFailed(
        current.url,
        createStructuredLoadError('Image tiles', error),
      )
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
    invalidateLatestRequest({
      abortRef: geneExpressionAbortRef,
      requestIdRef: geneExpressionRequestId,
    })
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain({ key: '', max: 0 })
    setGeneExpressionState(IDLE_GENE_EXPRESSION_STATE)
  }, [])
  const loadActiveAnalysisEmbeddings = useCallback(
    (...args: Parameters<typeof loadAnalysisEmbeddings>) => {
      const [baseUrl, options = {}] = args

      return loadAnalysisEmbeddings(baseUrl, {
        ...options,
        ...(isVisiumHdDataset && activeVisiumHdBinSize !== undefined
          ? { visiumHdBinSizeMicrometers: activeVisiumHdBinSize }
          : {}),
      })
    },
    [activeVisiumHdBinSize, isVisiumHdDataset, loadAnalysisEmbeddings],
  )
  const loadActiveBoundaryElements = useCallback<BoundaryElementsLoader>(
    async (baseUrl, bbox, options = {}) => {
      if (!isVisiumHdDataset) {
        return loadBoundaryElements(baseUrl, bbox, options)
      }

      const dataset = await getSpatialDataset(baseUrl)
      const meta = await dataset.meta()

      if (!meta.capabilities.cellBoundaries) {
        return { elements: [] }
      }

      return dataset.elements(bbox)
    },
    [getSpatialDataset, isVisiumHdDataset, loadBoundaryElements],
  )
  const loadActiveNucleusBoundaryElements = useCallback<BoundaryElementsLoader>(
    async (baseUrl, bbox) => {
      if (!isVisiumHdDataset) {
        return { elements: [] }
      }

      const dataset = await getSpatialDataset(baseUrl)
      const meta = await dataset.meta()
      const hasNucleusSegmentation =
        meta.segmentations?.some((segmentation) => segmentation.kind === 'nucleus') ??
        false

      if (!hasNucleusSegmentation || !isSpatialSegmentationDataset(dataset)) {
        return { elements: [] }
      }

      return {
        elements: await dataset.segmentationElements('nucleus', bbox),
      }
    },
    [getSpatialDataset, isVisiumHdDataset],
  )
  const loadActiveGeneExpression = useCallback<GeneExpressionLoader>(
    async (baseUrl, bbox, genes, options = {}) => {
      if (!isVisiumHdDataset) {
        return loadGeneExpression(baseUrl, bbox, genes, options)
      }

      const dataset = await getSpatialDataset(baseUrl)

      if (!isSpatialGeneExpressionDataset(dataset)) {
        throw new Error('Loaded dataset does not expose selected-gene expression.')
      }

      return dataset.geneExpression(bbox, genes, {
        ...options,
        ...(activeVisiumHdBinSize === undefined
          ? {}
          : { binSizeMicrometers: activeVisiumHdBinSize }),
      })
    },
    [activeVisiumHdBinSize, getSpatialDataset, isVisiumHdDataset, loadGeneExpression],
  )
  const loadVisiumHdMagicLensSummary = useVisiumHdMagicLensSummary({
    controls: {
      selectedBinSize: activeVisiumHdBinSize,
    },
    data: {
      currentViewportDetail,
      geneExpressionBatch,
      gridCells: expressionStyledSpatialGridCells,
      loadState,
      selectedGenes,
    },
    loaders: {
      getSpatialDataset,
      loadGeneExpression: loadActiveGeneExpression,
    },
  })
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
    callbacks: {
      appendDebugEvent,
      recordTelemetry,
      rememberGeneExpressionScaleMax,
    },
    controls: {
      boundaryCellLimit,
      boundaryLoadingEnabled,
      geneExpressionDetailMode,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
    },
    data: {
      loadState,
      overviewExtent,
      selectedGenes,
    },
    loaders: {
      boundaryElements: loadActiveBoundaryElements,
      ...(isVisiumHdDataset && showNucleusBoundaries
        ? { nucleusBoundaryElements: loadActiveNucleusBoundaryElements }
        : {}),
      geneExpression: loadActiveGeneExpression,
    },
    requests: {
      boundary: {
        abortRef: boundaryAbortRef,
        requestIdRef: boundaryRequestId,
        boundaryViewportKeyRef,
      },
      geneExpression: {
        abortRef: geneExpressionAbortRef,
        requestIdRef: geneExpressionRequestId,
        geneExpressionViewportKeyRef,
      },
      lastViewportDetailRef,
    },
    setters: {
      setBoundaryElements,
      setNucleusBoundaryElements,
      setBoundaryState,
      setCurrentViewportDetail,
      setGeneExpressionBatch,
      setGeneExpressionState,
      setShareableViewState,
    },
  })
  useEffect(() => {
    if (boundaryOverlayRequestKeyRef.current === boundaryOverlayRequestKey) {
      return
    }

    boundaryOverlayRequestKeyRef.current = boundaryOverlayRequestKey
    const detail = lastViewportDetailRef.current

    if (detail === null || loadState.status !== 'ready') {
      return
    }

    boundaryViewportKeyRef.current = null
    handleViewportChange(detail)
  }, [boundaryOverlayRequestKey, handleViewportChange, loadState.status])

  useTranscriptWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      activeControlHudTab,
      effectiveTranscriptFeatureFilterMode,
      manualTranscriptExactRequestKey,
      showTranscriptOverlay: effectiveShowTranscriptOverlay,
      transcriptDetailMode,
      transcriptExactPointLimit,
      transcriptGeneOnly,
      transcriptMinQv,
      visibleTranscriptEstimate,
    },
    data: {
      currentViewportDetail,
      loadState,
      overviewCells,
      selectedGenes,
      transcriptCapabilityState,
    },
    loaders: {
      loadTranscriptAggregates,
      loadTranscriptCapabilities,
      loadTranscriptViewport,
    },
    refs: {
      loadRequestIdRef: loadRequestId,
      transcriptAbortRef,
      transcriptCapabilityAbortRef,
      transcriptCapabilityRequestIdRef: transcriptCapabilityRequestId,
      transcriptRequestIdRef: transcriptRequestId,
      transcriptViewportKeyRef,
    },
    setters: {
      setTranscriptCapabilityState,
      setTranscriptLayerState,
    },
  })

  useCellDetailWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    data: {
      cellDetailState,
      loadState,
      selectedCell,
    },
    loaders: {
      loadBoundaryElements: loadActiveBoundaryElements,
      loadCellTranscriptDistribution,
      loadRoiGeneStats,
    },
    refs: {
      cellDetailAbortRef,
      cellDetailRequestIdRef: cellDetailRequestId,
      cellTranscriptDistributionAbortRef,
      cellTranscriptDistributionRequestIdRef: cellTranscriptDistributionRequestId,
    },
    setters: {
      setCellDetailState,
      setCellTranscriptDistributionState,
    },
  })
  useGridCellAssignmentWorkflow({
    callbacks: { appendDebugEvent },
    controls: {
      isVisiumHdDataset,
      rowBudget: visiumHdBarcodeMappingRowBudget,
      selectedBinSize: activeVisiumHdBinSize,
    },
    data: {
      loadState,
      selectedGridCell,
    },
    loaders: { getSpatialDataset },
    refs: {
      gridCellAssignmentAbortRef,
      gridCellAssignmentRequestIdRef: gridCellAssignmentRequestId,
    },
    setters: { setGridCellAssignmentState },
  })

  const {
    handleClearRoi,
    handleExportRoiCells,
    handleExportRoiGeoJson,
    handleExportRoiTranscripts,
    handleRoiComplete,
  } = useRoiWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      currentViewportDetail,
      enabled: !isVisiumHdDataset,
      magicLensScope,
      roiName,
    },
    data: {
      loadState,
      roiState,
    },
    loaders: {
      loadRoiCells,
      loadRoiGeneStats,
      loadRoiTranscripts,
    },
    refs: {
      initialSharedRoiSelectionRef,
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef: magicLensRequestId,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupTimeoutRef,
      roiIdRef,
      roiRequestIdRef: roiRequestId,
      roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef: roiTranscriptExportRequestId,
    },
    setters: {
      setMagicLensState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiState,
      setRoiTranscriptExportState,
    },
  })
  const {
    clearVisiumHdRoiState,
    handleClearActiveRoi,
    handleExportVisiumHdRoiBarcodes,
    handleExportVisiumHdRoiGeoJson,
    handleVisiumHdRoiComplete,
  } = useVisiumHdRoiWorkflow({
    callbacks: {
      appendDebugEvent,
      clearRoi: handleClearRoi,
    },
    controls: {
      activeBinSize: activeVisiumHdBinSize,
      isVisiumHdDataset,
      roiName,
    },
    data: {
      activeRoiState: activeVisiumHdRoiState,
      gridCells: expressionStyledSpatialGridCells,
      loadState,
    },
    refs: {
      initialSharedRoiSelectionRef,
      roiIdRef,
    },
    setters: {
      setRoiMode,
      setRoiName,
      setVisiumHdRoiState,
    },
  })
  const handleBeforeDatasetLoad = useCallback(() => {
    clearVisiumHdRoiState()
    clearVisiumHdExpressionProfileState()
    setFallbackNotices([])
  }, [clearVisiumHdExpressionProfileState, clearVisiumHdRoiState])
  const handleBeforeVisiumHdBinSizeChange = useCallback(() => {
    clearVisiumHdRoiState()
    clearVisiumHdExpressionProfileState()
  }, [clearVisiumHdExpressionProfileState, clearVisiumHdRoiState])

  const {
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleClearAnnotations,
    handleExportAnnotations,
    handleImportAnnotationUrl,
    handleImportAnnotations,
    handleLoadAnnotations,
    handleRemoveCellMetadataTrack,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
  } = useAnnotationWorkflow({
    callbacks: { appendDebugEvent },
    data: {
      annotationState,
      cellMetadataTracks,
      datasetUrl,
      loadState,
      roiName,
      roiState,
      selectedAnnotationGroupId,
    },
    loaders: { loadAnnotations },
    refs: {
      datasetAbortRef,
      loadRequestIdRef: loadRequestId,
      roiIdRef,
    },
    setters: {
      setAnnotationColors,
      setAnnotationState,
      setCellMetadataTracks,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setObservationColorMode,
      setRoiName,
      setSelectedAnnotationGroupId,
      setSelectedCellMetadataTrackId,
    },
  })

  const { handleEmbeddingCellSelect, handleLoadAnalysisEmbeddings } =
    useAnalysisEmbeddingWorkflow({
      callbacks: {
        appendDebugEvent,
        appendFallbackNotice,
        onSelectedCellFocus: focusSpatialViewOnCell,
      },
      data: {
        analysisEmbeddingState,
        loadState,
        overviewCellById,
        selectedEmbeddingKind,
      },
      loaders: {
        loadAnalysisEmbeddings: loadActiveAnalysisEmbeddings,
      },
      refs: {
        analysisEmbeddingAbortRef,
        analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
      },
      setters: {
        setAnalysisEmbeddingState,
        setSelectedCell,
        setSelectedEmbeddingKind,
      },
    })
  const handleEmbeddingElementSelect = useCallback(
    (elementId: string) => {
      if (!isVisiumHdDataset) {
        setSelectedGridCell(null)
        setSelectedBoundaryCell(null)
        handleEmbeddingCellSelect(elementId)
        return
      }

      const gridCell = gridCellById.get(elementId)

      if (gridCell === undefined) {
        return
      }

      setSelectedCell(null)
      setSelectedBoundaryCell(null)
      clearVisiumHdExpressionProfileState()
      setSelectedGridCell(gridCell)
      focusSpatialViewOnGridCell(gridCell)
    },
    [
      clearVisiumHdExpressionProfileState,
      focusSpatialViewOnGridCell,
      gridCellById,
      handleEmbeddingCellSelect,
      isVisiumHdDataset,
    ],
  )

  const {
    handleMagicLensCursorActiveChange,
    handleMagicLensLeave,
    handleMagicLensMinQvChange,
    handleMagicLensMove,
    handleMagicLensRadiusChange,
    handleMagicLensScopeChange,
    handleRunMagicLens,
  } = useMagicLensWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      magicLensActive,
      magicLensMinQv,
      magicLensScope,
    },
    data: {
      activeRoiSelection,
      currentViewportDetail,
      loadState,
      selectedGenes,
    },
    loaders: {
      loadRoiCells,
      loadRoiGeneStats,
      ...(isVisiumHdDataset
        ? { loadMagicLensSummary: loadVisiumHdMagicLensSummary }
        : {}),
    },
    refs: {
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef: magicLensRequestId,
    },
    setters: {
      setMagicLensActive,
      setMagicLensMinQv,
      setMagicLensRadiusMicrometers,
      setMagicLensScope,
      setMagicLensState,
      setMeasurementEnabled,
      setMeasurementResetKey,
    },
  })

  const { handleAutoContrast, queueAutoContrast, updateMorphologyChannel } =
    useMorphologyWorkflow({
      callbacks: { appendDebugEvent },
      loaders: { computeAutoChannelContrast },
      refs: {
        autoContrastChannelIdsRef,
        datasetAbortRef,
        loadRequestIdRef: loadRequestId,
      },
      setters: {
        setAutoContrastChannelIds,
        setMorphologyChannelSettings,
        setMorphologyState,
      },
    })
  const { handleLoadCustomLayer, handleRemoveCustomLayer } =
    useCustomMorphologyLayerWorkflow({
      callbacks: {
        appendDebugEvent,
        appendFallbackNotice,
      },
      data: {
        customLayers: customMorphologyLayers,
      },
      loaders: { loadCustomMorphologyLayer },
      refs: {
        customLayerAbortRef: customMorphologyLayerAbortRef,
        customLayerIdRef: customMorphologyLayerIdRef,
        customLayerRequestIdRef: customMorphologyLayerRequestIdRef,
        loadRequestIdRef: loadRequestId,
      },
      setters: {
        setCustomLayerLoadState: setCustomMorphologyLayerState,
        setCustomLayers: setCustomMorphologyLayers,
        setMorphologyChannelSettings,
      },
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
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
      onBeforeDatasetLoad: handleBeforeDatasetLoad,
      queueAutoContrast,
      recordTelemetry,
    },
    controls: {
      geneExpressionColorScale,
      transcriptDensityColorScale,
      transcriptExactPointLimit,
      transcriptPointColorMode,
    },
    initialState: {
      initialShareableState,
    },
    loaders: {
      detectSpatialDataset,
      getSpatialDataset,
      loadAnnotationGroups,
      loadDatasetOverview,
      loadGenePanel,
      loadMorphologyImage,
      warmDatasetForRoi,
    },
    refs: {
      analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
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
      geneExpressionRequestIdRef: geneExpressionRequestId,
      geneExpressionViewportKeyRef,
      initialShareableStateRef,
      initialSharedRoiSelectionRef,
      initialShouldLoadMorphologyRef,
      lastViewportDetailRef,
      loadRequestIdRef: loadRequestId,
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef: magicLensRequestId,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupTimeoutRef,
      roiRequestIdRef: roiRequestId,
      roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef: roiTranscriptExportRequestId,
      startDatasetLoadRef,
      transcriptAbortRef,
      transcriptCapabilityAbortRef,
      transcriptCapabilityRequestIdRef: transcriptCapabilityRequestId,
      transcriptRequestIdRef: transcriptRequestId,
      transcriptViewportKeyRef,
    },
    setters: {
      setAnalysisEmbeddingState,
      setAnnotationColors,
      setAnnotationGroupState,
      setAnnotationState,
      setHiddenAnnotationIds,
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
      setDatasetPlatform,
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
      setFlatMorphologyImage,
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
      setSelectedGridCell,
      setSelectedEmbeddingKind,
      setSelectedGenes,
      setShowCellBoundaries,
      setShowNucleusBoundaries,
      setSpatialGridCells,
      setNucleusBoundaryElements,
      setTranscriptCapabilityState,
      setTranscriptDensityColorScale,
      setTranscriptExactPointLimit,
      setTranscriptLayerState,
      setTranscriptPointColorMode,
      setVisiumHdControlState,
      setViewportCellCount,
    },
  })

  const { handleVisiumHdBinSizeChange } = useVisiumHdBinWorkflow({
    callbacks: {
      appendDebugEvent,
      onBeforeBinSizeChange: handleBeforeVisiumHdBinSizeChange,
    },
    controls: {
      shouldLoadMorphology,
      visiumHdControlState,
    },
    data: {
      flatMorphologyImage,
      loadedDatasetUrl,
    },
    loaders: {
      getSpatialDataset,
    },
    refs: {
      geneExpressionAbortRef,
      geneExpressionRequestIdRef: geneExpressionRequestId,
      geneExpressionViewportKeyRef,
      visiumHdBinRequestIdRef: visiumHdBinRequestId,
    },
    setters: {
      setFlatMorphologyImage,
      setGeneExpressionBatch,
      setGeneExpressionScaleDomain,
      setGeneExpressionState,
      setGenePanelState,
      setLoadState,
      setMorphologyState,
      setSelectedGridCell,
      setSpatialGridCells,
      setVisiumHdControlState,
    },
  })

  useShareableUrlHash({
    dataset: {
      annotationUrl: annotationImportUrl,
      customImageOpacities,
      customImageUrls,
      datasetUrl,
    },
    genes: {
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScoreMode,
      selectedGenes,
    },
    layers: {
      boundaryCellLimit,
      cellBoundaryOpacity,
      cellFillOpacity,
      coordinateUnit,
      imageOpacity: imageLayerOpacity,
      measurementUnit,
      morphologyEnabledChannelIds: shareableMorphologyEnabledChannelIds,
      observationColorMode,
      shouldLoadMorphology,
      showCellBoundaries,
      showNucleusBoundaries,
      showHoverTooltips,
    },
    magicLens: {
      magicLensActive,
      magicLensMinQv,
      magicLensRadiusMicrometers,
      magicLensScope,
    },
    transcripts: {
      showTranscriptOverlay,
      transcriptDensityColorScale,
      transcriptDetailMode,
      transcriptExactPointLimit,
      transcriptFeatureFilterMode: effectiveTranscriptFeatureFilterMode,
      transcriptGeneOnly,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    },
    view: {
      activeControlHudTab,
      activeRoiSelection,
      shareableViewState,
    },
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
          fallbackNotices={fallbackNotices}
          diagnosticsState={diagnosticsState}
          handleDatasetSubmit={handleDatasetSubmit}
          handleDownloadDiagnostics={handleDownloadDiagnostics}
          handleRunDatasetDiagnostics={handleRunDatasetDiagnostics}
          handleVisiumHdBinSizeChange={handleVisiumHdBinSizeChange}
          isLoading={isLoading}
          isVisiumHdDataset={isVisiumHdDataset}
          setBoundaryCellLimit={setBoundaryCellLimit}
          setDatasetUrl={setDatasetUrl}
          setDebugLog={setDebugLog}
          setShouldLoadMorphology={setShouldLoadMorphology}
          shouldLoadMorphology={shouldLoadMorphology}
          visiumHdControlState={visiumHdControlState}
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
          showCellBoundaries={showCellBoundaries}
          showNucleusBoundaries={showNucleusBoundaries}
          showHoverTooltips={showHoverTooltips}
          nucleusBoundaryControlsVisible={isVisiumHdDataset}
          setCellBoundaryOpacity={setCellBoundaryOpacity}
          setCellFillOpacity={setCellFillOpacity}
          setShowCellBoundaries={setShowCellBoundaries}
          setShowNucleusBoundaries={setShowNucleusBoundaries}
          setShowHoverTooltips={setShowHoverTooltips}
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
          loadEnabled={xeniumFeatureLoadEnabled}
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
          showTranscriptOverlay={effectiveShowTranscriptOverlay}
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
          loadEnabled={magicLensLoadEnabled}
          roiAvailable={activeRoiSelection !== null}
          magicLensScope={magicLensScope}
          magicLensState={magicLensState}
          magicLensRadiusMicrometers={magicLensRadiusMicrometers}
          magicLensMinQv={magicLensMinQv}
          minQvVisible={!isVisiumHdDataset}
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
          loadEnabled={xeniumFeatureLoadEnabled}
          selectedAnnotationGroupId={selectedAnnotationGroupId}
          annotationGroupOptions={annotationGroupOptions}
          annotationState={annotationState}
          annotationGroupState={annotationGroupState}
          annotationColors={annotationColors}
          hiddenAnnotationSetIds={hiddenAnnotationSetIds}
          hiddenAnnotationIds={hiddenAnnotationIds}
          cellMetadataTracks={cellMetadataTracks}
          onAnnotationGroupChange={handleAnnotationGroupChange}
          onLoadAnnotations={handleLoadAnnotations}
          onClearAnnotations={handleClearAnnotations}
          onExportAnnotations={handleExportAnnotations}
          onImportAnnotations={(file) => {
            void handleImportAnnotations(file)
          }}
          onAnnotationImportUrlChange={setAnnotationImportUrl}
          onImportAnnotationUrl={handleImportAnnotationUrl}
          onAnnotationColorChange={handleAnnotationColorChange}
          onAnnotationSetVisibilityChange={handleAnnotationSetVisibilityChange}
          onAnnotationVisibilityChange={handleAnnotationVisibilityChange}
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
          isVisiumHdDataset={isVisiumHdDataset}
          selectedCell={selectedCell}
          selectedGridCell={activeSelectedGridCell}
          selectedGridCellAssignmentState={gridCellAssignmentState}
          selectedGridCellExpressionStatus={selectedGridCellExpressionStatus}
          selectedBoundaryCell={activeSelectedBoundaryCell}
          selectedBoundaryCellExpressionStatus={selectedBoundaryCellExpressionStatus}
          selectedExpressionProfileState={activeVisiumHdExpressionProfileState}
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
            clearVisiumHdExpressionProfileState()
            setSelectedCell(null)
            setSelectedBoundaryCell(null)
          }}
          onClearSelectedGridCell={() => {
            clearVisiumHdExpressionProfileState()
            setSelectedGridCell(null)
          }}
          onClearSelectedBoundaryCell={() => {
            clearVisiumHdExpressionProfileState()
            setSelectedBoundaryCell(null)
          }}
          onSelectEmbeddingCell={handleEmbeddingElementSelect}
          onLoadSelectedExpressionProfile={handleLoadVisiumHdExpressionProfile}
        />

        {isVisiumHdDataset ? (
          <VisiumHdRoiHudPanel
            active={activeControlHudTab === 'roi'}
            roiNameInputId={controlIds.roiNameInputId}
            roiHeaderCopy={visiumHdRoiCopy}
            canDrawRoi={canDrawRoi}
            roiMode={roiMode}
            roiName={roiName}
            loadEnabled={loadState.status === 'ready'}
            roiState={activeVisiumHdRoiState}
            roiSummary={visiumHdRoiSummary}
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
            onClearRoi={handleClearActiveRoi}
            onRoiNameChange={setRoiName}
            onExportRoiBarcodes={handleExportVisiumHdRoiBarcodes}
            onExportRoiGeoJson={handleExportVisiumHdRoiGeoJson}
          />
        ) : (
          <RoiHudPanel
            active={activeControlHudTab === 'roi'}
            roiNameInputId={controlIds.roiNameInputId}
            roiHeaderCopy={roiHeaderCopy}
            isLoading={isRoiTabLoading}
            canDrawRoi={canDrawRoi}
            roiMode={roiMode}
            roiName={roiName}
            loadEnabled={xeniumFeatureLoadEnabled}
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
            onClearRoi={handleClearActiveRoi}
            onRoiNameChange={setRoiName}
            onSaveRoiAnnotation={handleSaveRoiAnnotation}
            onExportRoiCells={handleExportRoiCells}
            onExportRoiGeoJson={handleExportRoiGeoJson}
            onExportRoiTranscripts={handleExportRoiTranscripts}
          />
        )}
      </AppControlHud>

      <section className="viewer-region" aria-labelledby="viewer-heading">
        <h2 id="viewer-heading" className="visually-hidden">
          Spatial View
        </h2>

        <ViewerCore
          cells={styledOverviewCells}
          expressionCells={styledGeneExpressionCells}
          geneExpressionActive={geneExpressionState.status === 'ready'}
          geneExpressionOverlayEnabled={geneExpressionOverlayEnabled}
          boundaries={expressionStyledBoundaryLayerData}
          nucleusBoundaries={visibleNucleusBoundaryLayerData}
          cellBoundaryHoverEnabled={isVisiumHdDataset && showCellBoundaries}
          hoverTooltipsEnabled={showHoverTooltips}
          gridCells={viewerGridCells}
          fitGridCells={spatialGridCells}
          transcriptAggregateBins={transcriptLayerAggregateBins}
          transcriptPoints={transcriptLayerPoints}
          imageLoader={morphologyImage?.loader ?? null}
          imageChannels={morphologyCanvasChannels}
          flatImage={flatMorphologyImage}
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
          viewResetKey={viewerViewResetKey}
          focusRequest={spatialFocusRequest}
          onImageTileError={handleImageTileError}
          onTileCacheEviction={handleTileCacheEviction}
          onViewportCellCountChange={setViewportCellCount}
          onViewportChange={handleViewportChange}
          onTranscriptHover={setHoveredTranscript}
          onTranscriptClick={handlePinTranscript}
          onCellClick={(cell) => {
            clearVisiumHdExpressionProfileState()
            setSelectedGridCell(null)
            setSelectedBoundaryCell(null)
            setSelectedCell(cell)
          }}
          onCellBoundaryClick={(cell) => {
            clearVisiumHdExpressionProfileState()
            setSelectedCell(null)
            setSelectedGridCell(null)
            setSelectedBoundaryCell(cell)
          }}
          onGridCellClick={(cell) => {
            clearVisiumHdExpressionProfileState()
            setSelectedCell(null)
            setSelectedBoundaryCell(null)
            setSelectedGridCell(cell)
          }}
          onRoiComplete={
            isVisiumHdDataset ? handleVisiumHdRoiComplete : handleRoiComplete
          }
          onMagicLensMove={handleMagicLensMove}
          onMagicLensLeave={handleMagicLensLeave}
          {...(initialShareableState.viewState === undefined
            ? {}
            : { initialViewStateOverride: initialShareableState.viewState })}
          {...(loadState.status === 'error'
            ? { errorMessage: formatStructuredError(loadState.error) }
            : {})}
          {...(viewerImageError === null
            ? {}
            : { imageErrorMessage: formatStructuredError(viewerImageError) })}
          {...(viewerMicrometersPerPixel === undefined
            ? {}
            : {
                micrometersPerPixel: viewerMicrometersPerPixel,
              })}
          {...(boundaryState.status === 'error'
            ? { boundaryErrorMessage: formatStructuredError(boundaryState.error) }
            : {})}
        />
      </section>
    </main>
  )
}

function selectionGeneExpressionStatus(
  selectedGenes: readonly string[],
  state: GeneExpressionState<StructuredLoadError>,
): CellGeneExpressionStatus {
  if (selectedGenes.length === 0) {
    return {
      status: 'idle',
      message: 'Select a gene or gene set to load expression.',
    }
  }

  if (state.status === 'loading') {
    return {
      status: 'loading',
      message: 'Loading selected-gene expression.',
    }
  }

  if (state.status === 'waiting') {
    return {
      status: 'unavailable',
      message: state.message,
    }
  }

  if (state.status === 'error') {
    return {
      status: 'error',
      message: formatStructuredError(state.error),
    }
  }

  if (state.status === 'ready') {
    return {
      status: 'unavailable',
      message:
        'Selected-gene expression is loaded, but no expression value matched this selection.',
    }
  }

  return {
    status: 'idle',
    message: 'Expression will load after the spatial view is ready.',
  }
}

function boundarySelectionGeneExpressionStatus(
  baseStatus: CellGeneExpressionStatus,
  geneExpressionState: GeneExpressionState<StructuredLoadError>,
  projectionState: VisiumHdExpressionProjectionState,
): CellGeneExpressionStatus {
  if (geneExpressionState.status !== 'ready') {
    return baseStatus
  }

  if (projectionState.status === 'loading') {
    return {
      status: 'loading',
      message: `Projecting selected-gene expression onto ${projectionState.boundaryCellCount.toLocaleString()} cells using ${formatMappingRowsScope(
        projectionState.rowBudget,
      )}.`,
    }
  }

  if (projectionState.status === 'unavailable') {
    return {
      status: 'unavailable',
      message: projectionState.reason,
    }
  }

  if (projectionState.status === 'error') {
    return {
      status: 'error',
      message: formatStructuredError(projectionState.error),
    }
  }

  if (projectionState.status === 'ready') {
    return {
      status: 'unavailable',
      message:
        'Selected-gene expression was projected, but no expression value matched this cell.',
    }
  }

  return {
    status: 'unavailable',
    message: 'Selected-gene bin expression is loaded. Cell projection is pending.',
  }
}
