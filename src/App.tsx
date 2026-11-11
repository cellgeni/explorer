import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ViewerCore,
  type RoiDrawMode,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import { AppControlHud } from './features/app-shell/AppControlHud'
import { setSpatialDataSelection } from './datasets/datasetFactory'
import type { SpatialDataSelection } from './datasets/spatialDataDataset'
import {
  spatialDataControlLoading,
  spatialDataSelectionToShareable,
} from './features/dataset/spatialDataModel'
import { visiumSelectionToShareable } from './features/dataset/visiumModel'
import { useTranscriptWorkflow } from './features/transcripts/useTranscriptWorkflow'
import { useGeneExpressionLayerTelemetry } from './features/genes/useGeneExpressionLayerTelemetry'
import {
  useVisiumHdExpressionProjectionWorkflow,
  type VisiumHdExpressionProjectionState,
} from './features/genes/useVisiumHdExpressionProjectionWorkflow'
import { AnnotationHudPanel } from './features/annotations/AnnotationHudPanel'
import { DatasetHudPanel } from './features/control-hud/DatasetHudPanel'
import { LayerHudPanel } from './features/control-hud/LayerHudPanel'
import { GeneHudPanel } from './features/genes/GeneHudPanel'
import { TranscriptHudPanel } from './features/transcripts/TranscriptHudPanel'
import { useAnnotationsSectionModel } from './features/sections/annotationsSectionModel'
import { useCellsSectionModel } from './features/sections/cellsSectionModel'
import { useDatasetInfoModel } from './features/sections/datasetInfoModel'
import { useImageSectionModel } from './features/sections/imageSectionModel'
import { useTranscriptsSectionModel } from './features/sections/transcriptsSectionModel'
import { useViewSettingsModel } from './features/sections/viewSettingsModel'
import { useLayerPanelModel } from './features/shell/layerPanelModel'
import { ShellLayout } from './features/shell/ShellLayout'
import { useTopBarModel } from './features/shell/topBarModel'
import { useToolShortcuts } from './features/shell/useToolShortcuts'
import { CellHudPanel } from './features/control-hud/CellHudPanel'
import {
  GeometricRoiHudPanel,
  RoiHudPanel,
  VisiumHdRoiHudPanel,
} from './features/control-hud/RoiHudPanel'
import { MagicLensHudPanel } from './features/roi/MagicLensHudPanel'
import { useCardStackModel } from './features/cards/cardModels'
import {
  CONTROL_HUD_TABS,
  NEW_SHELL_HIDDEN_HUD_TABS,
  parseObservationColorMode,
  readDebugModeFromLocation,
  readShellVersionFromLocation,
  readShareableStateFromLocation,
  type ControlHudTab,
} from './features/app-shell/appShellModel'
import { DatasetLoadToast } from './features/app-shell/DatasetLoadToast'
import { datasetDisplayName, documentTitle } from './features/app-shell/documentTitle'
import { isTextEntryTarget } from './features/app-shell/activeToolModel'
import { ALL_ANNOTATION_GROUP_ID } from './data/datasetAnnotations'
import { viewerLegendSections } from './features/app-shell/viewerLegendModel'
import { viewerSelectionHighlight } from './features/app-shell/viewerSelectionHighlight'
import { colorModeAfterGeneChange } from './features/genes/geneColorModeModel'
import type { ObservationColorMode } from './rendering/cellStyling'
import {
  activeVisiumHdRoiStateForPlatform,
  appPlatformAdapterFor,
  isAnnDataPlatform,
  isVisiumHdPlatform,
  loadPlatformBoundaryElements,
  loadPlatformGeneExpression,
  loadPlatformNucleusBoundaryElements,
  loadPlatformTranscriptAggregates,
  loadPlatformTranscriptCapabilities,
  loadPlatformTranscriptViewport,
  platformAnalysisEmbeddingOptions,
  platformActiveBoundaryCell,
  platformBoundarySurfaceReserved,
  platformExpressionProfileSelection,
  platformRoiElementIds,
  platformRoiSelection,
  platformSelectedEmbeddingElementId,
} from './features/app-shell/platformAdapter'
import {
  resolveAppDependencies,
  type AnalysisEmbeddingsLoader,
  type AnnotationLoader,
  type AppProps,
  type BoundaryElementsLoader,
  type GeneExpressionLoader,
  type RoiCellsLoader,
  type RoiGeneStatsLoader,
  type RoiTranscriptsLoader,
  type TranscriptAggregateLoader,
  type TranscriptCapabilitiesLoader,
  type TranscriptViewportLoader,
} from './features/app-shell/appDependencies'
import { useAppControlIds } from './features/app-shell/useAppControlIds'
import { useViewerLayerData } from './features/app-shell/useViewerLayerData'
import { useDatasetLifecycle } from './features/app-shell/useDatasetLifecycle'
import { useAppDomainState } from './features/app-shell/useAppDomainState'
import { useVisiumControlsWorkflow } from './features/app-shell/useVisiumControlsWorkflow'
import { useVisiumHdBinWorkflow } from './features/app-shell/useVisiumHdBinWorkflow'
import { useVisiumHdGridLodWorkflow } from './features/app-shell/useVisiumHdGridLodWorkflow'
import { useVisiumHdExpressionProfileWorkflow } from './features/app-shell/useVisiumHdExpressionProfileWorkflow'
import { useViewportDataWorkflow } from './features/app-shell/useViewportDataWorkflow'
import { useShareableUrlHash } from './features/app-shell/useShareableUrlHash'
import { formatMappingRowsScope } from './features/app-shell/visiumHdAppController'
import {
  appendFallbackNoticeEntry,
  appendDebugLogEntry,
  createLoadingTasks,
  createFallbackNoticeEntry,
  createDebugLogEntry,
  downloadTextFile,
  invalidateLatestRequest,
  type DebugLogAppendOptions,
} from './features/app-shell/appRuntimeModel'
import {
  TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
  transcriptDensityContentForRendering,
  transcriptStatusCopy,
} from './features/transcripts/transcriptLayerModel'
import { cellDetailStatusCopy } from './features/cells/cellDetailModel'
import {
  IDLE_CELL_EXPRESSION_PROFILE_STATE,
  cellExpressionProfileMatchesSelection,
} from './features/cells/cellExpressionProfileModel'
import type { CellGeneExpressionStatus } from './features/cells/cellGeneExpressionStatus'
import { useCellDetailWorkflow } from './features/cells/useCellDetailWorkflow'
import { useGridCellAssignmentWorkflow } from './features/cells/useGridCellAssignmentWorkflow'
import { analysisEmbeddingStatusCopy } from './features/analysis/analysisEmbeddingModel'
import { useAnalysisEmbeddingWorkflow } from './features/analysis/useAnalysisEmbeddingWorkflow'
import { useMorphologyWorkflow } from './features/morphology/useMorphologyWorkflow'
import { useMorphologyZPlaneWorkflow } from './features/morphology/useMorphologyZPlaneWorkflow'
import { customMorphologyLayerChannels } from './features/morphology/customMorphologyLayers'
import { useCustomMorphologyLayerWorkflow } from './features/morphology/useCustomMorphologyLayerWorkflow'
import { magicLensScopeLabel, magicLensStatusCopy } from './features/roi/magicLensModel'
import { useMagicLensWorkflow } from './features/roi/useMagicLensWorkflow'
import { useVisiumHdMagicLensSummary } from './features/roi/useVisiumHdMagicLensSummary'
import { useRoiWorkflow } from './features/roi/useRoiWorkflow'
import { useVisiumHdRoiWorkflow } from './features/roi/useVisiumHdRoiWorkflow'
import {
  roiGeneDatasetWarmupKey,
  roiGeneStatsStatusCopy,
  roiStatusCopy,
  defaultRoiName,
  summarizeRoiCells,
} from './features/roi/roiModel'
import { summarizeRoiGeneExpression } from './data/roiGeneStats'
import {
  gridCellDatumDeckCenter,
  summarizeVisiumHdRoiBins,
  visiumHdRoiStatusCopy,
} from './features/roi/visiumHdRoiModel'
import { useDatasetDiagnosticsWorkflow } from './features/diagnostics/useDatasetDiagnosticsWorkflow'
import {
  annotationLabelsForCell,
  annotationStatusCopy,
  filterAnnotationsByVisibleClasses,
  filterAnnotationsByVisibleSets,
  type AnnotationState,
} from './features/annotations/annotationModel'
import {
  geometricAnnotationFromRoiSelection,
  geometricAnnotationsToGeoJson,
  parseGeometricAnnotationsGeoJson,
  removeGeometricAnnotation,
  updateGeometricAnnotationColor,
  updateGeometricAnnotationVisibility,
} from './features/annotations/geometricAnnotationModel'
import { useAnnotationWorkflow } from './features/annotations/useAnnotationWorkflow'
import {
  useCellMetadataTrackValues,
  type CellMetadataTrackValuesLoader,
} from './features/annotations/useCellMetadataTrackValues'
import {
  IDLE_GENE_EXPRESSION_STATE,
  type GeneExpressionState,
  geneExpressionModeLabel,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
} from './features/genes/geneControlsModel'
import {
  collectStructuredLoadErrors,
  createStructuredLoadError,
  formatStructuredError,
  type StructuredLoadError,
} from './features/errors/loadErrorModel'
import {
  IDLE_DATASET_LOAD_STATE,
  morphologyLoadFailed,
} from './features/dataset/datasetLoadModel'
import type { TranscriptFeatureFilterMode } from './data/transcriptOverlay'
import type { RoiSelection } from './data/roiSelection'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import type { ShareableState } from './data/shareableState'
import {
  appendTelemetryEvent,
  telemetryEvent,
  type TelemetryEvent,
} from './data/telemetry'
import type { FallbackNotice } from './data/fallbackNotice'
import { normalizeLayerOpacity } from './rendering/layerOpacity'
import {
  geometricAnnotationsToLayerData,
  geneExpressionScoreDomainMax,
  styleCellBoundariesByGeneExpression,
  styleGridCellsByGeneExpression,
} from './rendering/deckLayers'
import { annotationPaletteColor } from './rendering/annotationPalette'
import { useViewerStore } from './store/viewerStore'
import type { DatasetCell, GeneExpressionBatch } from './datasets/xeniumDataset'
import {
  normalizeCustomMorphologyLayerUrl,
  type MorphologyImage,
} from './data/morphologyImage'
import { micrometers, type BBox } from './data/coords'
import { slug } from './utils/slug'
import type {
  Annotation,
  SpatialElement,
  SpatialElementId,
} from './datasets/spatialDataset'
import type { GexResult } from './data/gex'
import type { AnalysisEmbedding } from './data/analysisEmbeddings'
import type { ContinuousCellMetadataValue } from './data/customAnnotations'
import type {
  GeneExpressionScoreMode,
  GeometricAnnotationDatum,
} from './rendering/deckLayers'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from './rendering/deckLayers'
import type {
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerViewportDetail,
} from './components/ViewerCore'

