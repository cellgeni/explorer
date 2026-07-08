import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
import { ImageOnlyDataset } from './imageOnlyDataset'
import type { TiffPyramidLoader } from '../tiff/loader'

describe('ImageOnlyDataset', () => {
  it('derives metadata extent and capabilities from the TIFF loader', async () => {
    const loader = tiffLoaderFixture({
      imageWidth: imagePixels(400),
      imageHeight: imagePixels(200),
      micrometersPerPixel: 0.5,
      channelCount: 2,
    })
    const openImage = vi.fn(async () => loader)
    const dataset = new ImageOnlyDataset({
      imageUrl: 'https://example.test/sample.ome.tif',
      openImage,
    })

    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'image',
      extent: {
        minX: 0,
        maxX: 200,
        minY: 0,
        maxY: 100,
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: true,
        multiChannel: true,
      },
      channels: [
        {
          id: 'Channel:0',
          index: 0,
          name: 'Channel 1',
          color: [88, 144, 255],
          contrast: { min: 0, max: 255 },
        },
        {
          id: 'Channel:1',
          index: 1,
          name: 'Channel 2',
          color: [32, 166, 122],
          contrast: { min: 0, max: 255 },
        },
      ],
    })
    expect(openImage).toHaveBeenCalledWith('https://example.test/sample.ome.tif')
  })

  it('returns empty spatial data while exposing the pyramid image', async () => {
    const loader = tiffLoaderFixture()
    const openImage = vi.fn(async () => loader)
    const dataset = new ImageOnlyDataset({
      imageUrl: 'https://example.test/sample.ome.tif',
      openImage,
    })

    await expect(dataset.elements()).resolves.toEqual({ elements: [] })
    await expect(dataset.annotations()).resolves.toEqual([])

    const matrix = await dataset.matrix(['shape-a', 'shape-b'])
    expect(matrix.geneNames).toEqual([])
    expect(matrix.cells.get('shape-a')).toEqual({ geneNames: [], counts: [] })
    expect(matrix.cells.get('shape-b')).toEqual({ geneNames: [], counts: [] })

    await expect(dataset.image()).resolves.toEqual({ kind: 'pyramid', loader })
    await dataset.meta()
    expect(openImage).toHaveBeenCalledTimes(1)
  })
})

function tiffLoaderFixture({
  imageWidth = imagePixels(100),
  imageHeight = imagePixels(50),
  micrometersPerPixel = 1,
  channelCount = 1,
}: {
  readonly imageWidth?: ReturnType<typeof imagePixels>
  readonly imageHeight?: ReturnType<typeof imagePixels>
  readonly micrometersPerPixel?: number
  readonly channelCount?: number
} = {}): TiffPyramidLoader {
  return {
    url: 'https://example.test/sample.ome.tif',
    imageWidth,
    imageHeight,
    tileWidth: imagePixels(256),
    tileHeight: imagePixels(256),
    numLevels: 1,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(micrometersPerPixel),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    channels: Array.from({ length: channelCount }, (_value, index) => ({
      id: `Channel:${index}`,
      index,
      name: `Channel ${index + 1}`,
      color: index === 0 ? ([88, 144, 255] as const) : ([32, 166, 122] as const),
      contrast: { min: 0, max: 255 },
    })),
  } as unknown as TiffPyramidLoader
}
