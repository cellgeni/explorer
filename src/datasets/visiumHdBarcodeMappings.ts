import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { coalescingAsyncBuffer } from '../data/coalescingAsyncBuffer'
import { datasetFileUrlFor } from '../data/datasetFiles'
import {
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from '../data/persistentByteRangeCache'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import { waitForSharedLoad } from '../utils/sharedLoad'
import { parseVisiumHdSquareBarcode } from './visiumHdBarcodes'
import { normalizeVisiumHdBarcodeMappingRowBudget } from './visiumHdStrategy'
import type { AsyncBuffer, Compressors, FileMetaData } from 'hyparquet'
import type { CoalescingAsyncBufferOptions } from '../data/coalescingAsyncBuffer'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type { SharedLoad } from '../utils/sharedLoad'
import type { SpatialElementId } from './spatialDataset'
import type { VisiumHdBinSizeMicrometers } from './visiumHdDataset'

export const VISIUM_HD_BARCODE_MAPPING_COLUMNS = [
  'square_002um',
  'square_008um',
  'square_016um',
  'cell_id',
  'in_nucleus',
  'in_cell',
] as const

export { normalizeVisiumHdBarcodeMappingRowBudget } from './visiumHdStrategy'

// A bin read decodes at most this many rows per hyparquet read, and runs at
// most VISIUM_HD_BARCODE_MAPPING_READ_CONCURRENCY reads at once.
export const VISIUM_HD_BARCODE_MAPPING_ROWS_PER_READ = 262_144
export const VISIUM_HD_BARCODE_MAPPING_READ_CONCURRENCY = 2

export interface VisiumHdBarcodeMapping {
  readonly square002um: SpatialElementId
  readonly square008um: SpatialElementId
  readonly square016um: SpatialElementId
  readonly cellId: SpatialElementId | null
  readonly inNucleus: boolean
  readonly inCell: boolean
}

export interface VisiumHdBarcodeMappingCellAssignment {
  readonly binId: SpatialElementId
  readonly square002um: SpatialElementId
  readonly cellId: SpatialElementId | null
  readonly inNucleus: boolean
  readonly inCell: boolean
}

export interface VisiumHdBarcodeMappingBinSelection {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly binIds: readonly SpatialElementId[]
}

// The file's size and parsed footer, read once and shared by later bin reads.
export interface VisiumHdBarcodeMappingsSource {
  readonly byteLength: number
  readonly metadata: FileMetaData
}

export type VisiumHdBarcodeMappingsSourceCache = Map<
  string,
  SharedLoad<VisiumHdBarcodeMappingsSource>
>

export interface ReadVisiumHdBarcodeMappingsOptions {
  // Rows the read may decode. Without `bins` that is the whole file.
  readonly maxRows?: number
  // Read only these bins' rows. Row groups whose barcode statistics rule out
  // every bin are skipped; Space Ranger sorts the file by 2 µm barcode, so one
  // 16 µm bin needs about 3 of the reference's 1,123 row groups.
  readonly bins?: VisiumHdBarcodeMappingBinSelection
  // Holds the file's size and footer per URL across bin reads.
  readonly sourceCache?: VisiumHdBarcodeMappingsSourceCache
  readonly file?: AsyncBuffer
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly compressors?: Compressors
  readonly loadCompressors?: () => Promise<Compressors>
  readonly readObjects?: VisiumHdBarcodeMappingsObjectReader
  readonly byteRangeCache?: PersistentByteRangeCache | null
  // How the URL reads are merged and limited; see coalescingAsyncBuffer.
  readonly rangeRequests?: CoalescingAsyncBufferOptions
}

export interface VisiumHdBarcodeMappingsReadObjectsOptions {
  readonly file: AsyncBuffer
  readonly metadata?: FileMetaData
  readonly columns: readonly string[]
  readonly rowFormat: 'object'
  readonly rowStart?: number
  readonly rowEnd?: number
  readonly compressors?: Compressors
}

export interface VisiumHdBarcodeMappingRowRange {
  readonly rowStart: number
  readonly rowEnd: number
}

export type VisiumHdBarcodeMappingsObjectReader = (
  options: VisiumHdBarcodeMappingsReadObjectsOptions,
) => Promise<readonly Record<string, unknown>[]>

export class VisiumHdBarcodeMappingsBudgetExceededError extends Error {
  override readonly name = 'VisiumHdBarcodeMappingsBudgetExceededError'

  constructor(
    readonly observedRows: number,
    readonly maxRows: number,
  ) {
    super(
      `Visium HD barcode_mappings.parquet exceeded the interactive budget of ${maxRows.toLocaleString()} rows.`,
    )
  }
}

export async function readVisiumHdBarcodeMappings(
  baseUrl: string,
  options: ReadVisiumHdBarcodeMappingsOptions,
): Promise<readonly VisiumHdBarcodeMapping[]> {
  const maxRows =
    options.maxRows === undefined
      ? undefined
      : normalizeVisiumHdBarcodeMappingRowBudget(options.maxRows)
  const url = datasetFileUrlFor(baseUrl, 'barcodeMappings')

  if (options.bins !== undefined) {
    return readVisiumHdBarcodeMappingsForBins(url, options.bins, maxRows, options)
  }

  const file = options.file ?? (await barcodeMappingsFileFromUrl(url, options))
  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const rows = await (options.readObjects ?? readHyparquetObjects)({
    file,
    columns: VISIUM_HD_BARCODE_MAPPING_COLUMNS,
    rowFormat: 'object',
    ...(maxRows === undefined ? {} : { rowEnd: maxRows + 1 }),
    compressors,
  })

  return parseVisiumHdBarcodeMappingRows(rows, maxRows === undefined ? {} : { maxRows })
}

async function readVisiumHdBarcodeMappingsForBins(
  url: string,
  bins: VisiumHdBarcodeMappingBinSelection,
  maxRows: number | undefined,
  options: ReadVisiumHdBarcodeMappingsOptions,
): Promise<readonly VisiumHdBarcodeMapping[]> {
  if (bins.binIds.length === 0) {
    return []
  }

  const { file, metadata } = await barcodeMappingsFileWithMetadata(url, options)
  const column = visiumHdBarcodeMappingBinColumn(bins.binSizeMicrometers)
  const ranges = visiumHdBarcodeMappingRowRanges(metadata, column, bins.binIds)
  const rowCount = ranges.reduce(
    (total, range) => total + range.rowEnd - range.rowStart,
    0,
  )

  if (maxRows !== undefined && rowCount > maxRows) {
    throw new VisiumHdBarcodeMappingsBudgetExceededError(rowCount, maxRows)
  }

  if (ranges.length === 0) {
    return []
  }

  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const readObjects = options.readObjects ?? readHyparquetObjects
  const binIds = new Set<unknown>(bins.binIds)
  const batches = await mapWithConcurrency(
    ranges,
    VISIUM_HD_BARCODE_MAPPING_READ_CONCURRENCY,
    async (range) => {
      const rows = await readObjects({
        file,
        metadata,
        columns: VISIUM_HD_BARCODE_MAPPING_COLUMNS,
        rowFormat: 'object',
        rowStart: range.rowStart,
        rowEnd: range.rowEnd,
        compressors,
      })

      return rows.filter((row) => binIds.has(row[column]))
    },
  )

  return parseVisiumHdBarcodeMappingRows(batches.flat())
}

// Row ranges holding the row groups that may contain one of `binIds` in
// `column`: those without string min/max statistics, or whose range holds a
// bin. Neighbouring row groups share a range of up to `maxRowsPerRange` rows.
export function visiumHdBarcodeMappingRowRanges(
  metadata: Pick<FileMetaData, 'row_groups'>,
  column: string,
  binIds: readonly string[],
  maxRowsPerRange = VISIUM_HD_BARCODE_MAPPING_ROWS_PER_READ,
): readonly VisiumHdBarcodeMappingRowRange[] {
  const sortedBinIds = [...new Set(binIds)].sort(compareStrings)
  const ranges: { rowStart: number; rowEnd: number }[] = []
  let groupStart = 0

  for (const rowGroup of metadata.row_groups) {
    const groupEnd = groupStart + Number(rowGroup.num_rows)
    const statistics = rowGroup.columns.find(
      (chunk) => chunk.meta_data?.path_in_schema[0] === column,
    )?.meta_data?.statistics
    const min = statistics?.min_value ?? statistics?.min
    const max = statistics?.max_value ?? statistics?.max
    const mayHoldBin =
      typeof min !== 'string' ||
      typeof max !== 'string' ||
      sortedRangeHasValue(sortedBinIds, min, max)

    if (groupEnd > groupStart && mayHoldBin) {
      const last = ranges.at(-1)

      if (
        last !== undefined &&
        last.rowEnd === groupStart &&
        groupEnd - last.rowStart <= maxRowsPerRange
      ) {
        last.rowEnd = groupEnd
      } else {
        ranges.push({ rowStart: groupStart, rowEnd: groupEnd })
      }
    }

    groupStart = groupEnd
  }

  return ranges
}

function visiumHdBarcodeMappingBinColumn(
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
): 'square_002um' | 'square_008um' | 'square_016um' {
  switch (binSizeMicrometers) {
    case 2:
      return 'square_002um'
    case 8:
      return 'square_008um'
    case 16:
      return 'square_016um'
  }
}

// Whether any of the sorted `values` lies in [min, max].
function sortedRangeHasValue(
  values: readonly string[],
  min: string,
  max: string,
): boolean {
  let low = 0
  let high = values.length

  while (low < high) {
    const middle = (low + high) >>> 1

    if ((values[middle] as string) < min) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low < values.length && (values[low] as string) <= max
}

// Parquet orders string statistics by bytes, and for these ASCII barcodes
// that is the order of `<` on JS strings.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function parseVisiumHdBarcodeMappingRows(
  rows: readonly Record<string, unknown>[],
  options: { readonly maxRows?: number } = {},
): readonly VisiumHdBarcodeMapping[] {
  const maxRows =
    options.maxRows === undefined
      ? undefined
      : normalizeVisiumHdBarcodeMappingRowBudget(options.maxRows)

  if (maxRows !== undefined && rows.length > maxRows) {
    throw new VisiumHdBarcodeMappingsBudgetExceededError(rows.length, maxRows)
  }

  return rows.map((row, index) => parseVisiumHdBarcodeMappingRow(row, index))
}

export function selectVisiumHdBarcodeMappingAssignments(
  mappings: readonly VisiumHdBarcodeMapping[],
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
  binIds?: readonly SpatialElementId[],
): readonly VisiumHdBarcodeMappingCellAssignment[] {
  const selectedBinIds = binIds === undefined ? null : new Set(binIds)
  const assignments: VisiumHdBarcodeMappingCellAssignment[] = []

  for (const mapping of mappings) {
    const binId = visiumHdBarcodeMappingBinId(mapping, binSizeMicrometers)

    if (selectedBinIds !== null && !selectedBinIds.has(binId)) {
      continue
    }

    assignments.push({
      binId,
      square002um: mapping.square002um,
      cellId: mapping.cellId,
      inNucleus: mapping.inNucleus,
      inCell: mapping.inCell,
    })
  }

  return assignments
}

export function visiumHdBarcodeMappingBinId(
  mapping: VisiumHdBarcodeMapping,
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
): SpatialElementId {
  switch (binSizeMicrometers) {
    case 2:
      return mapping.square002um
    case 8:
      return mapping.square008um
    case 16:
      return mapping.square016um
  }
}

export function parseVisiumHdBarcodeMappingRow(
  row: Record<string, unknown>,
  rowIndex = 0,
): VisiumHdBarcodeMapping {
  return {
    square002um: readSquareBarcode(row, 'square_002um', 2, rowIndex),
    square008um: readSquareBarcode(row, 'square_008um', 8, rowIndex),
    square016um: readSquareBarcode(row, 'square_016um', 16, rowIndex),
    cellId: readOptionalCellId(row, rowIndex),
    inNucleus: readBooleanFlag(row, 'in_nucleus', rowIndex),
    inCell: readBooleanFlag(row, 'in_cell', rowIndex),
  }
}

type BarcodeMappingsFileOptions = Pick<
  ReadVisiumHdBarcodeMappingsOptions,
  'byteRangeCache' | 'fetcher' | 'rangeRequests' | 'signal'
>

async function barcodeMappingsFileWithMetadata(
  url: string,
  options: ReadVisiumHdBarcodeMappingsOptions,
): Promise<{ readonly file: AsyncBuffer; readonly metadata: FileMetaData }> {
  if (options.file !== undefined) {
    return { file: options.file, metadata: await parquetMetadataAsync(options.file) }
  }

  const source =
    options.sourceCache === undefined
      ? await readBarcodeMappingsSource(url, options)
      : await waitForSharedLoad(
          options.sourceCache,
          url,
          (signal) => readBarcodeMappingsSource(url, { ...options, signal }),
          options.signal,
        )
  const file = await barcodeMappingsFileFromUrl(url, options, source.byteLength)

  return { file, metadata: source.metadata }
}

async function readBarcodeMappingsSource(
  url: string,
  options: BarcodeMappingsFileOptions,
): Promise<VisiumHdBarcodeMappingsSource> {
  const file = await barcodeMappingsFileFromUrl(url, options)

  return { byteLength: file.byteLength, metadata: await parquetMetadataAsync(file) }
}

// Reads go through coalescingAsyncBuffer, which merges hyparquet's per-column
// chunk reads and limits how many are in flight. The footer cache sits on
// top so hyparquet's footer reads keep their exact ranges.
async function barcodeMappingsFileFromUrl(
  url: string,
  options: BarcodeMappingsFileOptions,
  byteLength?: number,
): Promise<AsyncBuffer> {
  const file = await asyncBufferFromUrl({
    url,
    ...(byteLength === undefined ? {} : { byteLength }),
    ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
  const byteRangeCache =
    options.byteRangeCache === undefined
      ? defaultPersistentByteRangeCache()
      : options.byteRangeCache

  return cacheFooterByteRanges(coalescingAsyncBuffer(file, options.rangeRequests), {
    cache: byteRangeCache,
    url,
  })
}

async function readHyparquetObjects(
  options: VisiumHdBarcodeMappingsReadObjectsOptions,
): Promise<readonly Record<string, unknown>[]> {
  return (await parquetReadObjects({
    file: options.file,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    columns: [...options.columns],
    rowFormat: options.rowFormat,
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
    ...(options.rowStart === undefined ? {} : { rowStart: options.rowStart }),
    ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
  })) as readonly Record<string, unknown>[]
}

async function loadDefaultCompressors(): Promise<Compressors> {
  const { compressors } = await import('hyparquet-compressors')
  return compressors
}

function readSquareBarcode(
  row: Record<string, unknown>,
  key: 'square_002um' | 'square_008um' | 'square_016um',
  expectedBinSize: VisiumHdBinSizeMicrometers,
  rowIndex: number,
): SpatialElementId {
  const value = row[key]

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Expected barcode_mappings.parquet ${key} to be a non-empty string on row ${rowIndex}.`,
    )
  }

  const parsed = parseVisiumHdSquareBarcode(value)

  if (parsed === null) {
    throw new Error(
      `Unable to parse barcode_mappings.parquet ${key} on row ${rowIndex}: ${value}`,
    )
  }

  if (parsed.binSizeMicrometers !== expectedBinSize) {
    throw new Error(
      `Expected barcode_mappings.parquet ${key} to contain ${expectedBinSize} µm barcodes on row ${rowIndex}, received ${parsed.binSizeMicrometers} µm: ${value}`,
    )
  }

  return parsed.barcode
}

function readOptionalCellId(
  row: Record<string, unknown>,
  rowIndex: number,
): SpatialElementId | null {
  const value = row.cell_id

  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error(
      `Expected barcode_mappings.parquet cell_id to be a string or null on row ${rowIndex}.`,
    )
  }

  return value
}

function readBooleanFlag(
  row: Record<string, unknown>,
  key: 'in_nucleus' | 'in_cell',
  rowIndex: number,
): boolean {
  const value = row[key]

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    if (value === 0 || value === 0n) {
      return false
    }

    if (value === 1 || value === 1n) {
      return true
    }
  }

  throw new Error(
    `Expected barcode_mappings.parquet ${key} to be a boolean or 0/1 flag on row ${rowIndex}.`,
  )
}
