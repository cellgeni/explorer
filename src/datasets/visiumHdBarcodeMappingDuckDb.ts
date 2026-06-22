import { datasetFileUrl } from '../data/datasetFiles'
import { createDuckDbClient } from '../data/duckdb'
import {
  parseVisiumHdBarcodeMappingRows,
  VISIUM_HD_BARCODE_MAPPINGS_PATH,
  type VisiumHdBarcodeMapping,
} from './visiumHdBarcodeMappings'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  SqlParameter,
} from '../data/gex'
import type { SpatialElementId } from './spatialDataset'

export interface DuckDbBarcodeMappingClientLike {
  readonly conn: DuckDbBarcodeMappingConnectionLike
  close?(): Promise<void>
}

export interface DuckDbBarcodeMappingConnectionLike {
  prepare(sql: string): Promise<DuckDbPreparedStatementLike>
}

export interface ReadVisiumHdBarcodeMappingsForCellWithDuckDbOptions {
  readonly signal?: AbortSignal
  readonly createClient?: () => Promise<DuckDbBarcodeMappingClientLike>
}

export async function readVisiumHdBarcodeMappingsForCellWithDuckDb(
  baseUrl: string,
  cellId: SpatialElementId,
  options: ReadVisiumHdBarcodeMappingsForCellWithDuckDbOptions = {},
): Promise<readonly VisiumHdBarcodeMapping[]> {
  throwIfAborted(options.signal)

  const createClient = options.createClient ?? createDuckDbClient
  const client = await createClient()

  try {
    throwIfAborted(options.signal)

    const statement = await client.conn.prepare(barcodeMappingsForCellSql())
    const table = await queryBarcodeMappingsForCell(statement, baseUrl, cellId)

    throwIfAborted(options.signal)

    return parseVisiumHdBarcodeMappingRows(table.toArray())
  } finally {
    await client.close?.()
  }
}

function barcodeMappingsForCellSql(): string {
  return `
SELECT square_002um,
       square_008um,
       square_016um,
       cell_id,
       in_nucleus,
       in_cell
FROM read_parquet( ? )
WHERE cell_id = ?
  AND (in_cell = true OR in_nucleus = true)
ORDER BY square_002um
`
}

async function queryBarcodeMappingsForCell(
  statement: DuckDbPreparedStatementLike,
  baseUrl: string,
  cellId: SpatialElementId,
): Promise<ArrowTableLike> {
  const params: SqlParameter[] = [
    datasetFileUrl(baseUrl, VISIUM_HD_BARCODE_MAPPINGS_PATH),
    cellId,
  ]

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

  const error = new Error('DuckDB barcode mapping query aborted.')
  error.name = 'AbortError'
  return error
}
