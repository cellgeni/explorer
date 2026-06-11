import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AnalysisEmbeddingKind } from '../../data/analysisEmbeddings'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type { AnalysisEmbeddingsLoader } from '../app-shell/appDependencies'
import {
  abortActiveRequest,
  isAbortError,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { AnalysisEmbeddingState } from './analysisEmbeddingModel'

interface MutableRef<T> {
  current: T
}

interface UseAnalysisEmbeddingWorkflowOptions {
  readonly analysisEmbeddingAbortRef: MutableRef<AbortController | null>
  readonly analysisEmbeddingRequestIdRef: MutableRef<number>
  readonly analysisEmbeddingState: AnalysisEmbeddingState<StructuredLoadError>
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly loadAnalysisEmbeddings: AnalysisEmbeddingsLoader
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly onSelectedCellFocus?: (cell: OverviewCellDatum) => void
  readonly overviewCellById: ReadonlyMap<string, OverviewCellDatum>
  readonly selectedEmbeddingKind: AnalysisEmbeddingKind
  readonly setAnalysisEmbeddingState: Dispatch<
    SetStateAction<AnalysisEmbeddingState<StructuredLoadError>>
  >
  readonly setSelectedCell: Dispatch<SetStateAction<OverviewCellDatum | null>>
  readonly setSelectedEmbeddingKind: Dispatch<SetStateAction<AnalysisEmbeddingKind>>
}

interface UseAnalysisEmbeddingWorkflowResult {
  readonly handleEmbeddingCellSelect: (cellId: string) => void
  readonly handleLoadAnalysisEmbeddings: () => void
}

export function useAnalysisEmbeddingWorkflow({
  analysisEmbeddingAbortRef,
  analysisEmbeddingRequestIdRef,
  analysisEmbeddingState,
  appendDebugEvent,
  loadAnalysisEmbeddings,
  loadState,
  onSelectedCellFocus,
  overviewCellById,
  selectedEmbeddingKind,
  setAnalysisEmbeddingState,
  setSelectedCell,
  setSelectedEmbeddingKind,
}: UseAnalysisEmbeddingWorkflowOptions): UseAnalysisEmbeddingWorkflowResult {
  const handleLoadAnalysisEmbeddings = useCallback(() => {
    if (loadState.status !== 'ready' || analysisEmbeddingState.status === 'loading') {
      return
    }

    const requestId = analysisEmbeddingRequestIdRef.current + 1
    abortActiveRequest(analysisEmbeddingAbortRef)
    const abortController = new AbortController()
    analysisEmbeddingRequestIdRef.current = requestId
    analysisEmbeddingAbortRef.current = abortController
    setAnalysisEmbeddingState({ status: 'loading', url: loadState.url })
    appendDebugEvent('Loading embeddings')

    void loadAnalysisEmbeddings(loadState.url, { signal: abortController.signal })
      .then((embeddings) => {
        if (analysisEmbeddingRequestIdRef.current !== requestId) {
          return
        }

        setAnalysisEmbeddingState({
          status: 'ready',
          url: loadState.url,
          embeddings,
        })

        if (
          embeddings.length > 0 &&
          !embeddings.some((embedding) => embedding.kind === selectedEmbeddingKind)
        ) {
          setSelectedEmbeddingKind(embeddings[0]?.kind ?? 'umap')
        }
        appendDebugEvent(`Embeddings loaded: ${embeddings.length.toLocaleString()} views`)
      })
      .catch((error) => {
        if (isAbortError(error) || analysisEmbeddingRequestIdRef.current !== requestId) {
          return
        }

        setAnalysisEmbeddingState({
          status: 'error',
          url: loadState.url,
          error: createStructuredLoadError('Embeddings', error),
        })
        appendDebugEvent('Embeddings failed')
      })
      .finally(() => {
        if (analysisEmbeddingAbortRef.current === abortController) {
          analysisEmbeddingAbortRef.current = null
        }
      })
  }, [
    analysisEmbeddingAbortRef,
    analysisEmbeddingRequestIdRef,
    analysisEmbeddingState,
    appendDebugEvent,
    loadAnalysisEmbeddings,
    loadState,
    selectedEmbeddingKind,
    setAnalysisEmbeddingState,
    setSelectedEmbeddingKind,
  ])

  const handleEmbeddingCellSelect = useCallback(
    (cellId: string) => {
      const cell = overviewCellById.get(cellId)

      if (cell !== undefined) {
        setSelectedCell(cell)
        onSelectedCellFocus?.(cell)
      }
    },
    [onSelectedCellFocus, overviewCellById, setSelectedCell],
  )

  return { handleEmbeddingCellSelect, handleLoadAnalysisEmbeddings }
}
