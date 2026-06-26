import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { SpatialElementId } from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import {
  abortActiveRequest,
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
  IDLE_GRID_CELL_ASSIGNMENT_STATE,
  gridCellAssignmentFailed,
  gridCellAssignmentLoadStarted,
  gridCellAssignmentMissing,
  gridCellAssignmentReady,
  gridCellAssignmentUnavailable,
  type GridCellAssignmentState,
} from './gridCellAssignmentModel'

interface MutableRef<T> {
  current: T
}

interface VisiumHdBarcodeMappingCellAssignment {
  readonly binId: SpatialElementId
  readonly cellId: string
  readonly inNucleus: boolean
  readonly inCell: boolean
}

interface VisiumHdBarcodeAssignmentDataset {
  readonly barcodeMappingAssignments: (
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    binIds: readonly SpatialElementId[],
    options: { readonly maxRows?: number; readonly signal?: AbortSignal },
  ) => Promise<readonly VisiumHdBarcodeMappingCellAssignment[]>
}

interface GridCellAssignmentWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
}

interface GridCellAssignmentWorkflowControls {
  readonly isVisiumHdDataset: boolean
  readonly rowBudget: number | undefined
  readonly selectedBinSize: VisiumHdBinSizeMicrometers | undefined
}

interface GridCellAssignmentWorkflowData {
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly selectedGridCell: GridCellDatum | null
}

interface GridCellAssignmentWorkflowLoaders {
  readonly getSpatialDataset: SpatialDatasetLoader
}

interface GridCellAssignmentWorkflowRefs {
  readonly gridCellAssignmentAbortRef: MutableRef<AbortController | null>
  readonly gridCellAssignmentRequestIdRef: MutableRef<number>
}

interface GridCellAssignmentWorkflowSetters {
  readonly setGridCellAssignmentState: Dispatch<
    SetStateAction<GridCellAssignmentState<StructuredLoadError>>
  >
}

interface UseGridCellAssignmentWorkflowOptions {
  readonly callbacks: GridCellAssignmentWorkflowCallbacks
  readonly controls: GridCellAssignmentWorkflowControls
  readonly data: GridCellAssignmentWorkflowData
  readonly loaders: GridCellAssignmentWorkflowLoaders
  readonly refs: GridCellAssignmentWorkflowRefs
  readonly setters: GridCellAssignmentWorkflowSetters
}

export function useGridCellAssignmentWorkflow({
  callbacks,
  controls,
  data,
  loaders,
  refs,
  setters,
}: UseGridCellAssignmentWorkflowOptions): void {
  const { appendDebugEvent } = callbacks
  const { isVisiumHdDataset, rowBudget, selectedBinSize } = controls
  const { loadState, selectedGridCell } = data
  const { getSpatialDataset } = loaders
  const { gridCellAssignmentAbortRef, gridCellAssignmentRequestIdRef } = refs
  const { setGridCellAssignmentState } = setters

  useEffect(() => {
    if (!isVisiumHdDataset || selectedGridCell === null || loadState.status !== 'ready') {
      const requestId = invalidateLatestRequest({
        abortRef: gridCellAssignmentAbortRef,
        requestIdRef: gridCellAssignmentRequestIdRef,
      })

      queueMicrotask(() => {
        if (gridCellAssignmentRequestIdRef.current === requestId) {
          setGridCellAssignmentState(IDLE_GRID_CELL_ASSIGNMENT_STATE)
        }
      })
      return
    }

    const binSize = gridCellBinSize(selectedGridCell, selectedBinSize)

    if (binSize === undefined) {
      const requestId = invalidateLatestRequest({
        abortRef: gridCellAssignmentAbortRef,
        requestIdRef: gridCellAssignmentRequestIdRef,
      })

      queueMicrotask(() => {
        if (gridCellAssignmentRequestIdRef.current === requestId) {
          setGridCellAssignmentState(
            gridCellAssignmentUnavailable('Selected bin size is unavailable.'),
          )
        }
      })
      return
    }

    const request = startLatestRequest({
      abortRef: gridCellAssignmentAbortRef,
      requestIdRef: gridCellAssignmentRequestIdRef,
    })
    const startedAt = readTimestamp()
    setGridCellAssignmentState(
      gridCellAssignmentLoadStarted(selectedGridCell.id, rowBudget),
    )
    appendDebugEvent(`Bin assignment started: ${shortIdentifier(selectedGridCell.id)}`, {
      coalesceKey: 'bin-assignment',
    })

    void (async () => {
      const dataset = await getSpatialDataset(loadState.url)

      if (!hasBarcodeMappingAssignments(dataset)) {
        throw new Error('Active dataset does not expose Visium HD barcode mappings.')
      }

      const assignments = await dataset.barcodeMappingAssignments(
        binSize,
        [selectedGridCell.id],
        {
          ...(rowBudget === undefined ? {} : { maxRows: rowBudget }),
          signal: request.signal,
        },
      )

      if (request.signal.aborted || !request.isCurrent()) {
        return
      }

      const assignment = assignments[0]

      if (assignment === undefined) {
        setGridCellAssignmentState(
          gridCellAssignmentMissing(selectedGridCell.id, rowBudget),
        )
      } else {
        setGridCellAssignmentState(
          gridCellAssignmentReady(selectedGridCell.id, {
            cellId: assignment.cellId,
            inNucleus: assignment.inNucleus,
            inCell: assignment.inCell,
            ...(rowBudget === undefined ? {} : { rowBudget }),
          }),
        )
      }

      appendDebugEvent(`Bin assignment ready in ${formatElapsed(startedAt)}`, {
        coalesceKey: 'bin-assignment',
      })
    })()
      .catch((error) => {
        if (isAbortError(error) || !request.isCurrent()) {
          return
        }

        setGridCellAssignmentState(
          gridCellAssignmentFailed(
            selectedGridCell.id,
            createStructuredLoadError('Cell details', error),
          ),
        )
        appendDebugEvent(`Bin assignment failed (${formatElapsed(startedAt)})`, {
          coalesceKey: 'bin-assignment',
        })
      })
      .finally(() => {
        request.complete()
      })

    return () => {
      if (request.isCurrent()) {
        abortActiveRequest(gridCellAssignmentAbortRef)
      }
    }
  }, [
    appendDebugEvent,
    getSpatialDataset,
    gridCellAssignmentAbortRef,
    gridCellAssignmentRequestIdRef,
    isVisiumHdDataset,
    loadState,
    rowBudget,
    selectedBinSize,
    selectedGridCell,
    setGridCellAssignmentState,
  ])
}

function hasBarcodeMappingAssignments(
  dataset: unknown,
): dataset is VisiumHdBarcodeAssignmentDataset {
  return (
    dataset !== null &&
    typeof dataset === 'object' &&
    'barcodeMappingAssignments' in dataset &&
    typeof dataset.barcodeMappingAssignments === 'function'
  )
}

function gridCellBinSize(
  cell: GridCellDatum,
  fallback: VisiumHdBinSizeMicrometers | undefined,
): VisiumHdBinSizeMicrometers | undefined {
  if (cell.binSizeMicrometers === 2 || cell.binSizeMicrometers === 8) {
    return cell.binSizeMicrometers
  }

  if (cell.binSizeMicrometers === 16) {
    return cell.binSizeMicrometers
  }

  return fallback
}
