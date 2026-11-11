import type {
  AnalysisEmbedding,
  AnalysisEmbeddingElementLabel,
  AnalysisEmbeddingKind,
  AnalysisEmbeddingOption,
} from '../../data/analysisEmbeddings'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'
import {
  analysisEmbeddingOptionsForState,
  type AnalysisEmbeddingState,
} from '../analysis/analysisEmbeddingModel'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'

// UMAP or t-SNE beside the tissue (UNIFIED_PLAN.md, 15.2-G): the Cell tab's
// Embeddings section, and the new shell's floating Embedding panel.
export interface EmbeddingModel {
  // "Idle", "Loading", "2 embeddings".
  readonly copy: string
  readonly loading: boolean
  readonly options: readonly AnalysisEmbeddingOption[]
  readonly selectedKind: AnalysisEmbeddingKind
  readonly onKindChange: (kind: AnalysisEmbeddingKind) => void
  readonly canLoad: boolean
  readonly onLoad: () => void
  readonly embedding: AnalysisEmbedding | null
  readonly annotationStyles: readonly AnnotationColorStyle[]
  // Selection sync both ways: the ROI's and the selected cell's points light
  // up, and picking a point selects that cell or bin.
  readonly roiElementIds: readonly string[]
  readonly selectedElementId: string | null
  readonly elementLabel: AnalysisEmbeddingElementLabel
  readonly onSelectElement: (elementId: string) => void
}

export interface EmbeddingModelInput {
  readonly activeEmbedding: AnalysisEmbedding | null
  readonly analysisEmbeddingState: AnalysisEmbeddingState
  readonly annotationStyles: readonly AnnotationColorStyle[]
  readonly appendDebugEvent: AppendDebugEvent
  readonly copy: string
  readonly datasetReady: boolean
  readonly elementLabel: AnalysisEmbeddingElementLabel
  readonly onLoad: () => void
  readonly onSelectElement: (elementId: string) => void
  readonly roiElementIds: readonly string[]
  readonly selectedElementId: string | null
  readonly selectedKind: AnalysisEmbeddingKind
  readonly setSelectedKind: (kind: AnalysisEmbeddingKind) => void
}

export function useEmbeddingModel({
  activeEmbedding,
  analysisEmbeddingState,
  annotationStyles,
  appendDebugEvent,
  copy,
  datasetReady,
  elementLabel,
  onLoad,
  onSelectElement,
  roiElementIds,
  selectedElementId,
  selectedKind,
  setSelectedKind,
}: EmbeddingModelInput): EmbeddingModel {
  const loading = analysisEmbeddingState.status === 'loading'

  return {
    copy,
    loading,
    options: analysisEmbeddingOptionsForState(analysisEmbeddingState),
    selectedKind: activeEmbedding?.kind ?? selectedKind,
    onKindChange: (kind) => {
      setSelectedKind(kind)
      appendDebugEvent(`Embedding view: ${kind}`)
    },
    canLoad: datasetReady && !loading,
    onLoad,
    embedding: activeEmbedding,
    annotationStyles,
    roiElementIds,
    selectedElementId,
    elementLabel,
    onSelectElement,
  }
}
