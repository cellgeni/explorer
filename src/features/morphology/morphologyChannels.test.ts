import { describe, expect, it } from 'vitest'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import {
  type MorphologyChannelSetting,
  changedMorphologyChannelColors,
  channelsToAutoContrastOnLoad,
  createMorphologyChannelSettings,
  defaultEnabledChannelIds,
  MAX_DEFAULT_ENABLED_CHANNELS,
  mergeMorphologyChannelDefaults,
  morphologyPatchLabel,
  needsAutoContrastOnEnable,
  normalizeChannelContrast,
  unmatchedMorphologyChannelDefaults,
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

  it('takes the colours and windows a manifest or collection sets, by ID or name', () => {
    const channels = testChannels(3)
    const image = { channelLoaders: channels } as unknown as MorphologyImage
    const settings = createMorphologyChannelSettings(image, {
      channelDefaults: {
        c0: { color: [88, 144, 255], contrast: [0, 828] },
        // Names match in any case.
        'CHANNEL 1': { color: [32, 166, 122] },
        missing: { contrast: [0, 10] },
      },
    })

    expect(settings).toEqual([
      {
        id: 'c0',
        enabled: true,
        color: [88, 144, 255],
        defaultColor: [88, 144, 255],
        contrastMin: 0,
        contrastMax: 828,
        contrastSet: true,
      },
      {
        id: 'c1',
        enabled: false,
        color: [32, 166, 122],
        defaultColor: [32, 166, 122],
        contrastMin: 0,
        contrastMax: 65_535,
      },
      {
        id: 'c2',
        enabled: false,
        color: [255, 255, 255],
        contrastMin: 0,
        contrastMax: 65_535,
      },
    ])
    // A set window is kept when the image loads and when the channel is
    // turned on.
    expect(
      channelsToAutoContrastOnLoad(channels, settings).map((channel) => channel.info.id),
    ).toEqual(['c1', 'c2'])
    expect(
      needsAutoContrastOnEnable(channels[0] as MorphologyImageChannel, {
        ...(settings[0] as MorphologyChannelSetting),
        contrastMin: 0,
        contrastMax: 65_535,
      }),
    ).toBe(false)
    expect(
      unmatchedMorphologyChannelDefaults(channels, {
        c0: {},
        'channel 2': {},
        missing: {},
      }),
    ).toEqual(['missing'])
  })

  it("opens with a link's colours and gives the link the colours changed since", () => {
    const channels = testChannels(3)
    const image = { channelLoaders: channels } as unknown as MorphologyImage
    const settings = createMorphologyChannelSettings(image, {
      channelDefaults: { c0: { color: [88, 144, 255] }, c1: { color: [32, 166, 122] } },
      channelColors: { c1: [255, 0, 255], c2: [0, 255, 255] },
    })

    expect(settings.map((setting) => setting.color)).toEqual([
      [88, 144, 255],
      [255, 0, 255],
      [0, 255, 255],
    ])
    // Changed from the manifest's colour, or the image's own without one.
    expect(changedMorphologyChannelColors(channels, settings)).toEqual({
      c1: [255, 0, 255],
      c2: [0, 255, 255],
    })
    // Set back to the colour the channel opens with, it is left out.
    expect(
      changedMorphologyChannelColors(
        channels,
        settings.map((setting) =>
          setting.id === 'c1' ? { ...setting, color: [32, 166, 122] as const } : setting,
        ),
      ),
    ).toEqual({ c2: [0, 255, 255] })
  })

  it("puts a collection's channel settings over the dataset manifest's", () => {
    const manifest = {
      DAPI: { color: [0, 0, 255] as const, contrast: [0, 100] as const },
      '18S': { color: [255, 255, 0] as const },
    }

    expect(mergeMorphologyChannelDefaults(manifest, undefined)).toBe(manifest)
    expect(mergeMorphologyChannelDefaults(undefined, manifest)).toBe(manifest)
    expect(
      mergeMorphologyChannelDefaults(manifest, { dapi: { color: [88, 144, 255] } }),
    ).toEqual({ '18S': { color: [255, 255, 0] }, dapi: { color: [88, 144, 255] } })
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
