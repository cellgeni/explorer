import { describe, expect, it } from 'vitest'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { TiffPyramidLoader } from '../../tiff/loader'
import {
  createCustomMorphologyLayer,
  customMorphologyLayerChannels,
  customMorphologyLayerDefaultEnabledChannelIds,
  isCustomMorphologyLayerChannelId,
} from './customMorphologyLayers'

describe('customMorphologyLayers', () => {
  it('prefixes custom layer channel IDs and labels', () => {
    const loader = {} as TiffPyramidLoader
    const image: MorphologyImage = {
      url: 'https://example.test/layers/remote.ome.tif',
      loader,
      channels: [],
      channelLoaders: [
        {
          info: {
            id: 'Channel:0',
            index: 0,
            name: 'DAPI',
            color: [88, 144, 255],
            contrast: { min: 0, max: 65_535 },
          },
          loader,
        },
      ],
    }

    const layer = createCustomMorphologyLayer('custom-layer:1', image)

    expect(layer.label).toBe('remote.ome.tif')
    expect(layer.channels[0]?.info).toMatchObject({
      id: 'custom-layer:1:Channel:0',
      name: 'remote.ome.tif / DAPI',
    })
    const channel = layer.channels[0]

    if (channel === undefined) {
      throw new Error('Expected custom layer channel.')
    }

    expect(customMorphologyLayerChannels([layer])).toHaveLength(1)
    expect(isCustomMorphologyLayerChannelId('custom-layer:1', channel.info.id)).toBe(true)
  })

  it('creates a fallback channel for TIFFs without OME channel metadata', () => {
    const loader = {} as TiffPyramidLoader
    const layer = createCustomMorphologyLayer('custom-layer:2', {
      url: 'https://example.test/layers/plain.ome.tif',
      loader,
      channels: [],
      channelLoaders: [],
    })

    expect(layer.channels).toHaveLength(1)
    expect(layer.channels[0]?.info).toMatchObject({
      id: 'custom-layer:2:image',
      name: 'plain.ome.tif',
      color: [255, 255, 255],
    })
  })

  it('treats generic three-plane uint8 custom images as native RGB', () => {
    const loader0 = {} as TiffPyramidLoader
    const loader1 = {} as TiffPyramidLoader
    const loader2 = {} as TiffPyramidLoader
    const layer = createCustomMorphologyLayer('custom-layer:3', {
      url: 'https://example.test/layers/rgb.ome.tif',
      loader: loader0,
      channels: [],
      channelLoaders: [
        {
          info: {
            id: 'Channel:0:0',
            index: 0,
            name: 'Channel 1',
            color: [88, 144, 255],
            contrast: { min: 0, max: 255 },
            fileName: 'rgb.ome.tif',
            ifdIndex: 0,
          },
          loader: loader0,
        },
        {
          info: {
            id: 'Channel:0:1',
            index: 1,
            name: 'Channel 2',
            color: [32, 166, 122],
            contrast: { min: 0, max: 255 },
            fileName: 'rgb.ome.tif',
            ifdIndex: 1,
          },
          loader: loader1,
        },
        {
          info: {
            id: 'Channel:0:2',
            index: 2,
            name: 'Channel 3',
            color: [240, 200, 75],
            contrast: { min: 0, max: 255 },
            fileName: 'rgb.ome.tif',
            ifdIndex: 2,
          },
          loader: loader2,
        },
      ],
    })

    expect(layer.channels.map((channel) => channel.info.name)).toEqual([
      'rgb.ome.tif / Red',
      'rgb.ome.tif / Green',
      'rgb.ome.tif / Blue',
    ])
    expect(layer.channels.map((channel) => channel.info.color)).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ])
    expect(layer.channels.map((channel) => channel.info.alphaFromIntensity)).toEqual([
      false,
      false,
      false,
    ])
    expect(customMorphologyLayerDefaultEnabledChannelIds(layer)).toEqual([
      'custom-layer:3:Channel:0:0',
      'custom-layer:3:Channel:0:1',
      'custom-layer:3:Channel:0:2',
    ])
  })
})
