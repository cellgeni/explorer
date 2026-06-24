import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { boundaryElementsToLayerData } from '../../rendering/deckLayers'
import type { SpatialElement, SpatialElementId } from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import {
  abortActiveRequest,
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  projectVisiumHdExpressionToBoundaryCells,
  visiumHdExpressionBinIds,
  type VisiumHdExpressionCellAssignment,
} from './visiumHdExpressionProjection'

export type VisiumHdExpressionProjectionState =
  | { readonly status: 'idle' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | {
      readonly status: 'loading'
      readonly binCount: number
      readonly boundaryCellCount: number
      readonly rowBudget?: number
    }
  | {
      readonly status: 'ready'
      readonly batch: GeneExpressionBatch
      readonly mappedBinCount: number
      readonly mappedCellCount: number
      readonly boundaryCellCount: number
      readonly rowBudget?: number
    }
  | { readonly status: 'error'; readonly error: StructuredLoadError }

interface VisiumHdExpressionProjectionDataset {
  readonly barcodeMappingAssignments: (
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    binIds: readonly SpatialElementId[],
    options: { readonly maxRows?: number; readonly signal?: AbortSignal },
  ) => Promise<readonly VisiumHdExpressionCellAssignment[]>
}

interface UseVisiumHdExpressionProjectionWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly boundaryElements: readonly SpatialElement[]
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly isVisiumHdDataset: boolean
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly rowBudget: number | undefined
  readonly selectedBinSize: VisiumHdBinSizeMicrometers | undefined
}

const IDLE_VISIUM_HD_EXPRESSION_PROJECTION_STATE: VisiumHdExpressionProjectionState = {
  status: 'idle',
}

export function useVisiumHdExpressionProjectionWorkflow({
  appendDebugEvent,
  boundaryElements,
  geneExpressionBatch,
  getSpatialDataset,
  isVisiumHdDataset,
  loadState,
  rowBudget,
  selectedBinSize,
}: UseVisiumHdExpressionProjectionWorkflowOptions): VisiumHdExpressionProjectionState {
  const [state, setState] = useState<VisiumHdExpressionProjectionState>(
    IDLE_VISIUM_HD_EXPRESSION_PROJECTION_STATE,
  )
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const boundaries = useMemo(
    () => boundaryElementsToLayerData(boundaryElements),
    [boundaryElements],
  )

  useEffect(() => {
    if (
      !isVisiumHdDataset ||
      loadState.status !== 'ready' ||
      geneExpressionBatch === null ||
      boundaries.length === 0
    ) {
      const requestId = invalidateLatestRequest({ abortRef, requestIdRef })
      queueProjectionState(
        requestIdRef,
        requestId,
        setState,
        IDLE_VISIUM_HD_EXPRESSION_PROJECTION_STATE,
      )
      return
    }

    if (selectedBinSize === undefined) {
      const requestId = invalidateLatestRequest({ abortRef, requestIdRef })
      queueProjectionState(requestIdRef, requestId, setState, {
        status: 'unavailable',
        reason: 'Selected Visium HD bin size is unavailable.',
      })
      return
    }

    const binIds = visiumHdExpressionBinIds(geneExpressionBatch)

    if (binIds.length === 0) {
      const result = projectVisiumHdExpressionToBoundaryCells(
        geneExpressionBatch,
        [],
        boundaries,
      )

      const requestId = invalidateLatestRequest({ abortRef, requestIdRef })
      queueProjectionState(requestIdRef, requestId, setState, {
        status: 'ready',
        batch: result.batch,
        boundaryCellCount: boundaries.length,
        mappedBinCount: result.mappedBinCount,
        mappedCellCount: result.mappedCellCount,
      })
      return
    }

    const request = startLatestRequest({ abortRef, requestIdRef })
    const startedAt = readTimestamp()

    queueProjectionState(requestIdRef, request.requestId, setState, {
      status: 'loading',
      binCount: binIds.length,
      boundaryCellCount: boundaries.length,
      ...(rowBudget === undefined ? {} : { rowBudget }),
    })
    appendDebugEvent(
      `Visium HD expression cell projection started: ${binIds.length.toLocaleString()} bins, ${boundaries.length.toLocaleString()} boundaries`,
      { coalesceKey: 'visium-hd-expression-projection' },
    )

    void (async () => {
      const dataset = await getSpatialDataset(loadState.url)

      if (!hasBarcodeMappingAssignments(dataset)) {
        throw new Error('Active dataset does not expose Visium HD barcode mappings.')
      }

      const assignments = await dataset.barcodeMappingAssignments(
        selectedBinSize,
        binIds,
        {
          ...(rowBudget === undefined ? {} : { maxRows: rowBudget }),
          signal: request.signal,
        },
      )

      if (request.signal.aborted || !request.isCurrent()) {
        return
      }

      const result = projectVisiumHdExpressionToBoundaryCells(
        geneExpressionBatch,
        assignments,
        boundaries,
      )

      setState({
        status: 'ready',
        batch: result.batch,
        boundaryCellCount: boundaries.length,
        mappedBinCount: result.mappedBinCount,
        mappedCellCount: result.mappedCellCount,
        ...(rowBudget === undefined ? {} : { rowBudget }),
      })
      appendDebugEvent(
        `Visium HD expression cell projection ready: ${result.mappedCellCount.toLocaleString()} cells in ${formatElapsed(
          startedAt,
        )}`,
        { coalesceKey: 'visium-hd-expression-projection' },
      )
    })()
      .catch((error) => {
        if (isAbortError(error) || !request.isCurrent()) {
          return
        }

        setState({
          status: 'error',
          error: createStructuredLoadError('Gene expression', error),
        })
        appendDebugEvent(`Visium HD expression cell projection failed`, {
          coalesceKey: 'visium-hd-expression-projection',
        })
      })
      .finally(() => {
        request.complete()
      })

    return () => {
      if (request.isCurrent()) {
        abortActiveRequest(abortRef)
      }
    }
  }, [
    appendDebugEvent,
    boundaries,
    geneExpressionBatch,
    getSpatialDataset,
    isVisiumHdDataset,
    loadState,
    rowBudget,
    selectedBinSize,
  ])

  return state
}

function hasBarcodeMappingAssignments(
  dataset: unknown,
): dataset is VisiumHdExpressionProjectionDataset {
  return (
    dataset !== null &&
    typeof dataset === 'object' &&
    'barcodeMappingAssignments' in dataset &&
    typeof dataset.barcodeMappingAssignments === 'function'
  )
}

function queueProjectionState(
  requestIdRef: { readonly current: number },
  requestId: number,
  setState: Dispatch<SetStateAction<VisiumHdExpressionProjectionState>>,
  nextState: VisiumHdExpressionProjectionState,
): void {
  queueMicrotask(() => {
    if (requestIdRef.current === requestId) {
      setState(nextState)
    }
  })
}
