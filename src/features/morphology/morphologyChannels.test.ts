import { describe, expect, it } from 'vitest'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import {
  channelsToAutoContrastOnLoad,
  createMorphologyChannelSettings,
  defaultEnabledChannelIds,
  MAX_DEFAULT_ENABLED_CHANNELS,
  morphologyPatchLabel,
  needsAutoContrastOnEnable,
  normalizeChannelContrast,
} from './morphologyChannels'

describe('morphologyChannels', () => {
  it('labels channel setting patches', () => {
    expect(morphologyPatchLabel({ enabled: true })).toBe('Channel enabled')
    expect(morphologyPatchLabel({ enabled: false })).toBe('Channel disabled')
    expect(morphologyPatchLabel({ color: [255, 0, 0] })).toBe('Channel color')
    expect(morphologyPatchLabel({ contrastMin: 1 })).toBe('Channel contrast')
    expect(morphologyPatchLabel({})).toBe('Channel updated')
  })

  it('creates initial channel settings from image loaders', () => {
    const image = {
      url: 'https://example.test/morphology.ome.tif',
      loader: {},
      channels: [],
      channelLoaders: [
        {
          info: {
            id: 'dapi',
            name: 'DAPI',
            index: 0,
            color: [80, 120, 255],
            contrast: { min: 10, max: 200 },
          },
        },
        {
          info: {
            id: 'protein',
            name: 'Protein',
            index: 1,
            color: [255, 80, 120],
            contrast: { min: 5, max: 150 },
          },
        },
      ],
    } as unknown as MorphologyImage

    expect(createMorphologyChannelSettings(image)).toEqual([
      {
        id: 'dapi',
        enabled: true,
        color: [80, 120, 255],
        contrastMin: 10,
        contrastMax: 200,
      },
      {
        id: 'protein',
        enabled: false,
        color: [255, 80, 120],
        contrastMin: 5,
        contrastMax: 150,
      },
    ])

    expect(
      createMorphologyChannelSettings(image, { enabledChannelIds: ['protein'] }),
    ).toEqual([
      {
        id: 'dapi',
        enabled: false,
        color: [80, 120, 255],
        contrastMin: 10,
        contrastMax: 200,
      },
      {
        id: 'protein',
        enabled: true,
        color: [255, 80, 120],
        contrastMin: 5,
        contrastMax: 150,
      },
    ])
  })

  it('turns on at most the first few channels of a multiplexed image', () => {
    expect(defaultEnabledChannelIds(testChannels(3))).toEqual(['c0', 'c1', 'c2'])
    expect(defaultEnabledChannelIds(testChannels(61))).toHaveLength(
      MAX_DEFAULT_ENABLED_CHANNELS,
    )
  })

  it('auto-contrasts every channel of a small image but only the shown channels of a large one', () => {
    const small = testChannels(MAX_DEFAULT_ENABLED_CHANNELS)
    const large = testChannels(20)
    const largeSettings = createMorphologyChannelSettings(
      { channelLoaders: large } as unknown as MorphologyImage,
      { enabledChannelIds: ['c0', 'c7'] },
    )

    expect(
      channelsToAutoContrastOnLoad(
        small,
        createMorphologyChannelSettings({
          channelLoaders: small,
        } as unknown as MorphologyImage),
      ),
    ).toEqual(small)
    expect(
      channelsToAutoContrastOnLoad(large, largeSettings).map(
        (channel) => channel.info.id,
      ),
    ).toEqual(['c0', 'c7'])
  })

  it('never auto-contrasts native RGB, which is drawn without a window', () => {
    const [grey] = testChannels(1) as [MorphologyImageChannel]
    const rgb: MorphologyImageChannel = {
      ...grey,
      info: { ...grey.info, id: 'rgb', samplesPerPixel: 3, alphaFromIntensity: false },
    }
    const channels = [rgb, grey]

    expect(
      channelsToAutoContrastOnLoad(
        channels,
        createMorphologyChannelSettings({
          channelLoaders: channels,
        } as unknown as MorphologyImage),
      ).map((channel) => channel.info.id),
    ).toEqual(['c0'])
  })

  it('auto-contrasts a channel turned on with its default window', () => {
    const [channel] = testChannels(1) as [MorphologyImageChannel]
    const setting = {
      id: 'c0',
      enabled: false,
      color: [255, 255, 255] as const,
      contrastMin: 0,
      contrastMax: 65_535,
    }

    expect(needsAutoContrastOnEnable(channel, setting)).toBe(true)
    expect(needsAutoContrastOnEnable(channel, { ...setting, contrastMax: 4_000 })).toBe(
      false,
    )
    expect(
      needsAutoContrastOnEnable(channel, {
        ...setting,
        histogram: { bins: [1], maxCount: 1, min: 0, max: 65_535, sampleCount: 1 },
      }),
    ).toBe(false)
    expect(
      needsAutoContrastOnEnable(
        { ...channel, info: { ...channel.info, alphaFromIntensity: false } },
        setting,
      ),
    ).toBe(false)
  })

  it('normalizes contrast ranges', () => {
    expect(normalizeChannelContrast({ min: 5, max: 3 })).toEqual({ lo: 5, hi: 6 })
    expect(normalizeChannelContrast({ min: Number.NaN, max: Number.NaN })).toEqual({
      lo: 0,
      hi: 1,
    })
  })
})

function testChannels(count: number): readonly MorphologyImageChannel[] {
  return Array.from({ length: count }, (_, index) => ({
    info: {
      id: `c${index}`,
      index,
      name: `Channel ${index}`,
      color: [255, 255, 255] as const,
      contrast: { min: 0, max: 65_535 },
    },
    loader: {} as MorphologyImageChannel['loader'],
  }))
}
