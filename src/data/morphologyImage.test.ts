import { describe, expect, it, vi } from 'vitest'
import { datasetFileUrl, setDatasetManifest } from './datasetFiles'
import {
  loadCustomMorphologyLayer,
  loadMorphologyImage,
  morphologyImageFromPyramidLoader,
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
      undefined,
      undefined,
      undefined,
    )
  })

  it('opens the image a dataset manifest names without reading experiment.xenium', async () => {
    const baseUrl = 'https://example.test/manifest-images/explorer.json'
    const loader = {} as TiffPyramidLoader
    const fetcher = vi.fn()
    const openImage = vi.fn(async () => loader)
    setDatasetManifest(baseUrl, {
      platform: 'xenium',
      url: baseUrl,
      rootUrl: 'https://example.test/manifest-images',
      files: {
        morphology: {
          path: 'images/he.ome.tif',
          url: 'https://example.test/manifest-images/images/he.ome.tif',
        },
      },
    })

    try {
      await expect(
        loadMorphologyImage(baseUrl, { fetcher, openImage }),
      ).resolves.toMatchObject({
        url: 'https://example.test/manifest-images/images/he.ome.tif',
      })
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
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
      undefined,
      undefined,
      undefined,
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
      undefined,
    )
  })

  it('opens the image and its channel files with the manifest sidecar', async () => {
    const baseUrl = 'https://example.test/manifest-sidecar/explorer.json'
    const zchunkStoreUrl = 'https://sidecars.example.test/focus.zchunkstore'
    const channels = [
      { id: 'Channel:0', index: 0, fileName: 'morphology_focus_0000.ome.tif' },
      { id: 'Channel:1', index: 1, fileName: 'morphology_focus_0001.ome.tif' },
    ]
    const loader = { channels } as unknown as TiffPyramidLoader
    const openImage = vi.fn(async () => loader)
    setDatasetManifest(baseUrl, {
      platform: 'xenium',
      url: baseUrl,
      rootUrl: 'https://example.test/manifest-sidecar',
      files: {
        morphology: {
          path: 'morphology_focus/morphology_focus_0000.ome.tif',
          url: 'https://example.test/manifest-sidecar/morphology_focus/morphology_focus_0000.ome.tif',
        },
        morphologyZchunkstore: { path: zchunkStoreUrl, url: zchunkStoreUrl },
      },
    })

    try {
      await loadMorphologyImage(baseUrl, { fetcher: vi.fn(), openImage })
      expect(openImage.mock.calls).toEqual([
        [
          'https://example.test/manifest-sidecar/morphology_focus/morphology_focus_0000.ome.tif',
          undefined,
          undefined,
          { zchunkStoreUrl },
        ],
        [
          'https://example.test/manifest-sidecar/morphology_focus/morphology_focus_0001.ome.tif',
          undefined,
          undefined,
          { zchunkStoreUrl },
        ],
      ])
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
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
      undefined,
      undefined,
      undefined,
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0001.ome.tif',
      undefined,
      undefined,
      undefined,
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
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/rgb.ome.tif',
      undefined,
      undefined,
      undefined,
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/rgb.ome.tif#ifd=1',
      undefined,
      undefined,
      undefined,
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/rgb.ome.tif#ifd=2',
      undefined,
      undefined,
      undefined,
    )
  })

  it('creates a full morphology image from an already-opened pyramid loader', async () => {
    const channel0 = {
      id: 'Channel:0:0',
      index: 0,
      name: 'DAPI',
      color: [88, 144, 255] as const,
      contrast: { min: 0, max: 255 },
      fileName: 'image.ome.tif',
      ifdIndex: 0,
    }
    const channel1 = {
      id: 'Channel:0:1',
      index: 1,
      name: 'Marker',
      color: [215, 63, 124] as const,
      contrast: { min: 0, max: 255 },
      fileName: 'image.ome.tif',
      ifdIndex: 1,
    }
    const loader0 = {
      channels: [channel0, channel1],
    } as unknown as TiffPyramidLoader
    const loader1 = {
      channels: [channel0, channel1],
    } as unknown as TiffPyramidLoader
    const openImage = vi.fn(async (url: string) =>
      url.endsWith('#ifd=1') ? loader1 : loader0,
    )

    await expect(
      morphologyImageFromPyramidLoader(
        'https://example.test/images/image.ome.tif',
        loader0,
        { openImage },
      ),
    ).resolves.toEqual({
      url: 'https://example.test/images/image.ome.tif',
      loader: loader0,
      channels: [channel0, channel1],
      channelLoaders: [
        { info: channel0, loader: loader0 },
        { info: channel1, loader: loader1 },
      ],
    })
    expect(openImage).toHaveBeenCalledTimes(1)
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/images/image.ome.tif#ifd=1',
      undefined,
      undefined,
      undefined,
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
      undefined,
      undefined,
      undefined,
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/custom_0001.ome.tif',
      undefined,
      undefined,
      undefined,
    )
  })

  it('retries remote HTTP custom morphology layers over HTTPS', async () => {
    const loader = {} as TiffPyramidLoader
    const openImage = vi.fn(async (url: string) => {
      if (url.startsWith('http://')) {
        throw new TypeError('Failed to fetch')
      }

      return loader
    })

    await expect(
      loadCustomMorphologyLayer('http://example.test/layers/custom.ome.tif', {
        openImage,
      }),
    ).resolves.toMatchObject({
      url: 'https://example.test/layers/custom.ome.tif',
      loader,
    })
    expect(openImage).toHaveBeenCalledWith(
      'http://example.test/layers/custom.ome.tif',
      undefined,
      undefined,
      undefined,
    )
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/layers/custom.ome.tif',
      undefined,
      undefined,
      undefined,
    )
  })

  it('does not rewrite localhost custom morphology layer URLs', async () => {
    const error = new TypeError('Failed to fetch')
    const openImage = vi.fn(async () => {
      throw error
    })

    await expect(
      loadCustomMorphologyLayer('http://localhost:3100/custom.ome.tif', {
        openImage,
      }),
    ).rejects.toBe(error)
    expect(openImage).toHaveBeenCalledTimes(1)
    expect(openImage).toHaveBeenCalledWith(
      'http://localhost:3100/custom.ome.tif',
      undefined,
      undefined,
      undefined,
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
