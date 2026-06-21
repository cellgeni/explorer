import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from '../../rendering/deckLayers'
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
        isVisiumHdDataset={false}
        selectedCell={null}
        selectedGridCell={null}
        selectedGridCellAssignmentState={{ status: 'idle' }}
        selectedBoundaryCell={null}
        selectedCellAnnotationLabels={[]}
        cellDetailCopy="No selection"
        cellDetailState={{ status: 'idle' }}
        cellTranscriptDistributionState={{ status: 'idle' }}
        loadEnabled
        onEmbeddingKindChange={onEmbeddingKindChange}
        onLoadAnalysisEmbeddings={onLoadAnalysisEmbeddings}
        onClearSelectedCell={vi.fn()}
        onClearSelectedGridCell={vi.fn()}
        onClearSelectedBoundaryCell={vi.fn()}
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

  it('forwards selected-cell clearing from the cell info header', () => {
    const onClearSelectedCell = vi.fn()

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
        isVisiumHdDataset={false}
        selectedCell={cellDatum()}
        selectedGridCell={null}
        selectedGridCellAssignmentState={{ status: 'idle' }}
        selectedBoundaryCell={null}
        selectedCellAnnotationLabels={[]}
        cellDetailCopy="Selected"
        cellDetailState={{ status: 'idle' }}
        cellTranscriptDistributionState={{ status: 'idle' }}
        loadEnabled
        onEmbeddingKindChange={vi.fn()}
        onLoadAnalysisEmbeddings={vi.fn()}
        onClearSelectedCell={onClearSelectedCell}
        onClearSelectedGridCell={vi.fn()}
        onClearSelectedBoundaryCell={vi.fn()}
        onSelectEmbeddingCell={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear Cell' }))

    expect(onClearSelectedCell).toHaveBeenCalledTimes(1)
  })

  it('renders selected Visium HD bin details and clears bin selection', () => {
    const onClearSelectedGridCell = vi.fn()

    render(
      <CellHudPanel
        active
        embeddingViewInputId="embedding-view"
        embeddingCopy="No embedding loaded"
        analysisEmbeddingState={{ status: 'idle' }}
        activeEmbedding={null}
        annotationStyles={[]}
        selectedEmbeddingKind="umap"
        roiCellIds={[]}
        isVisiumHdDataset
        selectedCell={null}
        selectedGridCell={gridCellDatum()}
        selectedGridCellAssignmentState={{
          status: 'ready',
          binId: 'BC-1',
          assignment: {
            cellId: 'cellid_000000001-1',
            inNucleus: true,
            inCell: true,
            rowBudget: 12_000_000,
          },
        }}
        selectedBoundaryCell={null}
        selectedCellAnnotationLabels={[]}
        cellDetailCopy="No selection"
        cellDetailState={{ status: 'idle' }}
        cellTranscriptDistributionState={{ status: 'idle' }}
        loadEnabled={false}
        onEmbeddingKindChange={vi.fn()}
        onLoadAnalysisEmbeddings={vi.fn()}
        onClearSelectedCell={vi.fn()}
        onClearSelectedGridCell={onClearSelectedGridCell}
        onClearSelectedBoundaryCell={vi.fn()}
        onSelectEmbeddingCell={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Bin Info' })).toBeInTheDocument()
    expect(screen.getByText('Selected bin')).toBeInTheDocument()
    expect(screen.getByText('BC-1')).toBeInTheDocument()
    expect(screen.getByText('16 um')).toBeInTheDocument()
    expect(screen.getByText('In tissue')).toBeInTheDocument()
    expect(screen.getByText('row 4, col 7')).toBeInTheDocument()
    expect(screen.getByText('row 128, col 256')).toBeInTheDocument()
    expect(screen.getByText('cellid_000000001-1')).toBeInTheDocument()
    expect(screen.getByText('Nucleus')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear Bin' }))

    expect(onClearSelectedGridCell).toHaveBeenCalledTimes(1)
  })

  it('renders selected Visium HD segmented cell details and clears cell selection', () => {
    const onClearSelectedBoundaryCell = vi.fn()

    render(
      <CellHudPanel
        active
        embeddingViewInputId="embedding-view"
        embeddingCopy="No embedding loaded"
        analysisEmbeddingState={{ status: 'idle' }}
        activeEmbedding={null}
        annotationStyles={[]}
        selectedEmbeddingKind="umap"
        roiCellIds={[]}
        isVisiumHdDataset
        selectedCell={null}
        selectedGridCell={null}
        selectedGridCellAssignmentState={{ status: 'idle' }}
        selectedBoundaryCell={boundaryCellDatum({
          expressionCount: 5,
          expressionGenes: ['Actb'],
        })}
        selectedCellAnnotationLabels={[]}
        cellDetailCopy="No selection"
        cellDetailState={{ status: 'idle' }}
        cellTranscriptDistributionState={{ status: 'idle' }}
        loadEnabled={false}
        onEmbeddingKindChange={vi.fn()}
        onLoadAnalysisEmbeddings={vi.fn()}
        onClearSelectedCell={vi.fn()}
        onClearSelectedGridCell={vi.fn()}
        onClearSelectedBoundaryCell={onClearSelectedBoundaryCell}
        onSelectEmbeddingCell={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Cell Info' })).toBeInTheDocument()
    expect(screen.getByText('Selected cell')).toBeInTheDocument()
    expect(screen.getByText('cellid_000000001-1')).toBeInTheDocument()
    expect(screen.getByText('Annotation')).toBeInTheDocument()
    expect(screen.getByText('Cluster 2')).toBeInTheDocument()
    expect(screen.getByText('Cell boundary')).toBeInTheDocument()
    expect(screen.getByText('100 um^2')).toBeInTheDocument()
    expect(screen.getByText('Loaded')).toBeInTheDocument()
    expect(screen.getByText('Actb')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear Cell' }))

    expect(onClearSelectedBoundaryCell).toHaveBeenCalledTimes(1)
  })
})

function cellDatum(values: Partial<OverviewCellDatum> = {}): OverviewCellDatum {
  return {
    id: 'cell-1',
    position: [10, -20, 0],
    radiusPixels: 4,
    fillColor: [215, 63, 124, 220],
    transcriptCount: 12,
    cellArea: 40,
    ...values,
  }
}

function gridCellDatum(values: Partial<GridCellDatum> = {}): GridCellDatum {
  return {
    id: 'BC-1',
    gridId: 'grid-16um',
    row: 4,
    col: 7,
    binSizeMicrometers: 16,
    inTissue: true,
    fullresRow: 128,
    fullresCol: 256,
    polygon: [
      [0, 0, 0],
      [16, 0, 0],
      [16, -16, 0],
      [0, -16, 0],
    ],
    fillColor: [34, 120, 108, 28],
    lineColor: [22, 90, 82, 150],
    ...values,
  }
}

function boundaryCellDatum(values: Partial<CellBoundaryDatum> = {}): CellBoundaryDatum {
  return {
    id: 'cellid_000000001-1',
    annotationLabel: 'Cluster 2',
    polygon: [
      [0, 0, 0],
      [10, 0, 0],
      [10, -10, 0],
      [0, -10, 0],
    ],
    fillColor: [32, 102, 83, 34],
    lineColor: [32, 102, 83, 190],
    ...values,
  }
}
