import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GridCellDatum } from '../../rendering/deckLayers'
import { GridCellInfoPanel } from './GridCellInfoPanel'

describe('GridCellInfoPanel', () => {
  it('shows selected Visium HD bin metadata', () => {
    render(<GridCellInfoPanel cell={gridCellDatum()} />)

    expect(screen.getByText('BC-1')).toBeInTheDocument()
    expect(screen.getByText('16 um')).toBeInTheDocument()
    expect(screen.getByText('In tissue')).toBeInTheDocument()
    expect(screen.getByText('row 4, col 7')).toBeInTheDocument()
    expect(screen.getByText('row 128, col 256')).toBeInTheDocument()
    expect(screen.getByText('Cell assignment')).toBeInTheDocument()
    expect(screen.getByText('No assignment loaded')).toBeInTheDocument()
    expect(screen.getByText('Gene expression')).toBeInTheDocument()
    expect(screen.getByText('No expression loaded')).toBeInTheDocument()
  })

  it('shows unavailable values when optional bin metadata is absent', () => {
    render(<GridCellInfoPanel cell={gridCellDatum({}, false)} />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(5)
  })

  it('shows loaded Visium HD cell assignment metadata', () => {
    render(
      <GridCellInfoPanel
        cell={gridCellDatum()}
        assignmentState={{
          status: 'ready',
          binId: 'BC-1',
          assignment: {
            cellId: 'cellid_000000001-1',
            inNucleus: true,
            inCell: true,
            rowBudget: 12_000_000,
          },
        }}
      />,
    )

    expect(screen.getByText('Loaded')).toBeInTheDocument()
    expect(screen.getByText('cellid_000000001-1')).toBeInTheDocument()
    expect(screen.getByText('Nucleus')).toBeInTheDocument()
    expect(screen.getByText('12,000,000')).toBeInTheDocument()
  })

  it('shows Visium HD cell assignment errors', () => {
    render(
      <GridCellInfoPanel
        cell={gridCellDatum()}
        assignmentState={{
          status: 'error',
          binId: 'BC-1',
          error: {
            title: 'Barcode mapping over budget',
            message: 'Increase the row budget.',
          },
        }}
      />,
    )

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(
      screen.getByText('Barcode mapping over budget: Increase the row budget.'),
    ).toBeInTheDocument()
  })

  it('asks for a mapping row budget before loading assignment metadata', () => {
    render(
      <GridCellInfoPanel
        cell={gridCellDatum()}
        assignmentState={{
          status: 'unavailable',
          reason: 'Set a mapping row budget in Dataset to load assignment.',
        }}
      />,
    )

    expect(
      screen.getByText('Set a mapping row budget in Dataset to load assignment.'),
    ).toBeInTheDocument()
  })

  it('shows an empty state without a selected bin', () => {
    render(<GridCellInfoPanel cell={null} />)

    expect(screen.getByText('No bin selected')).toBeInTheDocument()
  })
})

function gridCellDatum(
  values: Partial<GridCellDatum> = {},
  includeMetadata = true,
): GridCellDatum {
  return {
    id: 'BC-1',
    gridId: 'grid-16um',
    row: 4,
    col: 7,
    ...(includeMetadata
      ? {
          binSizeMicrometers: 16,
          inTissue: true,
          fullresRow: 128,
          fullresCol: 256,
        }
      : {}),
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
