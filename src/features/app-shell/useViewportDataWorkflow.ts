import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  geneExpressionRequestKey,
  geneExpressionWaitingKey,
  planGeneExpressionLod,
  type GeneExpressionDetailMode,
} from '../../data/geneExpressionLod'
import { formatGeneExpressionStageTiming } from '../../data/geneExpressionTiming'
import {
  shareableViewStateKey,
  viewStateToShareable,
  type ShareableViewState,
} from '../../data/shareableState'
import {
  formatRuntimeMemorySnapshot,
  readRuntimeMemorySnapshot,
} from '../../data/runtimeMemory'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { BBox } from '../../data/coords'
import type { ElementBatch, SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import {
  boundaryViewportKey,
  shouldLoadBoundaryPolygons,
} from '../../rendering/boundaryViewport'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayers'
import type { BoundaryElementsLoader, GeneExpressionLoader } from './appDependencies'
import {
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  startLatestRequest,
  type DebugLogAppendOptions,
  type LatestRequestRefs,
} from './appRuntimeModel'
import type { BoundaryLoadState, DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  formatGeneExpressionTiming,
  geneExpressionModeLabel,
  type GeneExpressionState,
} from '../genes/geneControlsModel'

type Setter<T> = Dispatch<SetStateAction<T>>

interface MutableRef<T> {
  current: T
}

interface BoundaryRequestRefs extends LatestRequestRefs {
  readonly boundaryViewportKeyRef: MutableRef<string | null>
}

interface GeneExpressionRequestRefs extends LatestRequestRefs {
  readonly geneExpressionViewportKeyRef: MutableRef<string | null>
}

interface ViewportDataWorkflowRequests {
  readonly boundary: BoundaryRequestRefs
  readonly geneExpression: GeneExpressionRequestRefs
  readonly lastViewportDetailRef: MutableRef<ViewerViewportDetail | null>
}

interface ViewportDataWorkflowLoaders {
  readonly boundaryElements: BoundaryElementsLoader
  readonly nucleusBoundaryElements?: BoundaryElementsLoader
  readonly geneExpression: GeneExpressionLoader
}

interface ViewportDataWorkflowSetters {
  readonly setBoundaryElements: Setter<readonly SpatialElement[]>
  readonly setNucleusBoundaryElements?: Setter<readonly SpatialElement[]>
  readonly setBoundaryState: Setter<BoundaryLoadState<StructuredLoadError>>
  readonly setCurrentViewportDetail: Setter<ViewerViewportDetail | null>
  readonly setGeneExpressionBatch: Setter<GeneExpressionBatch | null>
  readonly setGeneExpressionState: Setter<GeneExpressionState<StructuredLoadError>>
  readonly setShareableViewState: Setter<ShareableViewState | undefined>
}

interface UseViewportDataWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly boundaryCellLimit: number
  readonly boundaryLoadingEnabled?: boolean
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionDisabledMessage?: string | undefined
  readonly geneExpressionLoadingEnabled?: boolean
  readonly geneExpressionScaleKey: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly loaders: ViewportDataWorkflowLoaders
  readonly overviewExtent: BBox | null
  readonly recordTelemetry: (event: TelemetryEvent) => void
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
  readonly requests: ViewportDataWorkflowRequests
  readonly selectedGenes: readonly string[]
  readonly setters: ViewportDataWorkflowSetters
}

interface UseViewportDataWorkflowResult {
  readonly handleViewportChange: (detail: ViewerViewportDetail) => void
}

