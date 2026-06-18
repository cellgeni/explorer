import { createDuckDbClient } from './duckdb'
import { parseCellOverviewRow } from './hyparquetCells'
import { notifyFallback } from './fallbackNotice'
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
  'includeCellIds' | 'limit' | 'onFallback' | 'signal' | 'url'
> {
  readonly createClient?: () => Promise<DuckDbOverviewClientLike>
}

const OVERVIEW_POINT_COLUMNS = [
  'x_centroid',
  'y_centroid',
  'transcript_counts',
  'cell_area',
  'nucleus_count',
  'segmentation_method',
] as const

const OVERVIEW_WITH_ID_COLUMNS = ['cell_id', ...OVERVIEW_POINT_COLUMNS] as const
const OPTIONAL_OVERVIEW_COLUMNS = new Set(['nucleus_count', 'segmentation_method'])

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
    const table = await queryOverviewRowsWithFallback(client, columns, options)

    throwIfAborted(options.signal)
    return table.toArray().map(parseCellOverviewRow)
  } finally {
    await client.close?.()
  }
}

async function queryOverviewRowsWithFallback(
  client: DuckDbOverviewClientLike,
  columns: readonly string[],
  options: ReadCellsOverviewWithDuckDbOptions,
): Promise<ArrowTableLike> {
  const missingOptionalColumns = new Set<string>()

  while (true) {
    const currentColumns = columns.filter((column) => !missingOptionalColumns.has(column))

    try {
      return await queryOverviewRowsForColumns(client, currentColumns, options)
    } catch (error) {
      const missingColumn = readMissingOptionalOverviewColumn(error)

      if (missingColumn === null || !currentColumns.includes(missingColumn)) {
        throw error
      }

      missingOptionalColumns.add(missingColumn)
      notifyFallback(options.onFallback, {
        source: 'Dataset overview',
        message: `DuckDB overview read found cells.parquet is missing optional column ${missingColumn}; continuing without that cell metadata.`,
        action:
          'Overview rendering can continue, but controls that need that optional field may be unavailable.',
        coalesceKey: `duckdb-cells-parquet-optional-column:${missingColumn}`,
      })
    }
  }
}

async function queryOverviewRowsForColumns(
  client: DuckDbOverviewClientLike,
  columns: readonly string[],
  options: ReadCellsOverviewWithDuckDbOptions,
): Promise<ArrowTableLike> {
  const statement = await client.conn.prepare(overviewSql(columns, options.limit))
  return queryOverviewRows(statement, options)
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

function readMissingOptionalOverviewColumn(error: unknown): string | null {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()

  if (!message.includes('column')) {
    return null
  }

  for (const column of OPTIONAL_OVERVIEW_COLUMNS) {
    if (message.includes(column)) {
      return column
    }
  }

  return null
}
