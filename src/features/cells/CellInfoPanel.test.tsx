import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CellInfoPanel } from './CellInfoPanel'
import type { CellBoundaryDatum, OverviewCellDatum } from '../../rendering/deckLayers'

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

  it('lists the nuclei drawn for the cell with their area and circularity', () => {
    const nucleus = (id: string, size: number): CellBoundaryDatum => ({
      id,
      cellId: 'cell-1',
      polygon: [
        [0, 0, 0],
        [size, 0, 0],
        [size, -size, 0],
        [0, -size, 0],
      ],
      fillColor: [0, 0, 0, 0],
      lineColor: [0, 0, 0, 0],
    })
    const { rerender } = render(
      <CellInfoPanel
        cell={cellDatum({ nucleusCount: 2 })}
        nuclei={[nucleus('cell-1', 4), nucleus('cell-1#nucleus-2', 2)]}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('Nucleus 1').nextElementSibling).toHaveTextContent(
      '16 µm², circularity 0.785',
    )
    expect(screen.getByText('Nucleus 2')).toHaveAttribute('title', 'cell-1#nucleus-2')
    expect(screen.getByText('Nucleus 2').nextElementSibling).toHaveTextContent('4 µm²')

    rerender(
      <CellInfoPanel
        cell={cellDatum()}
        nuclei={[nucleus('cell-1', 4)]}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
        variant="observations"
      />,
    )

    expect(screen.getByText('Nucleus').nextElementSibling).toHaveTextContent('16 µm²')

    // Where a dataset's units are unknown.
    rerender(
      <CellInfoPanel
        cell={cellDatum()}
        nuclei={[nucleus('cell-1', 4)]}
        unitLabel="units"
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
        variant="observations"
      />,
    )
    expect(screen.getByText('Nucleus').nextElementSibling).toHaveTextContent('16 units²')
  })

  it('names the cell and its annotations in the observations variant', () => {
    render(
      <CellInfoPanel
        cell={cellDatum({ metadata: { n_genes: 12 } })}
        annotationLabels={['T cell']}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
        variant="observations"
      />,
    )

    expect(screen.getByText('ID').nextElementSibling).toHaveTextContent('cell-1')
    expect(screen.getByText('Annotations').nextElementSibling).toHaveTextContent('T cell')
    expect(screen.getByText('n_genes')).toBeInTheDocument()
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

  it('names the genes a per-gene z histogram counts, and asks for genes', () => {
    const distribution = {
      bins: [{ minZ: 0, maxZ: 3, count: 4, percent: 100 }],
      transcriptCount: 4,
      zCount: 4,
      missingZCount: 0,
      minZ: 0,
      maxZ: 3,
      maxBinCount: 4,
      hitTranscriptLimit: false,
      minQv: 20,
      featureNames: ['UMOD', 'NPHS1', 'PODXL', 'SLC34A1'],
    }
    const { rerender } = render(
      <CellInfoPanel
        cell={cellDatum()}
        state={{ status: 'idle' }}
        transcriptDistributionState={{
          status: 'ready',
          url: 'https://example.test/atera',
          cellId: 'cell-1',
          distribution,
        }}
      />,
    )

    expect(
      screen.getByText('4 transcript rows · QV 20+ · UMOD, NPHS1, PODXL +1'),
    ).toBeInTheDocument()

    rerender(
      <CellInfoPanel
        cell={cellDatum()}
        state={{ status: 'idle' }}
        transcriptDistributionState={{
          status: 'ready',
          url: 'https://example.test/atera',
          cellId: 'cell-1',
          distribution: {
            ...distribution,
            bins: [],
            transcriptCount: 0,
            zCount: 0,
            maxBinCount: 0,
            featureNames: [],
          },
        }}
      />,
    )

    expect(screen.getByText('Select genes')).toBeInTheDocument()
    expect(
      screen.getByText(/Select genes to see their transcripts' z locations/),
    ).toBeInTheDocument()
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

  it('shows why the gene expression profile is unavailable', () => {
    render(
      <CellInfoPanel
        cell={cellDatum()}
        state={{
          status: 'error',
          url: 'https://example.test/data.zarr',
          cellId: 'cell-1',
          error: {
            title: 'Expression matrix chunked by gene',
            message:
              "AnnData dense /X is chunked by gene, in chunks of 125,955 cells x 10 genes, so one cell's profile would read 1,297 chunks holding 6.1 GB of values, over the 256.0 MB limit.",
          },
        }}
        transcriptDistributionState={{ status: 'idle' }}
        transcriptDistributionVisible={false}
      />,
    )

    expect(screen.getByText('Gene expression').nextElementSibling).toHaveTextContent(
      'Unavailable',
    )
    expect(
      screen.getByText(/^Expression matrix chunked by gene: AnnData dense \/X/),
    ).toBeInTheDocument()
  })

  it('reads metadata the source builds on demand', () => {
    const readMetadata = vi.fn(() => ({ cell_type: 'Astrocyte', n_genes: 812 }))

    render(
      <CellInfoPanel
        cell={cellDatum({ readMetadata })}
        state={{ status: 'idle' }}
        transcriptDistributionState={{ status: 'idle' }}
        transcriptDistributionVisible={false}
        variant="observations"
      />,
    )

    expect(screen.getByText('cell_type')).toBeInTheDocument()
    expect(screen.getByText('Astrocyte')).toBeInTheDocument()
    expect(screen.getByText('812')).toBeInTheDocument()
    expect(readMetadata).toHaveBeenCalled()
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