export function useViewportDataWorkflow({
  appendDebugEvent,
  boundaryCellLimit,
  boundaryLoadingEnabled = true,
  geneExpressionDetailMode,
  geneExpressionDisabledMessage,
  geneExpressionLoadingEnabled = true,
  geneExpressionScaleKey,
  geneExpressionScoreMode,
  loadState,
  loaders,
  overviewExtent,
  recordTelemetry,
  rememberGeneExpressionScaleMax,
  requests,
  selectedGenes,
  setters,
}: UseViewportDataWorkflowOptions): UseViewportDataWorkflowResult {
  const {
    boundary: {
      abortRef: boundaryAbortRef,
      requestIdRef: boundaryRequestIdRef,
      boundaryViewportKeyRef,
    },
    geneExpression: {
      abortRef: geneExpressionAbortRef,
      requestIdRef: geneExpressionRequestIdRef,
      geneExpressionViewportKeyRef,
    },
    lastViewportDetailRef,
  } = requests
  const {
    boundaryElements: loadBoundaryElements,
    geneExpression: loadGeneExpression,
    nucleusBoundaryElements: loadNucleusBoundaryElements,
  } = loaders
  const {
    setBoundaryElements,
    setBoundaryState,
    setCurrentViewportDetail,
    setGeneExpressionBatch,
    setGeneExpressionState,
    setNucleusBoundaryElements,
    setShareableViewState,
  } = setters
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

      const shouldLoadBoundaries =
        boundaryLoadingEnabled &&
        shouldLoadBoundaryPolygons(detail, { cellLimit: boundaryCellLimit })

      if (!shouldLoadBoundaries) {
        if (boundaryLoadingEnabled && detail.visibleCellCount > 0) {
          appendDebugEvent(
            `Boundaries deferred: ${detail.visibleCellCount.toLocaleString()} visible cells exceed the ${boundaryCellLimit.toLocaleString()} boundary limit. Zoom in or raise Boundary limit to load true polygons.`,
            { coalesceKey: 'boundary-query' },
          )
        }

        invalidateLatestRequest({
          abortRef: boundaryAbortRef,
          requestIdRef: boundaryRequestIdRef,
        })
        boundaryViewportKeyRef.current = null
        setBoundaryElements((current) => (current.length === 0 ? current : []))
        setNucleusBoundaryElements?.((current) => (current.length === 0 ? current : []))
        setBoundaryState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
      } else {
        const requestKey = boundaryViewportKey(loadState.url, detail.bbox)

        if (requestKey !== boundaryViewportKeyRef.current) {
          const request = startLatestRequest({
            abortRef: boundaryAbortRef,
            requestIdRef: boundaryRequestIdRef,
          })
          boundaryViewportKeyRef.current = requestKey
          setBoundaryState({ status: 'loading', url: loadState.url })
          const boundaryStartedAt = readTimestamp()
          appendDebugEvent(
            `Boundaries started: ${detail.visibleCellCount.toLocaleString()} visible cells`,
            { coalesceKey: 'boundary-query' },
          )

          const loadCellElements = loadProfiledBoundaryElements(
            loadBoundaryElements,
            loadState.url,
            detail.bbox,
            { signal: request.signal },
          )
          const loadNucleusElements =
            loadNucleusBoundaryElements === undefined
              ? Promise.resolve(profiledBoundaryElements({ elements: [] }, 0))
              : loadProfiledBoundaryElements(
                  loadNucleusBoundaryElements,
                  loadState.url,
                  detail.bbox,
                  { signal: request.signal },
                )

          void Promise.all([loadCellElements, loadNucleusElements])
            .then((batch) => {
              if (!request.isCurrent()) {
                return
              }

              const [cellResult, nucleusResult] = batch
              const cellBatch = cellResult.batch
              const nucleusBatch = nucleusResult.batch
              const profileDetail = formatBoundaryProfileDetail(
                cellResult,
                nucleusResult,
                loadNucleusBoundaryElements !== undefined,
              )

              setBoundaryElements(cellBatch.elements)
              setNucleusBoundaryElements?.(nucleusBatch.elements)
              setBoundaryState({
                status: 'ready',
                url: loadState.url,
                cellCount: cellBatch.elements.length,
              })
              recordTelemetry(
                telemetryEvent('viewport.boundaries.load', 'success', {
                  startedAt: boundaryStartedAt,
                  detail: profileDetail,
                }),
              )
              appendDebugEvent(`Boundaries ready: ${profileDetail}`, {
                coalesceKey: 'boundary-query',
              })
            })
            .catch((error) => {
              if (isAbortError(error)) {
                return
              }

              if (!request.isCurrent()) {
                return
              }

              setBoundaryElements([])
              setNucleusBoundaryElements?.([])
              setBoundaryState({
                status: 'error',
                url: loadState.url,
                error: createStructuredLoadError('Cell boundaries', error),
              })
              recordTelemetry(
                telemetryEvent('viewport.boundaries.load', 'failure', {
                  startedAt: boundaryStartedAt,
                  detail: readErrorMessage(error),
                }),
              )
              appendDebugEvent('Boundary load failed', {
                coalesceKey: 'boundary-query',
              })
            })
            .finally(() => {
              request.complete()
            })
        }
      }

      if (!geneExpressionLoadingEnabled || selectedGenes.length === 0) {
        invalidateLatestRequest({
          abortRef: geneExpressionAbortRef,
          requestIdRef: geneExpressionRequestIdRef,
        })
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionBatch(null)
        setGeneExpressionState((current) => {
          if (selectedGenes.length > 0 && geneExpressionDisabledMessage !== undefined) {
            return current.status === 'waiting' &&
              current.message === geneExpressionDisabledMessage
              ? current
              : { status: 'waiting', message: geneExpressionDisabledMessage }
          }

          return current.status === 'idle' ? current : { status: 'idle' }
        })
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

        invalidateLatestRequest({
          abortRef: geneExpressionAbortRef,
          requestIdRef: geneExpressionRequestIdRef,
        })
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

      const expressionRequest = startLatestRequest({
        abortRef: geneExpressionAbortRef,
        requestIdRef: geneExpressionRequestIdRef,
      })
      const expressionStartedAt = readTimestamp()
      geneExpressionViewportKeyRef.current = expressionKey
      setGeneExpressionState({
        status: 'loading',
        url: loadState.url,
        genes: selectedGenes,
        mode: expressionPlan.mode,
        visibleCellCount: expressionPlan.sourceCellCount,
      })
      appendDebugEvent(
        `${geneExpressionModeLabel(expressionPlan.mode)} started: ${selectedGenes.join(', ')}; ${expressionPlan.sourceCellCount.toLocaleString()} source cells, limit ${expressionPlan.cellLimit.toLocaleString()}, stride ${expressionPlan.sampleStride.toLocaleString()}`,
        { coalesceKey: 'gene-expression-query' },
      )

      const expressionOptions: Parameters<GeneExpressionLoader>[3] = {
        signal: expressionRequest.signal,
        limit: expressionPlan.cellLimit,
        sampleStride: expressionPlan.sampleStride,
        onStageTiming: (timing) => {
          if (expressionRequest.signal.aborted || !expressionRequest.isCurrent()) {
            return
          }

          appendDebugEvent(
            `Expression stage: ${formatGeneExpressionStageTiming(timing)}`,
            { coalesceKey: `gene-expression-stage-${timing.stage}` },
          )
        },
      }
      const loadExpressionBatch = async (): Promise<GeneExpressionBatch> => {
        try {
          return await loadGeneExpression(
            loadState.url,
            expressionPlan.bbox,
            selectedGenes,
            expressionOptions,
          )
        } catch (error) {
          if (
            expressionRequest.signal.aborted ||
            !isRetryableExpressionLoadError(error)
          ) {
            throw error
          }

          appendDebugEvent('Gene expression load failed; retrying', {
            coalesceKey: 'gene-expression-query',
          })

          return loadGeneExpression(
            loadState.url,
            expressionPlan.bbox,
            selectedGenes,
            expressionOptions,
          )
        }
      }

      void loadExpressionBatch()
        .then((batch) => {
          if (!expressionRequest.isCurrent()) {
            return
          }

          const timingDetail = formatGeneExpressionTiming(batch.timing)
          const memoryDetail = currentMemoryDetail()

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
              detail: [
                `${geneExpressionModeLabel(expressionPlan.mode)}: ${batch.cells.length.toLocaleString()} positive cells across ${expressionPlan.sourceCellCount.toLocaleString()} source cells (${timingDetail})`,
                memoryDetail === undefined ? undefined : `memory ${memoryDetail}`,
              ]
                .filter((part): part is string => part !== undefined)
                .join('; '),
            }),
          )
          appendDebugEvent(
            `${geneExpressionModeLabel(expressionPlan.mode)} ready: ${batch.cells.length.toLocaleString()} positive cells in ${formatElapsed(
              expressionStartedAt,
            )} (${formatProfileTimingDetail(timingDetail, memoryDetail)})`,
            { coalesceKey: 'gene-expression-query' },
          )
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (!expressionRequest.isCurrent()) {
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
          expressionRequest.complete()
        })
    },
    [
      appendDebugEvent,
      boundaryAbortRef,
      boundaryCellLimit,
      boundaryLoadingEnabled,
      boundaryRequestIdRef,
      boundaryViewportKeyRef,
      geneExpressionAbortRef,
      geneExpressionDetailMode,
      geneExpressionDisabledMessage,
      geneExpressionLoadingEnabled,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
      geneExpressionRequestIdRef,
      geneExpressionViewportKeyRef,
      lastViewportDetailRef,
      loadBoundaryElements,
      loadNucleusBoundaryElements,
      loadGeneExpression,
      loadState,
      overviewExtent,
      recordTelemetry,
      rememberGeneExpressionScaleMax,
      selectedGenes,
      setBoundaryElements,
      setNucleusBoundaryElements,
      setBoundaryState,
      setCurrentViewportDetail,
      setGeneExpressionBatch,
      setGeneExpressionState,
      setShareableViewState,
    ],
  )

  useEffect(() => {
    const detail = lastViewportDetailRef.current

    if (detail !== null) {
      handleViewportChange(detail)
    }
  }, [handleViewportChange, lastViewportDetailRef])

  return { handleViewportChange }
}

