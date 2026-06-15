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
    expect(screen.getByText('Gene expression')).toBeInTheDocument()
    expect(screen.getByText('No expression loaded')).toBeInTheDocument()
  })

  it('shows unavailable values when optional bin metadata is absent', () => {
    render(<GridCellInfoPanel cell={gridCellDatum({}, false)} />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(4)
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
