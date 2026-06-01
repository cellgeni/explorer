import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OVERVIEW_CELL_LIMIT,
  cellsParquetUrl,
  loadDatasetOverview,
} from './datasetOverview'
import type { ReadCellsOverviewOptions } from './hyparquetCells'

describe('dataset overview loader', () => {
  it('builds the cells.parquet URL from a dataset base URL', () => {
    expect(cellsParquetUrl('https://example.test/xenium/')).toBe(
      'https://example.test/xenium/cells.parquet',
    )
  })

  it('uses the default first-paint cell limit', async () => {
    const calls: ReadCellsOverviewOptions[] = []

    await loadDatasetOverview('https://example.test/xenium/', {
      readCells: async (options) => {
        calls.push(options)
        return []
      },
    })

    expect(calls).toEqual([
      {
        url: 'https://example.test/xenium/cells.parquet',
        limit: DEFAULT_OVERVIEW_CELL_LIMIT,
      },
    ])
  })
})
