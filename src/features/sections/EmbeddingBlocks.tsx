import { useId } from 'react'
import { EmbeddingPanel } from '../analysis/EmbeddingPanel'
import type { EmbeddingModel } from './embeddingModel'

// The embedding to show, and Load Embeddings.
export function EmbeddingControls({ embedding }: { readonly embedding: EmbeddingModel }) {
  const selectId = useId()

  return (
    <div className="embedding-controls">
      <label htmlFor={selectId}>Embedding view</label>
      <select
        id={selectId}
        value={embedding.selectedKind}
        disabled={embedding.options.length === 0}
        title="Embedding view"
        onChange={(event) => {
          embedding.onKindChange(event.currentTarget.value)
        }}
      >
        {embedding.options.length > 0 ? (
          embedding.options.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))
        ) : (
          <>
            <option value="umap">UMAP</option>
            <option value="tsne">t-SNE</option>
          </>
        )}
      </select>
      <button
        type="button"
        className="secondary-action"
        disabled={!embedding.canLoad}
        title="Load embeddings"
        onClick={embedding.onLoad}
      >
        {embedding.loading ? 'Loading...' : 'Load Embeddings'}
      </button>
    </div>
  )
}

// The scatter plot, linked to the selection both ways.
export function EmbeddingPlot({ embedding }: { readonly embedding: EmbeddingModel }) {
  return (
    <EmbeddingPanel
      embedding={embedding.embedding}
      annotationStyles={embedding.annotationStyles}
      roiElementIds={embedding.roiElementIds}
      selectedElementId={embedding.selectedElementId}
      elementLabel={embedding.elementLabel}
      onSelectElement={embedding.onSelectElement}
    />
  )
}
