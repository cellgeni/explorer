import { describe, expect, it } from 'vitest'
import {
  segmentationFormatFromName,
  segmentationLinkFor,
  segmentationSourceFromLink,
  segmentationSourceName,
} from './segmentationSource'

describe('segmentationFormatFromName', () => {
  it('reads the format from the extension, before a query or hash', () => {
    expect(segmentationFormatFromName('https://x/a_cp_masks.tif?sig=1')).toBe(
      'label-tiff',
    )
    expect(segmentationFormatFromName('mask.OME.TIFF')).toBe('label-tiff')
    expect(segmentationFormatFromName('https://x/labels.zarr/')).toBe('label-zarr')
    expect(segmentationFormatFromName('https://x/labels/zarr.json')).toBe('label-zarr')
    expect(segmentationFormatFromName('cells.geojson.gz')).toBe('geojson')
    expect(segmentationFormatFromName('cells.json#x')).toBe('geojson')
    expect(segmentationFormatFromName('cells.parquet')).toBe('parquet')
    expect(segmentationFormatFromName('cells.csv.gz')).toBe('wkt')
    expect(segmentationFormatFromName('cells.wkt')).toBe('wkt')
  })

  it('refuses gzipped binary formats and unknown names', () => {
    expect(segmentationFormatFromName('mask.tif.gz')).toBeNull()
    expect(segmentationFormatFromName('cells.parquet.gz')).toBeNull()
    expect(segmentationFormatFromName('https://x/download?id=3')).toBeNull()
  })
})

describe('segmentation links', () => {
  it('writes only what the name does not tell', () => {
    expect(
      segmentationLinkFor({
        url: 'https://x/cells.csv',
        format: 'wkt',
        coordinates: 'micrometers',
      }),
    ).toEqual({ url: 'https://x/cells.csv', units: 'micrometers' })
    expect(
      segmentationLinkFor({
        url: 'https://x/get?id=1',
        format: 'label-tiff',
        coordinates: 'micrometers',
      }),
    ).toEqual({ url: 'https://x/get?id=1', format: 'label-tiff' })
    expect(
      segmentationLinkFor({
        url: 'local.geojson',
        file: new Blob(['{}']),
        format: 'geojson',
        coordinates: 'pixels',
      }),
    ).toBeUndefined()
  })

  it('reads a link back into a source', () => {
    expect(
      segmentationSourceFromLink({ url: 'https://x/get?id=1', format: 'parquet' }),
    ).toEqual({ url: 'https://x/get?id=1', format: 'parquet', coordinates: 'pixels' })
    expect(
      segmentationSourceFromLink({ url: 'https://x/a.wkt', units: 'micrometers' }),
    ).toEqual({ url: 'https://x/a.wkt', format: 'wkt', coordinates: 'micrometers' })
    expect(segmentationSourceFromLink({ url: 'https://x/get', format: 'svg' })).toBeNull()
  })

  it('names a source by its last path part', () => {
    expect(segmentationSourceName('https://x/a%20b/cp_masks.tif?x=1')).toBe(
      'cp_masks.tif',
    )
    expect(segmentationSourceName('https://x/labels.zarr/')).toBe('labels.zarr')
  })
})
