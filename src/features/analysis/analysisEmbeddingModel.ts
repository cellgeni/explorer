import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import type { OverviewCellDatum } from '../../rendering/deckLayers'

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

export function analysisEmbeddingStatusCopy<ErrorType>(
  state: AnalysisEmbeddingState<ErrorType>,
  activeEmbedding: AnalysisEmbedding | null,
  roiCellIds: readonly string[],
  selectedCell: OverviewCellDatum | null,
): string {
  if (state.status === 'loading') {
    return 'Loading'
  }

  if (state.status === 'ready') {
    if (activeEmbedding === null) {
      return 'No projection'
    }

    const linkedCount = roiCellIds.length + (selectedCell === null ? 0 : 1)

    return linkedCount === 0
      ? `${activeEmbedding.label}: ${activeEmbedding.points.length.toLocaleString()} cells`
      : `${activeEmbedding.label}: ${linkedCount.toLocaleString()} linked`
  }

  if (state.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}
