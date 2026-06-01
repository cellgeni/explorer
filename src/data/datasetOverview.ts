import { readCellsOverview } from './hyparquetCells'
import type { CellOverviewPoint, ReadCellsOverviewOptions } from './hyparquetCells'

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

  return readCells({
    url: cellsParquetUrl(baseUrl),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  })
}

export function cellsParquetUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/cells.parquet`
}
