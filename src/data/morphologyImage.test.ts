import { describe, expect, it, vi } from 'vitest'
import { datasetFileUrl } from './datasetFiles'
import {
  loadMorphologyImage,
  morphologyImagePathsFromExperiment,
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
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology.ome.tif',
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
