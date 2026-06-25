import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { GexResult } from '../../data/gexTypes'
import type { SpatialElementId } from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import {
  cellExpressionSummaryFromGexCells,
  type CellExpressionProfileSelection,
  type CellExpressionProfileState,
} from '../cells/cellExpressionProfileModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { SpatialDatasetLoader } from './appDependencies'
import {
  abortActiveRequest,
  invalidateLatestRequest,
  isAbortError,
  startLatestRequest,
  type DebugLogAppendOptions,
} from './appRuntimeModel'
import {
  isVisiumHdExpressionProfileDataset,
  selectedVisiumHdCellMappedBinIds,
  selectedVisiumHdCellMappings,
  selectedVisiumHdProfileBinSize,
  type VisiumHdExpressionProfileDataset,
} from './visiumHdAppController'

interface MutableRef<T> {
  current: T
}

interface UseVisiumHdExpressionProfileWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
}

interface UseVisiumHdExpressionProfileWorkflowControls {
  readonly activeBinSize: VisiumHdBinSizeMicrometers | undefined
  readonly isVisiumHdDataset: boolean
  readonly rowBudget?: number | undefined
}

interface UseVisiumHdExpressionProfileWorkflowData {
  readonly activeSelection: CellExpressionProfileSelection | null
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly selectedGridCell: GridCellDatum | null
}

interface UseVisiumHdExpressionProfileWorkflowLoaders {
  readonly getSpatialDataset: SpatialDatasetLoader
}

interface UseVisiumHdExpressionProfileWorkflowRefs {
  readonly abortRef: MutableRef<AbortController | null>
  readonly requestIdRef: MutableRef<number>
}

interface UseVisiumHdExpressionProfileWorkflowSetters {
  readonly setExpressionProfileState: Dispatch<
    SetStateAction<CellExpressionProfileState<StructuredLoadError>>
  >
}

interface UseVisiumHdExpressionProfileWorkflowOptions {
  readonly callbacks: UseVisiumHdExpressionProfileWorkflowCallbacks
  readonly controls: UseVisiumHdExpressionProfileWorkflowControls
  readonly data: UseVisiumHdExpressionProfileWorkflowData
  readonly loaders: UseVisiumHdExpressionProfileWorkflowLoaders
  readonly refs: UseVisiumHdExpressionProfileWorkflowRefs
  readonly setters: UseVisiumHdExpressionProfileWorkflowSetters
}

interface UseVisiumHdExpressionProfileWorkflowResult {
  readonly clearVisiumHdExpressionProfileState: () => void
  readonly handleLoadVisiumHdExpressionProfile: () => void
}

const IDLE_CELL_EXPRESSION_PROFILE_STATE: CellExpressionProfileState<StructuredLoadError> =
  {
    status: 'idle',
  }

