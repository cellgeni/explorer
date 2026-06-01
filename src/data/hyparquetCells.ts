import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { asCellId } from './cellid'
import { micrometers } from './coords'
import type { AsyncBuffer, Compressors } from 'hyparquet'
import type { CellId } from './cellid'
import type { DataPoint } from './coords'

export const CELL_OVERVIEW_COLUMNS = [
  'cell_id',
  'x_centroid',
  'y_centroid',
  'transcript_counts',
] as const

export interface CellOverviewPoint {
  readonly cellId: CellId
  readonly position: DataPoint
  readonly transcriptCount: number
}

export interface HyparquetReadObjectsOptions {
  readonly file: AsyncBuffer
  readonly columns: readonly string[]
  readonly rowFormat: 'object'
  readonly rowEnd?: number
  readonly compressors?: Compressors
}

export type HyparquetObjectReader = (
  options: HyparquetReadObjectsOptions,
) => Promise<readonly Record<string, unknown>[]>

export interface ReadCellsOverviewOptions {
  readonly url?: string
  readonly file?: AsyncBuffer
  readonly limit?: number
  readonly compressors?: Compressors
  readonly loadCompressors?: () => Promise<Compressors>
  readonly fetcher?: typeof fetch
  readonly readObjects?: HyparquetObjectReader
}

export async function readCellsOverview(
  options: ReadCellsOverviewOptions,
): Promise<readonly CellOverviewPoint[]> {
  const file = options.file ?? (await fileFromUrl(options))
  const readObjects = options.readObjects ?? readHyparquetObjects
  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const rows = await readObjects({
    file,
    columns: CELL_OVERVIEW_COLUMNS,
    rowFormat: 'object',
    compressors,
    ...(options.limit === undefined ? {} : { rowEnd: options.limit }),
  })

  return rows.map(parseCellOverviewRow)
}

async function fileFromUrl(options: ReadCellsOverviewOptions): Promise<AsyncBuffer> {
  if (options.url === undefined) {
    throw new Error('readCellsOverview requires either url or file.')
  }

  return asyncBufferFromUrl({
    url: options.url,
    ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
  })
}

async function readHyparquetObjects(
  options: HyparquetReadObjectsOptions,
): Promise<readonly Record<string, unknown>[]> {
  return (await parquetReadObjects({
    file: options.file,
    columns: [...options.columns],
    rowFormat: options.rowFormat,
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
    ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
  })) as readonly Record<string, unknown>[]
}

function parseCellOverviewRow(row: Record<string, unknown>): CellOverviewPoint {
  const cellId = row.cell_id

  if (typeof cellId !== 'string') {
    throw new Error('Expected cells.parquet cell_id to be a string.')
  }

  return {
    cellId: asCellId(cellId),
    position: {
      x: micrometers(readNumericValue(row, 'x_centroid')),
      y: micrometers(readNumericValue(row, 'y_centroid')),
    },
    transcriptCount: readNumericValue(row, 'transcript_counts'),
  }
}

async function loadDefaultCompressors(): Promise<Compressors> {
  const { compressors } = await import('hyparquet-compressors')
  return compressors
}

function readNumericValue(row: Record<string, unknown>, key: string): number {
  const value = row[key]

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  throw new Error(`Expected cells.parquet ${key} to be numeric.`)
}
