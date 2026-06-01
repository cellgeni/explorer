import { describe, expect, it } from 'vitest'
import { zchunkStoreCandidateUrls, zchunkStoreToPyramidOptions } from './zchunkStore'

describe('Zarr chunk store TIFF adapter', () => {
  it('prefers Xenium dataset-root chunk stores for morphology focus images', () => {
    expect(
      zchunkStoreCandidateUrls(
        'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      ),
    ).toEqual([
      'https://example.test/xenium/.zchunkstore',
      'https://example.test/xenium/morphology_focus/.zchunkstore',
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif.zchunkstore',
    ])
  })

  it('maps Zarr v3 chunk metadata to TIFF pyramid options', () => {
    const options = zchunkStoreToPyramidOptions({
      'zarr.json': {
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          multiscales: [{ datasets: [{ path: '0' }, { path: '1' }] }],
        },
      },
      '0/zarr.json': {
        zarr_format: 3,
        node_type: 'array',
        shape: [4, 200, 300],
        chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
      },
      '1/zarr.json': {
        zarr_format: 3,
        node_type: 'array',
        shape: [4, 100, 150],
        chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
      },
      '0/c/0/1/2': { offset: 10, size: 4 },
      '0/c/1/1/2': { offset: 20, size: 4 },
      '1/c/0/0/1': { offset: 30, size: 8 },
    })

    expect(options.chunkIndex.get('0/1/2')).toEqual({ offset: 10, length: 4 })
    expect(options.chunkIndex.has('0/1/1')).toBe(false)
    expect(options.chunkIndex.get('1/0/1')).toEqual({ offset: 30, length: 8 })
    expect(options.levelMeta.get(0)).toEqual({
      width: 300,
      height: 200,
      nCols: 3,
      nRows: 2,
    })
    expect(options.tileWidth).toBe(100)
    expect(options.tileHeight).toBe(100)
    expect(options.numLevels).toBe(2)
    expect(options.imageWidth).toBe(300)
    expect(options.imageHeight).toBe(200)
  })

  it('maps a requested Zarr v3 channel index to TIFF chunks', () => {
    const options = zchunkStoreToPyramidOptions(
      {
        'zarr.json': {
          zarr_format: 3,
          node_type: 'group',
          attributes: {
            multiscales: [{ datasets: [{ path: '0' }] }],
          },
        },
        '0/zarr.json': {
          zarr_format: 3,
          node_type: 'array',
          shape: [4, 200, 300],
          chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
        },
        '0/c/0/1/2': { offset: 10, size: 4 },
        '0/c/2/1/2': { offset: 20, size: 8 },
      },
      2,
    )

    expect(options.chunkIndex.get('0/1/2')).toEqual({ offset: 20, length: 8 })
  })

  it('also maps Observable-style Zarr v2 chunk-store keys', () => {
    const options = zchunkStoreToPyramidOptions({
      '.zattrs': {
        multiscales: [{ datasets: [{ path: '0' }] }],
      },
      '0/.zarray': {
        shape: [4, 120, 240],
        chunks: [1, 60, 80],
      },
      '0/0.1.2': { offset: 96, size: 32 },
    })

    expect(options.chunkIndex.get('0/1/2')).toEqual({ offset: 96, length: 32 })
    expect(options.levelMeta.get(0)).toEqual({
      width: 240,
      height: 120,
      nCols: 3,
      nRows: 2,
    })
    expect(options.tileWidth).toBe(80)
    expect(options.tileHeight).toBe(60)
  })
})
