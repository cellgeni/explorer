import { describe, expect, it } from 'vitest'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { TiffPyramidLoader } from '../../tiff/loader'
import {
  createCustomMorphologyLayer,
  customMorphologyLayerChannels,
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
})
