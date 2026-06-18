import { describe, expect, it, vi } from 'vitest'
import { datasetFileUrl } from './datasetFiles'
import {
  loadCustomMorphologyLayer,
  loadMorphologyImage,
  morphologyImagePathsFromExperiment,
  normalizeCustomMorphologyLayerUrl,
} from './morphologyImage'
import type { TiffPyramidLoader } from '../tiff/loader'

describe('morphology image loader', () => {
  it('normalises dataset file URLs', () => {
    expect(datasetFileUrl('https://example.test/xenium/', '/morphology.ome.tif')).toBe(
      'https://example.test/xenium/morphology.ome.tif',
    )
  })

  it('opens the preferred morphology image declared by experiment.xenium', async () => {
    const loader = {} as TiffPyramidLoader
    const fetcher = vi.fn(async () =>
      Response.json({
        images: {
          morphology_filepath: 'morphology.ome.tif',
          morphology_focus_filepath: 'morphology_focus/morphology_focus_0000.ome.tif',
        },
      }),
    )
    const openImage = vi.fn(async () => loader)

    await expect(
      loadMorphologyImage('https://example.test/xenium/', {
        fetcher,
        openImage,
      }),
    ).resolves.toEqual({
      url: 'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      loader,
      channels: [],
      channelLoaders: [],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://example.test/xenium/experiment.xenium')
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
    )
  })

  it('uses explicit candidates without probing image URLs', async () => {
    const loader = {} as TiffPyramidLoader
    const fetcher = vi.fn()
    const openImage = vi.fn(async () => loader)

    await expect(
      loadMorphologyImage('https://example.test/xenium/', {
        candidates: ['morphology.ome.tif'],
        fetcher,
        openImage,
      }),
    ).resolves.toEqual({
      url: 'https://example.test/xenium/morphology.ome.tif',
      loader,
      channels: [],
      channelLoaders: [],
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology.ome.tif',
    )
  })

  it('passes fallback notifications to the image opener', async () => {
    const loader = {} as TiffPyramidLoader
    const openImage = vi.fn(async () => loader)
    const onFallback = vi.fn()

    await expect(
      loadMorphologyImage('https://example.test/xenium/', {
        candidates: ['morphology.ome.tif'],
        openImage,
        onFallback,
      }),
    ).resolves.toMatchObject({
      url: 'https://example.test/xenium/morphology.ome.tif',
      loader,
    })

    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology.ome.tif',
      undefined,
      onFallback,
    )
  })

  it('opens channel loaders from OME-declared sibling focus files', async () => {
    const channel0 = {
      id: 'Channel:0',
      index: 0,
      name: 'DAPI',
      color: [88, 144, 255] as const,
      contrast: { min: 0, max: 65_535 },
      fileName: 'morphology_focus_0000.ome.tif',
    }
    const channel1 = {
      id: 'Channel:1',
      index: 1,
      name: 'Boundary',
      color: [32, 166, 122] as const,
      contrast: { min: 0, max: 65_535 },
      fileName: 'morphology_focus_0001.ome.tif',
    }
    const loader0 = { channels: [channel0, channel1] } as unknown as TiffPyramidLoader
    const loader1 = { channels: [channel0, channel1] } as unknown as TiffPyramidLoader
    const fetcher = vi.fn(async () =>
      Response.json({
        images: {
          morphology_focus_filepath: 'morphology_focus/morphology_focus_0000.ome.tif',
        },
      }),
    )
    const openImage = vi.fn(async (url: string) =>
      url.endsWith('morphology_focus_0001.ome.tif') ? loader1 : loader0,
    )

    await expect(
      loadMorphologyImage('https://example.test/xenium/', {
        fetcher,
        openImage,
      }),
    ).resolves.toEqual({
      url: 'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      loader: loader0,
      channels: [channel0, channel1],
      channelLoaders: [
        { info: channel0, loader: loader0 },
        { info: channel1, loader: loader1 },
      ],
    })
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0001.ome.tif',
    )
  })

  it('opens same-file OME channels from their declared IFD indices', async () => {
    const channel0 = {
      id: 'Channel:0:0',
      index: 0,
      name: 'Channel 1',
      color: [88, 144, 255] as const,
      contrast: { min: 0, max: 255 },
      fileName: 'rgb.ome.tif',
      ifdIndex: 0,
    }
    const channel1 = {
      id: 'Channel:0:1',
      index: 1,
      name: 'Channel 2',
      color: [32, 166, 122] as const,
      contrast: { min: 0, max: 255 },
      fileName: 'rgb.ome.tif',
      ifdIndex: 1,
    }
    const channel2 = {
      id: 'Channel:0:2',
      index: 2,
      name: 'Channel 3',
      color: [240, 200, 75] as const,
      contrast: { min: 0, max: 255 },
      fileName: 'rgb.ome.tif',
      ifdIndex: 2,
    }
    const loader0 = {
      channels: [channel0, channel1, channel2],
    } as unknown as TiffPyramidLoader
    const loader1 = {
      channels: [channel0, channel1, channel2],
    } as unknown as TiffPyramidLoader
    const loader2 = {
      channels: [channel0, channel1, channel2],
    } as unknown as TiffPyramidLoader
    const openImage = vi.fn(async (url: string) => {
      if (url.endsWith('#ifd=1')) {
        return loader1
      }

      if (url.endsWith('#ifd=2')) {
        return loader2
      }

      return loader0
    })

    await expect(
      loadCustomMorphologyLayer('https://example.test/layers/rgb.ome.tif', {
        openImage,
      }),
    ).resolves.toEqual({
      url: 'https://example.test/layers/rgb.ome.tif',
      loader: loader0,
      channels: [channel0, channel1, channel2],
      channelLoaders: [
        { info: channel0, loader: loader0 },
        { info: channel1, loader: loader1 },
        { info: channel2, loader: loader2 },
      ],
    })
    expect(openImage).toHaveBeenCalledWith('https://example.test/layers/rgb.ome.tif')
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/rgb.ome.tif#ifd=1',
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/rgb.ome.tif#ifd=2',
    )
  })

  it('opens a custom morphology layer directly from a remote URL', async () => {
    const channel0 = {
      id: 'Channel:0',
      index: 0,
      name: 'Custom DAPI',
      color: [88, 144, 255] as const,
      contrast: { min: 0, max: 65_535 },
      fileName: 'custom_0000.ome.tif',
    }
    const channel1 = {
      id: 'Channel:1',
      index: 1,
      name: 'Custom marker',
      color: [215, 63, 124] as const,
      contrast: { min: 0, max: 65_535 },
      fileName: 'custom_0001.ome.tif',
    }
    const loader0 = { channels: [channel0, channel1] } as unknown as TiffPyramidLoader
    const loader1 = { channels: [channel0, channel1] } as unknown as TiffPyramidLoader
    const openImage = vi.fn(async (url: string) =>
      url.endsWith('custom_0001.ome.tif') ? loader1 : loader0,
    )

    await expect(
      loadCustomMorphologyLayer(' https://example.test/layers/custom_0000.ome.tif ', {
        openImage,
      }),
    ).resolves.toEqual({
      url: 'https://example.test/layers/custom_0000.ome.tif',
      loader: loader0,
      channels: [channel0, channel1],
      channelLoaders: [
        { info: channel0, loader: loader0 },
        { info: channel1, loader: loader1 },
      ],
    })
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/custom_0000.ome.tif',
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/custom_0001.ome.tif',
    )
  })

  it('normalizes custom morphology layer URLs', () => {
    expect(
      normalizeCustomMorphologyLayerUrl(' https://example.test/layers/custom.ome.tif '),
    ).toBe('https://example.test/layers/custom.ome.tif')
    expect(() => normalizeCustomMorphologyLayerUrl('')).toThrow(
      'Enter a custom image layer URL.',
    )
    expect(() => normalizeCustomMorphologyLayerUrl('file:///tmp/custom.ome.tif')).toThrow(
      'Custom image layer URLs must use HTTP or HTTPS.',
    )
  })

  it('extracts morphology image paths from current and nested manifest shapes', () => {
    expect(
      morphologyImagePathsFromExperiment({
        images: {
          morphology_filepath: 'morphology.ome.tif',
          morphology_focus_filepath: 'morphology_focus/morphology_focus_0000.ome.tif',
          morphology_fov_locations: 'morphology_fov_locations.json',
        },
      }),
    ).toEqual(['morphology_focus/morphology_focus_0000.ome.tif', 'morphology.ome.tif'])

    expect(
      morphologyImagePathsFromExperiment({
        payload: {
          images: {
            morphology_mip_filepaths: ['morphology_mip.ome.tif'],
            morphology_filepaths: {
              zstack: 'morphology.ome.tif',
            },
          },
        },
      }),
    ).toEqual(['morphology_mip.ome.tif', 'morphology.ome.tif'])
  })
})
