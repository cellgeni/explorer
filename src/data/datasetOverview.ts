import { readCellsOverview } from './hyparquetCells'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import type { CellOverviewPoint, ReadCellsOverviewOptions } from './hyparquetCells'
import type { AssertHttpRangeSupportOptions } from './rangeSupport'

export const DEFAULT_OVERVIEW_CELL_LIMIT = 50_000

export type CellsOverviewReader = (
  options: ReadCellsOverviewOptions,
) => Promise<readonly CellOverviewPoint[]>

export type DatasetRangeValidator = (
  url: string,
  options?: AssertHttpRangeSupportOptions,
) => Promise<void>

export interface LoadDatasetOverviewOptions {
  readonly limit?: number | null
  readonly includeCellIds?: boolean
  readonly readCells?: CellsOverviewReader
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
}

export async function loadDatasetOverview(
  baseUrl: string,
  options: LoadDatasetOverviewOptions = {},
): Promise<readonly CellOverviewPoint[]> {
  const readCells = options.readCells ?? readCellsOverview
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const url = cellsParquetUrl(baseUrl)
  const limit =
    options.limit === null ? undefined : (options.limit ?? DEFAULT_OVERVIEW_CELL_LIMIT)

  await validateRangeSupport(url, {
    label: 'cells.parquet',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  return readCells({
    url,
    ...(options.includeCellIds === undefined
      ? {}
      : { includeCellIds: options.includeCellIds }),
    ...(limit === undefined ? {} : { limit }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

export function cellsParquetUrl(baseUrl: string): string {
  return datasetFileUrl(baseUrl, 'cells.parquet')
}
