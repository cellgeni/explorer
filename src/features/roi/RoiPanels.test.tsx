import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RoiGeneStat, RoiGeneStats } from '../../data/roiGeneStats'
import { MagicLensPanel, RoiGeneStatsPanel } from './RoiPanels'

function stat(gene: string, count: number, detected: number, cells: number): RoiGeneStat {
  return {
    gene,
    count,
    detectedCells: detected,
    percentCells: (detected / cells) * 100,
    meanPerCell: count / cells,
    percentTotal: 10,
  }
}

function stats(cells: number, genes: readonly RoiGeneStat[]): RoiGeneStats {
  return {
    genes,
    cellCount: cells,
    sampledCellCount: cells,
    totalCount: 100,
    hitCellLimit: false,
  }
}

const URL = 'https://example.test/output'
const INSIDE = stats(10, [
  stat('ACTB', 100, 10, 10),
  stat('GFAP', 30, 6, 10),
  stat('AQP4', 20, 5, 10),
  stat('RARE', 5, 1, 10),
])
const OUTSIDE = stats(400, [stat('ACTB', 4_000, 400, 400), stat('GFAP', 40, 40, 400)])

function geneNames(): readonly (string | null | undefined)[] {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.roi-gene-row span')?.textContent)
}

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

  it('ranks enriched genes over the cells outside, and switches to most abundant', () => {
    const onShowGene = vi.fn()
    render(
      <RoiGeneStatsPanel
        copy=""
        state={{ status: 'ready', url: URL, stats: INSIDE }}
        reference={{ status: 'ready', url: URL, stats: OUTSIDE }}
        selectedGenes={['GFAP']}
        onShowGene={onShowGene}
      />,
    )

    expect(screen.getByText('Compared with 400 cells outside')).toBeInTheDocument()
    // AQP4 is absent outside and ranks first; RARE, in 10% of the cells
    // inside, meets the default minimum.
    expect(geneNames()).toEqual(['AQP4', 'GFAP', 'RARE', 'ACTB'])
    expect(screen.getByRole('button', { name: /^AQP4/ })).toHaveTextContent('+4.4')
    expect(screen.getByRole('button', { name: /^GFAP/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('60% in · 10% out')

    fireEvent.click(screen.getByRole('button', { name: /^AQP4/ }))
    expect(onShowGene).toHaveBeenCalledWith('AQP4')

    fireEvent.change(screen.getByRole('combobox', { name: 'Min % of cells' }), {
      target: { value: '25' },
    })
    expect(geneNames()).toEqual(['AQP4', 'GFAP', 'ACTB'])

    fireEvent.click(screen.getByRole('button', { name: 'Most abundant' }))
    expect(geneNames()).toEqual(['ACTB', 'GFAP', 'AQP4'])
    expect(screen.getByRole('button', { name: /^ACTB/ })).toHaveTextContent('100')
  })

  it('orders by count and says why while there is no comparison', () => {
    const { rerender } = render(
      <RoiGeneStatsPanel
        copy=""
        state={{ status: 'ready', url: URL, stats: INSIDE }}
        reference={{ status: 'loading', url: URL, cellCount: 412 }}
      />,
    )

    expect(screen.getByText('Comparing with 412 cells outside…')).toBeInTheDocument()
    expect(geneNames()).toEqual(['ACTB', 'GFAP', 'AQP4', 'RARE'])
    // Without onShowGene the rows are not buttons.
    expect(screen.queryByRole('button', { name: /^ACTB/ })).toBeNull()

    rerender(
      <RoiGeneStatsPanel
        copy=""
        state={{ status: 'ready', url: URL, stats: INSIDE }}
        reference={{ status: 'unavailable', url: URL }}
      />,
    )
    expect(
      screen.getByText('No comparison: no sampled cells outside this selection'),
    ).toBeInTheDocument()

    rerender(
      <RoiGeneStatsPanel
        copy=""
        state={{ status: 'ready', url: URL, stats: stats(10, [stat('RARE', 1, 1, 10)]) }}
        reference={{ status: 'ready', url: URL, stats: OUTSIDE }}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Min % of cells' }), {
      target: { value: '50' },
    })
    expect(
      screen.getByText('No gene is expressed in 50% of the cells inside'),
    ).toBeInTheDocument()
  })
})
