import { describe, expect, it } from 'vitest'
import { chunkWindow, decodeChunk } from './zarrDecodeCore'

describe('Zarr decode worker core', () => {
  it('decodes a v2 chunk from its metadata and copies a window', async () => {
    const values = Uint16Array.from({ length: 2 * 3 * 4 }, (_value, index) => index)
    const chunk = await decodeChunk(
      {
        metadataKey: '.zarray',
        metadata: {
          zarr_format: 2,
          shape: [2, 3, 4],
          chunks: [2, 3, 4],
          dtype: '<u2',
          compressor: null,
          fill_value: 0,
          order: 'C',
          filters: null,
          dimension_separator: '/',
        },
        chunkKey: '0/0/0',
        coords: [0, 0, 0],
      },
      values.buffer,
    )

    // Channel 1, rows 1-2, columns 2-3.
    const pixels = chunkWindow(chunk, {
      xAxis: 2,
      yAxis: 1,
      x0: 2,
      y0: 1,
      width: 2,
      height: 2,
      fixedAxes: [{ axis: 0, index: 1 }],
    })
    expect(Array.from(pixels)).toEqual([18, 19, 22, 23])
  })

  it('fills absent v3 chunks with the fill value', async () => {
    const chunk = await decodeChunk(
      {
        metadataKey: 'zarr.json',
        metadata: {
          zarr_format: 3,
          node_type: 'array',
          shape: [2, 2],
          data_type: 'uint8',
          chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2] } },
          chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
          codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
          fill_value: 7,
        },
        chunkKey: 'c/0/0',
        coords: [0, 0],
      },
      null,
    )

    expect(Array.from(chunk.data as Uint8Array)).toEqual([7, 7, 7, 7])
  })
})
