import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AnalysisEmbeddingKind } from '../../data/analysisEmbeddings'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type { AnalysisEmbeddingsLoader } from '../app-shell/appDependencies'
import {
  isAbortError,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  analysisEmbeddingLoadFailed,
  analysisEmbeddingLoadReady,
  analysisEmbeddingLoadStarted,
  analysisEmbeddingOptionsForState,
  type AnalysisEmbeddingState,
} from './analysisEmbeddingModel'

interface MutableRef<T> {
  current: T
}

interface AnalysisEmbeddingWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
  readonly onSelectedCellFocus?: (cell: OverviewCellDatum) => void
}

interface AnalysisEmbeddingWorkflowData {
  readonly analysisEmbeddingState: AnalysisEmbeddingState<StructuredLoadError>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly overviewCellById: ReadonlyMap<string, OverviewCellDatum>
  readonly selectedEmbeddingKind: AnalysisEmbeddingKind
}

interface AnalysisEmbeddingWorkflowLoaders {
  readonly loadAnalysisEmbeddings: AnalysisEmbeddingsLoader
}

interface AnalysisEmbeddingWorkflowRefs {
  readonly analysisEmbeddingAbortRef: MutableRef<AbortController | null>
  readonly analysisEmbeddingRequestIdRef: MutableRef<number>
}

interface AnalysisEmbeddingWorkflowSetters {
  readonly setAnalysisEmbeddingState: Dispatch<
    SetStateAction<AnalysisEmbeddingState<StructuredLoadError>>
  >
  readonly setSelectedCell: Dispatch<SetStateAction<OverviewCellDatum | null>>
  readonly setSelectedEmbeddingKind: Dispatch<SetStateAction<AnalysisEmbeddingKind>>
}

interface UseAnalysisEmbeddingWorkflowOptions {
  readonly callbacks: AnalysisEmbeddingWorkflowCallbacks
  readonly data: AnalysisEmbeddingWorkflowData
  readonly loaders: AnalysisEmbeddingWorkflowLoaders
  readonly refs: AnalysisEmbeddingWorkflowRefs
  readonly setters: AnalysisEmbeddingWorkflowSetters
}

interface UseAnalysisEmbeddingWorkflowResult {
  readonly handleEmbeddingCellSelect: (cellId: string) => void
  readonly handleLoadAnalysisEmbeddings: () => void
}

export function useAnalysisEmbeddingWorkflow({
  callbacks,
  data,
  loaders,
  refs,
  setters,
}: UseAnalysisEmbeddingWorkflowOptions): UseAnalysisEmbeddingWorkflowResult {
  const { appendDebugEvent, appendFallbackNotice, onSelectedCellFocus } = callbacks
  const { analysisEmbeddingState, loadState, overviewCellById, selectedEmbeddingKind } =
    data
  const { loadAnalysisEmbeddings } = loaders
  const { analysisEmbeddingAbortRef, analysisEmbeddingRequestIdRef } = refs
  const { setAnalysisEmbeddingState, setSelectedCell, setSelectedEmbeddingKind } = setters

  const handleLoadAnalysisEmbeddings = useCallback(() => {
    if (loadState.status !== 'ready' || analysisEmbeddingState.status === 'loading') {
      return
    }

    const request = startLatestRequest({
      abortRef: analysisEmbeddingAbortRef,
      requestIdRef: analysisEmbeddingRequestIdRef,
    })
    const embeddingOptions = analysisEmbeddingOptionsForState(analysisEmbeddingState)
    setAnalysisEmbeddingState(
      analysisEmbeddingLoadStarted(
        loadState.url,
        embeddingOptions.length === 0 ? undefined : embeddingOptions,
      ),
    )
    appendDebugEvent(`Loading embedding ${selectedEmbeddingKind}`)

    void loadAnalysisEmbeddings(loadState.url, {
      signal: request.signal,
      kind: selectedEmbeddingKind,
      onFallback: appendFallbackNotice,
    })
      .then((embeddings) => {
        if (!request.isCurrent()) {
          return
        }

        setAnalysisEmbeddingState(
          analysisEmbeddingLoadReady(
            loadState.url,
            embeddings,
            embeddingOptions.length === 0 ? undefined : embeddingOptions,
          ),
        )

        if (
          embeddings.length > 0 &&
          !embeddings.some((embedding) => embedding.kind === selectedEmbeddingKind)
        ) {
          setSelectedEmbeddingKind(embeddings[0]?.kind ?? 'umap')
        }
        appendDebugEvent(`Embeddings loaded: ${embeddings.length.toLocaleString()} views`)
      })
      .catch((error) => {
        if (isAbortError(error) || !request.isCurrent()) {
          return
        }

        setAnalysisEmbeddingState(
          analysisEmbeddingLoadFailed(
            loadState.url,
            createStructuredLoadError('Embeddings', error),
          ),
        )
        appendDebugEvent('Embeddings failed')
      })
      .finally(() => {
        request.complete()
      })
  }, [
    analysisEmbeddingAbortRef,
    analysisEmbeddingRequestIdRef,
    analysisEmbeddingState,
    appendDebugEvent,
    appendFallbackNotice,
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
