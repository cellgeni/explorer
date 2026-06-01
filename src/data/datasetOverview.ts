import { readCellsOverview } from './hyparquetCells'
import type { CellOverviewPoint, ReadCellsOverviewOptions } from './hyparquetCells'

export const DEFAULT_OVERVIEW_CELL_LIMIT = 50_000

export type CellsOverviewReader = (
  options: ReadCellsOverviewOptions,
) => Promise<readonly CellOverviewPoint[]>

export interface LoadDatasetOverviewOptions {
  readonly limit?: number
  readonly readCells?: CellsOverviewReader
}

export async function loadDatasetOverview(
  baseUrl: string,
  options: LoadDatasetOverviewOptions = {},
): Promise<readonly CellOverviewPoint[]> {
  const readCells = options.readCells ?? readCellsOverview
  const limit = options.limit ?? DEFAULT_OVERVIEW_CELL_LIMIT

  return readCells({
    url: cellsParquetUrl(baseUrl),
    limit,
  })
}

export function cellsParquetUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/cells.parquet`
}
