import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import { BoundaryCellInfoPanel } from './BoundaryCellInfoPanel'

function boundaryCell(values: Partial<CellBoundaryDatum> = {}): CellBoundaryDatum {
  return {
    id: 'cellid_000000042-1',
    // A 10 × 10 µm square.
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    fillColor: [34, 120, 108, 28],
    lineColor: [22, 90, 82, 150],
    ...values,
  }
}

function valueOf(term: string): string | null | undefined {
  return screen.getByText(term).nextElementSibling?.textContent
}

describe('BoundaryCellInfoPanel', () => {
  it('shows the cell ID, segmentation, vertex count and area', () => {
    render(<BoundaryCellInfoPanel cell={boundaryCell()} />)

    expect(valueOf('Cell ID')).toBe('cellid_000000042-1')
    expect(valueOf('Segmentation')).toBe('Cell boundary')
    expect(valueOf('Vertices')).toBe('4')
    expect(valueOf('Area')).toBe('100 µm²')
    expect(screen.queryByText('Annotation')).not.toBeInTheDocument()
  })

  it('shows the annotation label when the cell has one', () => {
    render(
      <BoundaryCellInfoPanel cell={boundaryCell({ annotationLabel: 'Astrocyte' })} />,
    )

    expect(valueOf('Annotation')).toBe('Astrocyte')
  })

  it.each<[string, CellBoundaryDatum['polygon'], string]>([
    [
      'a clockwise triangle',
      [
        [0, 0],
        [0, 3],
        [3, 0],
      ],
      '4.5 µm²',
    ],
    [
      'an L-shaped polygon',
      [
        [0, 0],
        [20, 0],
        [20, 10],
        [10, 10],
        [10, 20],
        [0, 20],
      ],
      '300 µm²',
    ],
    [
      'a large rectangle',
      [
        [0, 0],
        [123.45, 0],
        [123.45, 10],
        [0, 10],
      ],
      '1,234.5 µm²',
    ],
    [
      'a line, which has no area',
      [
        [0, 0],
        [5, 5],
      ],
      '0 µm²',
    ],
  ])('computes the area of %s', (_name, polygon, area) => {
    render(<BoundaryCellInfoPanel cell={boundaryCell({ polygon })} />)

    expect(valueOf('Area')).toBe(area)
  })

  it('shows the expression status until selected-gene expression is loaded', () => {
    const { rerender } = render(<BoundaryCellInfoPanel cell={boundaryCell()} />)

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('No expression loaded')).toBeInTheDocument()

    rerender(
      <BoundaryCellInfoPanel
        cell={boundaryCell()}
        expressionStatus={{ status: 'loading', message: 'Reading Gad1 counts' }}
      />,
    )
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.getByText('Reading Gad1 counts')).toBeInTheDocument()
  })

  it('shows the loaded score and the genes it covers', () => {
    const { rerender } = render(
      <BoundaryCellInfoPanel
        cell={boundaryCell({
          expressionCount: 12.345,
          expressionGenes: ['Gad1', 'Actb'],
        })}
        expressionStatus={{ status: 'error', message: 'ignored once loaded' }}
      />,
    )

    expect(screen.getByText('Loaded')).toBeInTheDocument()
    expect(valueOf('Score')).toBe('12.3')
    expect(valueOf('Genes')).toBe('Gad1, Actb')
    expect(screen.queryByText('ignored once loaded')).not.toBeInTheDocument()

    rerender(<BoundaryCellInfoPanel cell={boundaryCell({ expressionCount: 3.14159 })} />)
    expect(valueOf('Score')).toBe('3.14')
    expect(valueOf('Genes')).toBe('Selected genes')
  })

  it('shows a zero score as loaded', () => {
    render(<BoundaryCellInfoPanel cell={boundaryCell({ expressionCount: 0 })} />)

    expect(screen.getByText('Loaded')).toBeInTheDocument()
    expect(valueOf('Score')).toBe('0')
  })

  it('disables the profile button until a loader is given, then calls it', () => {
    const { rerender } = render(<BoundaryCellInfoPanel cell={boundaryCell()} />)
    const button = screen.getByRole('button', { name: 'Load Cell GEX' })

    expect(button).toBeDisabled()

    const onLoad = vi.fn()
    rerender(
      <BoundaryCellInfoPanel cell={boundaryCell()} onLoadExpressionProfile={onLoad} />,
    )
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('shows a loaded expression profile', () => {
    render(
      <BoundaryCellInfoPanel
        cell={boundaryCell()}
        onLoadExpressionProfile={vi.fn()}
        expressionProfileState={{
          status: 'ready',
          selectionId: 'cellid_000000042-1',
          selectionKind: 'cell',
          expression: {
            genes: [{ gene: 'Slc17a7', count: 42, percentTotal: 100 }],
            totalCount: 42,
            hitGeneLimit: false,
          },
        }}
      />,
    )

    expect(screen.getByText('42 counts')).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Top selected cell genes' }),
    ).toHaveTextContent('Slc17a7')
    expect(screen.getByRole('button', { name: 'Refresh Cell GEX' })).toBeEnabled()
  })
})
