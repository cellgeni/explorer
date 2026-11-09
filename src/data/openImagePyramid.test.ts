import { describe, expect, it, vi } from 'vitest'
import { openImagePyramid } from './morphologyImage'
import { openOmeZarrImage } from '../zarr/omeZarrLoader'
import { openTiff } from '../tiff/loader'
import type { OmeZarrImagePyramidLoader } from '../zarr/omeZarrLoader'
import type { TiffPyramidLoader } from '../tiff/loader'

vi.mock('../zarr/omeZarrLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../zarr/omeZarrLoader')>()),
  openOmeZarrImage: vi.fn(),
}))

vi.mock('../tiff/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tiff/loader')>()),
  openTiff: vi.fn(),
}))

describe('openImagePyramid', () => {
  it('passes the manifest sidecar to TIFF images', async () => {
    const onFallback = vi.fn()
    vi.mocked(openTiff).mockResolvedValue({} as TiffPyramidLoader)

    await openImagePyramid('https://example.test/he.ome.tif', undefined, onFallback, {
      zchunkStoreUrl: 'https://example.test/he.zchunkstore',
    })

    expect(openTiff).toHaveBeenCalledWith(
      'https://example.test/he.ome.tif',
      undefined,
      onFallback,
      { zchunkStoreUrl: 'https://example.test/he.zchunkstore' },
    )
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('reports a manifest sidecar it cannot use for an OME-Zarr image', async () => {
    const onFallback = vi.fn()
    vi.mocked(openOmeZarrImage).mockResolvedValue({} as OmeZarrImagePyramidLoader)

    await openImagePyramid('https://example.test/he.ome.zarr', undefined, onFallback, {
      zchunkStoreUrl: 'https://example.test/he.zchunkstore',
    })

    expect(openOmeZarrImage).toHaveBeenCalledWith(
      'https://example.test/he.ome.zarr',
      undefined,
    )
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('the image is OME-Zarr') as unknown,
      }),
    )
  })
})
