import {
  useEffect,
  useRef,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerTranscriptHoverDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import {
  ALL_ANNOTATION_GROUP_ID,
  NO_ANNOTATION_GROUP_ID,
  type AnnotationGroupOption,
} from '../../data/datasetAnnotations'
import type { WarmDatasetForRoiResult } from '../../data/datasetWarmup'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import {
  morphologyImageFromPyramidLoader,
  type MorphologyImage,
  type MorphologyImageChannel,
} from '../../data/morphologyImage'
import { type RoiSelection } from '../../data/roiSelection'
import type { ShareableState } from '../../data/shareableState'
import {
  datasetManifestAbout,
  manifestDefaultsNotShared,
  manifestDefaultsToShareableState,
  resolveMorphologyChannelSelection,
  type DatasetManifestAbout,
} from '../dataset/datasetManifestModel'
import type { CellOverviewPoint } from '../../data/hyparquetCells'
import { normalizeTranscriptExactPointLimit } from '../../data/transcriptOverlay'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type {
  DatasetMeta,
  ImageSource,
  Platform,
  SpatialElement,
} from '../../datasets/spatialDataset'
import type { SpatialDataSummary } from '../../datasets/spatialDataDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type {
  AnalysisEmbeddingKind,
  AnalysisEmbeddingOption,
} from '../../data/analysisEmbeddings'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import {
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  overviewCellsToLayerData,
  type GridCellDatum,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
  type OverviewCellDatum,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import {
  IDLE_CELL_DETAIL_STATE,
  IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE,
  type CellDetailState,
  type CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import {
  IDLE_ANALYSIS_EMBEDDING_STATE,
  analysisEmbeddingOptionsReady,
  type AnalysisEmbeddingState,
} from '../analysis/analysisEmbeddingModel'
import {
  IDLE_ANNOTATION_GROUP_STATE,
  IDLE_ANNOTATION_STATE,
  annotationGroupLoadFailed,
  annotationGroupLoadReady,
  annotationGroupLoadStarted,
  defaultAnnotationGroupId,
  type AnnotationGroupState,
  type AnnotationState,
} from '../annotations/annotationModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
} from '../genes/geneControlsModel'
import {
  IDLE_GENE_EXPRESSION_STATE,
  IDLE_GENE_PANEL_STATE,
  genePanelLoadFailed,
  genePanelLoadReady,
  genePanelLoadStarted,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
} from '../genes/geneControlsModel'
import {
  channelsToAutoContrastOnLoad,
  createMorphologyChannelSettings,
  defaultEnabledChannelIds,
  type MorphologyChannelSetting,
} from '../morphology/morphologyChannels'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from '../morphology/customMorphologyLayers'
import { IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE } from '../morphology/customMorphologyLayers'
import { IDLE_MAGIC_LENS_STATE, type MagicLensState } from '../roi/magicLensModel'
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
import {
  IDLE_TRANSCRIPT_CAPABILITY_STATE,
  IDLE_TRANSCRIPT_LAYER_STATE,
  parseTranscriptDensityColorScale,
  parseTranscriptPointColorMode,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import type {
  AnnotationGroupLoader,
  DatasetOverviewLoader,
  SpatialDatasetDetector,
  SpatialDatasetLoader,
  DatasetWarmupLoader,
  GenePanelLoader,
  MorphologyImageLoader,
} from './appDependencies'
import {
  abortActiveRequest,
  clearTimeoutRef,
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  shortDatasetLabel,
  startLatestRequest,
  type DebugLogAppendOptions,
} from './appRuntimeModel'
import { manifestObservationColorMode, sharedObservationColorMode } from './appShellModel'
import {
  IDLE_BOUNDARY_LOAD_STATE,
  IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE,
  IDLE_DATASET_DIAGNOSTICS_STATE,
  IDLE_DATASET_WARMUP_STATE,
  IDLE_MORPHOLOGY_LOAD_STATE,
  cellFeatureMatrixCapabilityReady,
  datasetLoadFailed,
  datasetLoadReady,
  datasetLoadStarted,
  datasetWarmupFailed,
  datasetWarmupReady,
  datasetWarmupStarted,
  morphologyLoadFailed,
  morphologyLoadReady,
  morphologyLoadStarted,
  type BoundaryLoadState,
  type CellFeatureMatrixCapabilityState,
  type DatasetDiagnosticsState,
  type DatasetLoadState,
  type DatasetWarmupState,
  type MorphologyLoadState,
} from '../dataset/datasetLoadModel'
import {
  IDLE_VISIUM_HD_CONTROL_STATE,
  visiumHdControlStateFromOverview,
  type VisiumHdControlState,
} from '../dataset/visiumHdModel'
import {
  IDLE_SPATIALDATA_CONTROL_STATE,
  spatialDataControlReady,
  spatialDataSelectionFromShareable,
  type SpatialDataControlState,
} from '../dataset/spatialDataModel'
import {
  IDLE_VISIUM_CONTROL_STATE,
  visiumControlReady,
  visiumImageForLoad,
  visiumUnitsNeedNotice,
  visiumViewFromShareable,
  type VisiumControlState,
  type VisiumSource,
} from '../dataset/visiumModel'
import {
  setSpatialDataSelection,
  spatialDataSelectionFor,
} from '../../datasets/datasetFactory'
import { datasetDetectionError } from '../../datasets/datasetDetectionError'
import type { AnnDataVisiumSummary, AnnDataVisiumView } from '../../datasets/h5adDataset'
import { formatVisiumUnits, type VisiumImageKind } from '../../datasets/visiumFormat'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  flatMorphologyImageFromSource,
  isVisiumHdOverviewDataset,
} from './useVisiumHdBinWorkflow'
import { visiumHdOverviewToGridCellLayerData } from './visiumHdGridLayerData'

type Setter<T> = Dispatch<SetStateAction<T>>

interface MutableRef<T> {
  current: T
}

interface QueueAutoContrastOptions {
  readonly requestId?: number
  readonly signal?: AbortSignal
}

type QueueAutoContrast = (
  channels: readonly MorphologyImageChannel[],
  options?: QueueAutoContrastOptions,
) => void

interface H5adLifecycleDataset {
  overview(): Promise<readonly CellOverviewPoint[]>
  genePanel(): Promise<readonly string[]>
  geneAliases?(): Promise<ReadonlyMap<string, string>>
  annotationGroups(): Promise<readonly AnnotationGroupOption[]>
  embeddingOptions(): Promise<readonly AnalysisEmbeddingOption[]>
  metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]>
}

interface SpatialDataSummaryDataset {
  summary(): Promise<SpatialDataSummary>
}

export interface VisiumLifecycleDataset extends H5adLifecycleDataset {
  meta(): Promise<DatasetMeta>
  setVisiumView(view: AnnDataVisiumView): VisiumLifecycleDataset
  visiumSummary(): Promise<AnnDataVisiumSummary | null>
  tissueImage(kind: VisiumImageKind): Promise<ImageSource | null>
}

interface AteraMorphologyDataset {
  morphologyUrl(): Promise<string | null>
}

