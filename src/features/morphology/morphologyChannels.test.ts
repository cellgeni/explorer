import { describe, expect, it } from 'vitest'
import type { MorphologyImage } from '../../data/morphologyImage'
import {
  createMorphologyChannelSettings,
  morphologyPatchLabel,
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
  })

  it('normalizes contrast ranges', () => {
    expect(normalizeChannelContrast({ min: 5, max: 3 })).toEqual({ lo: 5, hi: 6 })
    expect(normalizeChannelContrast({ min: Number.NaN, max: Number.NaN })).toEqual({
      lo: 0,
      hi: 1,
    })
  })
})
