import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testCellsSectionModel } from '../../test/sectionModels'
import type { CellColourModel } from './cellsSectionModel'
import { GeneExpressionControls } from './CellsSectionBlocks'

function renderScale(overrides: Partial<CellColourModel> = {}, { edit = true } = {}) {
  const { colour } = testCellsSectionModel({
    colour: { scaleMin: 0, scaleMax: 92, autoScaleMax: 92, ...overrides },
  })
  render(<GeneExpressionControls colour={colour} />)
  if (edit)
    fireEvent.click(screen.getByRole('button', { name: 'Edit the Gene scale range' }))
  return colour
}

function setField(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

describe('Gene scale range', () => {
  it('shows the ends read only until the cog is pressed', () => {
    renderScale({ scaleRange: { min: null, max: 40 }, scaleMax: 40 }, { edit: false })

    const values = screen.getByLabelText('Gene scale values')
    expect(values).toHaveTextContent('0')
    expect(values).toHaveTextContent('10')
    expect(values).toHaveTextContent('40')
    expect(screen.getByTitle('Score at the top of the scale, set')).toHaveClass('is-set')
    expect(screen.queryByLabelText('Gene scale minimum')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()

    const cog = screen.getByRole('button', { name: 'Edit the Gene scale range' })
    expect(cog).toHaveAttribute('aria-pressed', 'false')
    expect(cog).toHaveClass('is-set')
    fireEvent.click(cog)
    expect(cog).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Gene scale maximum')).toHaveValue(40)

    fireEvent.click(cog)
    expect(screen.queryByLabelText('Gene scale maximum')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Gene scale values')).toBeInTheDocument()
  })

  it('shows the ends and the score at the gradient middle', () => {
    renderScale()

    expect(screen.getByLabelText('Gene scale minimum')).toHaveValue(0)
    expect(screen.getByLabelText('Gene scale maximum')).toHaveValue(92)
    expect(screen.getByLabelText('Gene scale range')).toHaveTextContent('23')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
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

  it("resets to the selected genes' range", () => {
    const colour = renderScale({
      scaleRange: { min: 2, max: 20 },
      scaleMin: 2,
      scaleMax: 20,
    })
    const reset = screen.getByRole('button', { name: 'Reset' })

    expect(reset).toBeEnabled()
    expect(reset).toHaveAttribute(
      'title',
      "Back to the selected genes' range: 0 to the highest score, 92",
    )
    fireEvent.click(reset)
    expect(colour.onScaleRangeChange).toHaveBeenCalledWith({ min: null, max: null })
  })
})
