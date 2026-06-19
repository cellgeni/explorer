import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { SpatialElementId } from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
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
import type { GridCellAssignmentState } from './gridCellAssignmentModel'

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
    options: { readonly maxRows: number; readonly signal?: AbortSignal },
  ) => Promise<readonly VisiumHdBarcodeMappingCellAssignment[]>
}

interface UseGridCellAssignmentWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly gridCellAssignmentAbortRef: MutableRef<AbortController | null>
  readonly gridCellAssignmentRequestIdRef: MutableRef<number>
  readonly isVisiumHdDataset: boolean
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly selectedBinSize: VisiumHdBinSizeMicrometers | undefined
  readonly selectedGridCell: GridCellDatum | null
  readonly setGridCellAssignmentState: Dispatch<
    SetStateAction<GridCellAssignmentState<StructuredLoadError>>
  >
  readonly twoMicrometerFilteredBarcodeBudget: number | undefined
  readonly rowBudget: number | undefined
}

export function useGridCellAssignmentWorkflow({
  appendDebugEvent,
  getSpatialDataset,
  gridCellAssignmentAbortRef,
  gridCellAssignmentRequestIdRef,
  isVisiumHdDataset,
  loadState,
  selectedBinSize,
  selectedGridCell,
  setGridCellAssignmentState,
  twoMicrometerFilteredBarcodeBudget,
  rowBudget,
}: UseGridCellAssignmentWorkflowOptions): void {
  useEffect(() => {
    if (!isVisiumHdDataset || selectedGridCell === null || loadState.status !== 'ready') {
      abortActiveRequest(gridCellAssignmentAbortRef)
      gridCellAssignmentRequestIdRef.current += 1
      const requestId = gridCellAssignmentRequestIdRef.current
      queueMicrotask(() => {
        if (gridCellAssignmentRequestIdRef.current === requestId) {
          setGridCellAssignmentState({ status: 'idle' })
        }
      })
      return
    }

    if (rowBudget === undefined) {
      abortActiveRequest(gridCellAssignmentAbortRef)
      gridCellAssignmentRequestIdRef.current += 1
      const requestId = gridCellAssignmentRequestIdRef.current
      queueMicrotask(() => {
        if (gridCellAssignmentRequestIdRef.current === requestId) {
          setGridCellAssignmentState({
            status: 'unavailable',
            reason: 'Set a mapping row budget in Dataset to load assignment.',
          })
        }
      })
      return
    }

    const binSize = gridCellBinSize(selectedGridCell, selectedBinSize)

    if (binSize === undefined) {
      abortActiveRequest(gridCellAssignmentAbortRef)
      gridCellAssignmentRequestIdRef.current += 1
      const requestId = gridCellAssignmentRequestIdRef.current
      queueMicrotask(() => {
        if (gridCellAssignmentRequestIdRef.current === requestId) {
          setGridCellAssignmentState({
            status: 'unavailable',
            reason: 'Selected bin size is unavailable.',
          })
        }
      })
      return
    }

    const requestId = gridCellAssignmentRequestIdRef.current + 1
    const startedAt = readTimestamp()
    const abortController = new AbortController()
    abortActiveRequest(gridCellAssignmentAbortRef)
    gridCellAssignmentRequestIdRef.current = requestId
    gridCellAssignmentAbortRef.current = abortController
    setGridCellAssignmentState({
      status: 'loading',
      binId: selectedGridCell.id,
      rowBudget,
    })
    appendDebugEvent(`Bin assignment started: ${shortIdentifier(selectedGridCell.id)}`, {
      coalesceKey: 'bin-assignment',
    })

    void (async () => {
      const dataset = await getSpatialDataset(loadState.url, {
        ...(twoMicrometerFilteredBarcodeBudget === undefined
          ? {}
          : {
              visiumHdMaxTwoMicrometerFilteredBarcodes:
                twoMicrometerFilteredBarcodeBudget,
            }),
      })

      if (!hasBarcodeMappingAssignments(dataset)) {
        throw new Error('Active dataset does not expose Visium HD barcode mappings.')
      }

      const assignments = await dataset.barcodeMappingAssignments(
        binSize,
        [selectedGridCell.id],
        {
          maxRows: rowBudget,
          signal: abortController.signal,
        },
      )

      if (
        abortController.signal.aborted ||
        gridCellAssignmentRequestIdRef.current !== requestId
      ) {
        return
      }

      const assignment = assignments[0]

      if (assignment === undefined) {
        setGridCellAssignmentState({
          status: 'missing',
          binId: selectedGridCell.id,
          rowBudget,
        })
      } else {
        setGridCellAssignmentState({
          status: 'ready',
          binId: selectedGridCell.id,
          assignment: {
            cellId: assignment.cellId,
            inNucleus: assignment.inNucleus,
            inCell: assignment.inCell,
            rowBudget,
          },
        })
      }

      appendDebugEvent(`Bin assignment ready in ${formatElapsed(startedAt)}`, {
        coalesceKey: 'bin-assignment',
      })
    })()
      .catch((error) => {
        if (isAbortError(error) || gridCellAssignmentRequestIdRef.current !== requestId) {
          return
        }

        setGridCellAssignmentState({
          status: 'error',
          binId: selectedGridCell.id,
          error: createStructuredLoadError('Cell details', error),
        })
        appendDebugEvent(`Bin assignment failed (${formatElapsed(startedAt)})`, {
          coalesceKey: 'bin-assignment',
        })
      })
      .finally(() => {
        if (gridCellAssignmentAbortRef.current === abortController) {
          gridCellAssignmentAbortRef.current = null
        }
      })

    return () => {
      if (gridCellAssignmentAbortRef.current === abortController) {
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
    twoMicrometerFilteredBarcodeBudget,
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