const EMPTY_CELL_BOUNDARY_DATA: readonly CellBoundaryDatum[] = []
const EMPTY_GRID_CELL_DATA: readonly GridCellDatum[] = []
const EMPTY_SPATIAL_ELEMENTS: readonly SpatialElement[] = []
const EMPTY_GENE_EXPRESSION_ELEMENTS: readonly OverviewCellDatum[] = []

export type {
  AnalysisEmbeddingsLoader,
  AnnotationGroupLoader,
  AnnotationLoader,
  AutoChannelContrastLoader,
  AppDependencies,
  AppDependencyOverrides,
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

// Shapes passed while the Annotations section hides them (15.2-C).
const NO_GEOMETRY_LAYERS: readonly GeometricAnnotationDatum[] = []

export function App({ dependencies }: AppProps = {}) {
  const {
    dataset: {
      detectSpatialDataset,
      getSpatialDataset,
      loadDatasetOverview,
      loadGenePanel,
      warmDatasetForRoi,
    },
    morphology: {
      computeAutoChannelContrast,
      loadCustomMorphologyLayer,
      loadMorphologyImage,
    },
    spatialElements: { loadBoundaryElements },
    annotations: { loadAnnotationGroups, loadAnnotations },
    analysis: { loadAnalysisEmbeddings },
    roi: { loadRoiCells, loadRoiGeneStats, loadRoiTranscripts },
    transcripts: {
      loadCellTranscriptDistribution,
      loadTranscriptAggregates,
      loadTranscriptCapabilities,
      loadTranscriptViewport,
    },
    genes: { loadGeneExpression },
    diagnostics: { runDatasetDiagnostics },
  } = resolveAppDependencies(dependencies)

  const controlIds = useAppControlIds()
  const [initialShareableState] = useState<ShareableState>(() =>
    readShareableStateFromLocation(),
  )
  const [performanceBudget] = useState<PerformanceBudget>(() => detectPerformanceBudget())
  const [debugMode, setDebugMode] = useState(readDebugModeFromLocation)
  const [shellVersion] = useState(readShellVersionFromLocation)
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const appState = useAppDomainState({ initialShareableState, performanceBudget })
  const {
    annotations: {
      annotationColors,
      annotationGroupState,
      annotationImportUrl,
      annotationState,
      cellMetadataTracks,
      geometricAnnotations,
      hiddenAnnotationIds,
      hiddenAnnotationSetIds,
      selectedAnnotationGroupId,
      selectedCellMetadataTrackId,
      setAnnotationColors,
      setAnnotationGroupState,
      setAnnotationImportUrl,
      setAnnotationState,
      setCellMetadataTracks,
      setGeometricAnnotations,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setSelectedAnnotationGroupId,
      setSelectedCellMetadataTrackId,
    },
    analysis: {
      analysisEmbeddingState,
      selectedEmbeddingKind,
      setAnalysisEmbeddingState,
      setSelectedEmbeddingKind,
    },
    cells: {
      cellDetailState,
      cellTranscriptDistributionState,
      setCellDetailState,
      setCellTranscriptDistributionState,
    },
    dataset: {
      boundaryState,
      cellFeatureMatrixCapabilityState,
      datasetAbout,
      datasetPlatform,
      datasetWarmupState,
      diagnosticsState,
      loadState,
      morphologyState,
      pendingDatasetLoadState,
      setBoundaryState,
      setCellFeatureMatrixCapabilityState,
      setDatasetAbout,
      setDatasetPlatform,
      setDatasetWarmupState,
      setDiagnosticsState,
      setLoadState,
      setMorphologyState,
      setPendingDatasetLoadState,
    },
    genes: {
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScaleDomain,
      geneExpressionScoreMode,
      geneExpressionState,
      genePanelState,
      selectedGenes,
      setGeneExpressionBatch,
      setGeneExpressionColorScale,
      setGeneExpressionDetailMode,
      setGeneExpressionScaleDomain,
      setGeneExpressionScoreMode,
      setGeneExpressionState,
      setGenePanelState,
      setSelectedGenes,
    },
    layers: {
      boundaryCellLimit,
      cellBoundaryOpacity,
      cellFillOpacity,
      coordinateUnit,
      imageLayerOpacity,
      layerVisibility,
      measurementEnabled,
      measurementResetKey,
      measurementUnit,
      observationColorMode,
      setBoundaryCellLimit,
      setCellBoundaryOpacity,
      setCellFillOpacity,
      setCoordinateUnit,
      setImageLayerOpacity,
      setLayerVisibility,
      setMeasurementEnabled,
      setMeasurementResetKey,
      setMeasurementUnit,
      setObservationColorMode,
      setShowCellBoundaries,
      setShowHoverTooltips,
      setShowNucleusBoundaries,
      showCellBoundaries,
      showHoverTooltips,
      showNucleusBoundaries,
    },
    magicLens: {
      magicLensActive,
      magicLensMinQv,
      magicLensRadiusMicrometers,
      magicLensScope,
      magicLensState,
      setMagicLensActive,
      setMagicLensMinQv,
      setMagicLensRadiusMicrometers,
      setMagicLensScope,
      setMagicLensState,
    },
    morphology: {
      autoContrastChannelIds,
      boundaryElements,
      customImageLayerOpacities,
      customMorphologyLayerState,
      customMorphologyLayers,
      flatMorphologyImage,
      morphologyChannelSettings,
      morphologyImage,
      nucleusBoundaryElements,
      setAutoContrastChannelIds,
      setBoundaryElements,
      setCustomImageLayerOpacities,
      setCustomMorphologyLayerState,
      setCustomMorphologyLayers,
      setFlatMorphologyImage,
      setMorphologyChannelSettings,
      setMorphologyImage,
      setNucleusBoundaryElements,
      setShouldLoadMorphology,
      shouldLoadMorphology,
    },
    roi: {
      roiGeneStatsState,
      roiGeneViewportWarmupState,
      roiMode,
      roiName,
      roiState,
      roiTranscriptExportState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiState,
      setRoiTranscriptExportState,
      setVisiumHdRoiState,
      visiumHdRoiState,
    },
    runtime: {
      activeControlHudTab,
      debugLog,
      fallbackNotices,
      isControlHudCollapsed,
      setActiveControlHudTab,
      setDebugLog,
      setFallbackNotices,
      setIsControlHudCollapsed,
      setTelemetryEvents,
      telemetryEvents,
    },
    selection: {
      currentViewportDetail,
      selectedBoundaryCell,
      selectedCell,
      selectedGridCell,
      setCurrentViewportDetail,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
      setShareableViewState,
      setSpatialFocusRequest,
      setViewportCellCount,
      shareableViewState,
      spatialFocusRequest,
    },
    transcripts: {
      hoveredTranscript,
      manualTranscriptExactRequestKey,
      pinnedTranscript,
      setHoveredTranscript,
      setManualTranscriptExactRequestKey,
      setPinnedTranscript,
      setShowTranscriptOverlay,
      setTranscriptCapabilityState,
      setTranscriptDensityColorScale,
      setTranscriptDetailMode,
      setTranscriptExactPointLimit,
      setTranscriptFeatureFilterMode,
      setTranscriptGeneOnly,
      setTranscriptLayerState,
      setTranscriptMinQv,
      setTranscriptOpacity,
      setTranscriptPointColorMode,
      setTranscriptPointSize,
      showTranscriptOverlay,
      transcriptCapabilityState,
      transcriptDensityColorScale,
      transcriptDetailMode,
      transcriptExactPointLimit,
      transcriptFeatureFilterMode,
      transcriptGeneOnly,
      transcriptLayerState,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    },
    spatialData: { setSpatialDataControlState, spatialDataControlState },
    visium: { setVisiumControlState, visiumControlState },
    visiumHd: {
      gridCellAssignmentState,
      overviewCells,
      setGridCellAssignmentState,
      setOverviewCells,
      setSpatialGridCells,
      setVisiumHdControlState,
      setVisiumHdExpressionProfileState,
      spatialGridCells,
      visiumHdControlState,
      visiumHdExpressionProfileState,
    },
    tools: { activeTool, setActiveTool },
  } = appState
  const effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode =
    selectedGenes.length === 0 ? 'all' : transcriptFeatureFilterMode
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
  const geometricAnnotationIdRef = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const geneExpressionLayerTimingKeyRef = useRef<string | null>(null)
  const transcriptViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const initialShareableStateRef = useRef<ShareableState | null>(initialShareableState)
  const initialAnnotationImportUrlRef = useRef(
    initialShareableState.annotationUrl?.trim() || null,
  )
  // Annotation sets a link names (groups=), loaded once the dataset is ready.
  const initialAnnotationGroupIdsRef = useRef<readonly string[] | null>(
    initialShareableState.annotationGroupIds ?? null,
  )
  const initialSharedRoiSelectionRef = useRef<RoiSelection | null>(
    initialShareableState.roiSelection ?? null,
  )
  // The colour mode to go back to when the last gene is removed.
  const colorModeBeforeGenesRef = useRef<ObservationColorMode>(
    nonGeneColorMode(
      parseObservationColorMode(initialShareableState.observationColorMode),
    ),
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
  const isLoading =
    loadState.status === 'loading' || pendingDatasetLoadState.status === 'loading'
  const loadedDatasetUrl = loadState.status === 'ready' ? loadState.url : null
  useEffect(() => {
    document.title = documentTitle(
      datasetDisplayName(loadedDatasetUrl, datasetAbout?.name),
    )
  }, [datasetAbout, loadedDatasetUrl])
  const platformAdapter = appPlatformAdapterFor(loadState, datasetPlatform)
  const isVisiumHdDataset = isVisiumHdPlatform(platformAdapter)
  const platformFeatureLoadEnabled = platformAdapter.featureLoadEnabled(loadState)
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const selectedCellMetadataTrack = useMemo(
    () =>
      cellMetadataTracks.find((track) => track.id === selectedCellMetadataTrackId) ??
      cellMetadataTracks[0] ??
      null,
    [cellMetadataTracks, selectedCellMetadataTrackId],
  )
  const selectedCellMetadataColorStyle = useMemo(() => {
    const values = selectedCellMetadataTrack?.values ?? null

    return selectedCellMetadataTrack === null || values === null
      ? null
      : { ...selectedCellMetadataTrack, values }
  }, [selectedCellMetadataTrack])
  const diagnosticsVisiumHdBinSize =
    visiumHdControlState.status === 'idle'
      ? undefined
      : visiumHdControlState.selectedBinSize
  const activeVisiumHdBinSize = diagnosticsVisiumHdBinSize
  const visiumHdBarcodeMappingRowBudget: number | undefined = undefined
  const activeVisiumHdRoiState = activeVisiumHdRoiStateForPlatform({
    activeBinSize: activeVisiumHdBinSize,
    adapter: platformAdapter,
    loadState,
    state: visiumHdRoiState,
  })
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
    [setDebugLog],
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
  // The Image section's checkbox hides the dataset image and custom layers.
  const renderedImageOpacity = layerVisibility.image ? imageLayerOpacity : 0
  const morphologyChannelOpacities = useMemo(() => {
    const opacities = new Map<string, number>()

    for (const channel of morphologyImage?.channelLoaders ?? []) {
      opacities.set(channel.info.id, renderedImageOpacity)
    }

    for (const layer of customMorphologyLayers) {
      const opacity = layerVisibility.image
        ? normalizeLayerOpacity(customImageLayerOpacities[layer.image.url] ?? 1)
        : 0

      for (const channel of layer.channels) {
        opacities.set(channel.info.id, opacity)
      }
    }

    return opacities
  }, [
    customImageLayerOpacities,
    customMorphologyLayers,
    layerVisibility.image,
    morphologyImage,
    renderedImageOpacity,
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
  const {
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
    styledGeneExpressionElements,
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
      cellMetadataTrack: selectedCellMetadataColorStyle,
      currentViewportBbox: currentViewportDetail?.bbox ?? null,
      gridCells: spatialGridCells,
      observationColorMode,
      overviewCells,
    },
    geneExpression: {
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionScaleDatasetUrl,
      geneExpressionScaleDomain,
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
  // Gene expression colours cells only when it is the colour mode (D2), so
  // loading clusters with genes selected shows the clusters.
  const isGeneExpressionColorMode = observationColorMode === 'gene-expression'
  const viewerGeneExpressionElements = isGeneExpressionColorMode
    ? styledGeneExpressionElements
    : EMPTY_GENE_EXPRESSION_ELEMENTS
  const geneExpressionColorsReady =
    isGeneExpressionColorMode && geneExpressionState.status === 'ready'
  const visibleBoundaryLayerData = showCellBoundaries
    ? boundaryLayerData
    : EMPTY_CELL_BOUNDARY_DATA
  const expressionStyledBoundaryLayerData = useMemo(
    () =>
      styleCellBoundariesByGeneExpression(
        visibleBoundaryLayerData,
        viewerGeneExpressionElements,
      ),
    [viewerGeneExpressionElements, visibleBoundaryLayerData],
  )
  const visibleNucleusBoundaryLayerData = showNucleusBoundaries
    ? nucleusBoundaryLayerData
    : EMPTY_CELL_BOUNDARY_DATA
  const isVisiumHdBoundarySurfaceReserved = platformBoundarySurfaceReserved(
    platformAdapter,
    {
      boundaryState,
      expressionBoundaryCount: expressionStyledBoundaryLayerData.length,
      showCellBoundaries,
    },
  )
  const expressionStyledSpatialGridCells = useMemo(
    () =>
      styleGridCellsByGeneExpression(spatialGridCells, viewerGeneExpressionElements, {
        styleUnmatchedCells: geneExpressionColorsReady,
      }),
    [geneExpressionColorsReady, spatialGridCells, viewerGeneExpressionElements],
  )
  const viewerGridCells = isVisiumHdBoundarySurfaceReserved
    ? EMPTY_GRID_CELL_DATA
    : expressionStyledSpatialGridCells
  const boundaryLoadingEnabled = platformAdapter.boundaryLoadingEnabled(
    showCellBoundaries,
    showNucleusBoundaries,
  )
  const boundaryOverlayRequestKey = platformAdapter.boundaryOverlayRequestKey(
    showCellBoundaries,
    showNucleusBoundaries,
  )
  const boundaryOverlayRequestKeyRef = useRef(boundaryOverlayRequestKey)
  const geneExpressionOverlayEnabled = platformAdapter.geneExpressionOverlayEnabled(
    spatialGridCells.length,
  )
  const activeSelectedBoundaryCell = useMemo(() => {
    return platformActiveBoundaryCell(
      platformAdapter,
      selectedBoundaryCell,
      expressionStyledBoundaryLayerData,
    )
  }, [expressionStyledBoundaryLayerData, platformAdapter, selectedBoundaryCell])
  const viewerMicrometersPerPixel =
    morphologyMicrometersPerPixel ?? flatMorphologyImage?.micrometersPerPixel
  const geometricAnnotationLayerData = useMemo(
    () => geometricAnnotationsToLayerData(geometricAnnotations),
    [geometricAnnotations],
  )
  const imageFitExtent = useMemo(
    () =>
      platformAdapter.kind === 'image'
        ? imageFitExtentFromMorphologyImage(morphologyImage)
        : null,
    [morphologyImage, platformAdapter.kind],
  )
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
  const viewerOverviewRenderCellLimit = isAnnDataPlatform(platformAdapter)
    ? null
    : performanceBudget.overviewRenderCellLimit
  const geneOptions = useMemo(
    () => (genePanelState.status === 'ready' ? genePanelState.genes : []),
    [genePanelState],
  )
  const genePanelCopy = genePanelStatusCopy(genePanelState)
  const annotationCopy = annotationStatusCopy(annotationState)
  const annotationGroupOptions =
    annotationGroupState.status === 'ready' ? annotationGroupState.groups : []
  const legendAnnotations = useMemo(() => {
    if (annotationState.status !== 'ready') return null

    const annotations = filterAnnotationsByVisibleSets(
      annotationState.annotations,
      hiddenAnnotationSetIdSet,
    )
    const groupLabel =
      annotationGroupState.status === 'ready'
        ? annotationGroupState.groups.find(
            (group) => group.id === selectedAnnotationGroupId,
          )?.label
        : undefined
    const setLabel =
      groupLabel !== undefined &&
      annotations.every((annotation) => annotation.label.startsWith(`${groupLabel}: `))
        ? groupLabel
        : null

    return {
      setLabel,
      items: annotations.map((annotation, index) => ({
        id: annotation.id,
        label: annotation.label,
        color: annotationColors[annotation.id] ?? annotationPaletteColor(index),
        count: annotation.cellIds.length,
      })),
      hiddenIds: hiddenAnnotationIdSet,
    }
  }, [
    annotationColors,
    annotationGroupState,
    annotationState,
    hiddenAnnotationIdSet,
    hiddenAnnotationSetIdSet,
    selectedAnnotationGroupId,
  ])
  const legendCellAreaMax = useMemo(() => {
    if (observationColorMode !== 'cell-area') return null

    let max: number | null = null
    for (const cell of overviewCells) {
      if (cell.cellArea !== undefined && Number.isFinite(cell.cellArea)) {
        max = Math.max(max ?? 0, cell.cellArea)
      }
    }
    return max
  }, [observationColorMode, overviewCells])
  const overviewCellById = useMemo(() => {
    const cellById = new Map<string, OverviewCellDatum>()

    for (const cell of overviewCells) {
      cellById.set(cell.id, cell)
    }

    return cellById
  }, [overviewCells])
  // Visium spots off the tissue are not placed while hidden, so annotation
  // counts leave them out (15.1-I).
  const annotationPlacedCellIds =
    visiumControlState.status !== 'idle' &&
    visiumControlState.summary.offTissueSpotCount > 0 &&
    !visiumControlState.summary.showOffTissue
      ? overviewCellById
      : null
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
  const activeVisiumHdExpressionProfileSelection = useMemo(
    () =>
      platformExpressionProfileSelection(
        platformAdapter,
        activeSelectedBoundaryCell,
        activeSelectedGridCell,
      ),
    [activeSelectedBoundaryCell, activeSelectedGridCell, platformAdapter],
  )
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
    () => platformRoiElementIds(platformAdapter, roiState, activeVisiumHdRoiState),
    [activeVisiumHdRoiState, platformAdapter, roiState],
  )
  const selectedEmbeddingElementId = platformSelectedEmbeddingElementId(
    platformAdapter,
    selectedCell,
    activeSelectedGridCell,
  )
  const embeddingElementLabel = platformAdapter.labels.embeddingElementPlural
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
    [setHiddenAnnotationSetIds],
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
    [setHiddenAnnotationIds],
  )
  const focusSpatialViewOnCell = useCallback(
    (cell: OverviewCellDatum) => {
      spatialFocusRequestIdRef.current += 1
      setSpatialFocusRequest({
        key: spatialFocusRequestIdRef.current,
        target: [cell.position[0] ?? 0, cell.position[1] ?? 0, cell.position[2] ?? 0],
      })
    },
    [setSpatialFocusRequest],
  )
  // The cards' Go To buttons (UNIFIED_PLAN.md, 15.2-E).
  const zoomToBbox = useCallback(
    (bbox: BBox) => {
      spatialFocusRequestIdRef.current += 1
      setSpatialFocusRequest({ key: spatialFocusRequestIdRef.current, bbox })
    },
    [setSpatialFocusRequest],
  )
  const focusSpatialViewOnGridCell = useCallback(
    (cell: GridCellDatum) => {
      spatialFocusRequestIdRef.current += 1
      setSpatialFocusRequest({
        key: spatialFocusRequestIdRef.current,
        target: gridCellDatumDeckCenter(cell),
      })
    },
    [setSpatialFocusRequest],
  )
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
    !isVisiumHdDataset &&
    roiGeneViewportWarmupState.status === 'loading' &&
    roiGeneViewportWarmupState.key === roiGeneViewportWarmupRequiredKey
  const isDatasetPreparationPending =
    loadState.status === 'ready' && datasetWarmupState.status === 'loading'
  const canDrawRoi = platformAdapter.canDrawRoi({
    isDatasetPreparationPending,
    loadState,
    spatialGridCellCount: spatialGridCells.length,
    visiumHdControlState,
  })
  const roiHeaderCopy = isDatasetPreparationPending
    ? 'Preparing'
    : roiGeneStatsState.status === 'loading'
      ? 'Querying genes'
      : roiTranscriptExportState.status === 'loading'
        ? 'Exporting'
        : isRoiGeneViewportWarmupLoading
          ? 'Preparing genes'
          : roiCopy
  const geometricRoiHeaderCopy =
    roiMode === 'box'
      ? 'Drawing box'
      : roiMode === 'lasso'
        ? 'Drawing lasso'
        : `${geometricAnnotations.length.toLocaleString()} ${
            geometricAnnotations.length === 1 ? 'shape' : 'shapes'
          }`
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
        // The dataset load in progress, whether or not it replaces one.
        loadState:
          pendingDatasetLoadState.status === 'loading'
            ? pendingDatasetLoadState
            : loadState,
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
      pendingDatasetLoadState,
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
  const loadingAreas = useMemo(
    () => new Set(loadingTasks.map((task) => task.area)),
    [loadingTasks],
  )
  const hiddenControlHudTabIds = useMemo<ReadonlySet<ControlHudTab>>(() => {
    const { cells, magicLens, transcripts } = platformAdapter.capabilities
    // In the new shell the top bar, info drawer, layer panel and cards hold
    // these tabs' controls (15.2-B to D); the HUD keeps the embeddings until
    // 15.2-G.
    const hiddenTabIds = new Set<ControlHudTab>(
      shellVersion === 2 ? NEW_SHELL_HIDDEN_HUD_TABS : [],
    )

    if (!cells) {
      hiddenTabIds.add('genes')
      hiddenTabIds.add('cell')
    }

    if (!magicLens) hiddenTabIds.add('magic-lens')
    if (!transcripts) hiddenTabIds.add('transcripts')

    return hiddenTabIds
  }, [platformAdapter.capabilities, shellVersion])
  const activeRoiSelection = platformRoiSelection(
    platformAdapter,
    roiState,
    activeVisiumHdRoiState,
  )
  const effectiveShowTranscriptOverlay =
    platformAdapter.effectiveTranscriptOverlay(showTranscriptOverlay)
  const transcriptDensityContent = useMemo(
    () => transcriptDensityContentForRendering(transcriptLayerState),
    [transcriptLayerState],
  )
  const legendSections = useMemo(
    () =>
      viewerLegendSections({
        cellsVisible: layerVisibility.cells,
        colorMode: observationColorMode,
        genes: {
          names: selectedGenes,
          scoreMode: geneExpressionScoreMode,
          colorScale: geneExpressionColorScale,
          scaleMax: geneExpressionScaleMax,
          loading: geneExpressionState.status !== 'ready',
        },
        annotations: legendAnnotations,
        metadataTrack:
          activeCellMetadataTrack === null || selectedCellMetadataTrack === null
            ? null
            : {
                label: selectedCellMetadataTrack.label,
                min: activeCellMetadataTrack.min,
                max: activeCellMetadataTrack.max,
              },
        cellAreaMax: legendCellAreaMax,
        transcripts: {
          density:
            effectiveShowTranscriptOverlay && transcriptDensityContent !== null
              ? {
                  colorScale: transcriptDensityColorScale,
                  labels: transcriptDensityScaleLabels,
                  content: transcriptDensityContent,
                }
              : null,
          pointColorMode:
            effectiveShowTranscriptOverlay && transcriptLayerPoints.length > 0
              ? transcriptPointColorMode
              : null,
        },
      }),
    [
      activeCellMetadataTrack,
      effectiveShowTranscriptOverlay,
      layerVisibility.cells,
      geneExpressionColorScale,
      geneExpressionScaleMax,
      geneExpressionScoreMode,
      geneExpressionState.status,
      legendAnnotations,
      legendCellAreaMax,
      observationColorMode,
      selectedCellMetadataTrack,
      selectedGenes,
      transcriptDensityColorScale,
      transcriptDensityContent,
      transcriptDensityScaleLabels,
      transcriptLayerPoints,
      transcriptPointColorMode,
    ],
  )
  const magicLensAvailability = platformAdapter.magicLensAvailability(
    loadState,
    spatialGridCells.length,
  )
  const magicLensLoadEnabled = magicLensAvailability.loadEnabled
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
  // While the image opens, a shared plane stays in the link.
  const shareableMorphologyZPlane =
    morphologyImage?.zStack?.zPlane ??
    (morphologyImage === null && morphologyState.status === 'loading'
      ? initialShareableState.morphologyZPlane
      : undefined)
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
    magicLensAvailability.unavailableReason,
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
    [appendDebugEvent, setFallbackNotices],
  )
  const recordTelemetry = useCallback(
    (event: TelemetryEvent) => {
      setTelemetryEvents((current) =>
        appendTelemetryEvent(current, event, performanceBudget.telemetryEventLimit),
      )
    },
    [performanceBudget.telemetryEventLimit, setTelemetryEvents],
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
        pendingDatasetLoadState,
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
      pendingDatasetLoadState,
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
  const handleImageTileError = useCallback(
    (error: Error) => {
      setMorphologyState((current) => {
        if (current.status !== 'ready') {
          return current
        }

        return morphologyLoadFailed(
          current.url,
          createStructuredLoadError('Image tiles', error),
        )
      })
    },
    [setMorphologyState],
  )
  const rememberGeneExpressionScaleMax = useCallback(
    (key: string, batch: GeneExpressionBatch, scoreMode: GeneExpressionScoreMode) => {
      const max = geneExpressionScoreDomainMax(batch.elements, batch.genes, scoreMode)

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
    [setGeneExpressionScaleDomain],
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
  }, [setGeneExpressionBatch, setGeneExpressionScaleDomain, setGeneExpressionState])
  const loadActiveAnnotations = useCallback<AnnotationLoader>(
    async (...args) => {
      const [baseUrl, options = {}] = args

      if (isAnnDataPlatform(platformAdapter)) {
        const dataset = await getSpatialDataset(baseUrl)

        if (!isH5adAnnotationDataset(dataset)) {
          throw new Error('Loaded H5AD dataset does not expose annotations.')
        }

        return dataset.annotations({
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
        })
      }

      return loadAnnotations(baseUrl, options)
    },
    [getSpatialDataset, loadAnnotations, platformAdapter],
  )
  // Only AnnData tracks arrive without values; imported CSV/JSON tracks carry them.
  const loadActiveCellMetadataTrackValues = useCallback<CellMetadataTrackValuesLoader>(
    async (baseUrl, trackId, options = {}) => {
      const dataset = await getSpatialDataset(baseUrl)

      if (!isH5adMetadataTrackDataset(dataset)) {
        throw new Error('Loaded dataset does not expose metadata track values.')
      }

      return dataset.metadataTrackValues(trackId, options)
    },
    [getSpatialDataset],
  )
  const loadActiveAnalysisEmbeddings = useCallback<AnalysisEmbeddingsLoader>(
    async (...args) => {
      const [baseUrl, options = {}] = args

      if (isAnnDataPlatform(platformAdapter)) {
        const dataset = await getSpatialDataset(baseUrl)

        if (!isH5adEmbeddingDataset(dataset)) {
          throw new Error('Loaded H5AD dataset does not expose embeddings.')
        }

        return dataset.embeddings({
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.kind === undefined ? {} : { kind: options.kind }),
        })
      }

      return loadAnalysisEmbeddings(baseUrl, {
        ...options,
        ...platformAnalysisEmbeddingOptions(platformAdapter, activeVisiumHdBinSize),
      })
    },
    [activeVisiumHdBinSize, getSpatialDataset, loadAnalysisEmbeddings, platformAdapter],
  )
  const loadActiveBoundaryElements = useCallback<BoundaryElementsLoader>(
    (...args) =>
      loadPlatformBoundaryElements(
        platformAdapter,
        { getSpatialDataset, loadBoundaryElements },
        ...args,
      ),
    [getSpatialDataset, loadBoundaryElements, platformAdapter],
  )
  const loadActiveNucleusBoundaryElements = useCallback<BoundaryElementsLoader>(
    (...args) =>
      loadPlatformNucleusBoundaryElements(
        platformAdapter,
        { getSpatialDataset },
        ...args,
      ),
    [getSpatialDataset, platformAdapter],
  )
  const loadActiveGeneExpression = useCallback<GeneExpressionLoader>(
    (...args) =>
      loadPlatformGeneExpression(
        platformAdapter,
        {
          activeBinSize: activeVisiumHdBinSize,
          getSpatialDataset,
          loadGeneExpression,
        },
        ...args,
      ),
    [activeVisiumHdBinSize, getSpatialDataset, loadGeneExpression, platformAdapter],
  )
  const loadActiveTranscriptCapabilities = useCallback<TranscriptCapabilitiesLoader>(
    (...args) =>
      loadPlatformTranscriptCapabilities(
        platformAdapter,
        { getSpatialDataset, loadTranscriptCapabilities },
        ...args,
      ),
    [getSpatialDataset, loadTranscriptCapabilities, platformAdapter],
  )
  const loadActiveTranscriptAggregates = useCallback<TranscriptAggregateLoader>(
    (...args) =>
      loadPlatformTranscriptAggregates(
        platformAdapter,
        { getSpatialDataset, loadTranscriptAggregates },
        ...args,
      ),
    [getSpatialDataset, loadTranscriptAggregates, platformAdapter],
  )
  const loadActiveTranscriptViewport = useCallback<TranscriptViewportLoader>(
    (...args) =>
      loadPlatformTranscriptViewport(
        platformAdapter,
        { getSpatialDataset, loadTranscriptViewport },
        ...args,
      ),
    [getSpatialDataset, loadTranscriptViewport, platformAdapter],
  )
  const loadActiveRoiCells = useCallback<RoiCellsLoader>(
    async (...args) => {
      const [baseUrl, selection, options = {}] = args

      if (!isAnnDataPlatform(platformAdapter)) {
        return loadRoiCells(baseUrl, selection, options)
      }

      const dataset = await getSpatialDataset(baseUrl)

      if (!isH5adRoiDataset(dataset)) {
        throw new Error('Loaded H5AD dataset does not expose ROI cell lookup.')
      }

      return dataset.cells(selection, {
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      })
    },
    [getSpatialDataset, loadRoiCells, platformAdapter],
  )
  const loadActiveRoiGeneStats = useCallback<RoiGeneStatsLoader>(
    async (...args) => {
      const [baseUrl, cells, options = {}] = args

      if (!isAnnDataPlatform(platformAdapter)) {
        return loadRoiGeneStats(baseUrl, cells, options)
      }

      const dataset = await getSpatialDataset(baseUrl)

      if (!isH5adExpressionDataset(dataset)) {
        throw new Error('Loaded H5AD dataset does not expose expression matrix reads.')
      }

      const h5adDataset: H5adExpressionDataset = dataset
      const sampledCells = h5adSampleCells(cells, options.cellLimit)
      const sampledCellIds = sampledCells.map((cell) => cell.id as SpatialElementId)
      const matrix = await h5adDataset.matrix(sampledCellIds)

      return summarizeRoiGeneExpression(matrix, {
        cellCount: cells.length,
        sampledCellIds,
        ...(options.geneLimit === undefined ? {} : { geneLimit: options.geneLimit }),
      })
    },
    [getSpatialDataset, loadRoiGeneStats, platformAdapter],
  )
  const loadActiveRoiTranscripts = useCallback<RoiTranscriptsLoader>(
    (...args) => {
      if (!isAnnDataPlatform(platformAdapter)) {
        return loadRoiTranscripts(...args)
      }

      return Promise.reject(
        new Error(
          `${
            platformAdapter.kind === 'atera'
              ? 'Atera'
              : platformAdapter.kind === 'visium'
                ? 'Visium'
                : 'H5AD and SpatialData'
          } datasets do not support ROI transcript export.`,
        ),
      )
    },
    [loadRoiTranscripts, platformAdapter],
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
  useEffect(() => {
    if (observationColorMode !== 'gene-expression') {
      colorModeBeforeGenesRef.current = observationColorMode
    }
  }, [observationColorMode])
  const toggleGene = useCallback(
    (gene: string) => {
      const isSelected = selectedGenes.includes(gene)
      const nextGenes = isSelected
        ? selectedGenes.filter((selectedGene) => selectedGene !== gene)
        : [...selectedGenes, gene].sort((a, b) => a.localeCompare(b))

      appendDebugEvent(isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`)
      resetGeneExpressionSelectionState()
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes(nextGenes)
      setObservationColorMode((mode) =>
        colorModeAfterGeneChange(mode, colorModeBeforeGenesRef.current, {
          added: !isSelected,
          geneCount: nextGenes.length,
        }),
      )
    },
    [
      appendDebugEvent,
      resetGeneExpressionSelectionState,
      selectedGenes,
      setManualTranscriptExactRequestKey,
      setObservationColorMode,
      setSelectedGenes,
    ],
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
    [appendDebugEvent, setActiveControlHudTab, setPinnedTranscript],
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
      ...(activeVisiumHdBinSize === undefined
        ? {}
        : { visiumHdBinSizeMicrometers: activeVisiumHdBinSize }),
    },
    data: {
      loadState,
      overviewExtent,
      selectedGenes,
    },
    loaders: {
      boundaryElements: loadActiveBoundaryElements,
      ...(platformAdapter.capabilities.nucleusBoundaries && showNucleusBoundaries
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
    if (!hiddenControlHudTabIds.has(activeControlHudTab)) {
      return
    }

    setActiveControlHudTab(
      CONTROL_HUD_TABS.find((tab) => !hiddenControlHudTabIds.has(tab.id))?.id ??
        'dataset',
    )
  }, [activeControlHudTab, hiddenControlHudTabIds, setActiveControlHudTab])

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
      loadTranscriptAggregates: loadActiveTranscriptAggregates,
      loadTranscriptCapabilities: loadActiveTranscriptCapabilities,
      loadTranscriptViewport: loadActiveTranscriptViewport,
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
      transcriptDistributionEnabled:
        platformAdapter.capabilities.cellTranscriptDistribution,
    },
    loaders: {
      loadBoundaryElements: loadActiveBoundaryElements,
      loadCellTranscriptDistribution,
      loadRoiGeneStats: loadActiveRoiGeneStats,
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
      enabled: platformAdapter.kind !== 'visium-hd',
      magicLensScope,
      viewportGeneWarmupEnabled: !isAnnDataPlatform(platformAdapter),
      roiName,
    },
    data: {
      loadState,
      roiState,
    },
    loaders: {
      loadRoiCells: loadActiveRoiCells,
      loadRoiGeneStats: loadActiveRoiGeneStats,
      loadRoiTranscripts: loadActiveRoiTranscripts,
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
    loaders: {
      getSpatialDataset,
    },
    refs: {
      initialSharedRoiSelectionRef,
      roiGeneAbortRef: roiAbortRef,
      roiGeneRequestIdRef: roiRequestId,
      roiIdRef,
    },
    setters: {
      setRoiGeneStatsState,
      setRoiMode,
      setRoiName,
      setVisiumHdRoiState,
    },
  })
  const handleBeforeDatasetLoad = useCallback(() => {
    clearVisiumHdRoiState()
    clearVisiumHdExpressionProfileState()
    setGeometricAnnotations([])
    setFallbackNotices([])
  }, [
    clearVisiumHdExpressionProfileState,
    clearVisiumHdRoiState,
    setFallbackNotices,
    setGeometricAnnotations,
  ])
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
    loadAnnotationGroup,
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
    loaders: { loadAnnotations: loadActiveAnnotations },
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
  useCellMetadataTrackValues({
    callbacks: { appendDebugEvent },
    data: { loadState, observationColorMode, selectedCellMetadataTrack },
    loaders: { loadCellMetadataTrackValues: loadActiveCellMetadataTrackValues },
    refs: { datasetAbortRef, loadRequestIdRef: loadRequestId },
    setters: { setCellMetadataTracks },
  })
  const handleImportGeometricAnnotations = useCallback(
    async (file: File | null) => {
      if (file === null) {
        return
      }

      try {
        geometricAnnotationIdRef.current += 1
        const imported = parseGeometricAnnotationsGeoJson(await file.text(), {
          defaultCoordinateUnit:
            platformAdapter.kind === 'image' ? 'pixel' : 'micrometer',
          micrometersPerPixel: viewerMicrometersPerPixel ?? 1,
          idPrefix: `geojson:${geometricAnnotationIdRef.current}`,
        })

        if (imported.length === 0) {
          appendDebugEvent('GeoJSON annotations empty')
          return
        }

        setGeometricAnnotations((current) => [...imported, ...current])
        appendDebugEvent(
          `GeoJSON annotations imported: ${imported.length.toLocaleString()} shapes`,
        )
      } catch {
        appendDebugEvent('GeoJSON annotation import failed')
      }
    },
    [
      appendDebugEvent,
      platformAdapter.kind,
      setGeometricAnnotations,
      viewerMicrometersPerPixel,
    ],
  )
  const handleExportGeometricAnnotations = useCallback(() => {
    if (geometricAnnotations.length === 0) {
      return
    }

    downloadTextFile(
      'geometric-annotations.geojson',
      geometricAnnotationsToGeoJson(geometricAnnotations),
    )
    appendDebugEvent(
      `GeoJSON annotations exported: ${geometricAnnotations.length.toLocaleString()} shapes`,
    )
  }, [appendDebugEvent, geometricAnnotations])
  const handleClearGeometricAnnotations = useCallback(() => {
    if (geometricAnnotations.length === 0) {
      return
    }

    setGeometricAnnotations([])
    appendDebugEvent('Cleared GeoJSON annotations')
  }, [appendDebugEvent, geometricAnnotations.length, setGeometricAnnotations])
  const handleGeometricAnnotationColorChange = useCallback(
    (annotationId: string, color: string) => {
      setGeometricAnnotations((current) =>
        updateGeometricAnnotationColor(current, annotationId, color),
      )
      appendDebugEvent(`GeoJSON annotation color ${annotationId}`, {
        coalesceKey: `geometric-annotation-color:${annotationId}`,
      })
    },
    [appendDebugEvent, setGeometricAnnotations],
  )
  const handleGeometricAnnotationVisibilityChange = useCallback(
    (annotationId: string, visible: boolean) => {
      setGeometricAnnotations((current) =>
        updateGeometricAnnotationVisibility(current, annotationId, visible),
      )
    },
    [setGeometricAnnotations],
  )
  const handleRemoveGeometricAnnotation = useCallback(
    (annotationId: string) => {
      setGeometricAnnotations((current) =>
        removeGeometricAnnotation(current, annotationId),
      )
      appendDebugEvent(`Removed GeoJSON annotation ${annotationId}`)
    },
    [appendDebugEvent, setGeometricAnnotations],
  )
  const handleImageRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (loadState.status !== 'ready') {
        return
      }

      geometricAnnotationIdRef.current += 1
      const name = roiName.trim() || defaultRoiName(geometricAnnotationIdRef.current)
      const id = `geometry:${geometricAnnotationIdRef.current}:${slug(name) || 'shape'}`
      const feature = geometricAnnotationFromRoiSelection({
        id,
        label: name,
        color: annotationPaletteColor(geometricAnnotations.length),
        selection,
      })

      setGeometricAnnotations((current) => [feature, ...current])
      setRoiMode('idle')
      setRoiName(defaultRoiName(geometricAnnotationIdRef.current + 1))
      appendDebugEvent(`Saved geometric annotation ${name}`)
    },
    [
      appendDebugEvent,
      geometricAnnotations.length,
      loadState.status,
      roiName,
      setGeometricAnnotations,
      setRoiMode,
      setRoiName,
    ],
  )
  useEffect(() => {
    if (loadedDatasetUrl === null) {
      return
    }

    const initialAnnotationUrl = initialAnnotationImportUrlRef.current

    if (initialAnnotationUrl === null) {
      return
    }

    initialAnnotationImportUrlRef.current = null
    void handleImportAnnotationUrl(initialAnnotationUrl).then((imported) => {
      if (imported) {
        setAnnotationImportUrl(initialAnnotationUrl)
      }
    })
  }, [handleImportAnnotationUrl, loadedDatasetUrl, setAnnotationImportUrl])
  useEffect(() => {
    const groupIds = initialAnnotationGroupIdsRef.current

    if (
      groupIds === null ||
      loadedDatasetUrl === null ||
      annotationGroupState.status !== 'ready' ||
      annotationGroupState.url !== loadedDatasetUrl
    ) {
      return
    }

    initialAnnotationGroupIdsRef.current = null
    const groupId = groupIds.find(
      (id) =>
        id === ALL_ANNOTATION_GROUP_ID ||
        annotationGroupState.groups.some((group) => group.id === id),
    )

    if (groupId !== undefined) {
      setSelectedAnnotationGroupId(groupId)
      loadAnnotationGroup(groupId)
    }
  }, [
    annotationGroupState,
    loadAnnotationGroup,
    loadedDatasetUrl,
    setSelectedAnnotationGroupId,
  ])

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
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )
  // Stable viewer click handlers keep the deck props unchanged across App
  // renders, so unrelated state changes do not redraw every cell.
  const handleViewerCellClick = useCallback(
    (cell: OverviewCellDatum) => {
      clearVisiumHdExpressionProfileState()
      setSelectedGridCell(null)
      setSelectedBoundaryCell(null)
      setSelectedCell(cell)
      setActiveControlHudTab('cell')
    },
    [
      clearVisiumHdExpressionProfileState,
      setActiveControlHudTab,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )
  const handleViewerCellBoundaryClick = useCallback(
    (cell: CellBoundaryDatum) => {
      clearVisiumHdExpressionProfileState()
      setSelectedCell(null)
      setSelectedGridCell(null)
      setSelectedBoundaryCell(cell)
      setActiveControlHudTab('cell')
    },
    [
      clearVisiumHdExpressionProfileState,
      setActiveControlHudTab,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )
  const handleViewerGridCellClick = useCallback(
    (cell: GridCellDatum) => {
      clearVisiumHdExpressionProfileState()
      setSelectedCell(null)
      setSelectedBoundaryCell(null)
      setSelectedGridCell(cell)
      setActiveControlHudTab('cell')
    },
    [
      clearVisiumHdExpressionProfileState,
      setActiveControlHudTab,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )

  const handleClearSelection = useCallback(() => {
    clearVisiumHdExpressionProfileState()
    setSelectedCell(null)
    setSelectedBoundaryCell(null)
    setSelectedGridCell(null)
  }, [
    clearVisiumHdExpressionProfileState,
    setSelectedBoundaryCell,
    setSelectedCell,
    setSelectedGridCell,
  ])
  const drawnBoundaryById = useMemo(
    () =>
      new Map(
        expressionStyledBoundaryLayerData.map((boundary) => [boundary.id, boundary]),
      ),
    [expressionStyledBoundaryLayerData],
  )
  const selectionHighlight = useMemo(
    () =>
      viewerSelectionHighlight({
        selectedCell,
        selectedBoundaryCell,
        selectedGridCell,
        drawnBoundaries: drawnBoundaryById,
      }),
    [drawnBoundaryById, selectedBoundaryCell, selectedCell, selectedGridCell],
  )

  const {
    handleMagicLensClear,
    handleMagicLensCursorActiveChange,
    handleMagicLensLeave,
    handleMagicLensMinQvChange,
    handleMagicLensMove,
    handleMagicLensRadiusChange,
    handleMagicLensScopeChange,
    handleMagicLensSummarise,
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
      ...(platformAdapter.kind === 'visium-hd'
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
      setMeasurementResetKey,
    },
  })
  const returnToPan = useCallback(() => {
    if (activeTool === 'magic-lens') handleMagicLensLeave()
    setActiveTool('pan')
    appendDebugEvent('Tool: Pan')
  }, [activeTool, appendDebugEvent, handleMagicLensLeave, setActiveTool])
  // Esc anywhere but a text field leaves the active tool for Pan (D8).
  useEffect(() => {
    if (activeTool === 'pan') return

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || isTextEntryTarget(event.target)) return
      returnToPan()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeTool, returnToPan])
  const handleRoiModeChange = useCallback(
    (nextMode: RoiDrawMode) => {
      // Starting a shape clears the measurement line.
      if (nextMode !== 'idle') {
        setMeasurementResetKey((current) => current + 1)
      }

      setRoiMode(nextMode)
      appendDebugEvent(
        platformAdapter.kind === 'image'
          ? nextMode === 'idle'
            ? 'Geometry draw cancelled'
            : nextMode === 'box'
              ? 'Geometry box mode enabled'
              : 'Geometry lasso mode enabled'
          : nextMode === 'idle'
            ? 'ROI draw cancelled'
            : nextMode === 'box'
              ? 'ROI draw mode enabled'
              : 'ROI lasso mode enabled',
      )
    },
    [appendDebugEvent, platformAdapter.kind, setMeasurementResetKey, setRoiMode],
  )

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
  const { requestedZPlane: requestedMorphologyZPlane, selectMorphologyZPlane } =
    useMorphologyZPlaneWorkflow({
      callbacks: { appendDebugEvent },
      data: { morphologyImage },
      refs: { loadRequestIdRef: loadRequestId },
      setters: { setMorphologyImage, setMorphologyState },
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
    [setCustomImageLayerOpacities],
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
    [customMorphologyLayers, handleRemoveCustomLayer, setCustomImageLayerOpacities],
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
      isDatasetLoaded: loadState.status === 'ready',
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
      setCellBoundaryOpacity,
      setCellFillOpacity,
      setImageLayerOpacity,
      setShowTranscriptOverlay,
      setDatasetAbout,
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
      setPendingDatasetLoadState,
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
      setSpatialDataControlState,
      setVisiumControlState,
      setViewportCellCount,
    },
  })

  const handleSpatialDataSelectionChange = useCallback(
    (selection: SpatialDataSelection) => {
      setSpatialDataSelection(datasetUrl, selection)
      setSpatialDataControlState((state) => spatialDataControlLoading(state, selection))
      appendDebugEvent(
        `SpatialData view change: ${[
          selection.coordinateSystem === undefined
            ? null
            : `coordinate system ${selection.coordinateSystem}`,
          selection.image === undefined ? null : `image ${selection.image}`,
          selection.micrometersPerUnit === undefined
            ? 'estimated units'
            : `${selection.micrometersPerUnit.toString()} µm per unit`,
        ]
          .filter((part) => part !== null)
          .join(', ')}`,
      )
      void startDatasetLoadRef.current?.(datasetUrl, shouldLoadMorphology)
    },
    [appendDebugEvent, datasetUrl, setSpatialDataControlState, shouldLoadMorphology],
  )
  const { handleVisiumImageChange, handleVisiumViewChange } = useVisiumControlsWorkflow({
    appendDebugEvent,
    datasetUrl: loadState.status === 'idle' ? null : loadState.url,
    getSpatialDataset,
    initialShareableStateRef,
    setFlatMorphologyImage,
    setMorphologyState,
    setVisiumControlState,
    shouldLoadMorphology,
    startDatasetLoadRef,
    visiumControlState,
  })
  const { handleVisiumHdBinSizeChange } = useVisiumHdBinWorkflow({
    callbacks: {
      appendDebugEvent,
      onBeforeBinSizeChange: handleBeforeVisiumHdBinSizeChange,
    },
    controls: {
      currentViewportDetail,
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

  useVisiumHdGridLodWorkflow({
    callbacks: { appendDebugEvent },
    controls: { visiumHdControlState },
    data: {
      currentViewportDetail,
      loadedDatasetUrl,
      spatialGridCells,
    },
    loaders: { getSpatialDataset },
    refs: { visiumHdBinRequestIdRef: visiumHdBinRequestId },
    setters: {
      setLoadState,
      setSpatialGridCells,
      setVisiumHdControlState,
    },
  })

  // The loaded annotation set for the link; until one loads, the link keeps
  // the sets it was opened with. Memoised so the link is not rescheduled on
  // every render.
  const loadedAnnotationGroupId =
    annotationState.status === 'ready' ? annotationState.groupId : undefined
  const sharedAnnotationGroupIds = useMemo(
    () =>
      loadedAnnotationGroupId === undefined
        ? (initialShareableState.annotationGroupIds ?? undefined)
        : [loadedAnnotationGroupId],
    [initialShareableState.annotationGroupIds, loadedAnnotationGroupId],
  )
  useShareableUrlHash({
    dataset: {
      annotationUrl: annotationImportUrl,
      customImageOpacities,
      customImageUrls,
      // The loaded dataset, not the address box: until a load finishes the
      // link keeps the dataset it was opened with (15.1-L).
      datasetUrl: loadedDatasetUrl ?? initialShareableState.datasetUrl ?? '',
      annotationGroupIds: sharedAnnotationGroupIds,
      spatialDataSelection: spatialDataSelectionToShareable(spatialDataControlState),
      visiumSelection: visiumSelectionToShareable(visiumControlState),
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
      cellMetadataTrackId:
        observationColorMode === 'metadata'
          ? (selectedCellMetadataTrack?.id ?? null)
          : null,
      coordinateUnit,
      imageOpacity: imageLayerOpacity,
      measurementUnit,
      morphologyEnabledChannelIds: shareableMorphologyEnabledChannelIds,
      morphologyZPlane: shareableMorphologyZPlane,
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
      // The chosen filter, not the one in effect: with no genes selected the
      // filter shows All features, but the link should still say Selected
      // genes (the default, so left out) and apply it once genes are chosen.
      transcriptFeatureFilterMode,
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

  const activeRoiCompleteHandler =
    platformAdapter.kind === 'image'
      ? handleImageRoiComplete
      : platformAdapter.kind === 'visium-hd'
        ? handleVisiumHdRoiComplete
        : handleRoiComplete

  // The section models (UNIFIED_PLAN.md, 15.2-A): the HUD tabs, and the new
  // shell, take these instead of separate props.
  const datasetInfo = useDatasetInfoModel({
    activeErrors,
    appendDebugEvent,
    boundaryCellLimit,
    cellFeatureMatrixCapabilityState,
    datasetAbout,
    datasetFactsInput:
      loadState.status === 'ready'
        ? {
            platform: platformAdapter.kind,
            url: loadState.url,
            elementNoun: platformAdapter.labels.embeddingElementPlural,
            elementCount: loadState.cellCount,
            geneCount:
              genePanelState.status === 'ready' ? genePanelState.genes.length : null,
            channelCount: morphologyChannels.length,
            zPlaneCount: morphologyImage?.zStack?.sizeZ ?? 1,
            hasFlatImage: flatMorphologyImage !== null,
            micrometersPerPixel: viewerMicrometersPerPixel,
          }
        : null,
    datasetUrl,
    debugLog,
    debugMode,
    diagnosticsState,
    fallbackNotices,
    handleDatasetSubmit,
    handleDownloadDiagnostics,
    handleRunDatasetDiagnostics,
    handleSpatialDataSelectionChange,
    handleVisiumHdBinSizeChange,
    handleVisiumImageChange,
    handleVisiumViewChange,
    isDatasetLoaded: loadState.status === 'ready',
    isLoading,
    isVisiumHdDataset,
    performanceBudget,
    setBoundaryCellLimit,
    setDatasetUrl,
    setDebugLog,
    setShouldLoadMorphology,
    shouldLoadMorphology,
    spatialDataControlState,
    visiumControlState,
    visiumHdControlState,
  })
  const imageSection = useImageSectionModel({
    appendDebugEvent,
    autoContrastChannelIds,
    customLayerLoadState: customMorphologyLayerState,
    customLayerOpacities: customImageLayerOpacities,
    customLayers: customMorphologyLayers,
    handleAutoContrast,
    handleLoadCustomLayer,
    handleRemoveCustomLayer: handleRemoveCustomImageLayer,
    imageLayerOpacity,
    loadEnabled: loadState.status === 'ready',
    morphologyChannelSettings,
    morphologyChannels,
    morphologyZStack: morphologyImage?.zStack,
    requestedMorphologyZPlane,
    selectMorphologyZPlane,
    setCustomLayerOpacity: handleCustomImageLayerOpacityChange,
    setImageLayerOpacity,
    updateMorphologyChannel,
  })
  const cellsSection = useCellsSectionModel({
    analysisHeaderCopy,
    appendDebugEvent,
    cellBoundaryOpacity,
    cellFillOpacity,
    cellLayerControlsVisible: platformAdapter.capabilities.cells,
    cellMetadataTracks,
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionCopy,
    geneExpressionDetailMode,
    geneExpressionScaleDatasetUrl,
    geneExpressionScaleMax,
    geneExpressionScoreMode,
    geneExpressionState,
    geneOptions,
    genePanelState,
    hasAnnotationColors:
      annotationState.status === 'ready' && annotationState.annotations.length > 0,
    nucleusBoundaryControlsVisible: platformAdapter.capabilities.nucleusBoundaries,
    observationColorMode,
    rememberGeneExpressionScaleMax,
    resetGeneExpressionSelectionState,
    selectedCellMetadataTrackId: selectedCellMetadataTrack?.id ?? null,
    selectedGenes,
    setCellBoundaryOpacity,
    setCellFillOpacity,
    setGeneExpressionColorScale,
    setGeneExpressionDetailMode,
    setGeneExpressionScaleDomain,
    setGeneExpressionScoreMode,
    setManualTranscriptExactRequestKey,
    setObservationColorMode,
    setSelectedCellMetadataTrackId,
    setSelectedGenes,
    setShowCellBoundaries,
    setShowNucleusBoundaries,
    showCellBoundaries,
    showNucleusBoundaries,
    toggleGene,
    transcriptViewportKeyRef,
  })
  const transcriptsSection = useTranscriptsSectionModel({
    appendDebugEvent,
    effectiveTranscriptFeatureFilterMode,
    geneOnlyFilterEnabled: platformAdapter.capabilities.transcriptGeneOnlyFilter,
    geneOptions,
    genePanelState,
    handlePinTranscript,
    hoveredTranscript,
    loadEnabled: platformFeatureLoadEnabled,
    pinnedTranscript,
    resetGeneExpressionSelectionState,
    selectedGenes,
    setManualTranscriptExactRequestKey,
    setPinnedTranscript,
    setSelectedGenes,
    setShowTranscriptOverlay,
    setTranscriptDensityColorScale,
    setTranscriptDetailMode,
    setTranscriptExactPointLimit,
    setTranscriptFeatureFilterMode,
    setTranscriptGeneOnly,
    setTranscriptMinQv,
    setTranscriptOpacity,
    setTranscriptPointColorMode,
    setTranscriptPointSize,
    showTranscriptOverlay: effectiveShowTranscriptOverlay,
    toggleGene,
    transcriptCapabilityState,
    transcriptCopy,
    transcriptDensityColorScale,
    transcriptDensityScaleLabels,
    transcriptDensityScaleMax,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptGeneOnly,
    transcriptLayerState,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
    transcriptViewportKeyRef,
    visibleTranscriptEstimate,
  })
  const annotationsSection = useAnnotationsSectionModel({
    annotationColors,
    annotationGroupOptions,
    annotationGroupState,
    annotationHeaderCopy,
    annotationImportUrl,
    annotationPlacedCellIds,
    annotationState,
    cellMetadataTracks,
    geometricAnnotations,
    geometricAnnotationsEnabled:
      platformAdapter.capabilities.geometricAnnotations && loadState.status === 'ready',
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleAnnotationSetVisibilityChange,
    handleAnnotationVisibilityChange,
    handleClearAnnotations,
    handleClearGeometricAnnotations,
    handleExportAnnotations,
    handleExportGeometricAnnotations,
    handleGeometricAnnotationColorChange,
    handleGeometricAnnotationVisibilityChange,
    handleImportAnnotationUrl,
    handleImportAnnotations,
    handleImportGeometricAnnotations,
    handleLoadAnnotations,
    handleRemoveAnnotation,
    handleRemoveCellMetadataTrack,
    handleRemoveGeometricAnnotation,
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
    loadEnabled: platformAdapter.capabilities.annotations && platformFeatureLoadEnabled,
    selectedAnnotationGroupId,
    setAnnotationImportUrl,
  })
  const viewSettings = useViewSettingsModel({
    appendDebugEvent,
    coordinateUnit,
    handleMagicLensLeave,
    measurementEnabled,
    measurementUnit,
    setCoordinateUnit,
    setMeasurementEnabled,
    setMeasurementResetKey,
    setMeasurementUnit,
    setShowHoverTooltips,
    showHoverTooltips,
  })
  const loadingDatasetUrl =
    pendingDatasetLoadState.status === 'loading'
      ? pendingDatasetLoadState.url
      : loadState.status === 'loading'
        ? loadState.url
        : null
  const topBar = useTopBarModel({
    activeTool,
    appendDebugEvent,
    canDrawRoi,
    channelCount: morphologyChannels.length,
    datasetName: datasetDisplayName(loadedDatasetUrl, datasetAbout?.name),
    debugMode,
    elementCount: loadState.status === 'ready' ? loadState.cellCount : 0,
    elementNoun: platformAdapter.labels.embeddingElementPlural,
    geneCount: genePanelState.status === 'ready' ? genePanelState.genes.length : null,
    loadingDatasetName:
      loadingDatasetUrl === null
        ? null
        : (datasetDisplayName(loadingDatasetUrl, undefined) ?? loadingDatasetUrl),
    magicLensAvailable: platformAdapter.capabilities.magicLens,
    magicLensCanSummariseView:
      currentViewportDetail !== null && magicLensState.status !== 'loading',
    magicLensEnabled: magicLensLoadEnabled,
    magicLensRadiusMicrometers,
    magicLensReason: magicLensAvailability.unavailableReason,
    magicLensScope,
    onMagicLensCursorActiveChange: handleMagicLensCursorActiveChange,
    onMagicLensRadiusChange: handleMagicLensRadiusChange,
    onMagicLensScopeChange: handleMagicLensScopeChange,
    onMagicLensSummariseView: () => {
      handleMagicLensSummarise('viewport')
    },
    onMeasureEnabledChange: viewSettings.measure.onEnabledChange,
    onReturnToPan: returnToPan,
    onRoiModeChange: handleRoiModeChange,
    platform: platformAdapter.kind,
    setDebugMode,
  })
  const [fitRequestKey, setFitRequestKey] = useState(0)
  useToolShortcuts(shellVersion === 2, topBar.tools.onSelect, () => {
    setFitRequestKey((current) => current + 1)
  })
  const layerPanel = useLayerPanelModel({
    annotations: annotationsSection,
    appendDebugEvent,
    capabilities: platformAdapter.capabilities,
    cells: cellsSection,
    elementNoun: platformAdapter.labels.embeddingElementPlural,
    image: imageSection,
    imageAvailable: morphologyImage !== null || flatMorphologyImage !== null,
    layerVisibility,
    loadingAreas,
    setLayerVisibility,
    transcripts: transcriptsSection,
  })

  // The cards (UNIFIED_PLAN.md, 15.2-D) replace the Magic Lens, ROI and
  // Cell tabs in the new shell.
  const elementPlural = platformAdapter.labels.embeddingElementPlural
  const selectionLensInput = {
    available: platformAdapter.capabilities.magicLens,
    enabled: magicLensLoadEnabled && activeRoiSelection !== null,
    label: platformAdapter.capabilities.transcripts ? 'Transcripts' : 'Expression',
    state: magicLensState,
    onRun: () => {
      handleMagicLensSummarise('roi')
    },
  }
  const cards = useCardStackModel({
    selection:
      platformAdapter.kind === 'image'
        ? {
            variant: 'geometry',
            drawing: roiMode === 'idle' ? null : roiMode,
            name: roiName,
            nameDisabled: loadState.status !== 'ready',
            onClose: returnToPan,
            onNameChange: setRoiName,
            shapeCount: geometricAnnotations.length,
          }
        : isVisiumHdDataset
          ? {
              variant: 'bins',
              genes: { copy: roiGeneStatsCopy, state: roiGeneStatsState },
              lens: selectionLensInput,
              name: roiName,
              nameDisabled: loadState.status !== 'ready',
              onClose: handleClearActiveRoi,
              onExportBarcodes: handleExportVisiumHdRoiBarcodes,
              onExportGeoJson: handleExportVisiumHdRoiGeoJson,
              onNameChange: setRoiName,
              roiState: activeVisiumHdRoiState,
              status: visiumHdRoiCopy,
              summary: visiumHdRoiSummary,
            }
          : {
              variant: 'cells',
              elementNoun: {
                singular: elementPlural.replace(/s$/, ''),
                plural: elementPlural,
              },
              genes: { copy: roiGeneStatsCopy, state: roiGeneStatsState },
              lens: selectionLensInput,
              loading: isRoiTabLoading,
              name: roiName,
              nameDisabled: !platformFeatureLoadEnabled,
              onClose: handleClearActiveRoi,
              onExportCells: handleExportRoiCells,
              onExportGeoJson: handleExportRoiGeoJson,
              onExportTranscripts: handleExportRoiTranscripts,
              onNameChange: setRoiName,
              onSave: handleSaveRoiAnnotation,
              roiState,
              status: roiHeaderCopy,
              summary: roiSummary,
              transcriptExportState: roiTranscriptExportState,
            },
    cell: {
      cell: {
        selected: selectedCell,
        title: platformAdapter.kind === 'visium' ? 'Spot' : 'Cell',
        status: cellDetailCopy,
        annotationLabels: selectedCellAnnotationLabels,
        state: cellDetailState,
        distributionState: cellTranscriptDistributionState,
        distributionVisible: platformAdapter.capabilities.cellTranscriptDistribution,
        variant: isAnnDataPlatform(platformAdapter) ? 'observations' : 'default',
      },
      boundary: {
        selected: activeSelectedBoundaryCell,
        expressionStatus: selectedBoundaryCellExpressionStatus,
      },
      gridCell: {
        selected: activeSelectedGridCell,
        assignmentState: gridCellAssignmentState,
        expressionStatus: selectedGridCellExpressionStatus,
      },
      profile: {
        state: activeVisiumHdExpressionProfileState,
        onLoad: handleLoadVisiumHdExpressionProfile,
      },
      onClose: handleClearSelection,
    },
    transcript: platformAdapter.capabilities.transcripts
      ? {
          capabilityState: transcriptCapabilityState,
          onClose: transcriptsSection.onClearPinnedTranscript,
          pinned: pinnedTranscript,
        }
      : null,
    magicLens: platformAdapter.capabilities.magicLens
      ? {
          cursorActive: magicLensIsCursorActive,
          onClose: handleMagicLensClear,
          state: magicLensState,
          status: magicLensCopy,
        }
      : null,
    zoomToBbox,
  })

  const controlHud = (
    <AppControlHud
      activeControlHudTab={activeControlHudTab}
      appendDebugEvent={appendDebugEvent}
      debugMode={debugMode}
      hiddenTabIds={hiddenControlHudTabIds}
      isControlHudCollapsed={isControlHudCollapsed}
      loadingTabIds={loadingTabIds}
      setActiveControlHudTab={setActiveControlHudTab}
      setIsControlHudCollapsed={setIsControlHudCollapsed}
    >
      {/* The new shell's top bar, drawer and layer panel hold these. */}
      {shellVersion === 2 ? null : (
        <>
          <DatasetHudPanel
            active={activeControlHudTab === 'dataset'}
            info={datasetInfo}
          />

          <LayerHudPanel
            active={activeControlHudTab === 'layers'}
            image={imageSection}
            cells={cellsSection}
            settings={viewSettings}
            info={datasetInfo}
          />

          <GeneHudPanel active={activeControlHudTab === 'genes'} cells={cellsSection} />

          {platformAdapter.capabilities.transcripts ? (
            <TranscriptHudPanel
              active={activeControlHudTab === 'transcripts'}
              transcripts={transcriptsSection}
            />
          ) : null}
        </>
      )}

      {shellVersion === 2 ? null : (
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
          minQvVisible={platformAdapter.capabilities.magicLensMinQv}
          magicLensIsCursorActive={magicLensIsCursorActive}
          magicLensCanScan={magicLensCanScan}
          onScopeChange={handleMagicLensScopeChange}
          onRadiusChange={handleMagicLensRadiusChange}
          onMinQvChange={handleMagicLensMinQvChange}
          onCursorActiveChange={handleMagicLensCursorActiveChange}
          onRunMagicLens={handleRunMagicLens}
        />
      )}

      {shellVersion === 2 ? null : (
        <AnnotationHudPanel
          active={activeControlHudTab === 'annotations'}
          annotations={annotationsSection}
        />
      )}

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
        selectedCellInfoVariant={
          isAnnDataPlatform(platformAdapter) ? 'observations' : 'default'
        }
        cellDetailCopy={cellDetailCopy}
        cellDetailState={cellDetailState}
        cellTranscriptDistributionState={cellTranscriptDistributionState}
        cellTranscriptDistributionVisible={
          platformAdapter.capabilities.cellTranscriptDistribution
        }
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
        embeddingOnly={shellVersion === 2}
      />

      {shellVersion === 2 ? null : platformAdapter.kind === 'image' ? (
        <GeometricRoiHudPanel
          active={activeControlHudTab === 'roi'}
          roiNameInputId={controlIds.roiNameInputId}
          roiHeaderCopy={geometricRoiHeaderCopy}
          canDrawRoi={canDrawRoi}
          roiMode={roiMode}
          roiName={roiName}
          loadEnabled={loadState.status === 'ready'}
          onRoiModeChange={handleRoiModeChange}
          onRoiNameChange={setRoiName}
        />
      ) : isVisiumHdDataset ? (
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
          roiGeneStatsCopy={roiGeneStatsCopy}
          roiGeneStatsState={roiGeneStatsState}
          onRoiModeChange={handleRoiModeChange}
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
          loadEnabled={platformFeatureLoadEnabled}
          roiState={roiState}
          roiSummary={roiSummary}
          roiGeneStatsCopy={roiGeneStatsCopy}
          roiGeneStatsState={roiGeneStatsState}
          roiTranscriptExportState={roiTranscriptExportState}
          onRoiModeChange={handleRoiModeChange}
          onClearRoi={handleClearActiveRoi}
          onRoiNameChange={setRoiName}
          onSaveRoiAnnotation={handleSaveRoiAnnotation}
          onExportRoiCells={handleExportRoiCells}
          onExportRoiGeoJson={handleExportRoiGeoJson}
          onExportRoiTranscripts={handleExportRoiTranscripts}
        />
      )}
    </AppControlHud>
  )
  const viewerRegion = (
    <section className="viewer-region" aria-labelledby="viewer-heading">
      <h2 id="viewer-heading" className="visually-hidden">
        Spatial View
      </h2>

      <ViewerCore
        cells={styledOverviewCells}
        expressionElements={viewerGeneExpressionElements}
        geneExpressionActive={geneExpressionColorsReady}
        geneExpressionOverlayEnabled={geneExpressionOverlayEnabled}
        boundaries={expressionStyledBoundaryLayerData}
        nucleusBoundaries={visibleNucleusBoundaryLayerData}
        cellBoundaryHoverEnabled={platformAdapter.cellBoundaryHoverEnabled(
          showCellBoundaries,
        )}
        hoverTooltipsEnabled={showHoverTooltips}
        overviewCellSourceLabel={
          platformAdapter.kind === 'h5ad'
            ? 'H5AD'
            : platformAdapter.kind === 'visium'
              ? 'Visium'
              : platformAdapter.kind === 'spatialdata'
                ? 'SpatialData'
                : platformAdapter.kind === 'atera'
                  ? 'Atera'
                  : 'Xenium'
        }
        gridCells={viewerGridCells}
        fitGridCells={spatialGridCells}
        fitImageExtent={imageFitExtent}
        transcriptAggregateBins={transcriptLayerAggregateBins}
        transcriptPoints={transcriptLayerPoints}
        geometricAnnotations={
          layerVisibility.annotations ? geometricAnnotationLayerData : NO_GEOMETRY_LAYERS
        }
        imageLoader={morphologyImage?.loader ?? null}
        imageChannels={morphologyCanvasChannels}
        flatImage={flatMorphologyImage}
        imageOpacity={morphologyCanvasChannels.length === 0 ? renderedImageOpacity : 1}
        cellLayersVisible={layerVisibility.cells}
        cellFillOpacity={cellFillOpacity}
        cellBoundaryOpacity={platformAdapter.kind === 'h5ad' ? 0 : cellBoundaryOpacity}
        pointSizeFullViewScale={platformAdapter.pointSizeFullViewScale}
        trueSizePoints={platformAdapter.trueSizePoints}
        transcriptOpacity={transcriptOpacity}
        transcriptPointSize={transcriptPointSize}
        observationColorMode={viewerObservationColorMode}
        annotationStyleColors={annotationStyleColors}
        cellMetadataTrack={activeCellMetadataTrack}
        loadingTasks={loadingTasks}
        legendSections={legendSections}
        showZoomLevel={debugMode}
        selectionHighlight={selectionHighlight}
        onClearSelection={handleClearSelection}
        onLegendCategoryVisibilityChange={handleAnnotationVisibilityChange}
        coordinateUnit={coordinateUnit}
        measurementEnabled={measurementEnabled}
        measurementUnit={measurementUnit}
        measurementResetKey={measurementResetKey}
        status={loadState.status}
        imageStatus={viewerImageStatus}
        boundaryStatus={boundaryState.status}
        overviewRenderCellLimit={viewerOverviewRenderCellLimit}
        clipOverviewCellsToViewport={!isAnnDataPlatform(platformAdapter)}
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
        navigationControls={shellVersion === 2}
        fitRequestKey={fitRequestKey}
        onImageTileError={handleImageTileError}
        onTileCacheEviction={handleTileCacheEviction}
        onViewportCellCountChange={setViewportCellCount}
        onViewportChange={handleViewportChange}
        onTranscriptHover={setHoveredTranscript}
        onTranscriptClick={handlePinTranscript}
        onCellClick={handleViewerCellClick}
        onCellBoundaryClick={handleViewerCellBoundaryClick}
        onGridCellClick={handleViewerGridCellClick}
        onRoiComplete={activeRoiCompleteHandler}
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
        {...(spatialDataControlState.status !== 'idle' &&
        spatialDataControlState.units.source === 'unknown'
          ? { physicalUnitLabel: 'units' }
          : {})}
        {...(boundaryState.status === 'error'
          ? { boundaryErrorMessage: formatStructuredError(boundaryState.error) }
          : {})}
      />
      {pendingDatasetLoadState.status === 'error' ? (
        <DatasetLoadToast
          failedUrl={pendingDatasetLoadState.url}
          error={pendingDatasetLoadState.error}
          openDatasetName={datasetDisplayName(loadedDatasetUrl, datasetAbout?.name)}
          onDismiss={() => {
            setPendingDatasetLoadState(IDLE_DATASET_LOAD_STATE)
          }}
        />
      ) : null}
    </section>
  )
  const skipLink = (
    <a className="skip-link" href="#viewer-heading">
      Skip To Spatial View
    </a>
  )

  if (shellVersion === 2) {
    return (
      <main className="app-shell app-shell--v2">
        {skipLink}
        <ShellLayout
          topBar={topBar}
          info={datasetInfo}
          settings={viewSettings}
          layerPanel={layerPanel}
          image={imageSection}
          cells={cellsSection}
          transcripts={transcriptsSection}
          annotations={annotationsSection}
          cards={cards}
        >
          {viewerRegion}
          {/* Images have no embeddings, so no HUD tab is left (15.2-D). */}
          {CONTROL_HUD_TABS.some((tab) => !hiddenControlHudTabIds.has(tab.id))
            ? controlHud
            : null}
        </ShellLayout>
      </main>
    )
  }

  return (
    <main className="app-shell">
      {skipLink}
      {controlHud}
      {viewerRegion}
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

interface H5adRoiDataset {
  cells(
    selection: Parameters<RoiCellsLoader>[1],
    options?: { readonly limit?: number },
  ): Promise<readonly DatasetCell[]>
}

interface H5adExpressionDataset {
  matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>>
}

interface H5adAnnotationDataset {
  annotations(options?: {
    readonly groupId?: string
    readonly signal?: AbortSignal
  }): Promise<readonly Annotation[]>
}

interface H5adEmbeddingDataset {
  embeddings(options?: {
    readonly kind?: string
    readonly signal?: AbortSignal
  }): Promise<readonly AnalysisEmbedding[]>
}

interface H5adMetadataTrackDataset {
  metadataTrackValues(
    trackId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly ContinuousCellMetadataValue[]>
}

function isH5adRoiDataset(dataset: unknown): dataset is H5adRoiDataset {
  return hasFunction(dataset, 'cells')
}

function isH5adExpressionDataset(dataset: unknown): dataset is H5adExpressionDataset {
  return hasFunction(dataset, 'matrix')
}

function isH5adAnnotationDataset(dataset: unknown): dataset is H5adAnnotationDataset {
  return hasFunction(dataset, 'annotations')
}

function isH5adEmbeddingDataset(dataset: unknown): dataset is H5adEmbeddingDataset {
  return hasFunction(dataset, 'embeddings')
}

function isH5adMetadataTrackDataset(
  dataset: unknown,
): dataset is H5adMetadataTrackDataset {
  return hasFunction(dataset, 'metadataTrackValues')
}

function hasFunction<T extends string>(
  value: unknown,
  key: T,
): value is Record<T, (...args: never[]) => unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    key in value &&
    typeof (value as Record<T, unknown>)[key] === 'function'
  )
}

function h5adSampleCells(
  cells: readonly DatasetCell[],
  limit: number | undefined,
): readonly DatasetCell[] {
  const normalizedLimit =
    limit === undefined || !Number.isFinite(limit)
      ? cells.length
      : Math.max(1, Math.floor(limit))

  return cells.length <= normalizedLimit ? cells : cells.slice(0, normalizedLimit)
}

function imageFitExtentFromMorphologyImage(image: MorphologyImage | null): BBox | null {
  if (image === null) {
    return null
  }

  const loader = image.loader
  const micrometersPerPixel = loader.units.micrometersPerPixel

  return {
    minX: micrometers(0),
    maxX: micrometers(loader.imageWidth * micrometersPerPixel),
    minY: micrometers(0),
    maxY: micrometers(loader.imageHeight * micrometersPerPixel),
  }
}

function nonGeneColorMode(mode: ObservationColorMode | undefined): ObservationColorMode {
  return mode === undefined || mode === 'gene-expression' ? 'transcript-count' : mode
}
