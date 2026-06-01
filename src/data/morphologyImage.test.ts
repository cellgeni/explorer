import { describe, expect, it, vi } from 'vitest'
import { datasetFileUrl, loadMorphologyImage } from './morphologyImage'
import type { TiffPyramidLoader } from '../tiff/loader'

describe('morphology image loader', () => {
  it('normalises dataset file URLs', () => {
    expect(datasetFileUrl('https://example.test/xenium/', '/morphology.ome.tif')).toBe(
      'https://example.test/xenium/morphology.ome.tif',
    )
  })

  it('opens the first available morphology candidate', async () => {
    const loader = {} as TiffPyramidLoader
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      return new Response(null, {
        status: String(url).endsWith('morphology.ome.tif') ? 200 : 404,
      })
    })
    const openImage = vi.fn(async () => loader)

    await expect(
      loadMorphologyImage('https://example.test/xenium/', {
        candidates: ['morphology_mip.ome.tif', 'morphology.ome.tif'],
        fetcher,
        openImage,
      }),
    ).resolves.toEqual({
      url: 'https://example.test/xenium/morphology.ome.tif',
      loader,
    })
    expect(openImage).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology.ome.tif',
    )
  })
})
