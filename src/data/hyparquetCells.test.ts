import { describe, expect, it } from 'vitest'
import { compressors as parquetCompressors } from 'hyparquet-compressors'
import {
  asyncBufferFromBytes,
  rangeFetcher,
  xeniumCellsFixtureBytes,
  XENIUM_CELLS_FIXTURE_ROWS,
} from '../test/xeniumCellsFixtures'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import {
  CELL_OVERVIEW_COLUMNS,
  CELL_OVERVIEW_POINT_COLUMNS,
  cellsOverviewColumnsFromValues,
  cellsOverviewFromColumns,
  readCellsOverview,
} from './hyparquetCells'
import type { AsyncBuffer } from 'hyparquet'
import type { CellOverviewPoint, HyparquetReadColumnsOptions } from './hyparquetCells'

const fakeFile: AsyncBuffer = {
  byteLength: 8,
  slice: () => new ArrayBuffer(0),
}

describe('readCellsOverview', () => {
  it('projects cells.parquet centroid columns for first paint', async () => {
    const cellId = intToCellId(0x1234abcd, 1)
    const calls: HyparquetReadColumnsOptions[] = []
    const rows = await readCellsOverview({
      file: fakeFile,
      limit: 100,
      readColumns: async (options) => {
        calls.push(options)
        return {
          cell_id: [cellId],
          x_centroid: new Float64Array([10]),
          y_centroid: [20n],
          transcript_counts: new BigInt64Array([7n]),
          cell_area: [314],
          nucleus_count: [2n],
          segmentation_method: ['nucleus_expansion'],
        }
      },
    })

    expect(calls[0]).toEqual({
      file: fakeFile,
      columns: CELL_OVERVIEW_COLUMNS,
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
    const calls: HyparquetReadColumnsOptions[] = []
    const rows = await readCellsOverview({
      file: fakeFile,
      includeCellIds: false,
      readColumns: async (options) => {
        calls.push(options)
        return {
          x_centroid: [10],
          y_centroid: [20],
          transcript_counts: [7],
          cell_area: [314],
          nucleus_count: [1],
          segmentation_method: ['cellpose'],
        }
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
    const calls: HyparquetReadColumnsOptions[] = []
    const onFallback = vi.fn()
    const rows = await readCellsOverview({
      file: fakeFile,
      onFallback,
      readColumns: async (options) => {
        calls.push(options)

        if (options.columns.includes('nucleus_count')) {
          throw new Error('Column nucleus_count not found')
        }

        return {
          x_centroid: [10],
          y_centroid: [20],
          transcript_counts: [7],
          cell_area: [314],
        }
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
    const calls: HyparquetReadColumnsOptions[] = []
    const onFallback = vi.fn()
    const rows = await readCellsOverview({
      file: fakeFile,
      onFallback,
      readColumns: async (options) => {
        calls.push(options)

        if (options.columns.includes('segmentation_method')) {
          throw new Error('Column segmentation_method not found')
        }

        return {
          x_centroid: [10],
          y_centroid: [20],
          transcript_counts: [7],
          cell_area: [314],
          nucleus_count: [2],
        }
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
        readColumns: async () => {
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
        readColumns: async () => {
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

const SEGMENTATION_METHODS = [
  'Segmented by boundary stain (ATP1A1+CD45+E-Cadherin)',
  'Segmented by interior stain (18S)',
  'Segmented by nucleus expansion of 5.0µm',
]

// The cells make_fixtures.py writes.
function fixtureCell(row: number): CellOverviewPoint {
  return {
    cellId: intToCellId(0x1234abcd + row, 1),
    position: { x: micrometers(10.5 + row), y: micrometers(20.25 + 2 * row) },
    transcriptCount: 100 + row,
    ...(row === 3 ? {} : { cellArea: 30 + row }),
    nucleusCount: row % 3,
    ...(row === 5 ? {} : { segmentationMethod: SEGMENTATION_METHODS[row % 3] }),
  }
}

describe('readCellsOverview with hyparquet', () => {
  it('decodes every row group of a Xenium cells.parquet', async () => {
    const onFallback = vi.fn()
    const cells = await readCellsOverview({
      file: asyncBufferFromBytes(xeniumCellsFixtureBytes('cells.parquet')),
      onFallback,
    })

    expect(cells).toEqual(
      Array.from({ length: XENIUM_CELLS_FIXTURE_ROWS }, (_, row) => fixtureCell(row)),
    )
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('stops at the row limit inside a row group', async () => {
    const cells = await readCellsOverview({
      file: asyncBufferFromBytes(xeniumCellsFixtureBytes('cells.parquet')),
      limit: 6,
      includeCellIds: false,
    })

    expect(cells).toHaveLength(6)
    expect(cells[5]).toEqual({
      position: { x: micrometers(15.5), y: micrometers(30.25) },
      transcriptCount: 105,
      cellArea: 35,
      nucleusCount: 2,
    })
  })

  it('reads a file without the optional columns over HTTP', async () => {
    const onFallback = vi.fn()
    const cells = await readCellsOverview({
      url: 'https://example.test/xenium/cells.parquet',
      fetcher: rangeFetcher(xeniumCellsFixtureBytes('cells_v1.parquet')),
      byteRangeCache: null,
      onFallback,
    })

    expect(cells).toHaveLength(XENIUM_CELLS_FIXTURE_ROWS)
    expect(cells[0]).toEqual({
      cellId: intToCellId(0x1234abcd, 1),
      position: { x: micrometers(10.5), y: micrometers(20.25) },
      transcriptCount: 100,
      cellArea: 30,
    })
    // As with row objects, an absent optional column is not reported.
    expect(onFallback).not.toHaveBeenCalled()
  })
})

describe('cellsOverviewColumnsFromValues', () => {
  it('packs numbers into typed arrays and methods into indices', () => {
    const columns = cellsOverviewColumnsFromValues({
      x_centroid: [1, 2, 3],
      y_centroid: new Float32Array([4, 5, 6]),
      transcript_counts: [7n, 8n, 9n],
      cell_area: [10, null, undefined],
      nucleus_count: [1n, null, 2],
      segmentation_method: ['b', null, 'b'],
    })

    expect(columns).toMatchObject({
      length: 3,
      cellIds: null,
      segmentationMethods: ['b'],
      missingColumns: [],
    })
    expect(Array.from(columns.transcriptCounts)).toEqual([7, 8, 9])
    expect(Array.from(columns.cellAreas ?? [])).toEqual([10, Number.NaN, Number.NaN])
    expect(Array.from(columns.segmentationMethodIndices ?? [])).toEqual([0, -1, 0])
    expect(cellsOverviewFromColumns(columns)[1]).toEqual({
      position: { x: micrometers(2), y: micrometers(5) },
      transcriptCount: 8,
    })
  })

  it('returns no cells for empty columns', () => {
    const columns = cellsOverviewColumnsFromValues({ cell_id: [], x_centroid: [] })

    expect(columns.length).toBe(0)
    expect(cellsOverviewFromColumns(columns)).toEqual([])
  })

  it('rejects values of the wrong type', () => {
    const numbers = { x_centroid: [1], y_centroid: [2], transcript_counts: [3] }

    expect(() => cellsOverviewColumnsFromValues({ ...numbers, cell_id: [7] })).toThrow(
      'Expected cells.parquet cell_id to be a string.',
    )
    expect(() =>
      cellsOverviewColumnsFromValues({ ...numbers, cell_id: ['not-a-cell'] }),
    ).toThrow('Invalid Xenium cell ID: not-a-cell.')
    expect(() =>
      cellsOverviewColumnsFromValues({ ...numbers, y_centroid: [null] }),
    ).toThrow('Expected cells.parquet y_centroid to be numeric.')
    expect(() =>
      cellsOverviewColumnsFromValues({ ...numbers, cell_area: ['large'] }),
    ).toThrow('Expected cells.parquet cell_area to be numeric.')
    expect(() =>
      cellsOverviewColumnsFromValues({ ...numbers, segmentation_method: [1] }),
    ).toThrow('Expected cells.parquet segmentation_method to be a string.')
  })

  it('requires the centroid and count columns', () => {
    expect(() =>
      cellsOverviewColumnsFromValues({ x_centroid: [1], y_centroid: [2] }),
    ).toThrow('Expected cells.parquet transcript_counts to be numeric.')
  })
})
