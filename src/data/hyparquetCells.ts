import {
  asyncBufferFromUrl,
  parquetMetadataAsync,
  parquetRead,
  parquetSchema,
} from 'hyparquet'
import type { CellMetadata } from './cellMetadata'
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
  readonly metadata?: CellMetadata
  // Builds the metadata when it is shown, for sources that hold it by column
  // (AnnData tables): an object per cell built up front takes seconds and
  // hundreds of MB for a table of 600,000 cells.
  readonly readMetadata?: () => CellMetadata
}

// The overview columns of cells.parquet, one entry per cell. The overview
// worker sends these to the main thread: the typed arrays are transferred, and
// only cell IDs and the distinct segmentation methods are cloned as strings.
export interface CellsOverviewColumns {
  readonly length: number
  readonly cellIds: readonly CellId[] | null
  readonly x: Float64Array
  readonly y: Float64Array
  readonly transcriptCounts: Float64Array
  // NaN where a cell has no value; null when the file has no such column.
  readonly cellAreas: Float64Array | null
  readonly nucleusCounts: Float64Array | null
  // Indices into `segmentationMethods`, or -1 where a cell has none.
  readonly segmentationMethodIndices: Int32Array | null
  readonly segmentationMethods: readonly string[]
  // Optional columns the reader reported missing, for the caller's notices.
  readonly missingColumns: readonly string[]
}

export interface HyparquetReadColumnsOptions {
  readonly file: AsyncBuffer
  readonly columns: readonly string[]
  readonly rowEnd?: number
  readonly compressors?: Compressors
}

// Each requested column the file has, with one value per row from row 0.
export type HyparquetColumnReader = (
  options: HyparquetReadColumnsOptions,
) => Promise<Readonly<Record<string, ArrayLike<unknown>>>>

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
  readonly readColumns?: HyparquetColumnReader
  readonly byteRangeCache?: PersistentByteRangeCache | null
  readonly onFallback?: FallbackNotifier
  readonly signal?: AbortSignal
}

export type ReadCellsOverviewColumnsOptions = Omit<ReadCellsOverviewOptions, 'onFallback'>

// Reads on this thread. `readCellsOverviewInWorker` reads the same columns in
// a worker.
export async function readCellsOverview(
  options: ReadCellsOverviewOptions,
): Promise<readonly CellOverviewPoint[]> {
  const columns = await readCellsOverviewColumns(options)
  notifyMissingCellOverviewColumns(columns.missingColumns, options.onFallback)
  return cellsOverviewFromColumns(columns)
}

export async function readCellsOverviewColumns(
  options: ReadCellsOverviewColumnsOptions,
): Promise<CellsOverviewColumns> {
  const file = options.file ?? (await fileFromUrl(options))
  const readColumns = options.readColumns ?? readHyparquetColumns
  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const columns: readonly string[] =
    options.includeCellIds === false ? CELL_OVERVIEW_POINT_COLUMNS : CELL_OVERVIEW_COLUMNS
  const missingColumns: string[] = []

  while (true) {
    const readableColumns = columns.filter((column) => !missingColumns.includes(column))
    let values: Readonly<Record<string, ArrayLike<unknown>>>

    try {
      values = await readCellsOverviewValues(
        {
          file,
          columns: readableColumns,
          compressors,
          ...(options.limit === undefined ? {} : { rowEnd: options.limit }),
        },
        readColumns,
        options.url,
      )
    } catch (error) {
      const missingColumn = readMissingOptionalCellOverviewColumn(error)

      if (missingColumn === null || !readableColumns.includes(missingColumn)) {
        throw error
      }

      missingColumns.push(missingColumn)
      continue
    }

    return cellsOverviewColumnsFromValues(values, missingColumns)
  }
}

