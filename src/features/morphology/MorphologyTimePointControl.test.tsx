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

  it('stays busy while the canvas shows another time point (plan 28-D6)', () => {
    render(
      <MorphologyTimePointControl
        timeSeries={{ sizeT: 40, timePoint: 22 }}
        requestedTimePoint={null}
        frameShown={false}
        onTimePointChange={vi.fn()}
      />,
    )

    expect(screen.getByText('23 / 40 …')).toBeInTheDocument()
    expect(screen.getByText('23 / 40 …').closest('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('plays and pauses, with a speed and Loop (28-D7)', () => {
    const playback = {
      playing: false,
      speed: 5,
      loop: true,
      onPlayingChange: vi.fn(),
      onSpeedChange: vi.fn(),
      onLoopChange: vi.fn(),
    }
    const { rerender } = render(
      <MorphologyTimePointControl
        timeSeries={{ sizeT: 40, timePoint: 21 }}
        requestedTimePoint={null}
        onTimePointChange={vi.fn()}
        playback={playback}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Play time points' }))
    expect(playback.onPlayingChange).toHaveBeenCalledWith(true)

    const speed = screen.getByRole('combobox', { name: 'Speed' })
    expect(speed).toHaveValue('5')
    fireEvent.change(speed, { target: { value: '20' } })
    expect(playback.onSpeedChange).toHaveBeenCalledWith(20)

    const loop = screen.getByRole('checkbox', { name: 'Loop' })
    expect(loop).toBeChecked()
    fireEvent.click(loop)
    expect(playback.onLoopChange).toHaveBeenCalledWith(false)

    rerender(
      <MorphologyTimePointControl
        timeSeries={{ sizeT: 40, timePoint: 21 }}
        requestedTimePoint={null}
        onTimePointChange={vi.fn()}
        playback={{ ...playback, playing: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pause time points' }))
    expect(playback.onPlayingChange).toHaveBeenCalledWith(false)
  })

  it('offers no Play without playback controls, as in 3D (28-D11)', () => {
    render(
      <MorphologyTimePointControl
        timeSeries={{ sizeT: 40, timePoint: 21 }}
        requestedTimePoint={null}
        onTimePointChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Play time points' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Speed' })).toBeNull()
  })

  it('adds the time since the first point when the time axis has a unit', () => {
    const timeSeries = { sizeT: 40, timeStep: { value: 1.5, unit: 'min' } }

    expect(morphologyTimePointLabel(timeSeries, 0)).toBe('1 / 40 · 0 min')
    expect(morphologyTimePointLabel(timeSeries, 21)).toBe('22 / 40 · 31.5 min')
    expect(morphologyTimePointLabel({ sizeT: 3 }, 2)).toBe('3 / 3')
  })
})
