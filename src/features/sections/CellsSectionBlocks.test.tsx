import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { genePanelLoadReady, type SavedGeneSet } from '../genes/geneControlsModel'
import { testCellsSectionModel } from '../../test/sectionModels'
import type { CellColourModel, GeneSelectionModel } from './cellsSectionModel'
import { GeneExpressionControls, GenePicker } from './CellsSectionBlocks'

function renderScale(overrides: Partial<CellColourModel> = {}) {
  const { colour } = testCellsSectionModel({
    colour: {
      scaleMin: 0,
      scaleMax: 92,
      autoScaleMax: 92,
      highestScore: 140,
      ...overrides,
    },
  })
  render(<GeneExpressionControls colour={colour} />)
  return colour
}

function setField(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

describe('Gene scale range', () => {
  it('shows the ends as fields under the gradient, with no Reset on Auto', () => {
    renderScale()

    expect(screen.getByLabelText('Gene scale minimum')).toHaveValue(0)
    const max = screen.getByLabelText('Gene scale maximum')
    expect(max).toHaveValue(92)
    expect(max).toHaveAttribute(
      'title',
      "Score at the top of the scale: Auto, the 99th percentile of the selected genes' scores above 0, 92 (highest 140). Cells at or above it get the last colour. Type a score and press Enter to fix it",
    )
    expect(screen.getByLabelText('Gene scale range')).toHaveTextContent('23')
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit the Gene scale range' }),
    ).not.toBeInTheDocument()
  })

  it('marks a set end and offers Reset', () => {
    renderScale({ scaleRange: { min: null, max: 40 }, scaleMax: 40 })

    expect(screen.getByLabelText('Gene scale maximum')).toHaveValue(40)
    expect(
      screen.getByLabelText('Gene scale maximum').closest('.gene-scale-end'),
    ).toHaveClass('is-set')
    expect(
      screen.getByLabelText('Gene scale minimum').closest('.gene-scale-end'),
    ).not.toHaveClass('is-set')
    expect(screen.getByLabelText('Gene scale range')).toHaveTextContent('10')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('names a percentile top from a link or manifest', () => {
    renderScale({
      scaleRange: { min: null, max: { percentile: 95 } },
      autoScaleMax: 30,
      scaleMax: 30,
    })

    const max = screen.getByLabelText('Gene scale maximum')
    expect(max).toHaveValue(30)
    expect(max.closest('.gene-scale-end')).toHaveClass('is-set')
    expect(max).toHaveAttribute(
      'title',
      "Score at the top of the scale: set to the 95th percentile of the selected genes' scores above 0, 30 (highest 140). Cells at or above it get the last colour. Type a score and press Enter to change it",
    )
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('sets each end on its own, keeping the other', () => {
    const colour = renderScale({ scaleRange: { min: null, max: 40 }, scaleMax: 40 })

    setField('Gene scale minimum', '5')
    expect(colour.onScaleRangeChange).toHaveBeenLastCalledWith({ min: 5, max: 40 })

    setField('Gene scale maximum', '60')
    expect(colour.onScaleRangeChange).toHaveBeenLastCalledWith({ min: null, max: 60 })
  })

  it('ignores an end that crosses the other', () => {
    const colour = renderScale()

    setField('Gene scale minimum', '92')
    setField('Gene scale maximum', '-1')
    expect(colour.onScaleRangeChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Gene scale minimum')).toHaveValue(0)
  })

  it('says when a kept bottom is not below this top', () => {
    // Set to 3 on another gene; this one tops out at 1.5, so the scale runs
    // from 0.
    renderScale({
      scaleRange: { min: 3, max: null },
      scaleMin: 0,
      scaleMax: 1.5,
      autoScaleMax: 1.5,
    })

    const min = screen.getByLabelText('Gene scale minimum')
    expect(min).toHaveValue(0)
    expect(min.closest('.gene-scale-end')).not.toHaveClass('is-set')
    expect(min).toHaveAttribute(
      'title',
      'Score at the bottom of the scale: 0, as the bottom set, 3, is not below the top. Cells at or below it get the first colour. Type a score and press Enter to change it',
    )
  })

  it('shows small ends to two significant digits', () => {
    renderScale({ scaleMax: 0.0048, autoScaleMax: 0.0048, highestScore: 0.0123 })

    expect(screen.getByLabelText('Gene scale maximum')).toHaveValue(0.0048)
    expect(screen.getByLabelText('Gene scale range')).toHaveTextContent('0.0012')
  })

  it('resets both ends to Auto', () => {
    const colour = renderScale({
      scaleRange: { min: 2, max: 20 },
      scaleMin: 2,
      scaleMax: 20,
    })
    const reset = screen.getByRole('button', { name: 'Reset' })

    expect(reset).toHaveAttribute(
      'title',
      "Back to Auto: 0 to the 99th percentile of the selected genes' scores above 0",
    )
    fireEvent.click(reset)
    expect(colour.onScaleRangeChange).toHaveBeenCalledWith({ min: null, max: null })
  })
})

describe('Saved gene sets', () => {
  const caf = {
    id: 'gene-set:cafs',
    name: 'CAFs',
    genes: ['COL1A2', 'POSTN'],
    scoreMode: 'mean' as const,
  }
  const apocrine = {
    id: 'gene-set:apocrine',
    name: 'Apocrine',
    genes: ['PIP'],
    scoreMode: 'sum' as const,
  }

  it('adds a set’s genes to the selection, sorted, keeping the score mode', () => {
    const { genes } = testCellsSectionModel({
      genes: { selected: ['AGR3', 'POSTN'], savedSets: [caf, apocrine] },
    })
    render(<GenePicker genes={genes} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add CAFs' }))

    expect(genes.onApply).toHaveBeenCalledWith(['AGR3', 'COL1A2', 'POSTN'])
    expect(genes.log).toHaveBeenCalledWith('Added gene set CAFs: 1 gene')
  })

  it('disables Add when the set’s genes are all selected', () => {
    const { genes } = testCellsSectionModel({
      genes: { selected: ['PIP'], savedSets: [caf, apocrine] },
    })
    render(<GenePicker genes={genes} />)

    expect(screen.getByRole('button', { name: 'Add Apocrine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Apocrine' })).toHaveAttribute(
      'title',
      "Apocrine's genes are all selected",
    )
    expect(screen.getByRole('button', { name: 'Add CAFs' })).toBeEnabled()
  })

  it('names the chips and the saved sets as groups', () => {
    const { genes } = testCellsSectionModel({
      genes: { selected: ['PIP'], savedSets: [caf] },
    })
    render(<GenePicker genes={genes} />)

    expect(screen.getByRole('group', { name: 'Selected genes' })).toHaveTextContent('PIP')
    expect(screen.getByRole('group', { name: 'Saved gene sets' })).toHaveTextContent(
      'CAFs',
    )
  })
})

const PANEL = ['ACTB', 'GAPDH', 'GFAP', 'MBP', 'SNAP25', 'TOP2A']

// A picker whose selection and saved sets change, as App's do.
function StatefulPicker({
  options = PANEL,
  onApply,
}: {
  readonly options?: readonly string[]
  readonly onApply?: (genes: readonly string[]) => void
}) {
  const [selected, setSelected] = useState<readonly string[]>([])
  const [savedSets, setSavedSets] = useState<readonly SavedGeneSet[]>([])
  const { genes } = testCellsSectionModel({
    genes: {
      panelState: genePanelLoadReady('https://example.test/d', options),
      options,
      selected,
      savedSets,
      onToggle: (gene) => {
        setSelected((current) =>
          current.includes(gene)
            ? current.filter((name) => name !== gene)
            : [...current, gene].sort(),
        )
      },
      onApply: (next) => {
        onApply?.(next)
        setSelected(next)
      },
      onSavedSetsChange: setSavedSets,
    } satisfies Partial<GeneSelectionModel>,
  })

  return <GenePicker genes={genes} />
}

describe('Apply Symbols', () => {
  it('names the symbols that match no gene', () => {
    render(<StatefulPicker />)

    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'actb, GAPDH, NOTAGENE, foo1, notagene' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Symbols' }))

    expect(screen.getByLabelText('Selected genes')).toHaveTextContent('ACTBGAPDH')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Applied 2 genes. No gene in this dataset matches NOTAGENE or foo1.',
    )

    // Editing the symbols clears it.
    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'MBP' },
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the selection and says so when no symbol matches', () => {
    const applied: (readonly string[])[] = []
    render(<StatefulPicker onApply={(genes) => applied.push(genes)} />)

    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'NOTAGENE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Symbols' }))

    expect(applied).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent(
      'No gene in this dataset matches NOTAGENE. The selection is unchanged.',
    )
  })
})

describe('Save Set without a name', () => {
  it('keeps a saved set of other genes that has the default name', () => {
    render(<StatefulPicker options={['CCNB1', 'CDK1', 'MKI67', 'PCNA', 'TOP2A']} />)
    const symbols = screen.getByLabelText('Gene set symbols')
    const apply = screen.getByRole('button', { name: 'Apply Symbols' })

    fireEvent.change(symbols, { target: { value: 'CCNB1 CDK1 MKI67 TOP2A' } })
    fireEvent.click(apply)
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))
    fireEvent.change(symbols, { target: { value: 'CCNB1 CDK1 MKI67 PCNA' } })
    fireEvent.click(apply)

    // The name it will take, shown in the empty name field.
    expect(screen.getByLabelText('Set name')).toHaveAttribute(
      'placeholder',
      'CCNB1, CDK1, MKI67 +1 (2)',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))

    expect(
      screen.getByRole('button', { name: 'Apply CCNB1, CDK1, MKI67 +1' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Apply CCNB1, CDK1, MKI67 +1 (2)' }),
    ).toBeVisible()
  })
})

describe('Gene picker focus', () => {
  it('moves to the next gene when one is picked from the list with the keyboard', () => {
    render(<StatefulPicker />)
    const gfap = screen.getByRole('button', { name: 'GFAP' })
    gfap.focus()

    // Enter on a button clicks it with no click count.
    fireEvent.click(gfap, { detail: 0 })

    expect(screen.getByLabelText('Selected genes')).toHaveTextContent('GFAP')
    expect(screen.getByRole('button', { name: 'MBP' })).toHaveFocus()
  })

  it('goes back to the cleared search after a gene found by searching', () => {
    render(<StatefulPicker />)
    const search = screen.getByLabelText('Gene selection')

    fireEvent.change(search, { target: { value: 'snap' } })
    const snap25 = screen.getByRole('button', { name: 'SNAP25' })
    snap25.focus()
    fireEvent.click(snap25, { detail: 0 })

    expect(screen.getByLabelText('Selected genes')).toHaveTextContent('SNAP25')
    expect(search).toHaveFocus()
    expect(search).toHaveValue('')
  })
})
