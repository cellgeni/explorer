import { describe, expect, it } from 'vitest'
import { compressors as parquetCompressors } from 'hyparquet-compressors'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import {
  CELL_OVERVIEW_COLUMNS,
  CELL_OVERVIEW_POINT_COLUMNS,
  readCellsOverview,
} from './hyparquetCells'
import type { AsyncBuffer } from 'hyparquet'
import type { HyparquetReadObjectsOptions } from './hyparquetCells'

const fakeFile: AsyncBuffer = {
  byteLength: 8,
  slice: () => new ArrayBuffer(0),
}

describe('readCellsOverview', () => {
  it('projects cells.parquet centroid columns for first paint', async () => {
    const cellId = intToCellId(0x1234abcd, 1)
    const calls: HyparquetReadObjectsOptions[] = []
    const rows = await readCellsOverview({
      file: fakeFile,
      limit: 100,
      readObjects: async (options) => {
        calls.push(options)
        return [
          {
            cell_id: cellId,
            x_centroid: 10,
            y_centroid: 20n,
            transcript_counts: 7n,
            cell_area: 314,
            nucleus_count: 2n,
            segmentation_method: 'nucleus_expansion',
          },
        ]
      },
    })

    expect(calls[0]).toEqual({
      file: fakeFile,
      columns: CELL_OVERVIEW_COLUMNS,
      rowFormat: 'object',
      rowEnd: 100,
      compressors: parquetCompressors,
    })
    expect(rows).toEqual([
      {
        cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 7,
        cellArea: 314,
        nucleusCount: 2,
        segmentationMethod: 'nucleus_expansion',
      },
    ])
  })

  it('can skip cell IDs for fast all-cell centroid rendering', async () => {
    const calls: HyparquetReadObjectsOptions[] = []
    const rows = await readCellsOverview({
      file: fakeFile,
      includeCellIds: false,
      readObjects: async (options) => {
        calls.push(options)
        return [
          {
            x_centroid: 10,
            y_centroid: 20,
            transcript_counts: 7,
            cell_area: 314,
            nucleus_count: 1,
            segmentation_method: 'cellpose',
          },
        ]
      },
    })

    expect(calls[0]?.columns).toEqual(CELL_OVERVIEW_POINT_COLUMNS)
    expect(rows).toEqual([
      {
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 7,
        cellArea: 314,
        nucleusCount: 1,
        segmentationMethod: 'cellpose',
      },
    ])
  })

  it('falls back when the optional nucleus count column is unavailable', async () => {
    const calls: HyparquetReadObjectsOptions[] = []
    const onFallback = vi.fn()
    const rows = await readCellsOverview({
      file: fakeFile,
      onFallback,
      readObjects: async (options) => {
        calls.push(options)

        if (options.columns.includes('nucleus_count')) {
          throw new Error('Column nucleus_count not found')
        }

        return [
          {
            x_centroid: 10,
            y_centroid: 20,
            transcript_counts: 7,
            cell_area: 314,
          },
        ]
      },
    })

    expect(calls.map((call) => call.columns)).toEqual([
      CELL_OVERVIEW_COLUMNS,
      [
        'cell_id',
        'x_centroid',
        'y_centroid',
        'transcript_counts',
        'cell_area',
        'segmentation_method',
      ],
    ])
    expect(rows[0]).toEqual({
      position: { x: micrometers(10), y: micrometers(20) },
      transcriptCount: 7,
      cellArea: 314,
    })
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Dataset overview',
        message: expect.stringContaining('optional column nucleus_count'),
        coalesceKey: 'cells-parquet-optional-column:nucleus_count',
      }),
    )
  })

  it('falls back when the optional segmentation method column is unavailable', async () => {
    const calls: HyparquetReadObjectsOptions[] = []
    const onFallback = vi.fn()
    const rows = await readCellsOverview({
      file: fakeFile,
      onFallback,
      readObjects: async (options) => {
        calls.push(options)

        if (options.columns.includes('segmentation_method')) {
          throw new Error('Column segmentation_method not found')
        }

        return [
          {
            x_centroid: 10,
            y_centroid: 20,
            transcript_counts: 7,
            cell_area: 314,
            nucleus_count: 2,
          },
        ]
      },
    })

    expect(calls.map((call) => call.columns)).toEqual([
      CELL_OVERVIEW_COLUMNS,
      [
        'cell_id',
        'x_centroid',
        'y_centroid',
        'transcript_counts',
        'cell_area',
        'nucleus_count',
      ],
    ])
    expect(rows[0]).toEqual({
      position: { x: micrometers(10), y: micrometers(20) },
      transcriptCount: 7,
      cellArea: 314,
      nucleusCount: 2,
    })
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Dataset overview',
        message: expect.stringContaining('optional column segmentation_method'),
        coalesceKey: 'cells-parquet-optional-column:segmentation_method',
      }),
    )
  })

  it('wraps low-level parquet page read errors with overview context', async () => {
    await expect(
      readCellsOverview({
        file: fakeFile,
        includeCellIds: false,
        url: 'https://example.test/xenium/cells.parquet',
        readObjects: async () => {
          throw new RangeError('Offset is outside the bounds of the DataView')
        },
      }),
    ).rejects.toMatchObject({
      name: 'ParquetDecodeError',
      message: expect.stringContaining(
        'Unable to decode cells.parquet while reading overview columns (x_centroid, y_centroid, transcript_counts, cell_area, nucleus_count, segmentation_method).',
      ),
    })
  })

  it('wraps Safari out-of-bounds parquet page errors with overview context', async () => {
    await expect(
      readCellsOverview({
        file: fakeFile,
        includeCellIds: false,
        url: 'https://example.test/xenium/cells.parquet',
        readObjects: async () => {
          throw new RangeError('Out of bounds access')
        },
      }),
    ).rejects.toMatchObject({
      name: 'ParquetDecodeError',
      message: expect.stringContaining(
        'Unable to decode cells.parquet while reading overview columns (x_centroid, y_centroid, transcript_counts, cell_area, nucleus_count, segmentation_method).',
      ),
    })
  })
})
