import { useCallback, useState, type SetStateAction } from 'react'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import type {
  RoiDrawMode,
  ViewerCoordinateUnit,
  ViewerFocusRequest,
  ViewerTranscriptHoverDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import type { AnalysisEmbeddingKind } from '../../data/analysisEmbeddings'
import { ALL_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import {
  normalizeTranscriptExactPointLimit,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type { PerformanceBudget } from '../../data/performanceBudget'
import type { ShareableState, ShareableViewState } from '../../data/shareableState'
import type { TelemetryEvent } from '../../data/telemetry'
import type { Platform, SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { MorphologyImage } from '../../data/morphologyImage'
import { normalizeLayerOpacity } from '../../rendering/layerOpacity'
import { normalizeBoundaryCellLimit } from '../../rendering/boundaryViewport'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import {
  type CellBoundaryDatum,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
  type GridCellDatum,
  type OverviewCellDatum,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import {
  type AnnotationGroupState,
  type AnnotationState,
  IDLE_ANNOTATION_GROUP_STATE,
  IDLE_ANNOTATION_STATE,
} from '../annotations/annotationModel'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import {
  type AnalysisEmbeddingState,
  IDLE_ANALYSIS_EMBEDDING_STATE,
} from '../analysis/analysisEmbeddingModel'
import {
  type CellDetailState,
  type CellTranscriptDistributionState,
  IDLE_CELL_DETAIL_STATE,
  IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE,
} from '../cells/cellDetailModel'
import {
  type CellExpressionProfileState,
  IDLE_CELL_EXPRESSION_PROFILE_STATE,
} from '../cells/cellExpressionProfileModel'
import {
  type GridCellAssignmentState,
  IDLE_GRID_CELL_ASSIGNMENT_STATE,
} from '../cells/gridCellAssignmentModel'
import {
  IDLE_BOUNDARY_LOAD_STATE,
  IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE,
  IDLE_DATASET_DIAGNOSTICS_STATE,
  IDLE_DATASET_LOAD_STATE,
  IDLE_DATASET_WARMUP_STATE,
  IDLE_MORPHOLOGY_LOAD_STATE,
  type BoundaryLoadState,
  type CellFeatureMatrixCapabilityState,
  type DatasetDiagnosticsState,
  type DatasetLoadState,
  type DatasetWarmupState,
  type MorphologyLoadState,
} from '../dataset/datasetLoadModel'
import type { DatasetManifestAbout } from '../dataset/datasetManifestModel'
import {
  type VisiumHdControlState,
  IDLE_VISIUM_HD_CONTROL_STATE,
} from '../dataset/visiumHdModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  IDLE_GENE_EXPRESSION_STATE,
  IDLE_GENE_PANEL_STATE,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
  type GeneExpressionScaleDomain,
  type GeneExpressionState,
  type GenePanelState,
} from '../genes/geneControlsModel'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from '../morphology/customMorphologyLayers'
import { IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE } from '../morphology/customMorphologyLayers'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import {
  IDLE_MAGIC_LENS_STATE,
  normalizeMagicLensRadius,
  parseMagicLensScope,
  type MagicLensScope,
  type MagicLensState,
} from '../roi/magicLensModel'
import {
  IDLE_ROI_GENE_STATS_STATE,
  IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE,
  IDLE_ROI_STATE,
  IDLE_ROI_TRANSCRIPT_EXPORT_STATE,
  type RoiGeneStatsState,
  type RoiGeneViewportWarmupState,
  type RoiState,
  type RoiTranscriptExportState,
} from '../roi/roiModel'
import { type VisiumHdRoiState, IDLE_VISIUM_HD_ROI_STATE } from '../roi/visiumHdRoiModel'
import {
  IDLE_ROI_REFERENCE_STATE,
  type RoiReferenceState,
} from '../roi/roiEnrichmentModel'
import {
  IDLE_TRANSCRIPT_CAPABILITY_STATE,
  IDLE_TRANSCRIPT_LAYER_STATE,
  parseTranscriptDensityColorScale,
  parseTranscriptDetailMode,
  parseTranscriptFeatureFilterMode,
  parseTranscriptPointColorMode,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import { sharedObservationColorMode, parseViewerCoordinateUnit } from './appShellModel'
import type { DebugLogEntry, FallbackNoticeEntry } from './appRuntimeModel'
import {
  resolveStateAction,
  roiModeForTool,
  toolAfterMagicLens,
  toolAfterMeasurement,
  toolAfterRoiMode,
  type ActiveTool,
} from './activeToolModel'
import { layerVisibilityFromLink, toolFromLink } from '../shell/shellLinkModel'
import { DEFAULT_SHAREABLE_STATE } from './shareableDefaults'
import {
  IDLE_SPATIALDATA_CONTROL_STATE,
  type SpatialDataControlState,
} from '../dataset/spatialDataModel'
import {
  IDLE_VISIUM_CONTROL_STATE,
  type VisiumControlState,
} from '../dataset/visiumModel'

const NO_MANIFEST_DEFAULTS: ShareableState = {}
export interface UseAppDomainStateOptions {
  readonly initialShareableState: ShareableState
  readonly performanceBudget: PerformanceBudget
}

export interface LayerVisibility {
  readonly image: boolean
  readonly cells: boolean
  readonly annotations: boolean
}

export function useAppDomainState({
  initialShareableState,
  performanceBudget,
}: UseAppDomainStateOptions) {
  const [loadState, setLoadState] = useState<DatasetLoadState<StructuredLoadError>>(
    IDLE_DATASET_LOAD_STATE,
  )
  // A load that will replace the dataset on screen (15.1-F): loading until
  // the new dataset is ready, or the error if it failed, while loadState
  // keeps describing the dataset still shown. Idle otherwise.
  const [pendingDatasetLoadState, setPendingDatasetLoadState] = useState<
    DatasetLoadState<StructuredLoadError>
  >(IDLE_DATASET_LOAD_STATE)
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
  const [geometricAnnotations, setGeometricAnnotations] = useState<
    readonly GeometricAnnotationFeature[]
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
  // The comparison for enriched genes (15.4-B).
  const [roiReferenceState, setRoiReferenceState] = useState<
    RoiReferenceState<StructuredLoadError>
  >(IDLE_ROI_REFERENCE_STATE)
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
    () =>
      parseMagicLensScope(initialShareableState.magicLensScope) ??
      DEFAULT_SHAREABLE_STATE.magicLensScope,
  )
  // One tool at a time (15.1-G). The old flags and their setters are derived
  // from it, so the workflows keep their interfaces and cannot turn on two.
  const [activeTool, setActiveTool] = useState<ActiveTool>(() =>
    toolFromLink(initialShareableState),
  )
  const magicLensActive = activeTool === 'magic-lens'
  const measurementEnabled = activeTool === 'measure'
  const roiMode = roiModeForTool(activeTool)
  const setMagicLensActive = useCallback((action: SetStateAction<boolean>) => {
    setActiveTool((tool) =>
      toolAfterMagicLens(tool, resolveStateAction(action, tool === 'magic-lens')),
    )
  }, [])
  const setMeasurementEnabled = useCallback((action: SetStateAction<boolean>) => {
    setActiveTool((tool) =>
      toolAfterMeasurement(tool, resolveStateAction(action, tool === 'measure')),
    )
  }, [])
  const setRoiMode = useCallback((action: SetStateAction<RoiDrawMode>) => {
    setActiveTool((tool) =>
      toolAfterRoiMode(tool, resolveStateAction(action, roiModeForTool(tool))),
    )
  }, [])
  const [magicLensRadiusMicrometers, setMagicLensRadiusMicrometers] = useState(() =>
    normalizeMagicLensRadius(
      initialShareableState.magicLensRadiusMicrometers ??
        DEFAULT_SHAREABLE_STATE.magicLensRadiusMicrometers,
    ),
  )
  const [showTranscriptOverlay, setShowTranscriptOverlay] = useState(
    initialShareableState.transcriptOverlay ?? DEFAULT_SHAREABLE_STATE.transcriptOverlay,
  )
  const [transcriptDetailMode, setTranscriptDetailMode] = useState<TranscriptDetailMode>(
    () =>
      parseTranscriptDetailMode(initialShareableState.transcriptDetailMode) ??
      DEFAULT_SHAREABLE_STATE.transcriptDetailMode,
  )
  const [transcriptMinQv, setTranscriptMinQv] = useState(
    initialShareableState.transcriptMinQv ?? DEFAULT_SHAREABLE_STATE.transcriptMinQv,
  )
  const [transcriptGeneOnly, setTranscriptGeneOnly] = useState(
    initialShareableState.transcriptGeneOnly ??
      DEFAULT_SHAREABLE_STATE.transcriptGeneOnly,
  )
  const [transcriptFeatureFilterMode, setTranscriptFeatureFilterMode] =
    useState<TranscriptFeatureFilterMode>(
      () =>
        parseTranscriptFeatureFilterMode(
          initialShareableState.transcriptFeatureFilterMode,
        ) ?? DEFAULT_SHAREABLE_STATE.transcriptFeatureFilterMode,
    )
  const [transcriptDensityColorScale, setTranscriptDensityColorScale] =
    useState<TranscriptDensityColorScale>(
      () =>
        parseTranscriptDensityColorScale(
          initialShareableState.transcriptDensityColorScale,
        ) ?? DEFAULT_SHAREABLE_STATE.transcriptDensityColorScale,
    )
  const [transcriptPointColorMode, setTranscriptPointColorMode] =
    useState<TranscriptPointColorMode>(
      () =>
        parseTranscriptPointColorMode(initialShareableState.transcriptPointColorMode) ??
        DEFAULT_SHAREABLE_STATE.transcriptPointColorMode,
    )
  const [transcriptExactPointLimit, setTranscriptExactPointLimit] = useState(() =>
    normalizeTranscriptExactPointLimit(
      initialShareableState.transcriptExactPointLimit ??
        DEFAULT_SHAREABLE_STATE.transcriptExactPointLimit,
    ),
  )
  const [transcriptOpacity, setTranscriptOpacity] = useState(
    initialShareableState.transcriptOpacity ?? DEFAULT_SHAREABLE_STATE.transcriptOpacity,
  )
  const [transcriptPointSize, setTranscriptPointSize] = useState(
    initialShareableState.transcriptPointSize ??
      DEFAULT_SHAREABLE_STATE.transcriptPointSize,
  )
  // The transcript gene legend (15.4-C): edited colours, and genes whose
  // points are hidden.
  const [transcriptGeneColors, setTranscriptGeneColors] = useState<
    Readonly<Record<string, string>>
  >({})
  const [hiddenTranscriptGenes, setHiddenTranscriptGenes] = useState<readonly string[]>(
    [],
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
    initialShareableState.shouldLoadMorphology ??
      DEFAULT_SHAREABLE_STATE.shouldLoadMorphology,
  )
  const [boundaryCellLimit, setBoundaryCellLimit] = useState(() =>
    normalizeBoundaryCellLimit(
      initialShareableState.boundaryCellLimit ?? performanceBudget.boundaryCellLimit,
    ),
  )
  const [imageLayerOpacity, setImageLayerOpacity] = useState(() =>
    normalizeLayerOpacity(
      initialShareableState.imageOpacity ?? DEFAULT_SHAREABLE_STATE.imageOpacity,
    ),
  )
  const [cellFillOpacity, setCellFillOpacity] = useState(() =>
    normalizeLayerOpacity(
      initialShareableState.cellFillOpacity ?? DEFAULT_SHAREABLE_STATE.cellFillOpacity,
    ),
  )
  const [showCellBoundaries, setShowCellBoundaries] = useState(
    initialShareableState.showCellBoundaries ??
      DEFAULT_SHAREABLE_STATE.showCellBoundaries,
  )
  const [showNucleusBoundaries, setShowNucleusBoundaries] = useState(
    initialShareableState.showNucleusBoundaries ??
      DEFAULT_SHAREABLE_STATE.showNucleusBoundaries,
  )
  const [showHoverTooltips, setShowHoverTooltips] = useState(
    initialShareableState.showHoverTooltips ?? DEFAULT_SHAREABLE_STATE.showHoverTooltips,
  )
  // Settings › Show minimap (15.4-D) and Show axes (15.4-E), for the
  // session.
  const [showMinimap, setShowMinimap] = useState(true)
  const [showAxes, setShowAxes] = useState(false)
  // The layer panel's visibility checkboxes (15.2-C). Transcripts use
  // showTranscriptOverlay.
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(() =>
    layerVisibilityFromLink(initialShareableState),
  )
  const [cellBoundaryOpacity, setCellBoundaryOpacity] = useState(() =>
    normalizeLayerOpacity(
      initialShareableState.cellBoundaryOpacity ??
        DEFAULT_SHAREABLE_STATE.cellBoundaryOpacity,
    ),
  )
  const [coordinateUnit, setCoordinateUnit] = useState<ViewerCoordinateUnit>(
    () =>
      parseViewerCoordinateUnit(initialShareableState.coordinateUnit) ??
      DEFAULT_SHAREABLE_STATE.coordinateUnit,
  )
  const [measurementUnit, setMeasurementUnit] = useState<ViewerCoordinateUnit>(
    () =>
      parseViewerCoordinateUnit(initialShareableState.measurementUnit) ??
      parseViewerCoordinateUnit(initialShareableState.coordinateUnit) ??
      DEFAULT_SHAREABLE_STATE.measurementUnit,
  )
  const [measurementResetKey, setMeasurementResetKey] = useState(0)
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    useState<GeneExpressionColorScale>(
      () =>
        parseGeneExpressionColorScale(initialShareableState.geneExpressionColorScale) ??
        DEFAULT_SHAREABLE_STATE.geneExpressionColorScale,
    )
  const [geneExpressionScoreMode, setGeneExpressionScoreMode] =
    useState<GeneExpressionScoreMode>(
      () =>
        parseGeneExpressionScoreMode(initialShareableState.geneExpressionScoreMode) ??
        DEFAULT_SHAREABLE_STATE.geneExpressionScoreMode,
    )
  const [geneExpressionDetailMode, setGeneExpressionDetailMode] =
    useState<GeneExpressionDetailMode>(
      () =>
        parseGeneExpressionDetailMode(initialShareableState.geneExpressionDetailMode) ??
        DEFAULT_SHAREABLE_STATE.geneExpressionDetailMode,
    )
  const [selectedGenes, setSelectedGenes] = useState<readonly string[]>(
    initialShareableState.selectedGenes ?? DEFAULT_SHAREABLE_STATE.selectedGenes,
  )
  const [roiName, setRoiName] = useState('ROI 1')
  const [observationColorMode, setObservationColorMode] = useState<ObservationColorMode>(
    () =>
      sharedObservationColorMode(initialShareableState) ??
      DEFAULT_SHAREABLE_STATE.observationColorMode,
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
  const [datasetAbout, setDatasetAbout] = useState<DatasetManifestAbout | null>(null)
  // The loaded dataset's manifest defaults, which its links leave out.
  const [datasetManifestDefaults, setDatasetManifestDefaults] =
    useState<ShareableState>(NO_MANIFEST_DEFAULTS)
  const [visiumHdControlState, setVisiumHdControlState] = useState<VisiumHdControlState>(
    IDLE_VISIUM_HD_CONTROL_STATE,
  )
  const [spatialDataControlState, setSpatialDataControlState] =
    useState<SpatialDataControlState>(IDLE_SPATIALDATA_CONTROL_STATE)
  const [visiumControlState, setVisiumControlState] = useState<VisiumControlState>(
    IDLE_VISIUM_CONTROL_STATE,
  )
  const [gridCellAssignmentState, setGridCellAssignmentState] = useState<
    GridCellAssignmentState<StructuredLoadError>
  >(IDLE_GRID_CELL_ASSIGNMENT_STATE)
  const [visiumHdExpressionProfileState, setVisiumHdExpressionProfileState] = useState<
    CellExpressionProfileState<StructuredLoadError>
  >(IDLE_CELL_EXPRESSION_PROFILE_STATE)

  return {
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
      datasetManifestDefaults,
      datasetPlatform,
      datasetWarmupState,
      diagnosticsState,
      loadState,
      morphologyState,
      pendingDatasetLoadState,
      setBoundaryState,
      setCellFeatureMatrixCapabilityState,
      setDatasetAbout,
      setDatasetManifestDefaults,
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
      setShowAxes,
      setShowHoverTooltips,
      setShowMinimap,
      setShowNucleusBoundaries,
      showAxes,
      showCellBoundaries,
      showHoverTooltips,
      showMinimap,
      showNucleusBoundaries,
    },
    magicLens: {
      magicLensActive,
      magicLensRadiusMicrometers,
      magicLensScope,
      magicLensState,
      setMagicLensActive,
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
      roiReferenceState,
      roiState,
      roiTranscriptExportState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setRoiState,
      setRoiTranscriptExportState,
      setVisiumHdRoiState,
      visiumHdRoiState,
    },
    tools: {
      activeTool,
      setActiveTool,
    },
    runtime: {
      debugLog,
      fallbackNotices,
      setDebugLog,
      setFallbackNotices,
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
      hiddenTranscriptGenes,
      hoveredTranscript,
      manualTranscriptExactRequestKey,
      pinnedTranscript,
      setHiddenTranscriptGenes,
      setHoveredTranscript,
      setManualTranscriptExactRequestKey,
      setPinnedTranscript,
      setShowTranscriptOverlay,
      setTranscriptCapabilityState,
      setTranscriptDensityColorScale,
      setTranscriptDetailMode,
      setTranscriptExactPointLimit,
      setTranscriptFeatureFilterMode,
      setTranscriptGeneColors,
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
      transcriptGeneColors,
      transcriptGeneOnly,
      transcriptLayerState,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    },
    spatialData: {
      setSpatialDataControlState,
      spatialDataControlState,
    },
    visium: {
      setVisiumControlState,
      visiumControlState,
    },
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
  }
}
