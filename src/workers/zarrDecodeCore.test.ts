import { describe, expect, it } from 'vitest'
import {
  chunkWindow,
  chunkWindowSamples,
  decodeChunk,
  measureChunkCells,
} from './zarrDecodeCore'

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

    // The same window, sampling every other pixel after one earlier pixel.
    const tile = chunkWindowSamples(
      chunk,
      {
        xAxis: 2,
        yAxis: 1,
        x0: 2,
        y0: 1,
        width: 2,
        height: 2,
        fixedAxes: [{ axis: 0, index: 1 }],
      },
      { startIndex: 1, stride: 2, width: 2, height: 2 },
    )
    expect(Array.from(tile.samples)).toEqual([19, 23])
    expect(tile.pixelCount).toBe(4)
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
  // Plan 26: a chunk's window summed per cell, the edge chunk cut to the
  // level, and an absent chunk read as its fill value.
  it('measures cells over one channel of a chunk', async () => {
    // Channel c of a 2 × 4 × 4 chunk is 100c + x; the level is 3 pixels wide.
    const values = Uint16Array.from(
      { length: 2 * 4 * 4 },
      (_value, index) => 100 * Math.floor(index / 16) + (index % 4),
    )
    const source = {
      metadataKey: '.zarray',
      metadata: {
        zarr_format: 2,
        shape: [2, 4, 3],
        chunks: [2, 4, 4],
        dtype: '<u2',
        compressor: null,
        fill_value: 5,
        order: 'C',
        filters: null,
        dimension_separator: '/',
      },
      chunkKey: '0/0/0',
      coords: [0, 0, 0],
    } as const
    const window = {
      xAxis: 2,
      yAxis: 1,
      x0: 0,
      y0: 0,
      width: 3,
      height: 4,
      fixedAxes: [{ axis: 0, index: 1 }],
    }
    // Cell 1 covers columns 0 and 1, and column 2's middle rows, which are
    // nearer cell 2's centre for its radius. Cell 2's disc also covers
    // column 3, past the level's edge.
    const measure = () => ({
      cells: {
        x: Float32Array.from([1, 3]),
        y: Float32Array.from([2, 2]),
        radius: Float32Array.from([2, 1]),
      },
      width: 3,
      height: 4,
      threshold: 102,
    })

    const sums = await measureChunkCells(source, values.buffer, window, measure())
    expect(Array.from(sums.count)).toEqual([8, 2])
    expect(Array.from(sums.sum)).toEqual([8 * 100 + 4 * (0 + 1), 2 * 102])
    expect(Array.from(sums.above)).toEqual([0, 2])

    const missing = await measureChunkCells(source, null, window, measure())
    expect(Array.from(missing.sum)).toEqual([8 * 5, 2 * 5])
  })
})
