import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import { EmbeddingPanel } from './EmbeddingPanel'

const embedding: AnalysisEmbedding = {
  kind: 'umap',
  label: 'UMAP',
  sourcePath: 'analysis/umap/projection.csv',
  points: [
    { id: asCellId('aaaaaaaa-1'), x: 0, y: 0 },
    { id: asCellId('bbbbbbbb-2'), x: 10, y: 10 },
  ],
}

function canvasContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('EmbeddingPanel', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 190,
      width: 320,
      height: 190,
      toJSON: () => ({}),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows an empty state when no embedding is loaded', () => {
    render(
      <EmbeddingPanel
        embedding={null}
        roiCellIds={[]}
        selectedCellId={null}
        onSelectCell={vi.fn()}
      />,
    )

    expect(screen.getByText('No embedding loaded')).toBeInTheDocument()
  })

  it('renders embedding summary and selects the nearest point from the canvas', () => {
    const onSelectCell = vi.fn()

    render(
      <EmbeddingPanel
        embedding={embedding}
        roiCellIds={['aaaaaaaa-1']}
        selectedCellId="bbbbbbbb-2"
        onSelectCell={onSelectCell}
      />,
    )

    expect(
      screen.getByRole('img', { name: 'UMAP embedding, 2 cells' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ROI').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Selected').nextElementSibling).toHaveTextContent('1')

    fireEvent.pointerDown(screen.getByRole('img'), { clientX: 308, clientY: 12 })

    expect(onSelectCell).toHaveBeenCalledWith('bbbbbbbb-2')
  })
})
