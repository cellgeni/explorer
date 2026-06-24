import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { asCellId } from '../../data/cellid'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import {
  CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  DEFAULT_CELL_TRANSCRIPT_MIN_QV,
} from '../../data/cellTranscripts'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type {
  BoundaryElementsLoader,
  CellTranscriptDistributionLoader,
  RoiGeneStatsLoader,
} from '../app-shell/appDependencies'
import {
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  shortIdentifier,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  CELL_GENE_EXPRESSION_LIMIT,
  cellExpressionSummaryFromStats,
  loadSelectedCellBoundary,
  overviewCellToDatasetCell,
  summarizeCellShape,
  type CellDetailState,
  type CellTranscriptDistributionState,
} from './cellDetailModel'

interface MutableRef<T> {
  current: T
}

interface UseCellDetailWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
}

interface UseCellDetailWorkflowData {
  readonly cellDetailState: CellDetailState<StructuredLoadError>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly selectedCell: OverviewCellDatum | null
}

interface UseCellDetailWorkflowLoaders {
  readonly loadBoundaryElements: BoundaryElementsLoader
  readonly loadCellTranscriptDistribution: CellTranscriptDistributionLoader
  readonly loadRoiGeneStats: RoiGeneStatsLoader
}

interface UseCellDetailWorkflowRefs {
  readonly cellDetailAbortRef: MutableRef<AbortController | null>
  readonly cellDetailRequestIdRef: MutableRef<number>
  readonly cellTranscriptDistributionAbortRef: MutableRef<AbortController | null>
  readonly cellTranscriptDistributionRequestIdRef: MutableRef<number>
}

interface UseCellDetailWorkflowSetters {
  readonly setCellDetailState: Dispatch<
    SetStateAction<CellDetailState<StructuredLoadError>>
  >
  readonly setCellTranscriptDistributionState: Dispatch<
    SetStateAction<CellTranscriptDistributionState<StructuredLoadError>>
  >
}

interface UseCellDetailWorkflowOptions {
  readonly callbacks: UseCellDetailWorkflowCallbacks
  readonly data: UseCellDetailWorkflowData
  readonly loaders: UseCellDetailWorkflowLoaders
  readonly refs: UseCellDetailWorkflowRefs
  readonly setters: UseCellDetailWorkflowSetters
}

export function useCellDetailWorkflow({
  callbacks: { appendDebugEvent, appendFallbackNotice },
  data: { cellDetailState, loadState, selectedCell },
  loaders: { loadBoundaryElements, loadCellTranscriptDistribution, loadRoiGeneStats },
  refs: {
    cellDetailAbortRef,
    cellDetailRequestIdRef,
    cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef,
  },
  setters: { setCellDetailState, setCellTranscriptDistributionState },
}: UseCellDetailWorkflowOptions): void {
  useEffect(() => {
    if (selectedCell === null || loadState.status !== 'ready') {
      invalidateLatestRequest({
        abortRef: cellDetailAbortRef,
        requestIdRef: cellDetailRequestIdRef,
      })
      return
    }

    const detailStartedAt = readTimestamp()
    const request = startLatestRequest({
      abortRef: cellDetailAbortRef,
      requestIdRef: cellDetailRequestIdRef,
    })
    queueMicrotask(() => {
      if (!request.isCurrent() || request.signal.aborted) {
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
          signal: request.signal,
          cellLimit: 1,
          geneLimit: CELL_GENE_EXPRESSION_LIMIT,
          sampleStrategy: 'head',
          onFallback: appendFallbackNotice,
        }),
        loadSelectedCellBoundary(
          loadState.url,
          selectedCell,
          loadBoundaryElements,
          request.signal,
        ),
      ])

      if (!request.isCurrent() || request.signal.aborted) {
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
        if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
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
        request.complete()
      })

    return () => {
      request.abortController.abort()
      request.complete()
    }
  }, [
    appendDebugEvent,
    appendFallbackNotice,
    cellDetailAbortRef,
    cellDetailRequestIdRef,
    loadBoundaryElements,
    loadRoiGeneStats,
    loadState,
    selectedCell,
    setCellDetailState,
  ])

  useEffect(() => {
    if (selectedCell === null || loadState.status !== 'ready') {
      const requestId = invalidateLatestRequest({
        abortRef: cellTranscriptDistributionAbortRef,
        requestIdRef: cellTranscriptDistributionRequestIdRef,
      })
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestIdRef.current === requestId) {
          setCellTranscriptDistributionState({ status: 'idle' })
        }
      })
      return
    }

    if (
      cellDetailState.status === 'error' &&
      cellDetailState.cellId === selectedCell.id
    ) {
      const requestId = invalidateLatestRequest({
        abortRef: cellTranscriptDistributionAbortRef,
        requestIdRef: cellTranscriptDistributionRequestIdRef,
      })
      const error = new Error(
        'Cell details failed before the selected-cell transcript z distribution could load.',
      )
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestIdRef.current === requestId) {
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
      const requestId = invalidateLatestRequest({
        abortRef: cellTranscriptDistributionAbortRef,
        requestIdRef: cellTranscriptDistributionRequestIdRef,
      })
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestIdRef.current === requestId) {
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
      const requestId = invalidateLatestRequest({
        abortRef: cellTranscriptDistributionAbortRef,
        requestIdRef: cellTranscriptDistributionRequestIdRef,
      })
      const error = new Error(
        'Selected cell boundary is unavailable, so cell-only transcript z locations cannot be computed.',
      )
      queueMicrotask(() => {
        if (cellTranscriptDistributionRequestIdRef.current === requestId) {
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

    const distributionStartedAt = readTimestamp()
    const request = startLatestRequest({
      abortRef: cellTranscriptDistributionAbortRef,
      requestIdRef: cellTranscriptDistributionRequestIdRef,
    })

    queueMicrotask(() => {
      if (!request.isCurrent() || request.signal.aborted) {
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
      signal: request.signal,
      limit: CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
      minQv: DEFAULT_CELL_TRANSCRIPT_MIN_QV,
      binCount: CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
      boundaryPolygon,
    })
      .then((distribution) => {
        if (!request.isCurrent() || request.signal.aborted) {
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
        if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
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
        request.complete()
      })

    return () => {
      request.abortController.abort()
      request.complete()
    }
  }, [
    appendDebugEvent,
    cellDetailState,
    cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef,
    loadCellTranscriptDistribution,
    loadState,
    selectedCell,
    setCellTranscriptDistributionState,
  ])
}
