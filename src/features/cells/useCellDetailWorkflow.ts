import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { asCellId } from '../../data/cellid'
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
  abortActiveRequest,
  formatElapsed,
  isAbortError,
  readTimestamp,
  shortIdentifier,
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

interface UseCellDetailWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly cellDetailAbortRef: MutableRef<AbortController | null>
  readonly cellDetailRequestIdRef: MutableRef<number>
  readonly cellDetailState: CellDetailState<StructuredLoadError>
  readonly cellTranscriptDistributionAbortRef: MutableRef<AbortController | null>
  readonly cellTranscriptDistributionRequestIdRef: MutableRef<number>
  readonly loadBoundaryElements: BoundaryElementsLoader
  readonly loadCellTranscriptDistribution: CellTranscriptDistributionLoader
  readonly loadRoiGeneStats: RoiGeneStatsLoader
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly selectedCell: OverviewCellDatum | null
  readonly setCellDetailState: Dispatch<
    SetStateAction<CellDetailState<StructuredLoadError>>
  >
  readonly setCellTranscriptDistributionState: Dispatch<
    SetStateAction<CellTranscriptDistributionState<StructuredLoadError>>
  >
}

export function useCellDetailWorkflow({
  appendDebugEvent,
  cellDetailAbortRef,
  cellDetailRequestIdRef,
  cellDetailState,
  cellTranscriptDistributionAbortRef,
  cellTranscriptDistributionRequestIdRef,
  loadBoundaryElements,
  loadCellTranscriptDistribution,
  loadRoiGeneStats,
  loadState,
  selectedCell,
  setCellDetailState,
  setCellTranscriptDistributionState,
}: UseCellDetailWorkflowOptions): void {
  useEffect(() => {
    if (selectedCell === null || loadState.status !== 'ready') {
      abortActiveRequest(cellDetailAbortRef)
      cellDetailRequestIdRef.current += 1
      return
    }

    const requestId = cellDetailRequestIdRef.current + 1
    const detailStartedAt = readTimestamp()
    const abortController = new AbortController()
    abortActiveRequest(cellDetailAbortRef)
    cellDetailRequestIdRef.current = requestId
    cellDetailAbortRef.current = abortController
    queueMicrotask(() => {
      if (
        abortController.signal.aborted ||
        cellDetailRequestIdRef.current !== requestId
      ) {
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
          signal: abortController.signal,
          cellLimit: 1,
          geneLimit: CELL_GENE_EXPRESSION_LIMIT,
          sampleStrategy: 'head',
        }),
        loadSelectedCellBoundary(
          loadState.url,
          selectedCell,
          loadBoundaryElements,
          abortController.signal,
        ),
      ])

      if (
        abortController.signal.aborted ||
        cellDetailRequestIdRef.current !== requestId
      ) {
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
        if (isAbortError(error) || cellDetailRequestIdRef.current !== requestId) {
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
        if (cellDetailAbortRef.current === abortController) {
          cellDetailAbortRef.current = null
        }
      })

    return () => {
      if (cellDetailAbortRef.current === abortController) {
        abortActiveRequest(cellDetailAbortRef)
      }
    }
  }, [
    appendDebugEvent,
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
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestIdRef.current += 1
      const requestId = cellTranscriptDistributionRequestIdRef.current
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
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestIdRef.current += 1
      const requestId = cellTranscriptDistributionRequestIdRef.current
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
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestIdRef.current += 1
      const requestId = cellTranscriptDistributionRequestIdRef.current
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
      abortActiveRequest(cellTranscriptDistributionAbortRef)
      cellTranscriptDistributionRequestIdRef.current += 1
      const requestId = cellTranscriptDistributionRequestIdRef.current
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

    const requestId = cellTranscriptDistributionRequestIdRef.current + 1
    const distributionStartedAt = readTimestamp()
    const abortController = new AbortController()
    abortActiveRequest(cellTranscriptDistributionAbortRef)
    cellTranscriptDistributionRequestIdRef.current = requestId
    cellTranscriptDistributionAbortRef.current = abortController

    queueMicrotask(() => {
      if (
        abortController.signal.aborted ||
        cellTranscriptDistributionRequestIdRef.current !== requestId
      ) {
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
      signal: abortController.signal,
      limit: CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
      minQv: DEFAULT_CELL_TRANSCRIPT_MIN_QV,
      binCount: CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
      boundaryPolygon,
    })
      .then((distribution) => {
        if (
          abortController.signal.aborted ||
          cellTranscriptDistributionRequestIdRef.current !== requestId
        ) {
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
        if (
          isAbortError(error) ||
          cellTranscriptDistributionRequestIdRef.current !== requestId
        ) {
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
        if (cellTranscriptDistributionAbortRef.current === abortController) {
          cellTranscriptDistributionAbortRef.current = null
        }
      })

    return () => {
      if (cellTranscriptDistributionAbortRef.current === abortController) {
        abortActiveRequest(cellTranscriptDistributionAbortRef)
      }
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
