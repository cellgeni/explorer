import { createDuckDbClient } from './duckdb'
import { parseCellOverviewRow } from './hyparquetCells'
import type { CellOverviewPoint, ReadCellsOverviewOptions } from './hyparquetCells'
import type { ArrowTableLike, DuckDbPreparedStatementLike, SqlParameter } from './gex'

export interface DuckDbOverviewClientLike {
  readonly conn: DuckDbOverviewConnectionLike
  close?(): Promise<void>
}

export interface DuckDbOverviewConnectionLike {
  prepare(sql: string): Promise<DuckDbPreparedStatementLike>
}

export interface ReadCellsOverviewWithDuckDbOptions extends Pick<
  ReadCellsOverviewOptions,
  'includeCellIds' | 'limit' | 'signal' | 'url'
> {
  readonly createClient?: () => Promise<DuckDbOverviewClientLike>
}

const OVERVIEW_POINT_COLUMNS = [
  'x_centroid',
  'y_centroid',
  'transcript_counts',
  'cell_area',
] as const

const OVERVIEW_WITH_ID_COLUMNS = ['cell_id', ...OVERVIEW_POINT_COLUMNS] as const

export async function readCellsOverviewWithDuckDb(
  options: ReadCellsOverviewWithDuckDbOptions,
): Promise<readonly CellOverviewPoint[]> {
  if (options.url === undefined) {
    throw new Error('readCellsOverviewWithDuckDb requires a cells.parquet URL.')
  }

  throwIfAborted(options.signal)

  const createClient = options.createClient ?? createDuckDbClient
  const client = await createClient()

  try {
    throwIfAborted(options.signal)

    const columns =
      options.includeCellIds === false ? OVERVIEW_POINT_COLUMNS : OVERVIEW_WITH_ID_COLUMNS
    const statement = await client.conn.prepare(overviewSql(columns, options.limit))
    const table = await queryOverviewRows(statement, options)

    throwIfAborted(options.signal)
    return table.toArray().map(parseCellOverviewRow)
  } finally {
    await client.close?.()
  }
}

function overviewSql(columns: readonly string[], limit: number | undefined): string {
  return `
SELECT ${columns.join(',\n       ')}
FROM read_parquet( ? )
ORDER BY file_row_number
${limit === undefined ? '' : 'LIMIT ?'}
`
}

async function queryOverviewRows(
  statement: DuckDbPreparedStatementLike,
  options: ReadCellsOverviewWithDuckDbOptions,
): Promise<ArrowTableLike> {
  const params: SqlParameter[] = [options.url ?? '']

  if (options.limit !== undefined) {
    params.push(options.limit)
  }

  return statement.query(...params)
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

  const error = new Error('DuckDB overview read aborted.')
  error.name = 'AbortError'
  return error
}
