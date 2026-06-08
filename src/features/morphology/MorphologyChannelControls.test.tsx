import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import { MorphologyChannelControls } from './MorphologyChannelControls'

const channel: MorphologyImageChannel = {
  info: {
    id: 'dapi',
    index: 0,
    name: 'DAPI',
    color: [80, 120, 255],
    contrast: { min: 10, max: 200 },
  },
  loader: {} as MorphologyImageChannel['loader'],
}

describe('MorphologyChannelControls', () => {
  it('returns nothing when no channels are available', () => {
    const { container } = render(
      <MorphologyChannelControls
        channels={[]}
        settings={[]}
        autoContrastChannelIds={[]}
        onAutoContrast={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders channel controls and forwards setting updates', () => {
    const onAutoContrast = vi.fn()
    const onUpdate = vi.fn()

    render(
      <MorphologyChannelControls
        channels={[channel]}
        settings={[
          {
            id: 'dapi',
            enabled: true,
            color: [80, 120, 255],
            contrastMin: 10,
            contrastMax: 200,
            histogram: { bins: [0, 2, 4], maxCount: 4, min: 0, max: 255, sampleCount: 6 },
          },
        ]}
        autoContrastChannelIds={[]}
        onAutoContrast={onAutoContrast}
        onUpdate={onUpdate}
      />,
    )

    fireEvent.click(screen.getByLabelText('DAPI'))
    fireEvent.change(screen.getByLabelText('DAPI color'), {
      target: { value: '#112233' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'DAPI auto contrast' }))
    fireEvent.change(screen.getByLabelText('DAPI minimum'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('DAPI maximum'), { target: { value: '220' } })

    expect(onUpdate).toHaveBeenCalledWith('dapi', { enabled: false })
    expect(onUpdate).toHaveBeenCalledWith('dapi', { color: [17, 34, 51] })
    expect(onUpdate).toHaveBeenCalledWith('dapi', { contrastMin: 20 })
    expect(onUpdate).toHaveBeenCalledWith('dapi', { contrastMax: 220 })
    expect(onAutoContrast).toHaveBeenCalledWith(channel)
    expect(screen.getByLabelText('DAPI histogram')).toHaveAttribute(
      'title',
      'DAPI histogram, 6 samples',
    )
  })
})