interface UseDatasetLifecycleCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
  readonly onBeforeDatasetLoad?: () => void
  readonly queueAutoContrast: QueueAutoContrast
  readonly recordTelemetry: (event: TelemetryEvent) => void
}

interface UseDatasetLifecycleControls {
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptExactPointLimit: number
  readonly transcriptPointColorMode: TranscriptPointColorMode
}

interface UseDatasetLifecycleInitialState {
  readonly initialShareableState: ShareableState
}

interface UseDatasetLifecycleLoaders {
  readonly detectSpatialDataset: SpatialDatasetDetector
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly loadAnnotationGroups: AnnotationGroupLoader
  readonly loadDatasetOverview: DatasetOverviewLoader
  readonly loadGenePanel: GenePanelLoader
  readonly loadMorphologyImage: MorphologyImageLoader
  readonly warmDatasetForRoi: DatasetWarmupLoader
}

interface UseDatasetLifecycleRefs {
  readonly analysisEmbeddingAbortRef: MutableRef<AbortController | null>
  readonly analysisEmbeddingRequestIdRef: MutableRef<number>
  readonly autoContrastChannelIdsRef: MutableRef<Set<string>>
  readonly boundaryAbortRef: MutableRef<AbortController | null>
  readonly boundaryRequestIdRef: MutableRef<number>
  readonly boundaryViewportKeyRef: MutableRef<string | null>
  readonly cellDetailAbortRef: MutableRef<AbortController | null>
  readonly cellDetailRequestIdRef: MutableRef<number>
  readonly cellFeatureMatrixCapabilityKeyRef: MutableRef<string | null>
  readonly cellTranscriptDistributionAbortRef: MutableRef<AbortController | null>
  readonly cellTranscriptDistributionRequestIdRef: MutableRef<number>
  readonly customMorphologyLayerAbortRef: MutableRef<AbortController | null>
  readonly customMorphologyLayerRequestIdRef: MutableRef<number>
  readonly datasetAbortRef: MutableRef<AbortController | null>
  readonly datasetWarmupAbortRef: MutableRef<AbortController | null>
  readonly diagnosticsAbortRef: MutableRef<AbortController | null>
  readonly didApplyInitialDatasetUrlRef: MutableRef<boolean>
  readonly geneExpressionAbortRef: MutableRef<AbortController | null>
  readonly geneExpressionRequestIdRef: MutableRef<number>
  readonly geneExpressionViewportKeyRef: MutableRef<string | null>
  readonly initialShareableStateRef: MutableRef<ShareableState | null>
  readonly initialSharedRoiSelectionRef: MutableRef<RoiSelection | null>
  readonly initialShouldLoadMorphologyRef: MutableRef<boolean>
  readonly lastViewportDetailRef: MutableRef<ViewerViewportDetail | null>
  readonly loadRequestIdRef: MutableRef<number>
  readonly magicLensAbortRef: MutableRef<AbortController | null>
  readonly magicLensDebounceRef: MutableRef<number | null>
  readonly magicLensLastDetailRef: MutableRef<ViewerMagicLensDetail | null>
  readonly magicLensLastQueryKeyRef: MutableRef<string | null>
  readonly magicLensRequestIdRef: MutableRef<number>
  readonly roiAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupKeyRef: MutableRef<string | null>
  readonly roiGeneViewportWarmupTimeoutRef: MutableRef<number | null>
  readonly roiRequestIdRef: MutableRef<number>
  readonly roiTranscriptExportAbortRef: MutableRef<AbortController | null>
  readonly roiTranscriptExportRequestIdRef: MutableRef<number>
  readonly startDatasetLoadRef: MutableRef<
    ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null
  >
  readonly transcriptAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityRequestIdRef: MutableRef<number>
  readonly transcriptRequestIdRef: MutableRef<number>
  readonly transcriptViewportKeyRef: MutableRef<string | null>
}

interface UseDatasetLifecycleSetters {
  readonly setAnalysisEmbeddingState: Setter<AnalysisEmbeddingState<StructuredLoadError>>
  readonly setAnnotationColors: Setter<Readonly<Record<string, string>>>
  readonly setAnnotationGroupState: Setter<AnnotationGroupState<StructuredLoadError>>
  readonly setAnnotationState: Setter<AnnotationState<StructuredLoadError>>
  readonly setHiddenAnnotationIds: Setter<readonly string[]>
  readonly setHiddenAnnotationSetIds: Setter<readonly string[]>
  readonly setCellMetadataTracks: Setter<readonly ContinuousCellMetadataTrack[]>
  readonly setSelectedCellMetadataTrackId: Setter<string | null>
  // Applied only from dataset manifest defaults.
  readonly setCellBoundaryOpacity?: Setter<number>
  readonly setCellFillOpacity?: Setter<number>
  readonly setImageLayerOpacity?: Setter<number>
  readonly setShowTranscriptOverlay?: Setter<boolean>
  // What the Dataset tab shows about a dataset with a manifest.
  readonly setDatasetAbout?: Setter<DatasetManifestAbout | null>
  readonly setAutoContrastChannelIds: Setter<readonly string[]>
  readonly setBoundaryElements: Setter<readonly SpatialElement[]>
  readonly setNucleusBoundaryElements?: Setter<readonly SpatialElement[]>
  readonly setBoundaryState: Setter<BoundaryLoadState<StructuredLoadError>>
  readonly setCellDetailState: Setter<CellDetailState<StructuredLoadError>>
  readonly setCellFeatureMatrixCapabilityState: Setter<CellFeatureMatrixCapabilityState>
  readonly setCellTranscriptDistributionState: Setter<
    CellTranscriptDistributionState<StructuredLoadError>
  >
  readonly setCurrentViewportDetail: Setter<ViewerViewportDetail | null>
  readonly setCustomMorphologyLayerState: Setter<
    CustomMorphologyLayerLoadState<StructuredLoadError>
  >
  readonly setCustomMorphologyLayers: Setter<readonly CustomMorphologyLayer[]>
  readonly setCustomImageLayerOpacities: Setter<Readonly<Record<string, number>>>
  readonly setDatasetUrl: (datasetUrl: string) => void
  readonly setDatasetPlatform: Setter<Platform | null>
  readonly setDatasetWarmupState: Setter<DatasetWarmupState>
  readonly setDiagnosticsState: Setter<DatasetDiagnosticsState<StructuredLoadError>>
  readonly setGeneExpressionBatch: Setter<GeneExpressionBatch | null>
  readonly setGeneExpressionColorScale: Setter<GeneExpressionColorScale>
  readonly setGeneExpressionDetailMode: Setter<GeneExpressionDetailMode>
  readonly setGeneExpressionScaleDomain: Setter<GeneExpressionScaleDomain>
  readonly setGeneExpressionScoreMode: Setter<GeneExpressionScoreMode>
  readonly setGeneExpressionState: Setter<GeneExpressionState<StructuredLoadError>>
  readonly setGenePanelState: Setter<GenePanelState<StructuredLoadError>>
  readonly setHoveredTranscript: Setter<ViewerTranscriptHoverDetail | null>
  readonly setLoadState: Setter<DatasetLoadState<StructuredLoadError>>
  readonly setMagicLensActive: Setter<boolean>
  readonly setMagicLensState: Setter<MagicLensState<StructuredLoadError>>
  readonly setManualTranscriptExactRequestKey: Setter<string | null>
  readonly setMeasurementEnabled: Setter<boolean>
  readonly setMeasurementResetKey: Setter<number>
  readonly setFlatMorphologyImage: Setter<FlatMorphologyCanvasImage | null>
  readonly setMorphologyChannelSettings: Setter<readonly MorphologyChannelSetting[]>
  readonly setMorphologyImage: Setter<MorphologyImage | null>
  readonly setMorphologyState: Setter<MorphologyLoadState<StructuredLoadError>>
  readonly setObservationColorMode: Setter<ObservationColorMode>
  readonly setOverviewCells: Setter<readonly OverviewCellDatum[]>
  readonly setPinnedTranscript: Setter<ViewerTranscriptHoverDetail | null>
  readonly setRoiGeneStatsState: Setter<RoiGeneStatsState<StructuredLoadError>>
  readonly setRoiGeneViewportWarmupState: Setter<RoiGeneViewportWarmupState>
  readonly setRoiMode: Setter<RoiDrawMode>
  readonly setRoiName: Setter<string>
  readonly setRoiState: Setter<RoiState<StructuredLoadError>>
  readonly setRoiTranscriptExportState: Setter<
    RoiTranscriptExportState<StructuredLoadError>
  >
  readonly setSelectedAnnotationGroupId: Setter<string>
  readonly setSelectedCell: Setter<OverviewCellDatum | null>
  readonly setSelectedGridCell: Setter<GridCellDatum | null>
  readonly setSelectedEmbeddingKind: Setter<AnalysisEmbeddingKind>
  readonly setSelectedGenes: Setter<readonly string[]>
  readonly setShowCellBoundaries: Setter<boolean>
  readonly setShowNucleusBoundaries: Setter<boolean>
  readonly setSpatialGridCells: Setter<readonly GridCellDatum[]>
  readonly setTranscriptCapabilityState: Setter<
    TranscriptCapabilityState<StructuredLoadError>
  >
  readonly setTranscriptDensityColorScale: Setter<TranscriptDensityColorScale>
  readonly setTranscriptExactPointLimit: Setter<number>
  readonly setTranscriptLayerState: Setter<TranscriptLayerState<StructuredLoadError>>
  readonly setTranscriptPointColorMode: Setter<TranscriptPointColorMode>
  readonly setVisiumHdControlState: Setter<VisiumHdControlState>
  readonly setSpatialDataControlState: Setter<SpatialDataControlState>
  readonly setVisiumControlState: Setter<VisiumControlState>
  readonly setViewportCellCount: Setter<number | null>
}

