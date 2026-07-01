import type {
  AnalysisEmbedding,
  AnalysisEmbeddingElementLabel,
  AnalysisEmbeddingOption,
} from '../../data/analysisEmbeddings'

export type AnalysisEmbeddingState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | {
      readonly status: 'available'
      readonly url: string
      readonly options: readonly AnalysisEmbeddingOption[]
    }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly options?: readonly AnalysisEmbeddingOption[]
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly embeddings: readonly AnalysisEmbedding[]
      readonly options?: readonly AnalysisEmbeddingOption[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export const IDLE_ANALYSIS_EMBEDDING_STATE: AnalysisEmbeddingState<never> = {
  status: 'idle',
}

export function analysisEmbeddingOptionsReady(
  url: string,
  options: readonly AnalysisEmbeddingOption[],
): AnalysisEmbeddingState<never> {
  return { status: 'available', url, options }
}

export function analysisEmbeddingLoadStarted(
  url: string,
  options?: readonly AnalysisEmbeddingOption[],
): AnalysisEmbeddingState<never> {
  return {
    status: 'loading',
    url,
    ...(options === undefined ? {} : { options }),
  }
}

export function analysisEmbeddingLoadReady(
  url: string,
  embeddings: readonly AnalysisEmbedding[],
  options?: readonly AnalysisEmbeddingOption[],
): AnalysisEmbeddingState<never> {
  return {
    status: 'ready',
    url,
    embeddings,
    ...(options === undefined ? {} : { options }),
  }
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

  if (state.status === 'available') {
    const noun = state.options.length === 1 ? 'view' : 'views'
    return `${state.options.length.toLocaleString()} ${noun} available`
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

export function analysisEmbeddingOptionsForState(
  state: AnalysisEmbeddingState,
): readonly AnalysisEmbeddingOption[] {
  if (state.status === 'available' || state.status === 'loading') {
    return state.options ?? []
  }

  if (state.status === 'ready') {
    return (
      state.options ??
      state.embeddings.map((embedding) => ({
        kind: embedding.kind,
        label: embedding.label,
        sourcePath: embedding.sourcePath,
      }))
    )
  }

  return []
}
