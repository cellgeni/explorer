import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { datasetFileUrl } from '../data/datasetFiles'
import {
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from '../data/persistentByteRangeCache'
import { parseVisiumHdSquareBarcode } from './visiumHdBarcodes'
import type { AsyncBuffer, Compressors } from 'hyparquet'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type { SpatialElementId } from './spatialDataset'
import type { VisiumHdBinSizeMicrometers } from './visiumHdDataset'

export const VISIUM_HD_BARCODE_MAPPINGS_PATH = 'barcode_mappings.parquet'
export const VISIUM_HD_BARCODE_MAPPING_COLUMNS = [
  'square_002um',
  'square_008um',
  'square_016um',
  'cell_id',
  'in_nucleus',
  'in_cell',
] as const

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

export interface ReadVisiumHdBarcodeMappingsOptions {
  readonly maxRows?: number
  readonly file?: AsyncBuffer
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly compressors?: Compressors
  readonly loadCompressors?: () => Promise<Compressors>
  readonly readObjects?: VisiumHdBarcodeMappingsObjectReader
  readonly byteRangeCache?: PersistentByteRangeCache | null
}

export interface VisiumHdBarcodeMappingsReadObjectsOptions {
  readonly file: AsyncBuffer
  readonly columns: readonly string[]
  readonly rowFormat: 'object'
  readonly rowEnd?: number
  readonly compressors?: Compressors
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
  const url = datasetFileUrl(baseUrl, VISIUM_HD_BARCODE_MAPPINGS_PATH)
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

async function barcodeMappingsFileFromUrl(
  url: string,
  options: Pick<
    ReadVisiumHdBarcodeMappingsOptions,
    'byteRangeCache' | 'fetcher' | 'signal'
  >,
): Promise<AsyncBuffer> {
  const file = await asyncBufferFromUrl({
    url,
    ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
  const byteRangeCache =
    options.byteRangeCache === undefined
      ? defaultPersistentByteRangeCache()
      : options.byteRangeCache

  return cacheFooterByteRanges(file, {
    cache: byteRangeCache,
    url,
  }) as AsyncBuffer
}

async function readHyparquetObjects(
  options: VisiumHdBarcodeMappingsReadObjectsOptions,
): Promise<readonly Record<string, unknown>[]> {
  return (await parquetReadObjects({
    file: options.file,
    columns: [...options.columns],
    rowFormat: options.rowFormat,
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
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

export function normalizeVisiumHdBarcodeMappingRowBudget(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(
      `Barcode mapping row budget must be a positive finite number, received ${value}.`,
    )
  }

  return Math.floor(value)
}
