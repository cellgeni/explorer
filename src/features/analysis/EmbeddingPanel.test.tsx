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

interface MockCanvasContext extends CanvasRenderingContext2D {
  readonly fillStyles: string[]
}

function canvasContext(): MockCanvasContext {
  const fillStyles: string[] = []
  const context = {
    fillStyles,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as MockCanvasContext

  Object.defineProperty(context, 'fillStyle', {
    get: () => fillStyles[fillStyles.length - 1] ?? '',
    set: (value: string) => {
      fillStyles.push(value)
    },
  })

  return context
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
        annotationStyles={[]}
        roiElementIds={[]}
        selectedElementId={null}
        onSelectElement={vi.fn()}
      />,
    )

    expect(screen.getByText('No embedding loaded')).toBeInTheDocument()
  })

  it('renders embedding summary and selects the nearest point from the canvas', () => {
    const onSelectCell = vi.fn()

    render(
      <EmbeddingPanel
        embedding={embedding}
        annotationStyles={[]}
        roiElementIds={['aaaaaaaa-1']}
        selectedElementId="bbbbbbbb-2"
        onSelectElement={onSelectCell}
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

  it('draws sampled embedding points with loaded annotation colors', () => {
    const context = canvasContext()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context)

    render(
      <EmbeddingPanel
        embedding={embedding}
        annotationStyles={[
          {
            id: 'annotation:t-cell',
            cellIds: [asCellId('aaaaaaaa-1')],
            color: '#123456',
          },
        ]}
        roiElementIds={[]}
        selectedElementId={null}
        onSelectElement={vi.fn()}
      />,
    )

    expect(context.fillStyles).toContain('rgba(18, 52, 86, 0.82)')
    expect(context.fillStyles).toContain('rgba(72, 68, 58, 0.34)')
  })

  it('labels Visium HD embedding points as bins', () => {
    render(
      <EmbeddingPanel
        embedding={embedding}
        annotationStyles={[]}
        roiElementIds={[]}
        selectedElementId={null}
        elementLabel="bins"
        onSelectElement={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('img', { name: 'UMAP embedding, 2 bins' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Bins').nextElementSibling).toHaveTextContent('2')
  })
})
