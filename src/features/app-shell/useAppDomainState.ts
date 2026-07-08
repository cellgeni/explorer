import { useState } from 'react'
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
import {
  DEFAULT_CELL_FILL_OPACITY,
  normalizeLayerOpacity,
} from '../../rendering/layerOpacity'
import { normalizeBoundaryCellLimit } from '../../rendering/boundaryViewport'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import {
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
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
  normalizeMagicLensMinQv,
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
  IDLE_TRANSCRIPT_CAPABILITY_STATE,
  IDLE_TRANSCRIPT_LAYER_STATE,
  parseTranscriptDensityColorScale,
  parseTranscriptDetailMode,
  parseTranscriptFeatureFilterMode,
  parseTranscriptPointColorMode,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import {
  parseControlHudTab,
  parseObservationColorMode,
  parseViewerCoordinateUnit,
  type ControlHudTab,
} from './appShellModel'
import type { DebugLogEntry, FallbackNoticeEntry } from './appRuntimeModel'

export interface UseAppDomainStateOptions {
  readonly initialShareableState: ShareableState
  readonly performanceBudget: PerformanceBudget
}

export function useAppDomainState({
  initialShareableState,
  performanceBudget,
}: UseAppDomainStateOptions) {
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
      datasetPlatform,
      datasetWarmupState,
      diagnosticsState,
      loadState,
      morphologyState,
      setBoundaryState,
      setCellFeatureMatrixCapabilityState,
      setDatasetPlatform,
      setDatasetWarmupState,
      setDiagnosticsState,
      setLoadState,
      setMorphologyState,
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
      measurementEnabled,
      measurementResetKey,
      measurementUnit,
      observationColorMode,
      setBoundaryCellLimit,
      setCellBoundaryOpacity,
      setCellFillOpacity,
      setCoordinateUnit,
      setImageLayerOpacity,
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
