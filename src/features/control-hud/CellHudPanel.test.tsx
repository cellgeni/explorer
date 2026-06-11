import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import { CellHudPanel } from './CellHudPanel'

const embeddings: readonly AnalysisEmbedding[] = [
  {
    kind: 'umap',
    label: 'UMAP',
    sourcePath: 'analysis/umap/projection.csv',
    points: [{ id: asCellId('aaaaaaaa-1'), x: 1, y: 2 }],
  },
  {
    kind: 'tsne',
    label: 't-SNE',
    sourcePath: 'analysis/tsne/projection.csv',
    points: [{ id: asCellId('aaaaaaaa-1'), x: 3, y: 4 }],
  },
]

describe('CellHudPanel', () => {
  it('renders embedding and cell-info controls and forwards embedding actions', () => {
    const onEmbeddingKindChange = vi.fn()
    const onLoadAnalysisEmbeddings = vi.fn()

    render(
      <CellHudPanel
        active
        embeddingViewInputId="embedding-view"
        embeddingCopy="UMAP: 1 cell"
        analysisEmbeddingState={{
          status: 'ready',
          url: 'https://example.test/output',
          embeddings,
        }}
        activeEmbedding={null}
        annotationStyles={[]}
        selectedEmbeddingKind="umap"
        roiCellIds={[]}
        selectedCell={null}
        selectedCellAnnotationLabels={[]}
        cellDetailCopy="No selection"
        cellDetailState={{ status: 'idle' }}
        cellTranscriptDistributionState={{ status: 'idle' }}
        loadEnabled
        onEmbeddingKindChange={onEmbeddingKindChange}
        onLoadAnalysisEmbeddings={onLoadAnalysisEmbeddings}
        onSelectEmbeddingCell={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Embedding view'), {
      target: { value: 'tsne' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))

    expect(screen.getByText('Cell Info')).toBeInTheDocument()
    expect(screen.getByText('No embedding loaded')).toBeInTheDocument()
    expect(onEmbeddingKindChange).toHaveBeenCalledWith('tsne')
    expect(onLoadAnalysisEmbeddings).toHaveBeenCalledTimes(1)
  })
})