interface UseDatasetLifecycleOptions {
  readonly callbacks: UseDatasetLifecycleCallbacks
  readonly controls: UseDatasetLifecycleControls
  readonly initialState: UseDatasetLifecycleInitialState
  readonly loaders: UseDatasetLifecycleLoaders
  readonly refs: UseDatasetLifecycleRefs
  readonly setters: UseDatasetLifecycleSetters
}

interface UseDatasetLifecycleResult {
  readonly handleDatasetSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}

export function useDatasetLifecycle({
  callbacks: {
    appendDebugEvent,
    appendFallbackNotice,
    onBeforeDatasetLoad,
    queueAutoContrast,
    recordTelemetry,
  },
  controls: {
    geneExpressionColorScale,
    transcriptDensityColorScale,
    transcriptExactPointLimit,
    transcriptPointColorMode,
  },
  initialState: { initialShareableState },
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
    analysisEmbeddingRequestIdRef,
    autoContrastChannelIdsRef,
    boundaryAbortRef,
    boundaryRequestIdRef,
    boundaryViewportKeyRef,
    cellDetailAbortRef,
    cellDetailRequestIdRef,
    cellFeatureMatrixCapabilityKeyRef,
    cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef,
    customMorphologyLayerAbortRef,
    customMorphologyLayerRequestIdRef,
    datasetAbortRef,
    datasetWarmupAbortRef,
    diagnosticsAbortRef,
    didApplyInitialDatasetUrlRef,
    geneExpressionAbortRef,
    geneExpressionRequestIdRef,
    geneExpressionViewportKeyRef,
    initialShareableStateRef,
    initialSharedRoiSelectionRef,
    initialShouldLoadMorphologyRef,
    lastViewportDetailRef,
    loadRequestIdRef,
    magicLensAbortRef,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensRequestIdRef,
    roiAbortRef,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupTimeoutRef,
    roiRequestIdRef,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef,
    startDatasetLoadRef,
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef,
    transcriptRequestIdRef,
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
    setNucleusBoundaryElements,
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
}: UseDatasetLifecycleOptions): UseDatasetLifecycleResult {
  const datasetWarmupRequestIdRef = useRef(0)

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
  }, [didApplyInitialDatasetUrlRef, initialShareableState.datasetUrl, setDatasetUrl])

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
      abortActiveRequest(customMorphologyLayerAbortRef)
      clearTimeoutRef(magicLensDebounceRef)
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    }
  }, [
    analysisEmbeddingAbortRef,
    boundaryAbortRef,
    cellDetailAbortRef,
    cellTranscriptDistributionAbortRef,
    datasetAbortRef,
    datasetWarmupAbortRef,
    diagnosticsAbortRef,
    geneExpressionAbortRef,
    magicLensAbortRef,
    magicLensDebounceRef,
    roiAbortRef,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupTimeoutRef,
    roiTranscriptExportAbortRef,
    customMorphologyLayerAbortRef,
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
  ])

  function startDatasetWarmup(requestedUrl: string, requestId: number) {
    const request = startLatestRequest({
      abortRef: datasetWarmupAbortRef,
      requestIdRef: datasetWarmupRequestIdRef,
    })
    const warmupStartedAt = readTimestamp()
    setDatasetWarmupState(datasetWarmupStarted(requestedUrl))
    appendDebugEvent('Dataset prep started')
    const applyCellFeatureMatrixCapability = (result: WarmDatasetForRoiResult | void) => {
      const capability = result?.cellFeatureMatrix

      if (
        capability === undefined ||
        capability === null ||
        loadRequestIdRef.current !== requestId ||
        !request.isCurrent() ||
        request.signal.aborted
      ) {
        return
      }

      const capabilityKey = `${requestedUrl}:${capability.hasCellMajorCsc}`

      if (cellFeatureMatrixCapabilityKeyRef.current === capabilityKey) {
        return
      }

      cellFeatureMatrixCapabilityKeyRef.current = capabilityKey
      setCellFeatureMatrixCapabilityState(
        cellFeatureMatrixCapabilityReady(requestedUrl, capability.hasCellMajorCsc),
      )

      if (!capability.hasCellMajorCsc) {
        appendDebugEvent(
          'Cell-feature matrix is not CSC; ROI gene stats will use H5 fallback when needed',
          { coalesceKey: 'cell-feature-matrix-csc' },
        )
      }
    }

    void warmDatasetForRoi(requestedUrl, {
      signal: request.signal,
      onCellFeatureMatrixCapability: (capability) => {
        applyCellFeatureMatrixCapability({ cellFeatureMatrix: capability })
      },
    })
      .then((result) => {
        if (
          loadRequestIdRef.current !== requestId ||
          !request.isCurrent() ||
          request.signal.aborted
        ) {
          return
        }

        applyCellFeatureMatrixCapability(result)
        setDatasetWarmupState(datasetWarmupReady(requestedUrl))
        appendDebugEvent(`Dataset prep ready (${formatElapsed(warmupStartedAt)})`)
      })
      .catch((error) => {
        if (
          isAbortError(error) ||
          loadRequestIdRef.current !== requestId ||
          !request.isCurrent() ||
          request.signal.aborted
        ) {
          return
        }

        setDatasetWarmupState(datasetWarmupFailed(requestedUrl))
        appendDebugEvent(`Dataset prep incomplete (${formatElapsed(warmupStartedAt)})`)
      })
      .finally(() => {
        request.complete()
      })
  }

  // Dataset manifest defaults that are not set per platform during the load.
  // Boundary toggles and image channels are applied with the platform's own
  // defaults instead.
  function applyManifestDefaults(defaults: ShareableState) {
    const observationColorMode = manifestObservationColorMode(defaults)
    const geneExpressionColorScale = parseGeneExpressionColorScale(
      defaults.geneExpressionColorScale,
    )
    const geneExpressionScoreMode = parseGeneExpressionScoreMode(
      defaults.geneExpressionScoreMode,
    )

    if (defaults.selectedGenes !== undefined) {
      setSelectedGenes(defaults.selectedGenes)
    }

    if (observationColorMode !== undefined) {
      setObservationColorMode(observationColorMode)
    }

    if (geneExpressionColorScale !== undefined) {
      setGeneExpressionColorScale(geneExpressionColorScale)
    }

    if (geneExpressionScoreMode !== undefined) {
      setGeneExpressionScoreMode(geneExpressionScoreMode)
    }

    if (defaults.imageOpacity !== undefined) {
      setImageLayerOpacity?.(defaults.imageOpacity)
    }

    if (defaults.cellFillOpacity !== undefined) {
      setCellFillOpacity?.(defaults.cellFillOpacity)
    }

    if (defaults.cellBoundaryOpacity !== undefined) {
      setCellBoundaryOpacity?.(defaults.cellBoundaryOpacity)
    }

    if (defaults.transcriptOverlay !== undefined) {
      setShowTranscriptOverlay?.(defaults.transcriptOverlay)
    }
  }

  async function startDatasetLoad(datasetUrl: string, loadImage: boolean) {
    const requestedUrl = datasetUrl.trim()

    if (requestedUrl !== '') {
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
      } else {
        const sharedSelection = spatialDataSelectionFromShareable(sharedState)

        if (Object.keys(sharedSelection).length > 0) {
          setSpatialDataSelection(requestedUrl, sharedSelection)
        }
      }
      appendDebugEvent(`Loading dataset ${shortDatasetLabel(requestedUrl)}`)
      onBeforeDatasetLoad?.()
      const request = startLatestRequest({
        abortRef: datasetAbortRef,
        requestIdRef: loadRequestIdRef,
      })
      const requestId = request.requestId
      const isCurrentDatasetLoad = () => request.isCurrent() && !request.signal.aborted
      const loadMorphologyInBackground = (
        load: () => Promise<MorphologyImage | null>,
        options: {
          readonly channelSelection?: readonly string[]
          // Start with up to MAX_DEFAULT_ENABLED_CHANNELS channels on rather
          // than only the first.
          readonly enableFirstChannelsByDefault?: boolean
          readonly skipNativeRgbAutoContrast?: boolean
        } = {},
      ) => {
        void load()
          .then((image) => {
            if (!isCurrentDatasetLoad()) {
              return
            }

            if (image === null) {
              setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
              return
            }

            const defaultChannelIds =
              options.enableFirstChannelsByDefault === true
                ? defaultEnabledChannelIds(image.channelLoaders)
                : undefined
            const enabledChannelIds =
              options.channelSelection === undefined
                ? defaultChannelIds
                : resolveMorphologyChannelSelection(
                    image.channelLoaders,
                    options.channelSelection,
                    defaultChannelIds,
                  )
            const channelSettings = createMorphologyChannelSettings(
              image,
              enabledChannelIds === undefined ? {} : { enabledChannelIds },
            )

            setMorphologyImage(image)
            setMorphologyChannelSettings((current) =>
              mergeMorphologyChannelSettings({
                baseChannelIds: image.channelLoaders.map((channel) => channel.info.id),
                currentSettings: current,
                nextBaseSettings: channelSettings,
              }),
            )
            setMorphologyState(morphologyLoadReady(image.url))
            appendDebugEvent('Morphology image ready')

            // Stretching R, G, and B independently shifts colour in brightfield
            // (H&E) images, so native RGB keeps its full 0-255 window.
            if (
              options.skipNativeRgbAutoContrast === true &&
              isNativeRgbMorphologyImage(image)
            ) {
              return
            }

            queueAutoContrast(
              channelsToAutoContrastOnLoad(image.channelLoaders, channelSettings),
              { requestId, signal: request.signal },
            )
          })
          .catch((error) => {
            if (isAbortError(error)) {
              return
            }

            if (!isCurrentDatasetLoad()) {
              return
            }

            setMorphologyState(
              morphologyLoadFailed(
                requestedUrl,
                createStructuredLoadError('Morphology image', error),
              ),
            )
            appendDebugEvent('Morphology image failed')
          })
      }
      invalidateLatestRequest({
        abortRef: datasetWarmupAbortRef,
        requestIdRef: datasetWarmupRequestIdRef,
      })
      abortActiveRequest(diagnosticsAbortRef)
      invalidateLatestRequest({
        abortRef: analysisEmbeddingAbortRef,
        requestIdRef: analysisEmbeddingRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: boundaryAbortRef,
        requestIdRef: boundaryRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: geneExpressionAbortRef,
        requestIdRef: geneExpressionRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: roiAbortRef,
        requestIdRef: roiRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: roiTranscriptExportAbortRef,
        requestIdRef: roiTranscriptExportRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: transcriptCapabilityAbortRef,
        requestIdRef: transcriptCapabilityRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      abortActiveRequest(roiGeneViewportWarmupAbortRef)
      invalidateLatestRequest({
        abortRef: magicLensAbortRef,
        requestIdRef: magicLensRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: cellDetailAbortRef,
        requestIdRef: cellDetailRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: cellTranscriptDistributionAbortRef,
        requestIdRef: cellTranscriptDistributionRequestIdRef,
      })
      invalidateLatestRequest({
        abortRef: customMorphologyLayerAbortRef,
        requestIdRef: customMorphologyLayerRequestIdRef,
      })
      clearTimeoutRef(magicLensDebounceRef)
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      roiGeneViewportWarmupKeyRef.current = null

      setDatasetUrl(requestedUrl)
      setDatasetPlatform(null)
      setDatasetAbout?.(null)
      setVisiumHdControlState(IDLE_VISIUM_HD_CONTROL_STATE)
      setSpatialDataControlState(IDLE_SPATIALDATA_CONTROL_STATE)
      setVisiumControlState(IDLE_VISIUM_CONTROL_STATE)
      setDatasetWarmupState(IDLE_DATASET_WARMUP_STATE)
      setCellFeatureMatrixCapabilityState(IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE)
      cellFeatureMatrixCapabilityKeyRef.current = null
      setOverviewCells([])
      setSpatialGridCells([])
      setGeneExpressionBatch(null)
      setGeneExpressionScaleDomain({ key: '', max: 0 })
      setMorphologyImage(null)
      setFlatMorphologyImage(null)
      setCustomMorphologyLayers([])
      setCustomImageLayerOpacities({})
      setCustomMorphologyLayerState(IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE)
      setMorphologyChannelSettings([])
      autoContrastChannelIdsRef.current.clear()
      setAutoContrastChannelIds([])
      setBoundaryElements([])
      setNucleusBoundaryElements?.([])
      setHoveredTranscript(null)
      setPinnedTranscript(null)
      setManualTranscriptExactRequestKey(null)
      setAnnotationColors({})
      setHiddenAnnotationIds([])
      setHiddenAnnotationSetIds([])
      setCellMetadataTracks([])
      setSelectedCellMetadataTrackId(
        shouldRestoreSharedState ? (sharedState?.cellMetadataTrackId ?? null) : null,
      )
      setAnnotationGroupState(IDLE_ANNOTATION_GROUP_STATE)
      setSelectedAnnotationGroupId(ALL_ANNOTATION_GROUP_ID)
      setAnalysisEmbeddingState(IDLE_ANALYSIS_EMBEDDING_STATE)
      setSelectedEmbeddingKind('umap')
      setObservationColorMode(
        shouldRestoreSharedState
          ? (sharedObservationColorMode({
              linkVersion: sharedState?.linkVersion,
              observationColorMode: sharedState?.observationColorMode,
              selectedGenes: sharedSelectedGenes,
            }) ?? 'transcript-count')
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
      setRoiState(IDLE_ROI_STATE)
      setRoiGeneStatsState(IDLE_ROI_GENE_STATS_STATE)
      setRoiGeneViewportWarmupState(IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE)
      setRoiTranscriptExportState(IDLE_ROI_TRANSCRIPT_EXPORT_STATE)
      setTranscriptCapabilityState(IDLE_TRANSCRIPT_CAPABILITY_STATE)
      setTranscriptLayerState(IDLE_TRANSCRIPT_LAYER_STATE)
      setMagicLensState(IDLE_MAGIC_LENS_STATE)
      setCellDetailState(IDLE_CELL_DETAIL_STATE)
      setCellTranscriptDistributionState(IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE)
      setMagicLensActive(
        shouldRestoreSharedState ? (sharedState?.magicLensActive ?? false) : false,
      )
      setSelectedCell(null)
      setSelectedGridCell(null)
      setCurrentViewportDetail(null)
      setViewportCellCount(null)
      setLoadState(datasetLoadStarted(requestedUrl))
      setMorphologyState(
        loadImage ? morphologyLoadStarted(requestedUrl) : IDLE_MORPHOLOGY_LOAD_STATE,
      )
      setDiagnosticsState(IDLE_DATASET_DIAGNOSTICS_STATE)
      setBoundaryState(IDLE_BOUNDARY_LOAD_STATE)
      setGenePanelState(IDLE_GENE_PANEL_STATE)
      setAnnotationState(IDLE_ANNOTATION_STATE)
      setGeneExpressionState(IDLE_GENE_EXPRESSION_STATE)
      magicLensLastDetailRef.current = null
      magicLensLastQueryKeyRef.current = null
      boundaryViewportKeyRef.current = null
      geneExpressionViewportKeyRef.current = null
      transcriptViewportKeyRef.current = null
      lastViewportDetailRef.current = null
      initialSharedRoiSelectionRef.current = shouldRestoreSharedState
        ? (sharedState?.roiSelection ?? null)
        : null

      try {
        const detection = await detectSpatialDataset(requestedUrl, {
          signal: request.signal,
        })

        if (!isCurrentDatasetLoad()) {
          return
        }

        // Dataset manifest defaults sit under a shared link for this dataset:
        // fields the link sets win, the rest come from the manifest.
        const manifest = detection.platform === 'unknown' ? undefined : detection.manifest
        const manifestDefaults = manifestDefaultsToShareableState(manifest?.defaults)
        setDatasetAbout?.(datasetManifestAbout(manifest))
        const restoreState: ShareableState = {
          ...manifestDefaults.state,
          ...(shouldRestoreSharedState ? sharedState : {}),
        }
        const restoredZPlane =
          restoreState.morphologyZPlane === undefined
            ? {}
            : { zPlane: restoreState.morphologyZPlane }

        if (manifest !== undefined) {
          appendDebugEvent(
            `Using dataset manifest ${shortDatasetLabel(manifest.url)}${
              manifest.name === undefined ? '' : ` (${manifest.name})`
            }`,
          )
          applyManifestDefaults(
            manifestDefaultsNotShared(
              manifestDefaults.state,
              shouldRestoreSharedState ? sharedState : null,
            ),
          )
        }

        for (const ignored of manifestDefaults.ignored) {
          appendFallbackNotice({
            source: 'Dataset overview',
            message: `The dataset manifest's ${ignored}, so the viewer default is used.`,
            action: 'Use one of the values listed in the dataset manifest documentation.',
            coalesceKey: `manifest-default:${requestedUrl}:${ignored}`,
          })
        }

        const loadAnnDataOverview = async (
          dataset: unknown,
          label: 'H5AD' | 'Visium' | 'SpatialData' | 'Atera',
        ): Promise<boolean> => {
          if (!isH5adLifecycleDataset(dataset)) {
            throw new Error(`Detected ${label} dataset does not expose AnnData readers.`)
          }

          const annDataset: H5adLifecycleDataset = dataset
          const [
            cells,
            genes,
            geneAliases,
            annotationGroups,
            embeddingOptions,
            metadataTracks,
          ] = await Promise.all([
            annDataset.overview(),
            annDataset.genePanel(),
            annDataset.geneAliases?.(),
            annDataset.annotationGroups(),
            annDataset.embeddingOptions(),
            annDataset.metadataTracks(),
          ])

          if (!isCurrentDatasetLoad()) {
            return false
          }

          const coalescePrefix = label.toLowerCase()
          const elementNoun = label === 'Visium' ? 'spots' : 'cells'
          setOverviewCells(overviewCellsToLayerData(cells))
          setGenePanelState(genePanelLoadReady(requestedUrl, genes, geneAliases))
          setAnnotationGroupState(
            annotationGroupLoadReady(requestedUrl, annotationGroups),
          )
          setSelectedAnnotationGroupId(NO_ANNOTATION_GROUP_ID)
          setCellMetadataTracks(metadataTracks)
          if (embeddingOptions.length > 0) {
            setAnalysisEmbeddingState(
              analysisEmbeddingOptionsReady(requestedUrl, embeddingOptions),
            )
            setSelectedEmbeddingKind(embeddingOptions[0]?.kind ?? 'umap')
          }
          initialShareableStateRef.current = null
          setLoadState(datasetLoadReady(requestedUrl, cells.length))
          appendDebugEvent(
            `${label} ready: ${cells.length.toLocaleString()} ${elementNoun}, ${genes.length.toLocaleString()} genes in ${formatElapsed(
              loadStartedAt,
            )}`,
          )
          appendDebugEvent(
            `${label} annotation sets ready: ${annotationGroups.length.toLocaleString()} groups`,
            { coalesceKey: `${coalescePrefix}-annotation-groups` },
          )
          appendDebugEvent(
            `${label} embeddings ready: ${embeddingOptions.length.toLocaleString()} obsm views`,
            { coalesceKey: `${coalescePrefix}-embedding-options` },
          )
          appendDebugEvent(
            `${label} metadata tracks ready: ${metadataTracks.length.toLocaleString()} numeric obs columns`,
            { coalesceKey: `${coalescePrefix}-metadata-tracks` },
          )
          recordTelemetry(
            telemetryEvent('dataset.load', 'success', {
              startedAt: loadStartedAt,
              detail: `${cells.length.toLocaleString()} ${label} ${elementNoun}`,
            }),
          )
          return true
        }

        // Standard Visium spots from an AnnData table, with the tissue image
        // loaded in the background once the spots are drawn.
        const loadVisiumOverview = async (
          dataset: VisiumLifecycleDataset,
          source: VisiumSource,
          summary: AnnDataVisiumSummary,
        ): Promise<void> => {
          const image = loadImage
            ? visiumImageForLoad(summary.images, restoreState.visiumImage)
            : null
          appendDebugEvent(
            `Visium library ${summary.libraryId}: ${summary.spotCount.toLocaleString()} spots${
              summary.offTissueSpotCount > 0
                ? ` (${summary.offTissueSpotCount.toLocaleString()} off tissue ${
                    summary.showOffTissue ? 'included' : 'hidden'
                  })`
                : ''
            }; ${formatVisiumUnits(summary.units)}${
              summary.libraryIds.length > 1
                ? `; ${(summary.libraryIds.length - 1).toLocaleString()} other libraries not shown`
                : ''
            }`,
          )

          if (visiumUnitsNeedNotice(summary.units)) {
            appendFallbackNotice({
              source: 'Dataset overview',
              message: `Visium micrometres per pixel is ${formatVisiumUnits(summary.units)}.`,
              action:
                'Distances and the scale bar are approximate. Include array_row and array_col in obs, or microns_per_pixel in the scale factors.',
              coalesceKey: `visium-units:${requestedUrl}`,
            })
          }

          setVisiumControlState(visiumControlReady(source, summary, image))

          if (!(await loadAnnDataOverview(dataset, 'Visium'))) {
            return
          }

          if (image === null) {
            setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
            return
          }

          setMorphologyState(morphologyLoadStarted(requestedUrl))
          void Promise.all([dataset.tissueImage(image), dataset.meta()])
            .then(([imageSource, meta]) => {
              if (!isCurrentDatasetLoad()) {
                return
              }

              const flatImage = flatMorphologyImageFromSource(imageSource, meta)

              if (flatImage === null) {
                setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
                return
              }

              setFlatMorphologyImage(flatImage)
              setMorphologyState(morphologyLoadReady(flatImage.url))
              appendDebugEvent(`Visium ${image} tissue image ready`)
            })
            .catch((error: unknown) => {
              if (isAbortError(error) || !isCurrentDatasetLoad()) {
                return
              }

              setMorphologyState(
                morphologyLoadFailed(
                  requestedUrl,
                  createStructuredLoadError('Morphology image', error),
                ),
              )
              appendDebugEvent('Visium tissue image failed')
            })
        }

        if (detection.platform === 'h5ad') {
          setDatasetPlatform('h5ad')
          setShowCellBoundaries(false)
          setShowNucleusBoundaries(false)
          setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
          setGenePanelState(genePanelLoadStarted(requestedUrl))
          const dataset = await getSpatialDataset(detection.baseUrl, {
            onH5adLoadProgress: appendDebugEvent,
          })
          // An .h5ad with `uns/spatial` is standard Visium; the file has to be
          // read to know.
          const visium = isVisiumLifecycleDataset(dataset)
            ? await dataset
                .setVisiumView(visiumViewFromShareable(restoreState))
                .visiumSummary()
            : null

          if (!isCurrentDatasetLoad()) {
            return
          }

          if (visium !== null && isVisiumLifecycleDataset(dataset)) {
            setDatasetPlatform('visium')
            setShowCellBoundaries(restoreState.showCellBoundaries ?? false)
            await loadVisiumOverview(dataset, 'h5ad', visium)
            return
          }

          await loadAnnDataOverview(dataset, 'H5AD')
          return
        }

        if (detection.platform === 'visium') {
          setDatasetPlatform('visium')
          setShowCellBoundaries(restoreState.showCellBoundaries ?? false)
          setShowNucleusBoundaries(false)
          setGenePanelState(genePanelLoadStarted(requestedUrl))
          const dataset = await getSpatialDataset(detection.baseUrl, {
            onH5adLoadProgress: appendDebugEvent,
          })

          if (!isVisiumLifecycleDataset(dataset)) {
            throw new Error('Detected Visium dataset does not expose spots.')
          }

          const visium = await dataset
            .setVisiumView(visiumViewFromShareable(restoreState))
            .visiumSummary()

          if (!isCurrentDatasetLoad()) {
            return
          }

          if (visium === null) {
            throw new Error('Visium output has no spot layout.')
          }

          await loadVisiumOverview(dataset, 'space-ranger', visium)
          return
        }

        if (detection.platform === 'spatialdata') {
          setDatasetPlatform('spatialdata')
          setShowCellBoundaries(restoreState.showCellBoundaries ?? true)
          setShowNucleusBoundaries(false)
          setGenePanelState(genePanelLoadStarted(requestedUrl))
          const dataset = await getSpatialDataset(detection.baseUrl, {
            onH5adLoadProgress: appendDebugEvent,
          })

          if (isSpatialDataSummaryDataset(dataset)) {
            const summary = await dataset.summary()
            setSpatialDataControlState(
              spatialDataControlReady(
                summary,
                spatialDataSelectionFor(detection.baseUrl),
              ),
            )
            appendDebugEvent(
              `SpatialData view: coordinate system ${summary.coordinateSystem}; image ${
                summary.image ?? 'none'
              }; table ${summary.table ?? 'none'}${
                summary.skippedElements.length > 0
                  ? `; not shown ${summary.skippedElements.join(', ')}`
                  : ''
              }`,
            )
          }

          if (!(await loadAnnDataOverview(dataset, 'SpatialData'))) {
            return
          }

          if (!loadImage) {
            setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
            return
          }

          loadMorphologyInBackground(
            async () => {
              const imageSource = await dataset.image()

              if (imageSource?.kind !== 'pyramid') {
                return null
              }

              return morphologyImageFromPyramidLoader(
                imageSource.loader.url,
                imageSource.loader,
                {
                  onFallback: appendFallbackNotice,
                  signal: request.signal,
                  ...(imageSource.openChannelLoader === undefined
                    ? {}
                    : { openImage: imageSource.openChannelLoader }),
                  ...restoredZPlane,
                },
              )
            },
            {
              ...(restoreState.morphologyEnabledChannelIds === undefined
                ? {}
                : { channelSelection: restoreState.morphologyEnabledChannelIds }),
              enableFirstChannelsByDefault: true,
              skipNativeRgbAutoContrast: true,
            },
          )
          return
        }

        if (detection.platform === 'atera') {
          setDatasetPlatform('atera')
          setShowCellBoundaries(restoreState.showCellBoundaries ?? true)
          setShowNucleusBoundaries(restoreState.showNucleusBoundaries ?? false)
          setGenePanelState(genePanelLoadStarted(requestedUrl))
          const dataset = await getSpatialDataset(detection.baseUrl, {
            onH5adLoadProgress: appendDebugEvent,
          })

          if (!(await loadAnnDataOverview(dataset, 'Atera'))) {
            return
          }

          if (!loadImage || !isAteraMorphologyDataset(dataset)) {
            setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
            return
          }

          // morphology_2d is a multi-file OME-TIFF like Xenium's
          // morphology_focus, so it opens through the same loader.
          loadMorphologyInBackground(
            async () => {
              const morphologyUrl = await dataset.morphologyUrl()

              return morphologyUrl === null
                ? null
                : loadMorphologyImage(requestedUrl, {
                    candidates: [morphologyUrl],
                    signal: request.signal,
                    onFallback: appendFallbackNotice,
                    ...restoredZPlane,
                  })
            },
            restoreState.morphologyEnabledChannelIds === undefined
              ? {}
              : { channelSelection: restoreState.morphologyEnabledChannelIds },
          )
          return
        }

        if (detection.platform === 'image') {
          setDatasetPlatform('image')
          setShowCellBoundaries(false)
          setShowNucleusBoundaries(false)
          setMorphologyState(morphologyLoadStarted(detection.imageUrl))
          const dataset = await getSpatialDataset(detection.baseUrl)
          const [meta, imageSource] = await Promise.all([dataset.meta(), dataset.image()])

          if (!isCurrentDatasetLoad()) {
            return
          }

          if (imageSource?.kind !== 'pyramid') {
            throw new Error('Image-only sources must expose a tiled TIFF pyramid.')
          }

          const image = await morphologyImageFromPyramidLoader(
            detection.imageUrl,
            imageSource.loader,
            {
              onFallback: appendFallbackNotice,
              signal: request.signal,
              ...(imageSource.openChannelLoader === undefined
                ? {}
                : { openImage: imageSource.openChannelLoader }),
              ...restoredZPlane,
            },
          )

          if (!isCurrentDatasetLoad()) {
            return
          }

          const defaultChannelIds = defaultEnabledChannelIds(image.channelLoaders)
          const channelSelection = restoreState.morphologyEnabledChannelIds
          const enabledChannelIds =
            channelSelection !== undefined
              ? resolveMorphologyChannelSelection(
                  image.channelLoaders,
                  channelSelection,
                  defaultChannelIds,
                )
              : shouldRestoreSharedState
                ? undefined
                : defaultChannelIds
          const channelSettings = createMorphologyChannelSettings(
            image,
            enabledChannelIds === undefined ? {} : { enabledChannelIds },
          )

          setMorphologyImage(image)
          setMorphologyChannelSettings((current) =>
            mergeMorphologyChannelSettings({
              baseChannelIds: image.channelLoaders.map((channel) => channel.info.id),
              currentSettings: current,
              nextBaseSettings: channelSettings,
            }),
          )
          queueAutoContrast(
            channelsToAutoContrastOnLoad(image.channelLoaders, channelSettings),
            { requestId, signal: request.signal },
          )
          setMorphologyState(morphologyLoadReady(detection.imageUrl))
          initialShareableStateRef.current = null
          setLoadState(datasetLoadReady(requestedUrl, 0))
          appendDebugEvent(
            `Image ready: ${Math.round(
              meta.extent.maxX - meta.extent.minX,
            ).toLocaleString()} x ${Math.round(
              meta.extent.maxY - meta.extent.minY,
            ).toLocaleString()} µm in ${formatElapsed(loadStartedAt)}`,
          )
          recordTelemetry(
            telemetryEvent('dataset.load', 'success', {
              startedAt: loadStartedAt,
              detail: 'image-only source',
            }),
          )
          return
        }

        if (detection.platform === 'visium-hd') {
          setDatasetPlatform('visium-hd')
          setShowCellBoundaries(restoreState.showCellBoundaries ?? false)
          setShowNucleusBoundaries(restoreState.showNucleusBoundaries ?? false)
          const dataset = await getSpatialDataset(detection.baseUrl)

          if (!isVisiumHdOverviewDataset(dataset)) {
            throw new Error('Detected Visium HD dataset does not expose binned outputs.')
          }

          if (dataset.genePanel !== undefined) {
            setGenePanelState(genePanelLoadStarted(requestedUrl))
            void dataset
              .genePanel(undefined, { signal: request.signal })
              .then((genes) => {
                if (!isCurrentDatasetLoad()) {
                  return
                }

                setGenePanelState(genePanelLoadReady(requestedUrl, genes))
                appendDebugEvent(
                  `Visium HD gene panel ready: ${genes.length.toLocaleString()} genes`,
                )
              })
              .catch((error) => {
                if (isAbortError(error)) {
                  return
                }

                if (!isCurrentDatasetLoad()) {
                  return
                }

                setGenePanelState(
                  genePanelLoadFailed(
                    requestedUrl,
                    createStructuredLoadError('Gene panel', error),
                  ),
                )
                appendDebugEvent('Visium HD gene panel failed')
              })
          }

          const [overview, meta] = await Promise.all([
            dataset.readBinnedOverview(),
            dataset.meta(),
          ])

          if (!isCurrentDatasetLoad()) {
            return
          }

          setSpatialGridCells(visiumHdOverviewToGridCellLayerData(overview))
          setVisiumHdControlState(
            visiumHdControlStateFromOverview(
              requestedUrl,
              detection.bins.map((bin) => bin.binSizeMicrometers),
              overview,
            ),
          )
          initialShareableStateRef.current = null
          setLoadState(datasetLoadReady(requestedUrl, overview.gridCells.ids.length))
          appendDebugEvent(
            `Visium HD ready: ${overview.gridCells.ids.length.toLocaleString()} ${overview.binSizeMicrometers} µm bins in ${formatElapsed(
              loadStartedAt,
            )}`,
          )
          recordTelemetry(
            telemetryEvent('dataset.load', 'success', {
              startedAt: loadStartedAt,
              detail: `${overview.gridCells.ids.length.toLocaleString()} Visium HD bins`,
            }),
          )

          if (loadImage) {
            void dataset
              .image()
              .then((imageSource) => {
                if (!isCurrentDatasetLoad()) {
                  return
                }

                const flatImage = flatMorphologyImageFromSource(imageSource, meta)

                if (flatImage === null) {
                  setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
                  return
                }

                setFlatMorphologyImage(flatImage)
                setMorphologyState(morphologyLoadReady(flatImage.url))
                appendDebugEvent('Visium HD tissue image ready')
              })
              .catch((error) => {
                if (isAbortError(error)) {
                  return
                }

                if (!isCurrentDatasetLoad()) {
                  return
                }

                setMorphologyState(
                  morphologyLoadFailed(
                    requestedUrl,
                    createStructuredLoadError('Morphology image', error),
                  ),
                )
                appendDebugEvent('Visium HD tissue image failed')
              })
          }

          return
        }

        if (detection.platform === 'unknown') {
          throw datasetDetectionError(detection.checked)
        }

        setDatasetPlatform('xenium')
        setShowCellBoundaries(restoreState.showCellBoundaries ?? true)
        setShowNucleusBoundaries(restoreState.showNucleusBoundaries ?? false)
        setAnnotationGroupState(annotationGroupLoadStarted(requestedUrl))
        setGenePanelState(genePanelLoadStarted(requestedUrl))
        startDatasetWarmup(requestedUrl, requestId)

        void loadGenePanel(requestedUrl, {
          signal: request.signal,
          onFallback: appendFallbackNotice,
        })
          .then((genes) => {
            if (!isCurrentDatasetLoad()) {
              return
            }

            setGenePanelState(genePanelLoadReady(requestedUrl, genes))
            appendDebugEvent(`Gene panel ready: ${genes.length.toLocaleString()} genes`)
          })
          .catch((error) => {
            if (isAbortError(error)) {
              return
            }

            if (!isCurrentDatasetLoad()) {
              return
            }

            setGenePanelState(
              genePanelLoadFailed(
                requestedUrl,
                createStructuredLoadError('Gene panel', error),
              ),
            )
            appendDebugEvent('Gene panel failed')
          })

        void loadAnnotationGroups(requestedUrl, { signal: request.signal })
          .then((groups) => {
            if (!isCurrentDatasetLoad()) {
              return
            }

            setAnnotationGroupState(annotationGroupLoadReady(requestedUrl, groups))
            setSelectedAnnotationGroupId(
              defaultAnnotationGroupId(groups) ?? ALL_ANNOTATION_GROUP_ID,
            )
            appendDebugEvent(
              `Annotation sets ready: ${groups.length.toLocaleString()} groups`,
            )
          })
          .catch((error) => {
            if (isAbortError(error)) {
              return
            }

            if (!isCurrentDatasetLoad()) {
              return
            }

            setAnnotationGroupState(
              annotationGroupLoadFailed(
                requestedUrl,
                createStructuredLoadError('Annotations', error),
              ),
            )
            appendDebugEvent('Annotation sets failed')
          })

        const cells = await loadDatasetOverview(requestedUrl, {
          includeCellIds: true,
          limit: null,
          signal: request.signal,
          onFallback: appendFallbackNotice,
        })

        if (!isCurrentDatasetLoad()) {
          return
        }

        setOverviewCells(overviewCellsToLayerData(cells))
        initialShareableStateRef.current = null
        setLoadState(datasetLoadReady(requestedUrl, cells.length))
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

        loadMorphologyInBackground(
          () =>
            loadMorphologyImage(requestedUrl, {
              signal: request.signal,
              onFallback: appendFallbackNotice,
              ...restoredZPlane,
            }),
          restoreState.morphologyEnabledChannelIds === undefined
            ? {}
            : { channelSelection: restoreState.morphologyEnabledChannelIds },
        )
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        if (!isCurrentDatasetLoad()) {
          return
        }

        setLoadState(
          datasetLoadFailed(
            requestedUrl,
            createStructuredLoadError('Dataset overview', error),
          ),
        )
        setDatasetPlatform(null)
        setVisiumHdControlState(IDLE_VISIUM_HD_CONTROL_STATE)
        setSpatialDataControlState(IDLE_SPATIALDATA_CONTROL_STATE)
        setVisiumControlState(IDLE_VISIUM_CONTROL_STATE)
        setSpatialGridCells([])
        setFlatMorphologyImage(null)
        initialShareableStateRef.current = null
        appendDebugEvent('Dataset load failed')
        recordTelemetry(
          telemetryEvent('dataset.load', 'failure', {
            startedAt: loadStartedAt,
            detail: readErrorMessage(error),
          }),
        )
        invalidateLatestRequest({
          abortRef: datasetWarmupAbortRef,
          requestIdRef: datasetWarmupRequestIdRef,
        })
        setDatasetWarmupState(IDLE_DATASET_WARMUP_STATE)
        setCellFeatureMatrixCapabilityState(IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE)
        cellFeatureMatrixCapabilityKeyRef.current = null
        setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
        setGenePanelState(IDLE_GENE_PANEL_STATE)
        setAnnotationGroupState(IDLE_ANNOTATION_GROUP_STATE)
        setTranscriptCapabilityState(IDLE_TRANSCRIPT_CAPABILITY_STATE)
        setTranscriptLayerState(IDLE_TRANSCRIPT_LAYER_STATE)
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

    const timeout = window.setTimeout(() => {
      void startDatasetLoadRef.current?.(
        initialDatasetUrl,
        initialShouldLoadMorphologyRef.current,
      )
    }, 0)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    initialShareableState.datasetUrl,
    initialShouldLoadMorphologyRef,
    startDatasetLoadRef,
  ])

  return { handleDatasetSubmit }
}

export function mergeMorphologyChannelSettings(options: {
  readonly baseChannelIds: readonly string[]
  readonly currentSettings: readonly MorphologyChannelSetting[]
  readonly nextBaseSettings: readonly MorphologyChannelSetting[]
}): readonly MorphologyChannelSetting[] {
  const baseChannelIds = new Set(options.baseChannelIds)
  const preservedSettings = options.currentSettings.filter(
    (setting) => !baseChannelIds.has(setting.id),
  )

  return [...options.nextBaseSettings, ...preservedSettings]
}

function isH5adLifecycleDataset(dataset: unknown): dataset is H5adLifecycleDataset {
  return (
    hasFunction(dataset, 'overview') &&
    hasFunction(dataset, 'genePanel') &&
    hasFunction(dataset, 'annotationGroups') &&
    hasFunction(dataset, 'embeddingOptions') &&
    hasFunction(dataset, 'metadataTracks')
  )
}

function isNativeRgbMorphologyImage(image: MorphologyImage): boolean {
  return (
    image.channelLoaders.length === 3 &&
    image.channelLoaders.every((channel) => channel.info.alphaFromIntensity === false)
  )
}

function isAteraMorphologyDataset(dataset: unknown): dataset is AteraMorphologyDataset {
  return hasFunction(dataset, 'morphologyUrl')
}

export function isVisiumLifecycleDataset(
  dataset: unknown,
): dataset is VisiumLifecycleDataset {
  return (
    isH5adLifecycleDataset(dataset) &&
    hasFunction(dataset, 'meta') &&
    hasFunction(dataset, 'setVisiumView') &&
    hasFunction(dataset, 'visiumSummary') &&
    hasFunction(dataset, 'tissueImage')
  )
}

function isSpatialDataSummaryDataset(
  dataset: unknown,
): dataset is SpatialDataSummaryDataset {
  return hasFunction(dataset, 'summary')
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
