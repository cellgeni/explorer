import { describe, expect, it, vi } from 'vitest'
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

  it('validates Range support before reading cells.parquet', async () => {
    const validateRangeSupport = vi.fn(async () => undefined)
    const readCells = vi.fn(async () => [])

    await loadDatasetOverview('https://example.test/xenium/', {
      readCells,
      validateRangeSupport,
    })

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cells.parquet',
      { label: 'cells.parquet' },
    )
    expect(readCells).toHaveBeenCalled()
  })

  it('uses the default first-paint cell limit', async () => {
    const calls: ReadCellsOverviewOptions[] = []

    await loadDatasetOverview('https://example.test/xenium/', {
      readCells: async (options) => {
        calls.push(options)
        return []
      },
      validateRangeSupport: async () => undefined,
    })

    expect(calls).toEqual([
      {
        url: 'https://example.test/xenium/cells.parquet',
        limit: DEFAULT_OVERVIEW_CELL_LIMIT,
      },
    ])
  })

  it('omits the row limit when all overview cells are requested', async () => {
    const calls: ReadCellsOverviewOptions[] = []

    await loadDatasetOverview('https://example.test/xenium/', {
      limit: null,
      readCells: async (options) => {
        calls.push(options)
        return []
      },
      validateRangeSupport: async () => undefined,
    })

    expect(calls).toEqual([
      {
        url: 'https://example.test/xenium/cells.parquet',
      },
    ])
  })

  it('passes through the optimized no-cell-id overview option', async () => {
    const calls: ReadCellsOverviewOptions[] = []

    await loadDatasetOverview('https://example.test/xenium/', {
      includeCellIds: false,
      limit: null,
      readCells: async (options) => {
        calls.push(options)
        return []
      },
      validateRangeSupport: async () => undefined,
    })

    expect(calls).toEqual([
      {
        url: 'https://example.test/xenium/cells.parquet',
        includeCellIds: false,
      },
    ])
  })
})
