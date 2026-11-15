import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testCellsSectionModel } from '../../test/sectionModels'
import type { CellColourModel } from './cellsSectionModel'
import { GeneExpressionControls } from './CellsSectionBlocks'

function renderScale(overrides: Partial<CellColourModel> = {}) {
  const { colour } = testCellsSectionModel({
    colour: { scaleMin: 0, scaleMax: 92, autoScaleMax: 92, ...overrides },
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
  it('shows the ends and the score at the gradient middle', () => {
    renderScale()

    expect(screen.getByLabelText('Gene scale minimum')).toHaveValue(0)
    expect(screen.getByLabelText('Gene scale maximum')).toHaveValue(92)
    expect(screen.getByLabelText('Gene scale range')).toHaveTextContent('23')
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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

  it('goes back to Auto', () => {
    const colour = renderScale({
      scaleRange: { min: 2, max: 20 },
      scaleMin: 2,
      scaleMax: 20,
    })
    const auto = screen.getByRole('button', { name: 'Auto' })

    expect(auto).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(auto)
    expect(colour.onScaleRangeChange).toHaveBeenCalledWith({ min: null, max: null })
  })
})
