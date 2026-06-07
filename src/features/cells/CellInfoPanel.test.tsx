import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CellInfoPanel } from './CellInfoPanel'
import type { OverviewCellDatum } from '../../rendering/deckLayers'

describe('CellInfoPanel', () => {
  it('shows the selected cell nuclei count when available', () => {
    render(
      <CellInfoPanel
        cell={cellDatum({
          nucleusCount: 2,
          segmentationMethod: 'nucleus_expansion',
        })}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
      />,
    )

    const nucleiTerm = screen.getByText('Nuclei')
    const segmentationTerm = screen.getByText('Segmentation')

    expect(nucleiTerm.nextElementSibling).toHaveTextContent('2')
    expect(segmentationTerm.nextElementSibling).toHaveTextContent('nucleus_expansion')
  })

  it('shows unavailable values when optional cell metadata is absent', () => {
    render(
      <CellInfoPanel
        cell={cellDatum()}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
      />,
    )

    const nucleiTerm = screen.getByText('Nuclei')
    const segmentationTerm = screen.getByText('Segmentation')

    expect(nucleiTerm.nextElementSibling).toHaveTextContent('None')
    expect(segmentationTerm.nextElementSibling).toHaveTextContent('None')
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
