import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MagicLensPanel, RoiGeneStatsPanel } from './RoiPanels'

describe('RoiPanels', () => {
  it('renders magic lens summaries and selected top genes', () => {
    render(
      <MagicLensPanel
        state={{
          status: 'ready',
          url: 'https://example.test/output',
          scope: 'roi',
          summary: {
            transcriptCount: 120,
            cellCount: 4,
            geneCount: 2,
            selectedGeneTranscriptCount: 10,
            hitLimit: true,
            topGenes: [
              { gene: 'Actb', count: 10, percentTotal: 50, selected: true },
              { gene: 'Gad1', count: 5, percentTotal: 25, selected: false },
            ],
          },
        }}
      />,
    )

    expect(screen.getByLabelText('Magic lens results')).toHaveTextContent('120+')
    expect(screen.getByLabelText('Magic lens gene distribution')).toHaveTextContent(
      'Actb',
    )
  })

  it('renders ROI gene stats with sampled-cell labels', () => {
    render(
      <RoiGeneStatsPanel
        copy="Genes ready"
        state={{
          status: 'ready',
          url: 'https://example.test/output',
          stats: {
            genes: [
              {
                gene: 'Actb',
                count: 20,
                detectedCells: 3,
                percentCells: 75,
                meanPerCell: 5,
                percentTotal: 40,
              },
            ],
            cellCount: 10,
            sampledCellCount: 4,
            totalCount: 50,
            hitCellLimit: true,
          },
        }}
      />,
    )

    expect(screen.getByLabelText('ROI gene distribution')).toHaveTextContent('4 sampled')
    expect(screen.getByText('Actb')).toBeInTheDocument()
  })
})
