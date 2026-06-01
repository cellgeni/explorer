import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { asCellId } from './cellid'
import { micrometers } from './coords'
import {
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from './persistentByteRangeCache'
import type { AsyncBuffer, Compressors } from 'hyparquet'
import type { CellId } from './cellid'
import type { DataPoint } from './coords'
import type { PersistentByteRangeCache } from './persistentByteRangeCache'

export const CELL_OVERVIEW_COLUMNS = [
  'cell_id',
  'x_centroid',
  'y_centroid',
  'transcript_counts',
  'cell_area',
] as const

export const CELL_OVERVIEW_POINT_COLUMNS = [
  'x_centroid',
  'y_centroid',
  'transcript_counts',
  'cell_area',
] as const

export interface CellOverviewPoint {
  readonly cellId?: CellId
  readonly position: DataPoint
  readonly transcriptCount: number
  readonly cellArea?: number
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
  readonly includeCellIds?: boolean
  readonly fetcher?: typeof fetch
  readonly readObjects?: HyparquetObjectReader
  readonly byteRangeCache?: PersistentByteRangeCache | null
  readonly signal?: AbortSignal
}

export async function readCellsOverview(
  options: ReadCellsOverviewOptions,
): Promise<readonly CellOverviewPoint[]> {
  const file = options.file ?? (await fileFromUrl(options))
  const readObjects = options.readObjects ?? readHyparquetObjects
  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const columns =
    options.includeCellIds === false ? CELL_OVERVIEW_POINT_COLUMNS : CELL_OVERVIEW_COLUMNS
  let rows: readonly Record<string, unknown>[]

  try {
    rows = await readObjects({
      file,
      columns,
      rowFormat: 'object',
      compressors,
      ...(options.limit === undefined ? {} : { rowEnd: options.limit }),
    })
  } catch (error) {
    if (isLowLevelParquetReadFailure(error)) {
      throw createCellsParquetDecodeError(error, columns, options.url)
    }

    throw error
  }

  return rows.map(parseCellOverviewRow)
}

async function fileFromUrl(options: ReadCellsOverviewOptions): Promise<AsyncBuffer> {
  if (options.url === undefined) {
    throw new Error('readCellsOverview requires either url or file.')
  }

  const file = await asyncBufferFromUrl({
    url: options.url,
    ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
  const byteRangeCache =
    options.byteRangeCache === undefined
      ? defaultPersistentByteRangeCache()
      : options.byteRangeCache

  return cacheFooterByteRanges(file, {
    cache: byteRangeCache,
    url: options.url,
  }) as AsyncBuffer
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

  if (cellId !== undefined && typeof cellId !== 'string') {
    throw new Error('Expected cells.parquet cell_id to be a string.')
  }

  return {
    ...(cellId === undefined ? {} : { cellId: asCellId(cellId) }),
    position: {
      x: micrometers(readNumericValue(row, 'x_centroid')),
      y: micrometers(readNumericValue(row, 'y_centroid')),
    },
    transcriptCount: readNumericValue(row, 'transcript_counts'),
    ...readOptionalNumericProperty(row, 'cell_area', 'cellArea'),
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

function readOptionalNumericProperty(
  row: Record<string, unknown>,
  parquetKey: string,
  outputKey: 'cellArea',
): { readonly cellArea: number } | Record<string, never> {
  const value = row[parquetKey]

  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value === 'number') {
    return { [outputKey]: value }
  }

  if (typeof value === 'bigint') {
    return { [outputKey]: Number(value) }
  }

  throw new Error(`Expected cells.parquet ${parquetKey} to be numeric.`)
}

function isLowLevelParquetReadFailure(error: unknown): boolean {
  const message = readUnknownErrorMessage(error).toLowerCase()

  return (
    message.includes('offset is outside the bounds of the dataview') ||
    message.includes('invalid typed array length')
  )
}

function createCellsParquetDecodeError(
  cause: unknown,
  columns: readonly string[],
  url: string | undefined,
): Error {
  const location =
    url === undefined ? 'the provided cells.parquet file' : `cells.parquet at ${url}`
  const error = new Error(
    `Unable to decode cells.parquet while reading overview columns (${columns.join(', ')}). The file was reachable, but the browser Parquet reader failed on ${location}: ${readUnknownErrorMessage(cause)}. This usually means the Parquet page encoding or page layout is not supported by the current browser reader.`,
  )
  error.name = 'ParquetDecodeError'
  return error
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return String(error)
}
