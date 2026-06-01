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
      },
    ])
  })
})