export function notifyMissingCellOverviewColumns(
  missingColumns: readonly string[],
  onFallback: FallbackNotifier | undefined,
): void {
  for (const missingColumn of missingColumns) {
    notifyFallback(onFallback, {
      source: 'Dataset overview',
      message: `cells.parquet is missing optional column ${missingColumn}; continuing without that cell metadata.`,
      action:
        'Overview rendering can continue, but controls that need that optional field may be unavailable.',
      coalesceKey: `cells-parquet-optional-column:${missingColumn}`,
    })
  }
}

async function readCellsOverviewValues(
  options: HyparquetReadColumnsOptions,
  readColumns: HyparquetColumnReader,
  url: string | undefined,
): Promise<Readonly<Record<string, ArrayLike<unknown>>>> {
  try {
    return await readColumns(options)
  } catch (error) {
    if (isLowLevelParquetReadFailure(error)) {
      throw createCellsParquetDecodeError(error, options.columns, url)
    }

    throw error
  }
}

async function fileFromUrl(
  options: ReadCellsOverviewColumnsOptions,
): Promise<AsyncBuffer> {
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

// Decodes column chunks as they are, without building an object per row.
async function readHyparquetColumns(
  options: HyparquetReadColumnsOptions,
): Promise<Readonly<Record<string, ArrayLike<unknown>>>> {
  const metadata = await parquetMetadataAsync(options.file)
  const fileColumns = new Set(
    parquetSchema(metadata).children.map((child) => child.element.name),
  )
  const columns = options.columns.filter((column) => fileColumns.has(column))
  const rowCount = Math.min(Number(metadata.num_rows), options.rowEnd ?? Infinity)
  const chunks = new Map<string, ColumnChunk[]>(columns.map((column) => [column, []]))

  await parquetRead({
    file: options.file,
    metadata,
    columns,
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
    ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
    onChunk: ({ columnName, columnData, rowStart }) => {
      chunks.get(columnName)?.push({ rowStart, values: columnData })
    },
  })

  return Object.fromEntries(
    columns.map((column) => [
      column,
      joinColumnChunks(chunks.get(column) ?? [], rowCount),
    ]),
  )
}

interface ColumnChunk {
  readonly rowStart: number
  readonly values: ArrayLike<unknown>
}

// Chunks arrive in any order and hold whole pages, so rows from `rowCount` on
// are dropped.
function joinColumnChunks(
  chunks: readonly ColumnChunk[],
  rowCount: number,
): ArrayLike<unknown> {
  const [first] = chunks

  if (
    chunks.length === 1 &&
    first !== undefined &&
    first.rowStart === 0 &&
    first.values.length === rowCount
  ) {
    return first.values
  }

  const values = new Array<unknown>(rowCount)

  for (const { rowStart, values: chunkValues } of chunks) {
    const end = Math.min(chunkValues.length, rowCount - rowStart)

    for (let index = 0; index < end; index += 1) {
      values[rowStart + index] = chunkValues[index]
    }
  }

  return values
}

// Checks every value, as `parseCellOverviewRow` does for a row.
export function cellsOverviewColumnsFromValues(
  values: Readonly<Record<string, ArrayLike<unknown>>>,
  missingColumns: readonly string[] = [],
): CellsOverviewColumns {
  const length = Object.values(values).reduce(
    (longest, column) => Math.max(longest, column.length),
    0,
  )
  const segmentationMethods = segmentationMethodColumn(values.segmentation_method, length)

  return {
    length,
    cellIds: values.cell_id === undefined ? null : cellIdColumn(values.cell_id, length),
    x: requiredNumericColumn(values, 'x_centroid', length),
    y: requiredNumericColumn(values, 'y_centroid', length),
    transcriptCounts: requiredNumericColumn(values, 'transcript_counts', length),
    cellAreas: optionalNumericColumn(values, 'cell_area', length),
    nucleusCounts: optionalNumericColumn(values, 'nucleus_count', length),
    segmentationMethodIndices: segmentationMethods?.indices ?? null,
    segmentationMethods: segmentationMethods?.methods ?? [],
    missingColumns,
  }
}

export function cellsOverviewFromColumns(
  columns: CellsOverviewColumns,
): CellOverviewPoint[] {
  const { cellIds, cellAreas, nucleusCounts, segmentationMethodIndices } = columns
  const cells = new Array<CellOverviewPoint>(columns.length)

  // Properties are assigned rather than spread, as this runs once per cell on
  // the main thread.
  for (let index = 0; index < columns.length; index += 1) {
    const cell: { -readonly [Key in keyof CellOverviewPoint]: CellOverviewPoint[Key] } = {
      position: {
        x: micrometers(columns.x[index] ?? Number.NaN),
        y: micrometers(columns.y[index] ?? Number.NaN),
      },
      transcriptCount: columns.transcriptCounts[index] ?? Number.NaN,
    }
    const cellId = cellIds?.[index]
    const cellArea = cellAreas?.[index]
    const nucleusCount = nucleusCounts?.[index]
    const segmentationMethod =
      columns.segmentationMethods[segmentationMethodIndices?.[index] ?? -1]

    if (cellId !== undefined) {
      cell.cellId = cellId
    }

    if (cellArea !== undefined && !Number.isNaN(cellArea)) {
      cell.cellArea = cellArea
    }

    if (nucleusCount !== undefined && !Number.isNaN(nucleusCount)) {
      cell.nucleusCount = nucleusCount
    }

    if (segmentationMethod !== undefined) {
      cell.segmentationMethod = segmentationMethod
    }

    cells[index] = cell
  }

  return cells
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

function cellIdColumn(column: ArrayLike<unknown>, length: number): CellId[] {
  const cellIds = new Array<CellId>(length)

  for (let index = 0; index < length; index += 1) {
    const cellId = column[index]

    if (typeof cellId !== 'string') {
      throw new Error('Expected cells.parquet cell_id to be a string.')
    }

    cellIds[index] = asCellId(cellId)
  }

  return cellIds
}

function requiredNumericColumn(
  values: Readonly<Record<string, ArrayLike<unknown>>>,
  key: string,
  length: number,
): Float64Array {
  const column = values[key]
  const numbers = new Float64Array(length)

  for (let index = 0; index < length; index += 1) {
    const value = numericValue(column?.[index])

    if (value === null) {
      throw new Error(`Expected cells.parquet ${key} to be numeric.`)
    }

    numbers[index] = value
  }

  return numbers
}

function optionalNumericColumn(
  values: Readonly<Record<string, ArrayLike<unknown>>>,
  key: string,
  length: number,
): Float64Array | null {
  const column = values[key]

  if (column === undefined) {
    return null
  }

  const numbers = new Float64Array(length)

  for (let index = 0; index < length; index += 1) {
    const value = column[index]

    if (value === undefined || value === null) {
      numbers[index] = Number.NaN
      continue
    }

    const number = numericValue(value)

    if (number === null) {
      throw new Error(`Expected cells.parquet ${key} to be numeric.`)
    }

    numbers[index] = number
  }

  return numbers
}

function segmentationMethodColumn(
  column: ArrayLike<unknown> | undefined,
  length: number,
): { readonly indices: Int32Array; readonly methods: readonly string[] } | null {
  if (column === undefined) {
    return null
  }

  const indices = new Int32Array(length)
  const methods: string[] = []
  const indexByMethod = new Map<string, number>()

  for (let index = 0; index < length; index += 1) {
    const method = column[index]

    if (method === undefined || method === null) {
      indices[index] = -1
      continue
    }

    if (typeof method !== 'string') {
      throw new Error('Expected cells.parquet segmentation_method to be a string.')
    }

    let methodIndex = indexByMethod.get(method)

    if (methodIndex === undefined) {
      methodIndex = methods.length
      methods.push(method)
      indexByMethod.set(method, methodIndex)
    }

    indices[index] = methodIndex
  }

  return { indices, methods }
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return null
}

function readNumericValue(row: Record<string, unknown>, key: string): number {
  const value = numericValue(row[key])

  if (value === null) {
    throw new Error(`Expected cells.parquet ${key} to be numeric.`)
  }

  return value
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
