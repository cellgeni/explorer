import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MorphologyTimePointControl } from './MorphologyTimePointControl'
import { morphologyTimePointLabel } from './morphologyTimePoint'

describe('MorphologyTimePointControl', () => {
  it('shows the time point, then the one being opened', () => {
    const onTimePointChange = vi.fn()
    const { rerender } = render(
      <MorphologyTimePointControl
        timeSeries={{ sizeT: 40, timePoint: 21 }}
        requestedTimePoint={null}
        onTimePointChange={onTimePointChange}
      />,
    )
    const slider = screen.getByRole('slider', { name: 'Time point' })

    expect(slider).toHaveAttribute('aria-valuetext', '22 / 40')
    expect(slider).toHaveAttribute('max', '39')

    fireEvent.change(slider, { target: { value: '30' } })
    expect(onTimePointChange).toHaveBeenCalledWith(30)

    rerender(
      <MorphologyTimePointControl
        timeSeries={{ sizeT: 40, timePoint: 21 }}
        requestedTimePoint={30}
        onTimePointChange={onTimePointChange}
      />,
    )
    expect(screen.getByText('31 / 40 …')).toBeInTheDocument()
  })

  it('adds the time since the first point when the time axis has a unit', () => {
    const timeSeries = { sizeT: 40, timeStep: { value: 1.5, unit: 'min' } }

    expect(morphologyTimePointLabel(timeSeries, 0)).toBe('1 / 40 · 0 min')
    expect(morphologyTimePointLabel(timeSeries, 21)).toBe('22 / 40 · 31.5 min')
    expect(morphologyTimePointLabel({ sizeT: 3 }, 2)).toBe('3 / 3')
  })
})
