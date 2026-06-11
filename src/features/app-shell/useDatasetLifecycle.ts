import { useEffect, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerTranscriptHoverDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { ALL_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import type { WarmDatasetForRoiResult } from '../../data/datasetWarmup'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import { type RoiSelection } from '../../data/roiSelection'
import type { ShareableState } from '../../data/shareableState'
import { normalizeTranscriptExactPointLimit } from '../../data/transcriptOverlay'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { AnalysisEmbeddingKind } from '../../data/analysisEmbeddings'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import {
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  overviewCellsToLayerData,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
  type OverviewCellDatum,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import type {
  CellDetailState,
  CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import type { AnalysisEmbeddingState } from '../analysis/analysisEmbeddingModel'
import type {
  AnnotationGroupState,
  AnnotationState,
} from '../annotations/annotationModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
} from '../genes/geneControlsModel'
import {
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
} from '../genes/geneControlsModel'
import {
  createMorphologyChannelSettings,
  type MorphologyChannelSetting,
} from '../morphology/morphologyChannels'
import type { MagicLensState } from '../roi/magicLensModel'
import type {
  RoiGeneStatsState,
  RoiGeneViewportWarmupState,
  RoiState,
  RoiTranscriptExportState,
} from '../roi/roiModel'
import {
  parseTranscriptDensityColorScale,
  parseTranscriptPointColorMode,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import type {
  AnnotationGroupLoader,
  DatasetOverviewLoader,
  DatasetWarmupLoader,
  GenePanelLoader,
  MorphologyImageLoader,
} from './appDependencies'
import {
  abortActiveRequest,
  clearTimeoutRef,
  formatElapsed,
  isAbortError,
  readTimestamp,
  shortDatasetLabel,
  type DebugLogAppendOptions,
} from './appRuntimeModel'
import { parseObservationColorMode } from './appShellModel'
import type {
  BoundaryLoadState,
  CellFeatureMatrixCapabilityState,
  DatasetDiagnosticsState,
  DatasetLoadState,
  DatasetWarmupState,
  MorphologyLoadState,
} from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'

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

interface UseDatasetLifecycleOptions {
  readonly analysisEmbeddingAbortRef: MutableRef<AbortController | null>
  readonly analysisEmbeddingRequestIdRef: MutableRef<number>
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly autoContrastChannelIdsRef: MutableRef<Set<string>>
  readonly boundaryAbortRef: MutableRef<AbortController | null>
  readonly boundaryRequestIdRef: MutableRef<number>
  readonly boundaryViewportKeyRef: MutableRef<string | null>
  readonly cellDetailAbortRef: MutableRef<AbortController | null>
  readonly cellDetailRequestIdRef: MutableRef<number>
  readonly cellFeatureMatrixCapabilityKeyRef: MutableRef<string | null>
  readonly cellTranscriptDistributionAbortRef: MutableRef<AbortController | null>
  readonly cellTranscriptDistributionRequestIdRef: MutableRef<number>
  readonly datasetAbortRef: MutableRef<AbortController | null>
  readonly datasetWarmupAbortRef: MutableRef<AbortController | null>
  readonly diagnosticsAbortRef: MutableRef<AbortController | null>
  readonly didApplyInitialDatasetUrlRef: MutableRef<boolean>
  readonly geneExpressionAbortRef: MutableRef<AbortController | null>
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionRequestIdRef: MutableRef<number>
  readonly geneExpressionViewportKeyRef: MutableRef<string | null>
  readonly initialShareableState: ShareableState
  readonly initialShareableStateRef: MutableRef<ShareableState | null>
  readonly initialSharedRoiSelectionRef: MutableRef<RoiSelection | null>
  readonly initialShouldLoadMorphologyRef: MutableRef<boolean>
  readonly lastViewportDetailRef: MutableRef<ViewerViewportDetail | null>
  readonly loadAnnotationGroups: AnnotationGroupLoader
  readonly loadDatasetOverview: DatasetOverviewLoader
  readonly loadGenePanel: GenePanelLoader
  readonly loadMorphologyImage: MorphologyImageLoader
  readonly loadRequestIdRef: MutableRef<number>
  readonly magicLensAbortRef: MutableRef<AbortController | null>
  readonly magicLensDebounceRef: MutableRef<number | null>
  readonly magicLensLastDetailRef: MutableRef<ViewerMagicLensDetail | null>
  readonly magicLensLastQueryKeyRef: MutableRef<string | null>
  readonly magicLensRequestIdRef: MutableRef<number>
  readonly queueAutoContrast: QueueAutoContrast
  readonly recordTelemetry: (event: TelemetryEvent) => void
  readonly roiAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupKeyRef: MutableRef<string | null>
  readonly roiGeneViewportWarmupTimeoutRef: MutableRef<number | null>
  readonly roiRequestIdRef: MutableRef<number>
  readonly roiTranscriptExportAbortRef: MutableRef<AbortController | null>
  readonly roiTranscriptExportRequestIdRef: MutableRef<number>
  readonly setAnalysisEmbeddingState: Setter<AnalysisEmbeddingState<StructuredLoadError>>
  readonly setAnnotationColors: Setter<Readonly<Record<string, string>>>
  readonly setAnnotationGroupState: Setter<AnnotationGroupState<StructuredLoadError>>
  readonly setAnnotationState: Setter<AnnotationState<StructuredLoadError>>
  readonly setAutoContrastChannelIds: Setter<readonly string[]>
  readonly setBoundaryElements: Setter<readonly SpatialElement[]>
  readonly setBoundaryState: Setter<BoundaryLoadState<StructuredLoadError>>
  readonly setCellDetailState: Setter<CellDetailState<StructuredLoadError>>
  readonly setCellFeatureMatrixCapabilityState: Setter<CellFeatureMatrixCapabilityState>
  readonly setCellTranscriptDistributionState: Setter<
    CellTranscriptDistributionState<StructuredLoadError>
  >
  readonly setCurrentViewportDetail: Setter<ViewerViewportDetail | null>
  readonly setDatasetUrl: (datasetUrl: string) => void
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
  readonly setSelectedEmbeddingKind: Setter<AnalysisEmbeddingKind>
  readonly setSelectedGenes: Setter<readonly string[]>
  readonly setTranscriptCapabilityState: Setter<
    TranscriptCapabilityState<StructuredLoadError>
  >
  readonly setTranscriptDensityColorScale: Setter<TranscriptDensityColorScale>
  readonly setTranscriptExactPointLimit: Setter<number>
  readonly setTranscriptLayerState: Setter<TranscriptLayerState<StructuredLoadError>>
  readonly setTranscriptPointColorMode: Setter<TranscriptPointColorMode>
  readonly setViewportCellCount: Setter<number | null>
  readonly startDatasetLoadRef: MutableRef<
    ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null
  >
  readonly transcriptAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityRequestIdRef: MutableRef<number>
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptExactPointLimit: number
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptRequestIdRef: MutableRef<number>
  readonly transcriptViewportKeyRef: MutableRef<string | null>
  readonly warmDatasetForRoi: DatasetWarmupLoader
}

interface UseDatasetLifecycleResult {
  readonly handleDatasetSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}

export function useDatasetLifecycle({
  analysisEmbeddingAbortRef,
  analysisEmbeddingRequestIdRef,
  appendDebugEvent,
  autoContrastChannelIdsRef,
  boundaryAbortRef,
  boundaryRequestIdRef,
  boundaryViewportKeyRef,
  cellDetailAbortRef,
  cellDetailRequestIdRef,
  cellFeatureMatrixCapabilityKeyRef,
  cellTranscriptDistributionAbortRef,
  cellTranscriptDistributionRequestIdRef,
  datasetAbortRef,
  datasetWarmupAbortRef,
  diagnosticsAbortRef,
  didApplyInitialDatasetUrlRef,
  geneExpressionAbortRef,
  geneExpressionColorScale,
  geneExpressionRequestIdRef,
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
  loadRequestIdRef,
  magicLensAbortRef,
  magicLensDebounceRef,
  magicLensLastDetailRef,
  magicLensLastQueryKeyRef,
  magicLensRequestIdRef,
  queueAutoContrast,
  recordTelemetry,
  roiAbortRef,
  roiGeneViewportWarmupAbortRef,
  roiGeneViewportWarmupKeyRef,
  roiGeneViewportWarmupTimeoutRef,
  roiRequestIdRef,
  roiTranscriptExportAbortRef,
  roiTranscriptExportRequestIdRef,
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
  transcriptCapabilityRequestIdRef,
  transcriptDensityColorScale,
  transcriptExactPointLimit,
  transcriptPointColorMode,
  transcriptRequestIdRef,
  transcriptViewportKeyRef,
  warmDatasetForRoi,
}: UseDatasetLifecycleOptions): UseDatasetLifecycleResult {
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
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
  ])

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
        loadRequestIdRef.current !== requestId ||
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
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        applyCellFeatureMatrixCapability(result)
        setDatasetWarmupState({ status: 'ready', url: requestedUrl })
        appendDebugEvent(`Dataset prep ready (${formatElapsed(warmupStartedAt)})`)
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
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
      const requestId = loadRequestIdRef.current + 1
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
      loadRequestIdRef.current = requestId
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
      boundaryRequestIdRef.current += 1
      analysisEmbeddingRequestIdRef.current += 1
      geneExpressionRequestIdRef.current += 1
      roiRequestIdRef.current += 1
      roiTranscriptExportRequestIdRef.current += 1
      transcriptCapabilityRequestIdRef.current += 1
      transcriptRequestIdRef.current += 1
      magicLensRequestIdRef.current += 1
      cellDetailRequestIdRef.current += 1
      cellTranscriptDistributionRequestIdRef.current += 1
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
          if (loadRequestIdRef.current !== requestId) {
            return
          }

          setGenePanelState({ status: 'ready', url: requestedUrl, genes })
          appendDebugEvent(`Gene panel ready: ${genes.length.toLocaleString()} genes`)
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (loadRequestIdRef.current !== requestId) {
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
          if (loadRequestIdRef.current !== requestId) {
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

          if (loadRequestIdRef.current !== requestId) {
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

        if (loadRequestIdRef.current !== requestId) {
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
            if (loadRequestIdRef.current !== requestId) {
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

            if (loadRequestIdRef.current !== requestId) {
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

        if (loadRequestIdRef.current !== requestId) {
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
