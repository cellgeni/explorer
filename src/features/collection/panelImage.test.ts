import { describe, expect, it, vi } from 'vitest'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { SpatialDatasetDetection } from '../../datasets/datasetFactory'
import { loadPanelImage, type PanelImageLoaders } from './panelImage'

const URL = 'https://example.test/run/section'

function channel(index: number, alphaFromIntensity?: boolean) {
  return {
    id: `Channel:${index}`,
    index,
    name: `C${index}`,
    color: [255, 255, 255] as const,
    contrast: { min: 0, max: 255 },
    ...(alphaFromIntensity === undefined ? {} : { alphaFromIntensity }),
  }
}

function pyramidLoader(count: number, alphaFromIntensity?: boolean): ImagePyramidLoader {
  return {
    url: `${URL}/image.ome.zarr`,
    channels: Array.from({ length: count }, (_, index) =>
      channel(index, alphaFromIntensity),
    ),
  } as unknown as ImagePyramidLoader
}

function loaders(
  detection: Partial<SpatialDatasetDetection>,
  dataset: object,
  loadMorphologyImage = vi.fn(),
): PanelImageLoaders {
  return {
    detectSpatialDataset: vi.fn(async () => ({
      baseUrl: URL,
      checked: [],
      ...detection,
    })) as unknown as PanelImageLoaders['detectSpatialDataset'],
    getSpatialDataset: vi.fn(
      async () => dataset,
    ) as unknown as PanelImageLoaders['getSpatialDataset'],
    loadMorphologyImage,
  }
}

describe('loadPanelImage', () => {
  it('opens a Xenium run’s morphology image as the load does', async () => {
    const image = {
      url: `${URL}/morphology_focus`,
      channelLoaders: [{ info: channel(0), loader: pyramidLoader(1) }],
    } as unknown as MorphologyImage
    const loadMorphologyImage = vi.fn(async () => image)

    const result = await loadPanelImage(
      URL,
      loaders({ platform: 'xenium' }, {}, loadMorphologyImage),
    )

    expect(loadMorphologyImage).toHaveBeenCalledWith(URL, {})
    expect(result).toEqual({
      kind: 'pyramid',
      image,
      enabledChannelIds: undefined,
      autoContrast: true,
    })
  })

  it('opens an image file with its first six channels on', async () => {
    const loader = pyramidLoader(8)
    const result = await loadPanelImage(
      URL,
      loaders({ platform: 'image', imageUrl: `${URL}/slide.ome.tif` } as never, {
        image: async () => ({ kind: 'pyramid', loader }),
      }),
    )

    expect(result?.kind).toBe('pyramid')
    if (result?.kind !== 'pyramid') return
    expect(result.image.url).toBe(`${URL}/slide.ome.tif`)
    expect(result.image.channelLoaders).toHaveLength(8)
    expect(result.enabledChannelIds).toEqual(
      [0, 1, 2, 3, 4, 5].map((i) => `Channel:${i}`),
    )
    expect(result.autoContrast).toBe(true)
  })

  it('keeps a native RGB SpatialData image’s full window', async () => {
    const loader = pyramidLoader(3, false)
    const result = await loadPanelImage(
      URL,
      loaders({ platform: 'spatialdata' } as never, {
        image: async () => ({ kind: 'pyramid', loader }),
      }),
    )

    expect(result).toMatchObject({ kind: 'pyramid', autoContrast: false })
  })

  it('opens an AnnData table’s attached image, and none without one', async () => {
    const loader = pyramidLoader(2)
    const withImage = await loadPanelImage(
      URL,
      loaders({ platform: 'h5ad' } as never, {
        image: async () => ({ kind: 'pyramid', loader }),
      }),
    )
    const without = await loadPanelImage(
      URL,
      loaders({ platform: 'h5ad' } as never, { image: async () => null }),
    )

    expect(withImage).toMatchObject({
      kind: 'pyramid',
      enabledChannelIds: ['Channel:0', 'Channel:1'],
    })
    expect(without).toBeNull()
  })

  it('opens a Visium table’s tissue image, as a flat image', async () => {
    const tissueImage = vi.fn(async () => ({
      kind: 'flat' as const,
      url: `${URL}/spatial/tissue_hires_image.png`,
      scaleFactor: 0.2,
      size: [2000, 1800] as const,
    }))
    const result = await loadPanelImage(
      URL,
      loaders({ platform: 'h5ad' } as never, {
        meta: async () => ({ units: { micrometersPerPixel: 0.5 } }),
        visiumSummary: async () => ({ images: ['hires', 'lowres'] }),
        tissueImage,
        image: async () => null,
      }),
    )

    expect(tissueImage).toHaveBeenCalledWith('hires')
    expect(result).toEqual({
      kind: 'flat',
      image: {
        url: `${URL}/spatial/tissue_hires_image.png`,
        scaleFactor: 0.2,
        micrometersPerPixel: 0.5,
        size: [2000, 1800],
      },
    })
  })

  it('opens a Visium HD tissue image', async () => {
    const result = await loadPanelImage(
      URL,
      loaders({ platform: 'visium-hd' } as never, {
        meta: async () => ({ units: { micrometersPerPixel: 0.27 } }),
        image: async () => ({ kind: 'flat', url: `${URL}/hires.png`, scaleFactor: 0.1 }),
      }),
    )

    expect(result).toEqual({
      kind: 'flat',
      image: { url: `${URL}/hires.png`, scaleFactor: 0.1, micrometersPerPixel: 0.27 },
    })
  })

  it('has no image for a dataset it cannot detect', async () => {
    const getSpatialDataset = vi.fn()
    const result = await loadPanelImage(URL, {
      ...loaders({ platform: 'unknown' } as never, {}),
      getSpatialDataset,
    })

    expect(result).toBeNull()
    expect(getSpatialDataset).not.toHaveBeenCalled()
  })

  it('stops when the panel no longer wants it', async () => {
    const controller = new AbortController()
    const image = vi.fn(async () => ({ kind: 'pyramid', loader: pyramidLoader(1) }))
    const opened = loaders({ platform: 'spatialdata' } as never, { image })
    const detect = opened.detectSpatialDataset
    const result = loadPanelImage(
      URL,
      {
        ...opened,
        detectSpatialDataset: vi.fn(async (url, options) => {
          controller.abort()
          return detect(url, options)
        }),
      },
      controller.signal,
    )

    await expect(result).rejects.toThrow()
    expect(image).not.toHaveBeenCalled()
  })
})
