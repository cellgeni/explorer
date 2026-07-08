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

  it('shows selected-cell annotation labels when present', () => {
    render(
      <CellInfoPanel
        cell={cellDatum()}
        annotationLabels={['CD16+ NK cells', 'Portal macrophages']}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
      />,
    )

    const annotationsTerm = screen.getByText('Annotations')

    expect(annotationsTerm.nextElementSibling).toHaveTextContent('CD16+ NK cells')
    expect(annotationsTerm.nextElementSibling).toHaveTextContent('Portal macrophages')
  })

  it('shows no selected-cell annotations when none match', () => {
    render(
      <CellInfoPanel
        cell={cellDatum()}
        annotationLabels={[]}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
      />,
    )

    const annotationsTerm = screen.getByText('Annotations')

    expect(annotationsTerm.nextElementSibling).toHaveTextContent('None')
  })

  it('hides transcript z-axis details when transcript distributions are disabled', () => {
    render(
      <CellInfoPanel
        cell={cellDatum()}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
        transcriptDistributionVisible={false}
      />,
    )

    expect(screen.queryByText('Z-axis transcripts')).not.toBeInTheDocument()
    expect(screen.getByText('Gene expression')).toBeInTheDocument()
  })

  it('shows only observation metadata in the observations variant', () => {
    render(
      <CellInfoPanel
        cell={cellDatum({
          metadata: {
            BARCODE_SAMPLE_CROP: 'TTCTCTCTCACTCCGT-1_WSSS_PLA8810751_1',
            FINAL_ANNOT_INV_TROPH_CORRECTED: 'INV_TROPH',
            N_GENES: 5395,
          },
        })}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
        transcriptDistributionVisible={false}
        variant="observations"
      />,
    )

    expect(screen.getByText('BARCODE_SAMPLE_CROP')).toBeInTheDocument()
    expect(screen.getByText('TTCTCTCTCACTCCGT-1_WSSS_PLA8810751_1')).toBeInTheDocument()
    expect(screen.getByText('FINAL_ANNOT_INV_TROPH_CORRECTED')).toBeInTheDocument()
    expect(screen.getByText('N_GENES')).toBeInTheDocument()
    expect(screen.queryByText('Cell Area')).not.toBeInTheDocument()
    expect(screen.queryByText('Eccentricity')).not.toBeInTheDocument()
    expect(screen.queryByText('Transcripts')).not.toBeInTheDocument()
    expect(screen.getByText('Gene expression')).toBeInTheDocument()
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
