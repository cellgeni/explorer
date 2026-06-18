import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { asCellId } from './cellid'
import { micrometers } from './coords'
import {
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from './persistentByteRangeCache'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
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
  'nucleus_count',
  'segmentation_method',
] as const

export const CELL_OVERVIEW_POINT_COLUMNS = [
  'x_centroid',
  'y_centroid',
  'transcript_counts',
  'cell_area',
  'nucleus_count',
  'segmentation_method',
] as const

const OPTIONAL_CELL_OVERVIEW_COLUMNS = new Set(['nucleus_count', 'segmentation_method'])

export interface CellOverviewPoint {
  readonly cellId?: CellId
  readonly position: DataPoint
  readonly transcriptCount: number
  readonly cellArea?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
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

export class CellsParquetDecodeError extends Error {
  override readonly name = 'ParquetDecodeError'
}

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
  readonly onFallback?: FallbackNotifier
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
  const rows = await readCellsOverviewRows({
    file,
    columns,
    rowFormat: 'object',
    compressors,
    ...(options.limit === undefined ? {} : { rowEnd: options.limit }),
    readObjects,
    url: options.url,
    onFallback: options.onFallback,
  })

  return rows.map(parseCellOverviewRow)
}

async function readCellsOverviewRows(
  options: HyparquetReadObjectsOptions & {
    readonly readObjects: HyparquetObjectReader
    readonly url: string | undefined
    readonly onFallback: FallbackNotifier | undefined
  },
): Promise<readonly Record<string, unknown>[]> {
  const missingOptionalColumns = new Set<string>()

  while (true) {
    const columns = options.columns.filter(
      (column) => !missingOptionalColumns.has(column),
    )

    try {
      return await readCellsOverviewRowsWithColumns(options, columns)
    } catch (error) {
      const missingColumn = readMissingOptionalCellOverviewColumn(error)

      if (missingColumn === null || !columns.includes(missingColumn)) {
        throw error
      }

      missingOptionalColumns.add(missingColumn)
      notifyFallback(options.onFallback, {
        source: 'Dataset overview',
        message: `cells.parquet is missing optional column ${missingColumn}; continuing without that cell metadata.`,
        action:
          'Overview rendering can continue, but controls that need that optional field may be unavailable.',
        coalesceKey: `cells-parquet-optional-column:${missingColumn}`,
      })
    }
  }
}

async function readCellsOverviewRowsWithColumns(
  options: HyparquetReadObjectsOptions & {
    readonly readObjects: HyparquetObjectReader
    readonly url: string | undefined
  },
  columns: readonly string[],
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await options.readObjects({
      file: options.file,
      columns,
      rowFormat: options.rowFormat,
      ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
      ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
    })
  } catch (error) {
    if (isLowLevelParquetReadFailure(error)) {
      throw createCellsParquetDecodeError(error, columns, options.url)
    }

    throw error
  }
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

export function parseCellOverviewRow(row: Record<string, unknown>): CellOverviewPoint {
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
    ...readOptionalNumericProperty(row, 'nucleus_count', 'nucleusCount'),
    ...readOptionalSegmentationMethod(row, 'segmentation_method'),
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
  outputKey: 'cellArea' | 'nucleusCount',
):
  | { readonly cellArea: number }
  | { readonly nucleusCount: number }
  | Record<string, never> {
  const value = row[parquetKey]

  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value === 'number') {
    return outputKey === 'cellArea' ? { cellArea: value } : { nucleusCount: value }
  }

  if (typeof value === 'bigint') {
    const numericValue = Number(value)
    return outputKey === 'cellArea'
      ? { cellArea: numericValue }
      : { nucleusCount: numericValue }
  }

  throw new Error(`Expected cells.parquet ${parquetKey} to be numeric.`)
}

function readOptionalSegmentationMethod(
  row: Record<string, unknown>,
  parquetKey: string,
): { readonly segmentationMethod: string } | Record<string, never> {
  const value = row[parquetKey]

  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value === 'string') {
    return { segmentationMethod: value }
  }

  throw new Error(`Expected cells.parquet ${parquetKey} to be a string.`)
}

function isLowLevelParquetReadFailure(error: unknown): boolean {
  const message = readUnknownErrorMessage(error).toLowerCase()

  return (
    message.includes('offset is outside the bounds of the dataview') ||
    message.includes('out of bounds access') ||
    message.includes('invalid typed array length')
  )
}

function readMissingOptionalCellOverviewColumn(error: unknown): string | null {
  if (error instanceof CellsParquetDecodeError) {
    return null
  }

  const message = readUnknownErrorMessage(error).toLowerCase()

  if (!message.includes('column')) {
    return null
  }

  for (const column of OPTIONAL_CELL_OVERVIEW_COLUMNS) {
    if (message.includes(column)) {
      return column
    }
  }

  return null
}

export function isCellsParquetDecodeError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ParquetDecodeError'
}

function createCellsParquetDecodeError(
  cause: unknown,
  columns: readonly string[],
  url: string | undefined,
): Error {
  const location =
    url === undefined ? 'the provided cells.parquet file' : `cells.parquet at ${url}`
  return new CellsParquetDecodeError(
    `Unable to decode cells.parquet while reading overview columns (${columns.join(', ')}). The file was reachable, but the browser Parquet reader failed on ${location}: ${readUnknownErrorMessage(cause)}. This usually means the Parquet page encoding or page layout is not supported by the current browser reader.`,
  )
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return String(error)
}
