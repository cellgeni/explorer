import { describe, expect, it } from 'vitest'
import { cellsParquetUrl, loadDatasetOverview } from './datasetOverview'
import type { ReadCellsOverviewOptions } from './hyparquetCells'

describe('dataset overview loader', () => {
  it('builds the cells.parquet URL from a dataset base URL', () => {
    expect(cellsParquetUrl('https://example.test/xenium/')).toBe(
      'https://example.test/xenium/cells.parquet',
    )
  })

  it('loads all overview cells by default', async () => {
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
      },
    ])
  })

  it('passes an explicit overview cell limit when requested', async () => {
    const calls: ReadCellsOverviewOptions[] = []

    await loadDatasetOverview('https://example.test/xenium/', {
      limit: 50_000,
      readCells: async (options) => {
        calls.push(options)
        return []
      },
    })

    expect(calls).toEqual([
      {
        url: 'https://example.test/xenium/cells.parquet',
        limit: 50_000,
      },
    ])
  })
})
