import { describe, expect, it } from 'vitest'
import { isOmeZarrImageUrl } from './omeZarrUrl'

describe('isOmeZarrImageUrl', () => {
  it.each([
    'https://example.test/images/sample.ome.zarr',
    'https://example.test/images/sample.zarr',
    'https://example.test/images/sample/zarr.json',
    'https://example.test/images/sample/.zattrs',
    'https://example.test/images/SAMPLE.OME.ZARR',
    'https://example.test/images/sample/ZARR.JSON',
  ])('recognises %s', (url) => {
    expect(isOmeZarrImageUrl(url)).toBe(true)
  })

  it.each([
    'https://example.test/images/sample.ome.tif',
    'https://example.test/images/sample.zarr.zip',
    'https://example.test/images/sample.zarr.json',
    'https://example.test/images/sample.zattrs',
    'https://example.test/images/sample.h5ad',
    'https://example.test/images/zarr',
  ])('rejects %s', (url) => {
    expect(isOmeZarrImageUrl(url)).toBe(false)
  })

  it('reads only the path, not the query or fragment', () => {
    expect(isOmeZarrImageUrl('https://example.test/a.ome.zarr?X-Amz-Signature=abc')).toBe(
      true,
    )
    expect(isOmeZarrImageUrl('https://example.test/a.zarr#channel=2')).toBe(true)
    expect(isOmeZarrImageUrl('https://example.test/image.tif?name=a.zarr')).toBe(false)
    expect(isOmeZarrImageUrl('https://example.test/image.tif#a.ome.zarr')).toBe(false)
  })

  it('needs an absolute URL', () => {
    expect(() => isOmeZarrImageUrl('images/sample.ome.zarr')).toThrow(TypeError)
  })
})
