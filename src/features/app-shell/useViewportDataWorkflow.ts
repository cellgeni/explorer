import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  geneExpressionRequestKey,
  geneExpressionWaitingKey,
  planGeneExpressionLod,
  type GeneExpressionDetailMode,
} from '../../data/geneExpressionLod'
import {
  shareableViewStateKey,
  viewStateToShareable,
  type ShareableViewState,
} from '../../data/shareableState'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { BBox } from '../../data/coords'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import {
  boundaryViewportKey,
  shouldLoadBoundaryPolygons,
} from '../../rendering/boundaryViewport'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayers'
import type { BoundaryElementsLoader, GeneExpressionLoader } from './appDependencies'
import {
  abortActiveRequest,
  formatElapsed,
  isAbortError,
  readTimestamp,
  type DebugLogAppendOptions,
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

interface UseViewportDataWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly boundaryAbortRef: MutableRef<AbortController | null>
  readonly boundaryCellLimit: number
  readonly boundaryRequestIdRef: MutableRef<number>
  readonly boundaryViewportKeyRef: MutableRef<string | null>
  readonly geneExpressionAbortRef: MutableRef<AbortController | null>
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionRequestIdRef: MutableRef<number>
  readonly geneExpressionScaleKey: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionViewportKeyRef: MutableRef<string | null>
  readonly lastViewportDetailRef: MutableRef<ViewerViewportDetail | null>
  readonly loadBoundaryElements: BoundaryElementsLoader
  readonly loadGeneExpression: GeneExpressionLoader
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly overviewExtent: BBox | null
  readonly recordTelemetry: (event: TelemetryEvent) => void
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
  readonly selectedGenes: readonly string[]
  readonly setBoundaryElements: Setter<readonly SpatialElement[]>
  readonly setBoundaryState: Setter<BoundaryLoadState<StructuredLoadError>>
  readonly setCurrentViewportDetail: Setter<ViewerViewportDetail | null>
  readonly setGeneExpressionBatch: Setter<GeneExpressionBatch | null>
  readonly setGeneExpressionState: Setter<GeneExpressionState<StructuredLoadError>>
  readonly setShareableViewState: Setter<ShareableViewState | undefined>
}

interface UseViewportDataWorkflowResult {
  readonly handleViewportChange: (detail: ViewerViewportDetail) => void
}

export function useViewportDataWorkflow({
  appendDebugEvent,
  boundaryAbortRef,
  boundaryCellLimit,
  boundaryRequestIdRef,
  boundaryViewportKeyRef,
  geneExpressionAbortRef,
  geneExpressionDetailMode,
  geneExpressionRequestIdRef,
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
}: UseViewportDataWorkflowOptions): UseViewportDataWorkflowResult {
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
        boundaryRequestIdRef.current += 1
        boundaryViewportKeyRef.current = null
        setBoundaryElements((current) => (current.length === 0 ? current : []))
        setBoundaryState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
      } else {
        const requestKey = boundaryViewportKey(loadState.url, detail.bbox)

        if (requestKey !== boundaryViewportKeyRef.current) {
          abortActiveRequest(boundaryAbortRef)
          const requestId = boundaryRequestIdRef.current + 1
          const abortController = new AbortController()
          boundaryRequestIdRef.current = requestId
          boundaryAbortRef.current = abortController
          boundaryViewportKeyRef.current = requestKey
          setBoundaryState({ status: 'loading', url: loadState.url })

          void loadBoundaryElements(loadState.url, detail.bbox, {
            signal: abortController.signal,
          })
            .then((batch) => {
              if (boundaryRequestIdRef.current !== requestId) {
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

              if (boundaryRequestIdRef.current !== requestId) {
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
        geneExpressionRequestIdRef.current += 1
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
        geneExpressionRequestIdRef.current += 1
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

      const expressionRequestId = geneExpressionRequestIdRef.current + 1
      abortActiveRequest(geneExpressionAbortRef)
      const expressionAbortController = new AbortController()
      const expressionStartedAt = readTimestamp()
      geneExpressionRequestIdRef.current = expressionRequestId
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
          if (geneExpressionRequestIdRef.current !== expressionRequestId) {
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

          if (geneExpressionRequestIdRef.current !== expressionRequestId) {
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
      boundaryAbortRef,
      boundaryCellLimit,
      boundaryRequestIdRef,
      boundaryViewportKeyRef,
      geneExpressionAbortRef,
      geneExpressionDetailMode,
      geneExpressionRequestIdRef,
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
