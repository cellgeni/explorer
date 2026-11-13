import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from './morphologyChannels'
import {
  CHANNEL_FILTER_MIN_COUNT,
  MorphologyChannelControls,
} from './MorphologyChannelControls'

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

  it('auto-contrasts a channel turned on for the first time', () => {
    const onAutoContrast = vi.fn()
    const onUpdate = vi.fn()
    const offSetting = {
      id: 'dapi',
      enabled: false,
      color: [80, 120, 255] as const,
      contrastMin: 10,
      contrastMax: 200,
    }
    const { rerender } = render(
      <MorphologyChannelControls
        channels={[channel]}
        settings={[offSetting]}
        autoContrastChannelIds={[]}
        onAutoContrast={onAutoContrast}
        onUpdate={onUpdate}
      />,
    )

    fireEvent.click(screen.getByLabelText('DAPI'))

    expect(onUpdate).toHaveBeenCalledWith('dapi', { enabled: true })
    expect(onAutoContrast).toHaveBeenCalledWith(channel)

    onAutoContrast.mockClear()
    rerender(
      <MorphologyChannelControls
        channels={[channel]}
        settings={[{ ...offSetting, contrastMin: 40 }]}
        autoContrastChannelIds={[]}
        onAutoContrast={onAutoContrast}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByLabelText('DAPI'))

    expect(onAutoContrast).not.toHaveBeenCalled()
  })

  it('hides the color picker for true-color channels', () => {
    render(
      <MorphologyChannelControls
        channels={[
          {
            ...channel,
            info: {
              ...channel.info,
              id: 'rgb',
              name: 'RGB',
              samplesPerPixel: 3,
            },
          },
        ]}
        settings={[
          {
            id: 'rgb',
            enabled: true,
            color: [255, 255, 255],
            contrastMin: 0,
            contrastMax: 255,
          },
        ]}
        autoContrastChannelIds={[]}
        onAutoContrast={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('RGB color')).not.toBeInTheDocument()
    expect(screen.getByLabelText('RGB histogram')).toBeInTheDocument()
  })

  describe('with many channels', () => {
    const names = ['DAPI', 'CD3', 'CD4', 'CD8', 'CD20', 'Keratin 14', 'Ki67', 'PanCK']
    const manyChannels: MorphologyImageChannel[] = names.map((name, index) => ({
      info: { ...channel.info, id: `c${index}`, index, name },
      loader: channel.loader,
    }))
    const manySettings: MorphologyChannelSetting[] = manyChannels.map((item) => ({
      id: item.info.id,
      enabled: ['DAPI', 'CD8', 'Ki67'].includes(item.info.name),
      color: [255, 255, 255],
      contrastMin: 0,
      contrastMax: 255,
    }))

    function renderMany(settings = manySettings) {
      return render(
        <MorphologyChannelControls
          channels={manyChannels}
          settings={settings}
          autoContrastChannelIds={[]}
          onAutoContrast={vi.fn()}
          onUpdate={vi.fn()}
        />,
      )
    }

    function shownChannelNames(): string[] {
      return screen
        .getAllByTitle(/^Toggle .* channel$/)
        .map(
          (input) =>
            input.getAttribute('title')?.replace(/^Toggle (.*) channel$/, '$1') ?? '',
        )
    }

    it('hides the filter for short channel lists', () => {
      render(
        <MorphologyChannelControls
          channels={manyChannels.slice(0, CHANNEL_FILTER_MIN_COUNT - 1)}
          settings={manySettings}
          autoContrastChannelIds={[]}
          onAutoContrast={vi.fn()}
          onUpdate={vi.fn()}
        />,
      )

      expect(screen.queryByLabelText('Search channels')).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/^Active only/)).not.toBeInTheDocument()
    })

    it('searches channels by name, ignoring case', () => {
      renderMany()

      expect(manyChannels).toHaveLength(CHANNEL_FILTER_MIN_COUNT)
      expect(screen.getByText('8 channels')).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Search channels'), {
        target: { value: ' cd ' },
      })

      expect(shownChannelNames()).toEqual(['CD3', 'CD4', 'CD8', 'CD20'])
      expect(screen.getByText('4 of 8')).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Search channels'), {
        target: { value: 'vimentin' },
      })

      expect(screen.queryAllByTitle(/^Toggle .* channel$/)).toEqual([])
      expect(screen.getByText('No channels match "vimentin"')).toBeInTheDocument()
    })

    it('shows only active channels, combined with the search', () => {
      const { rerender } = renderMany()

      fireEvent.click(screen.getByLabelText('Active only (3)'))

      expect(shownChannelNames()).toEqual(['DAPI', 'CD8', 'Ki67'])

      fireEvent.change(screen.getByLabelText('Search channels'), {
        target: { value: 'cd' },
      })

      expect(shownChannelNames()).toEqual(['CD8'])

      fireEvent.change(screen.getByLabelText('Search channels'), {
        target: { value: 'CD4' },
      })

      expect(screen.getByText('No active channels match "CD4"')).toBeInTheDocument()

      rerender(
        <MorphologyChannelControls
          channels={manyChannels}
          settings={manySettings.map((setting) => ({ ...setting, enabled: false }))}
          autoContrastChannelIds={[]}
          onAutoContrast={vi.fn()}
          onUpdate={vi.fn()}
        />,
      )
      fireEvent.change(screen.getByLabelText('Search channels'), {
        target: { value: '' },
      })

      expect(screen.getByLabelText('Active only (0)')).toBeChecked()
      expect(screen.getByText('No channels are on')).toBeInTheDocument()
    })
  })
})
