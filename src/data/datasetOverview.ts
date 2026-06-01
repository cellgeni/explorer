import { isCellsParquetDecodeError, readCellsOverview } from './hyparquetCells'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import type { CellOverviewPoint, ReadCellsOverviewOptions } from './hyparquetCells'
import type { ReadCellsOverviewWithDuckDbOptions } from './duckdbCells'
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
  readonly readFallbackCells?: CellsOverviewReader
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

  const readOptions: ReadCellsOverviewOptions = {
    url,
    ...(options.includeCellIds === undefined
      ? {}
      : { includeCellIds: options.includeCellIds }),
    ...(limit === undefined ? {} : { limit }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }

  try {
    return await readCells(readOptions)
  } catch (error) {
    if (!isCellsParquetDecodeError(error)) {
      throw error
    }

    throwIfAborted(options.signal)

    const readFallbackCells = options.readFallbackCells ?? readCellsOverviewWithDuckDb
    return readFallbackCells(readOptions)
  }
}

export function cellsParquetUrl(baseUrl: string): string {
  return datasetFileUrl(baseUrl, 'cells.parquet')
}

async function readCellsOverviewWithDuckDb(
  options: ReadCellsOverviewWithDuckDbOptions,
): Promise<readonly CellOverviewPoint[]> {
  const duckDbCells = await import('./duckdbCells')
  return duckDbCells.readCellsOverviewWithDuckDb(options)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Dataset overview request aborted.')
  error.name = 'AbortError'
  return error
}
