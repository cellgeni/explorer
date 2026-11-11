import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testCellsSectionModel } from '../../test/sectionModels'
import { GeneHudPanel } from './GeneHudPanel'

const READY_PANEL = {
  status: 'ready',
  url: 'https://example.test/output',
  genes: ['Actb', 'Gad1'],
} as const

const METADATA_TRACKS = [
  {
    id: 'metadata:confidence',
    label: 'confidence',
    values: [],
    cellCount: 0,
    min: 0,
    max: 1,
  },
  {
    id: 'metadata:pseudotime',
    label: 'pseudotime',
    values: [],
    cellCount: 0,
    min: 0.1,
    max: 0.9,
  },
]

describe('GeneHudPanel', () => {
  it('renders gene controls and forwards search, set, scale, and mode updates', () => {
    const cells = testCellsSectionModel({
      genes: {
        panelState: READY_PANEL,
        options: ['Actb', 'Gad1', 'Slc17a7'],
        selected: ['Actb', 'Slc17a7'],
        scoreMode: 'sum',
      },
      colour: {
        headerCopy: '2 genes',
        statusCopy: 'Expression ready',
        selectedGeneCount: 2,
        colorScale: 'plasma',
        scaleMax: 12,
        mode: 'metadata',
        hasAnnotationColors: true,
        metadataTracks: METADATA_TRACKS,
        selectedMetadataTrackId: 'metadata:confidence',
      },
    })

    render(<GeneHudPanel active cells={cells} />)

    expect(screen.getByText('2 genes')).toBeInTheDocument()
    expect(screen.getByText('Expression ready')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Actb' }))
    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))
    expect(screen.getByLabelText('Gene selection')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'actb, GAD1, missing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Symbols' }))
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'Marker set' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))
    expect(screen.getByLabelText('Set name')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Apply Marker set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Marker set' }))
    expect(
      screen.queryByRole('button', { name: 'Apply Marker set' }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Combine genes'), {
      target: { value: 'mean' },
    })
    fireEvent.change(screen.getByLabelText('Gene scale'), {
      target: { value: 'viridis' },
    })
    fireEvent.change(screen.getByLabelText('Expression detail'), {
      target: { value: 'all-cells' },
    })
    fireEvent.change(screen.getByLabelText('Cell color'), {
      target: { value: 'annotations' },
    })
    fireEvent.change(screen.getByLabelText('Metadata track'), {
      target: { value: 'metadata:pseudotime' },
    })

    expect(cells.genes.onToggle).toHaveBeenCalledWith('Actb')
    expect(cells.genes.onToggle).toHaveBeenCalledWith('Gad1')
    expect(cells.genes.onApply).toHaveBeenCalledWith(['Actb', 'Gad1'])
    expect(cells.genes.onApply).toHaveBeenCalledWith(['Actb', 'Slc17a7'], 'sum')
    expect(cells.genes.log).toHaveBeenCalledWith('Applied symbols: 2 genes')
    expect(cells.genes.log).toHaveBeenCalledWith('Saved gene set Marker set')
    expect(cells.genes.log).toHaveBeenCalledWith('Applied gene set Marker set')
    expect(cells.genes.log).toHaveBeenCalledWith('Removed gene set Marker set')
    expect(cells.colour.onScoreModeChange).toHaveBeenCalledWith('mean')
    expect(cells.colour.onColorScaleChange).toHaveBeenCalledWith('viridis')
    expect(cells.colour.onDetailModeChange).toHaveBeenCalledWith('all-cells')
    expect(cells.colour.onModeChange).toHaveBeenCalledWith('annotations')
    expect(cells.colour.onMetadataTrackChange).toHaveBeenCalledWith('metadata:pseudotime')
  })

  it('offers Combine genes only with two or more genes', () => {
    render(
      <GeneHudPanel
        active
        cells={testCellsSectionModel({ colour: { selectedGeneCount: 1 } })}
      />,
    )

    expect(screen.queryByLabelText('Combine genes')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Gene scale')).toBeInTheDocument()
  })

  it('resets local gene controls when a new gene panel load starts', () => {
    const cells = testCellsSectionModel({
      genes: { panelState: READY_PANEL, options: ['Actb', 'Gad1'], selected: ['Actb'] },
    })
    const { rerender } = render(<GeneHudPanel active cells={cells} />)

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'Actb' },
    })
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'Marker set' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'Draft' },
    })

    rerender(
      <GeneHudPanel
        active
        cells={{
          ...cells,
          genes: {
            ...cells.genes,
            panelState: { status: 'loading', url: 'https://example.test/next' },
          },
        }}
      />,
    )

    expect(screen.getByLabelText('Gene selection')).toHaveValue('')
    expect(screen.getByLabelText('Gene set symbols')).toHaveValue('')
    expect(screen.getByLabelText('Set name')).toHaveValue('')
    expect(
      screen.queryByRole('button', { name: 'Apply Marker set' }),
    ).not.toBeInTheDocument()
  })
})
