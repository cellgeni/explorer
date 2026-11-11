import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type {
  CardStackModel,
  MagicLensCardModel,
  RegionSelectionCardModel,
} from './cardModels'
import { CardStack } from './CardStack'

const NO_CARDS: CardStackModel = {
  selection: null,
  cell: null,
  transcript: null,
  magicLens: null,
}

function selection(
  overrides: Partial<RegionSelectionCardModel> = {},
): RegionSelectionCardModel {
  return {
    variant: 'cells',
    name: 'ROI 1',
    nameLabel: 'ROI name',
    onNameChange: vi.fn(),
    nameDisabled: false,
    status: '2 cells',
    loading: false,
    closeTitle: 'Clear selection',
    onClose: vi.fn(),
    summary: '2 cells · 5,000 µm²',
    elementsLabel: 'Cells',
    stats: [{ label: 'Cells', value: '2' }],
    genes: {
      copy: '',
      state: {
        status: 'ready',
        url: 'https://example.test',
        stats: {
          genes: [
            {
              gene: 'Actb',
              count: 4,
              percentTotal: 80,
              percentCells: 100,
              meanPerCell: 2,
            },
          ],
          cellCount: 2,
          sampledCellCount: 2,
          totalCount: 5,
          hitCellLimit: false,
        },
      } as never,
      title: 'Top ROI genes',
      elementSingular: 'cell',
      elementPlural: 'cells',
      emptyMessage: null,
    },
    ready: true,
    onSave: vi.fn(),
    exports: [
      {
        label: 'Export GeoJSON',
        title: 'Export ROI as GeoJSON',
        busy: false,
        onExport: vi.fn(),
      },
      {
        label: 'Export Transcripts',
        title: 'Export ROI transcripts',
        busy: true,
        busyLabel: 'Exporting…',
        onExport: vi.fn(),
      },
    ],
    lens: {
      label: 'Transcripts',
      state: { status: 'idle' },
      canRun: true,
      onRun: vi.fn(),
    },
    ...overrides,
  }
}

describe('CardStack', () => {
  it('renders nothing without cards', () => {
    const { container } = render(<CardStack cards={NO_CARDS} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows a selection with its genes, counts and Magic Lens tabs', () => {
    const card = selection()
    render(<CardStack cards={{ ...NO_CARDS, selection: card }} />)

    const region = screen.getByRole('region', { name: 'ROI 1' })
    expect(within(region).getByText('2 cells · 5,000 µm²')).toBeInTheDocument()
    expect(
      within(region)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Genes', 'Cells', 'Transcripts'])
    expect(within(region).getByRole('tabpanel')).toHaveTextContent('Actb')

    fireEvent.keyDown(within(region).getByRole('tab', { name: 'Genes' }), {
      key: 'ArrowRight',
    })
    expect(within(region).getByRole('tab', { name: 'Cells' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(region).getByRole('tab', { name: 'Cells' })).toHaveFocus()
    expect(within(region).getByLabelText('ROI summary')).toHaveTextContent('Cells2')

    fireEvent.click(within(region).getByRole('tab', { name: 'Transcripts' }))
    fireEvent.click(within(region).getByRole('button', { name: 'Summarise Transcripts' }))
    expect(card.lens?.onRun).toHaveBeenCalledTimes(1)
  })

  it('renames, saves, exports and clears a selection', () => {
    const card = selection()
    render(<CardStack cards={{ ...NO_CARDS, selection: card }} />)

    fireEvent.change(screen.getByLabelText('ROI name'), { target: { value: 'Cortex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save ROI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export GeoJSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(card.onNameChange).toHaveBeenCalledWith('Cortex')
    expect(card.onSave).toHaveBeenCalledTimes(1)
    expect(card.exports[0]?.onExport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled()
    expect(card.onClose).toHaveBeenCalledTimes(1)
  })

  it('names the next shape while drawing on an image', () => {
    const onClose = vi.fn()
    render(
      <CardStack
        cards={{
          ...NO_CARDS,
          selection: {
            variant: 'geometry',
            name: 'Shape 1',
            nameLabel: 'Shape name',
            onNameChange: vi.fn(),
            nameDisabled: false,
            status: 'Drawing box · 0 shapes',
            loading: false,
            closeTitle: 'Stop drawing',
            onClose,
          },
        }}
      />,
    )

    expect(screen.getByLabelText('Shape name')).toHaveValue('Shape 1')
    fireEvent.click(screen.getByRole('button', { name: 'Stop drawing' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the selected cell and clears it', () => {
    const onClose = vi.fn()
    render(
      <CardStack
        cards={{
          ...NO_CARDS,
          cell: {
            kind: 'cell',
            title: 'Cell',
            status: 'Selected',
            loading: false,
            onClose,
            cell: {
              id: 'cell-1',
              position: [0, 0],
              transcriptCount: 8,
            } as unknown as OverviewCellDatum,
            annotationLabels: ['T cells'],
            state: { status: 'idle' },
            distributionState: { status: 'idle' },
            distributionVisible: false,
            variant: 'default',
          },
        }}
      />,
    )

    const card = screen.getByRole('region', { name: 'Cell' })
    expect(within(card).getByText('cell-1')).toBeInTheDocument()
    expect(within(card).getByText('T cells')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Clear selected cell' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the pinned transcript', () => {
    const onClose = vi.fn()
    render(
      <CardStack
        cards={{
          ...NO_CARDS,
          transcript: {
            title: 'Transcript',
            detail: {
              transcript: {
                id: 't1',
                featureName: 'SNAP25',
                fovName: 'fov_1',
                cellId: null,
                cellAssignment: 'unassigned',
                qv: 31,
                position: [10, -20],
              },
            } as unknown as ViewerTranscriptHoverDetail,
            showFov: true,
            onClose,
          },
        }}
      />,
    )

    const card = screen.getByRole('region', { name: 'Transcript' })
    expect(within(card).getByText('SNAP25')).toBeInTheDocument()
    expect(within(card).getByText('fov_1')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Clear pinned transcript' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prompts for the cursor lens and shows a result', () => {
    const lens: MagicLensCardModel = {
      status: 'Move cursor',
      loading: false,
      scope: 'cursor',
      state: { status: 'idle' },
      onClose: vi.fn(),
    }
    const { rerender } = render(<CardStack cards={{ ...NO_CARDS, magicLens: lens }} />)

    expect(screen.getByText(/Move the cursor over the tissue/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Magic Lens' }))
    expect(lens.onClose).toHaveBeenCalledTimes(1)

    rerender(
      <CardStack
        cards={{
          ...NO_CARDS,
          magicLens: {
            ...lens,
            status: '10 transcripts',
            scope: 'viewport',
            state: {
              status: 'ready',
              url: '',
              scope: 'viewport',
              summary: {
                transcriptCount: 10,
                cellCount: 2,
                geneCount: 1,
                selectedGeneTranscriptCount: 0,
                topGenes: [
                  { gene: 'Actb', count: 10, percentTotal: 100, selected: false },
                ],
                hitLimit: false,
              },
            },
          },
        }}
      />,
    )

    expect(screen.getByLabelText('Magic lens results')).toHaveTextContent('Viewport')
    expect(screen.getByRole('button', { name: 'Clear Magic Lens' })).toBeInTheDocument()
  })
})
