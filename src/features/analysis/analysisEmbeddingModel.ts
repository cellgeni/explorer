import type {
  AnalysisEmbedding,
  AnalysisEmbeddingElementLabel,
} from '../../data/analysisEmbeddings'

export type AnalysisEmbeddingState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly embeddings: readonly AnalysisEmbedding[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export const IDLE_ANALYSIS_EMBEDDING_STATE: AnalysisEmbeddingState<never> = {
  status: 'idle',
}

export function analysisEmbeddingLoadStarted(url: string): AnalysisEmbeddingState<never> {
  return { status: 'loading', url }
}

export function analysisEmbeddingLoadReady(
  url: string,
  embeddings: readonly AnalysisEmbedding[],
): AnalysisEmbeddingState<never> {
  return { status: 'ready', url, embeddings }
}

export function analysisEmbeddingLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): AnalysisEmbeddingState<ErrorType> {
  return { status: 'error', url, error }
}

export function analysisEmbeddingStatusCopy<ErrorType>(
  state: AnalysisEmbeddingState<ErrorType>,
  activeEmbedding: AnalysisEmbedding | null,
  roiElementIds: readonly string[],
  selectedElementId: string | null,
  elementLabel: AnalysisEmbeddingElementLabel = 'cells',
): string {
  if (state.status === 'loading') {
    return 'Loading'
  }

  if (state.status === 'ready') {
    if (activeEmbedding === null) {
      return 'No projection'
    }

    const linkedCount = roiElementIds.length + (selectedElementId === null ? 0 : 1)

    return linkedCount === 0
      ? `${activeEmbedding.label}: ${activeEmbedding.points.length.toLocaleString()} ${elementLabel}`
      : `${activeEmbedding.label}: ${linkedCount.toLocaleString()} linked`
  }

  if (state.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}