function isRetryableExpressionLoadError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false
  }

  const message = readErrorMessage(error).toLowerCase()

  return (
    isTypeErrorLike(error) ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('network request failed') ||
    message.includes('networkerror')
  )
}

function isTypeErrorLike(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'TypeError'
  )
}

interface ProfiledBoundaryElements {
  readonly batch: ElementBatch
  readonly durationMs: number
}

async function loadProfiledBoundaryElements(
  loader: BoundaryElementsLoader,
  baseUrl: string,
  bbox: BBox,
  options: Parameters<BoundaryElementsLoader>[2],
): Promise<ProfiledBoundaryElements> {
  const startedAt = readTimestamp()
  const batch = await loader(baseUrl, bbox, options)
  return profiledBoundaryElements(batch, Math.max(0, readTimestamp() - startedAt))
}

function profiledBoundaryElements(
  batch: ElementBatch,
  durationMs: number,
): ProfiledBoundaryElements {
  return { batch, durationMs }
}

function formatBoundaryProfileDetail(
  cellResult: ProfiledBoundaryElements,
  nucleusResult: ProfiledBoundaryElements,
  includeNucleus: boolean,
): string {
  const memoryDetail = currentMemoryDetail()
  const parts = [
    `${cellResult.batch.elements.length.toLocaleString()} cells in ${formatDurationMs(
      cellResult.durationMs,
    )}`,
    includeNucleus
      ? `${nucleusResult.batch.elements.length.toLocaleString()} nuclei in ${formatDurationMs(
          nucleusResult.durationMs,
        )}`
      : undefined,
    memoryDetail === undefined ? undefined : `memory ${memoryDetail}`,
  ].filter((part): part is string => part !== undefined)

  return parts.join(', ')
}

function currentMemoryDetail(): string | undefined {
  return formatRuntimeMemorySnapshot(readRuntimeMemorySnapshot())
}

function formatProfileTimingDetail(
  timingDetail: string,
  memoryDetail: string | undefined,
): string {
  return memoryDetail === undefined
    ? timingDetail
    : `${timingDetail}; memory ${memoryDetail}`
}

function formatDurationMs(durationMs: number): string {
  return `${Math.round(durationMs).toLocaleString()} ms`
}
