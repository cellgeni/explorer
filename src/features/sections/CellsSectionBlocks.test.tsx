import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testCellsSectionModel } from '../../test/sectionModels'
import type { CellColourModel } from './cellsSectionModel'
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