export function useVisiumHdExpressionProfileWorkflow({
  callbacks: { appendDebugEvent },
  controls: { activeBinSize, isVisiumHdDataset, rowBudget },
  data: { activeSelection, loadState, selectedGridCell },
  loaders: { getSpatialDataset },
  refs: { abortRef, requestIdRef },
  setters: { setExpressionProfileState },
}: UseVisiumHdExpressionProfileWorkflowOptions): UseVisiumHdExpressionProfileWorkflowResult {
  const autoLoadedBinProfileKeyRef = useRef<string | null>(null)
  const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

  const clearVisiumHdExpressionProfileState = useCallback(() => {
    invalidateLatestRequest({ abortRef, requestIdRef })
    setExpressionProfileState((current) =>
      current.status === 'idle' ? current : IDLE_CELL_EXPRESSION_PROFILE_STATE,
    )
  }, [abortRef, requestIdRef, setExpressionProfileState])

  useEffect(() => {
    return () => {
      abortActiveRequest(abortRef)
    }
  }, [abortRef])

  const handleLoadVisiumHdExpressionProfile = useCallback(() => {
    if (!isVisiumHdDataset || readyDatasetUrl === null || activeSelection === null) {
      return
    }

    const selection = activeSelection
    const binSize = selectedVisiumHdProfileBinSize(activeBinSize, selectedGridCell)

    if (binSize === undefined) {
      setExpressionProfileState({
        status: 'unavailable',
        selectionId: selection.id,
        selectionKind: selection.kind,
        reason: 'Select a Visium HD bin size to load this expression profile.',
      })
      return
    }

    const request = startLatestRequest({ abortRef, requestIdRef })
    setExpressionProfileState({
      status: 'loading',
      selectionId: selection.id,
      selectionKind: selection.kind,
    })

    void loadVisiumHdExpressionProfile({
      binSize,
      datasetUrl: readyDatasetUrl,
      getSpatialDataset,
      rowBudget,
      selection,
      signal: request.signal,
    })
      .then(({ expression, sourceLabel }) => {
        if (!request.isCurrent() || request.signal.aborted) {
          return
        }

        setExpressionProfileState({
          status: 'ready',
          selectionId: selection.id,
          selectionKind: selection.kind,
          expression,
          sourceLabel,
        })
        appendDebugEvent(
          `Loaded Visium HD ${selection.kind} expression profile: ${expression.genes.length.toLocaleString()} genes`,
          { coalesceKey: 'visium-hd-expression-profile' },
        )
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
          return
        }

        setExpressionProfileState({
          status: 'error',
          selectionId: selection.id,
          selectionKind: selection.kind,
          error: createStructuredLoadError('Gene expression', error),
        })
      })
      .finally(() => {
        request.complete()
      })
  }, [
    activeBinSize,
    activeSelection,
    appendDebugEvent,
    abortRef,
    getSpatialDataset,
    isVisiumHdDataset,
    readyDatasetUrl,
    requestIdRef,
    rowBudget,
    selectedGridCell,
    setExpressionProfileState,
  ])

  useEffect(() => {
    if (
      !isVisiumHdDataset ||
      readyDatasetUrl === null ||
      activeSelection?.kind !== 'bin'
    ) {
      autoLoadedBinProfileKeyRef.current = null
      return
    }

    const binSize = selectedVisiumHdProfileBinSize(activeBinSize, selectedGridCell)
    const profileKey = `${activeSelection.id}:${binSize ?? 'unknown'}`

    if (autoLoadedBinProfileKeyRef.current === profileKey) {
      return
    }

    autoLoadedBinProfileKeyRef.current = profileKey
    handleLoadVisiumHdExpressionProfile()
  }, [
    activeBinSize,
    activeSelection,
    handleLoadVisiumHdExpressionProfile,
    isVisiumHdDataset,
    readyDatasetUrl,
    selectedGridCell,
  ])

  return {
    clearVisiumHdExpressionProfileState,
    handleLoadVisiumHdExpressionProfile,
  }
}

async function loadVisiumHdExpressionProfile({
  binSize,
  datasetUrl,
  getSpatialDataset,
  rowBudget,
  selection,
  signal,
}: {
  readonly binSize: VisiumHdBinSizeMicrometers
  readonly datasetUrl: string
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly rowBudget?: number | undefined
  readonly selection: CellExpressionProfileSelection
  readonly signal: AbortSignal
}) {
  const dataset = await getSpatialDataset(datasetUrl)

  if (!isVisiumHdExpressionProfileDataset(dataset)) {
    throw new Error('Loaded dataset does not expose Visium HD expression profiles.')
  }

  const profileDataset = dataset as VisiumHdExpressionProfileDataset

  if (selection.kind === 'bin') {
    const matrix = await profileDataset.matrix([selection.id], binSize, { signal })

    return {
      expression: cellExpressionSummaryFromGexCells(matrix, [selection.id]),
      sourceLabel: 'Selected bin',
    }
  }

  const mappings = await selectedVisiumHdCellMappings(
    dataset,
    selection.id,
    rowBudget,
    signal,
  )
  const mappedBinIds = selectedVisiumHdCellMappedBinIds(mappings, selection.id, binSize)

  if (mappedBinIds.length === 0) {
    const emptyMatrix: GexResult<SpatialElementId> = {
      geneNames: [],
      cells: new Map(),
    }

    return {
      expression: cellExpressionSummaryFromGexCells(emptyMatrix, []),
      sourceLabel: '0 mapped bins',
    }
  }

  const matrix = await profileDataset.matrix(mappedBinIds, binSize, { signal })

  return {
    expression: cellExpressionSummaryFromGexCells(matrix, mappedBinIds),
    sourceLabel: `${mappedBinIds.length.toLocaleString()} mapped bins`,
  }
}
