import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { datasetFileUrl } from '../data/datasetFiles'
import { isGeneFeature } from '../data/geneFeatures'
import { readMaybeGzipText } from '../data/readMaybeGzipText'
import { micrometers } from '../data/coords'
import {
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from '../data/persistentByteRangeCache'
import { fitGridBasis, gridCellCenter } from './spatialGrid'
import type { AsyncBuffer, Compressors } from 'hyparquet'
import type { DataPoint } from '../data/coords'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type {
  GridCellBatch,
  SpatialGrid,
  SpatialGridBasis,
  SpatialElementId,
} from './spatialDataset'
import type { VisiumHdSquareBarcode } from './visiumHdBarcodes'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'

export interface VisiumHdScalefactors {
  readonly micronsPerPixel: number
  readonly tissueHiresScale: number
  readonly tissueLowresScale: number
  readonly binSizeMicrometers?: number
  readonly spotDiameterFullres?: number
  readonly registrationTargetImageScale?: number
  readonly tissueHiresImageWidth?: number
  readonly tissueHiresImageHeight?: number
  readonly tissueLowresImageWidth?: number
  readonly tissueLowresImageHeight?: number
}

export interface VisiumHdBinnedOverview {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly scalefactors: VisiumHdScalefactors
  readonly grid: SpatialGrid
  readonly gridCells: GridCellBatch<SpatialElementId>
  readonly fullresRows: Float64Array
  readonly fullresCols: Float64Array
  readonly inTissue: Uint8Array
  readonly sourcePaths: {
    readonly tissuePositions: string
    readonly scalefactors: string
    readonly tissueHiresImage: string
    readonly tissueLowresImage: string
    readonly filteredMatrixH5: string
    readonly filteredMatrixBarcodes?: string
  }
}

export interface VisiumHdTissuePositions {
  readonly ids: readonly SpatialElementId[]
  readonly inTissue: Uint8Array
  readonly arrayRows: Int32Array
  readonly arrayCols: Int32Array
  readonly fullresRows: Float64Array
  readonly fullresCols: Float64Array
}

export interface ReadVisiumHdScalefactorsOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface ReadVisiumHdTissuePositionsOptions {
  readonly url?: string
  readonly file?: AsyncBuffer
  readonly limit?: number
  readonly fetcher?: typeof fetch
  readonly compressors?: Compressors
  readonly loadCompressors?: () => Promise<Compressors>
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly byteRangeCache?: PersistentByteRangeCache | null
  readonly signal?: AbortSignal
}

export interface ReadVisiumHdFeatureGenePanelOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface ReadVisiumHdBinnedOverviewOptions {
  readonly baseUrl: string
  readonly bin: VisiumHdBinDescriptor
  readonly includeOutOfTissue?: boolean
  readonly maxBasisFitSamples?: number
  readonly basis?: SpatialGridBasis | Promise<SpatialGridBasis>
  readonly fetcher?: typeof fetch
  readonly tissuePositionsReader?: (
    options: ReadVisiumHdTissuePositionsOptions,
  ) => Promise<VisiumHdTissuePositions>
  readonly scalefactorsReader?: (
    url: string,
    options: ReadVisiumHdScalefactorsOptions,
  ) => Promise<VisiumHdScalefactors>
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly loadCompressors?: () => Promise<Compressors>
  readonly byteRangeCache?: PersistentByteRangeCache | null
  readonly signal?: AbortSignal
}

export interface CreateVisiumHdBinnedOverviewOptions {
  readonly includeOutOfTissue?: boolean
  readonly maxBasisFitSamples?: number
  readonly basis?: SpatialGridBasis
}

export interface VisiumHdParquetReadObjectsOptions {
  readonly file: AsyncBuffer
  readonly columns: readonly string[]
  readonly rowFormat: 'object'
  readonly rowEnd?: number
  readonly compressors?: Compressors
}

export type VisiumHdParquetObjectReader = (
  options: VisiumHdParquetReadObjectsOptions,
) => Promise<readonly Record<string, unknown>[]>

export const VISIUM_HD_TISSUE_POSITION_COLUMNS = [
  'barcode',
  'in_tissue',
  'array_row',
  'array_col',
  'pxl_row_in_fullres',
  'pxl_col_in_fullres',
] as const

export class VisiumHdTissuePositionsDecodeError extends Error {
  override readonly name = 'ParquetDecodeError'
}

const DEFAULT_VISIUM_HD_MAX_BASIS_FIT_SAMPLES = 10_000

export async function readVisiumHdBinnedOverview(
  options: ReadVisiumHdBinnedOverviewOptions,
): Promise<VisiumHdBinnedOverview> {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const tissuePositionsUrl = datasetFileUrl(baseUrl, options.bin.tissuePositionsPath)
  const scalefactorsUrl = datasetFileUrl(baseUrl, options.bin.scalefactorsPath)
  const [positions, scalefactors, basis] = await Promise.all([
    (options.tissuePositionsReader ?? readVisiumHdTissuePositions)({
      url: tissuePositionsUrl,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.readObjects === undefined ? {} : { readObjects: options.readObjects }),
      ...(options.loadCompressors === undefined
        ? {}
        : { loadCompressors: options.loadCompressors }),
      ...(options.byteRangeCache === undefined
        ? {}
        : { byteRangeCache: options.byteRangeCache }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    (options.scalefactorsReader ?? readVisiumHdScalefactors)(scalefactorsUrl, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    options.basis,
  ])

  return createVisiumHdBinnedOverview(options.bin, positions, scalefactors, {
    ...(options.includeOutOfTissue === undefined
      ? {}
      : { includeOutOfTissue: options.includeOutOfTissue }),
    ...(options.maxBasisFitSamples === undefined
      ? {}
      : { maxBasisFitSamples: options.maxBasisFitSamples }),
    ...(basis === undefined ? {} : { basis }),
  })
}

export async function readVisiumHdScalefactors(
  url: string,
  options: ReadVisiumHdScalefactorsOptions = {},
): Promise<VisiumHdScalefactors> {
  const response = await (options.fetcher ?? fetch)(url, {
    method: 'GET',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(
      `Unable to read Visium HD scalefactors at ${url}: HTTP ${response.status}`,
    )
  }

  return parseVisiumHdScalefactors(await response.json())
}

export async function readVisiumHdFeatureGenePanel(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFeatureGenePanelOptions = {},
): Promise<readonly string[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const url = datasetFileUrl(
    normalizeBaseUrl(baseUrl),
    `${bin.outputPath}/filtered_feature_bc_matrix/features.tsv.gz`,
  )
  const response =
    options.signal === undefined
      ? await fetcher(url)
      : await fetcher(url, { signal: options.signal })

  if (!response.ok) {
    throw new Error(`Unable to load Visium HD features.tsv.gz: HTTP ${response.status}.`)
  }

  return parseVisiumHdFeatureRows(await readMaybeGzipText(response))
}

export function parseVisiumHdFeatureRows(text: string): readonly string[] {
  const genes = new Set<string>()

  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
      continue
    }

    const columns = trimmedLine.split('\t')
    const geneName = (columns[1] ?? columns[0] ?? '').trim()
    const featureType = columns[2]?.trim()

    if (geneName.length > 0 && isGeneFeature(geneName, featureType)) {
      genes.add(geneName)
    }
  }

  return [...genes].sort((a, b) => a.localeCompare(b))
}

export function parseVisiumHdScalefactors(value: unknown): VisiumHdScalefactors {
  if (value === null || typeof value !== 'object') {
    throw new Error('Expected Visium HD scalefactors JSON to be an object.')
  }

  const source = value as Record<string, unknown>

  return {
    micronsPerPixel: readJsonNumber(source, 'microns_per_pixel'),
    tissueHiresScale: readJsonNumber(source, 'tissue_hires_scalef'),
    tissueLowresScale: readJsonNumber(source, 'tissue_lowres_scalef'),
    ...readOptionalJsonNumber(source, 'bin_size_um', 'binSizeMicrometers'),
    ...readOptionalJsonNumber(source, 'spot_diameter_fullres', 'spotDiameterFullres'),
    ...readOptionalJsonNumber(
      source,
      'tissue_hires_image_width',
      'tissueHiresImageWidth',
    ),
    ...readOptionalJsonNumber(
      source,
      'tissue_hires_image_height',
      'tissueHiresImageHeight',
    ),
    ...readOptionalJsonNumber(
      source,
      'tissue_lowres_image_width',
      'tissueLowresImageWidth',
    ),
    ...readOptionalJsonNumber(
      source,
      'tissue_lowres_image_height',
      'tissueLowresImageHeight',
    ),
    ...readOptionalRegistrationTargetImageScale(source),
  }
}

export async function readVisiumHdTissuePositions(
  options: ReadVisiumHdTissuePositionsOptions,
): Promise<VisiumHdTissuePositions> {
  const file = options.file ?? (await visiumHdFileFromUrl(options))
  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const rows = await readVisiumHdPositionRowsWithContext({
    file,
    columns: VISIUM_HD_TISSUE_POSITION_COLUMNS,
    rowFormat: 'object',
    compressors,
    ...(options.limit === undefined ? {} : { rowEnd: options.limit }),
    readObjects: options.readObjects ?? readHyparquetObjects,
    url: options.url,
  })

  return parseVisiumHdTissuePositionRows(rows)
}

export function parseVisiumHdTissuePositionRows(
  rows: readonly Record<string, unknown>[],
): VisiumHdTissuePositions {
  const ids = new Array<SpatialElementId>(rows.length)
  const inTissue = new Uint8Array(rows.length)
  const arrayRows = new Int32Array(rows.length)
  const arrayCols = new Int32Array(rows.length)
  const fullresRows = new Float64Array(rows.length)
  const fullresCols = new Float64Array(rows.length)

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]

    if (row === undefined) {
      throw new Error(`Missing Visium HD tissue position row ${index}.`)
    }

    const barcode = row.barcode

    if (typeof barcode !== 'string') {
      throw new Error('Expected tissue_positions.parquet barcode to be a string.')
    }

    ids[index] = barcode
    inTissue[index] = readInTissue(row)
    arrayRows[index] = readIntegerColumn(row, 'array_row')
    arrayCols[index] = readIntegerColumn(row, 'array_col')
    fullresRows[index] = readNumericColumn(row, 'pxl_row_in_fullres')
    fullresCols[index] = readNumericColumn(row, 'pxl_col_in_fullres')
  }

  return {
    ids,
    inTissue,
    arrayRows,
    arrayCols,
    fullresRows,
    fullresCols,
  }
}

export function createVisiumHdBinnedOverview(
  bin: VisiumHdBinDescriptor,
  positions: VisiumHdTissuePositions,
  scalefactors: VisiumHdScalefactors,
  options: CreateVisiumHdBinnedOverviewOptions = {},
): VisiumHdBinnedOverview {
  const retainedCount = countRetainedPositions(positions, options)

  if (retainedCount === 0) {
    throw new Error(
      'No Visium HD tissue positions were retained for the binned overview.',
    )
  }

  const ids = new Array<SpatialElementId>(retainedCount)
  const rows = new Int32Array(retainedCount)
  const cols = new Int32Array(retainedCount)
  const fullresRows = new Float64Array(retainedCount)
  const fullresCols = new Float64Array(retainedCount)
  const inTissue = new Uint8Array(retainedCount)
  const basisSamples: {
    readonly row: number
    readonly col: number
    readonly point: DataPoint
  }[] = []
  const sampleStride =
    options.basis === undefined
      ? basisSampleStride(retainedCount, options.maxBasisFitSamples)
      : 1
  let targetIndex = 0
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  for (let sourceIndex = 0; sourceIndex < positions.ids.length; sourceIndex += 1) {
    if (!shouldRetainPosition(positions, sourceIndex, options)) {
      continue
    }

    const arrayRow = positions.arrayRows[sourceIndex] ?? 0
    const arrayCol = positions.arrayCols[sourceIndex] ?? 0
    const fullresRow = positions.fullresRows[sourceIndex] ?? 0
    const fullresCol = positions.fullresCols[sourceIndex] ?? 0
    const point = fullresPixelCenterToDataPoint(fullresRow, fullresCol, scalefactors)

    ids[targetIndex] = positions.ids[sourceIndex] ?? ''
    rows[targetIndex] = arrayRow
    cols[targetIndex] = arrayCol
    fullresRows[targetIndex] = fullresRow
    fullresCols[targetIndex] = fullresCol
    inTissue[targetIndex] = positions.inTissue[sourceIndex] ?? 0

    if (
      options.basis === undefined &&
      (targetIndex % sampleStride === 0 || basisSamples.length < 3)
    ) {
      basisSamples.push({ row: arrayRow, col: arrayCol, point })
    }

    minRow = Math.min(minRow, arrayRow)
    maxRow = Math.max(maxRow, arrayRow)
    minCol = Math.min(minCol, arrayCol)
    maxCol = Math.max(maxCol, arrayCol)
    targetIndex += 1
  }

  const grid: SpatialGrid = {
    id: visiumHdGridId(bin.binSizeMicrometers),
    binSizeMicrometers: micrometers(bin.binSizeMicrometers),
    basis: options.basis ?? fitGridBasis(basisSamples),
    bounds: {
      minRow,
      maxRow,
      minCol,
      maxCol,
    },
  }

  return {
    binSizeMicrometers: bin.binSizeMicrometers,
    scalefactors,
    grid,
    gridCells: {
      kind: 'grid-cells',
      gridId: grid.id,
      ids,
      rows,
      cols,
    },
    fullresRows,
    fullresCols,
    inTissue,
    sourcePaths: {
      tissuePositions: bin.tissuePositionsPath,
      scalefactors: bin.scalefactorsPath,
      tissueHiresImage: `${bin.outputPath}/spatial/tissue_hires_image.png`,
      tissueLowresImage: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
      filteredMatrixH5: bin.filteredMatrixH5Path,
      filteredMatrixBarcodes: `${bin.outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`,
    },
  }
}

export function createVisiumHdBinnedOverviewFromSquareBarcodes(
  bin: VisiumHdBinDescriptor,
  barcodes: readonly VisiumHdSquareBarcode[],
  scalefactors: VisiumHdScalefactors,
  basis: SpatialGridBasis,
): VisiumHdBinnedOverview {
  if (barcodes.length === 0) {
    throw new Error(
      'No Visium HD filtered matrix barcodes were available for the binned overview.',
    )
  }

  const ids = new Array<SpatialElementId>(barcodes.length)
  const rows = new Int32Array(barcodes.length)
  const cols = new Int32Array(barcodes.length)
  const fullresRows = new Float64Array(barcodes.length)
  const fullresCols = new Float64Array(barcodes.length)
  const inTissue = new Uint8Array(barcodes.length)
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  for (let index = 0; index < barcodes.length; index += 1) {
    const barcode = barcodes[index]

    if (barcode === undefined) {
      throw new Error(`Missing Visium HD barcode row ${index}.`)
    }

    if (barcode.binSizeMicrometers !== bin.binSizeMicrometers) {
      throw new Error(
        `Expected ${bin.binSizeMicrometers} µm barcode, received ${barcode.binSizeMicrometers} µm: ${barcode.barcode}`,
      )
    }

    const center = gridCellCenter(basis, barcode.row, barcode.col)

    ids[index] = barcode.barcode
    rows[index] = barcode.row
    cols[index] = barcode.col
    fullresRows[index] = dataPointToFullresRow(center, scalefactors)
    fullresCols[index] = dataPointToFullresCol(center, scalefactors)
    inTissue[index] = 1
    minRow = Math.min(minRow, barcode.row)
    maxRow = Math.max(maxRow, barcode.row)
    minCol = Math.min(minCol, barcode.col)
    maxCol = Math.max(maxCol, barcode.col)
  }

  const grid: SpatialGrid = {
    id: visiumHdGridId(bin.binSizeMicrometers),
    binSizeMicrometers: micrometers(bin.binSizeMicrometers),
    basis,
    bounds: {
      minRow,
      maxRow,
      minCol,
      maxCol,
    },
  }

  return {
    binSizeMicrometers: bin.binSizeMicrometers,
    scalefactors,
    grid,
    gridCells: {
      kind: 'grid-cells',
      gridId: grid.id,
      ids,
      rows,
      cols,
    },
    fullresRows,
    fullresCols,
    inTissue,
    sourcePaths: {
      tissuePositions: bin.tissuePositionsPath,
      scalefactors: bin.scalefactorsPath,
      tissueHiresImage: `${bin.outputPath}/spatial/tissue_hires_image.png`,
      tissueLowresImage: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
      filteredMatrixH5: bin.filteredMatrixH5Path,
      filteredMatrixBarcodes: `${bin.outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`,
    },
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function visiumHdGridId(binSizeMicrometers: VisiumHdBinSizeMicrometers): string {
  return `visium-hd-square-${String(binSizeMicrometers).padStart(3, '0')}um`
}

function fullresPixelCenterToDataPoint(
  fullresRow: number,
  fullresCol: number,
  scalefactors: VisiumHdScalefactors,
): DataPoint {
  return {
    x: micrometers(fullresCol * scalefactors.micronsPerPixel),
    y: micrometers(fullresRow * scalefactors.micronsPerPixel),
  }
}

function dataPointToFullresRow(
  point: DataPoint,
  scalefactors: VisiumHdScalefactors,
): number {
  return point.y / scalefactors.micronsPerPixel
}

function dataPointToFullresCol(
  point: DataPoint,
  scalefactors: VisiumHdScalefactors,
): number {
  return point.x / scalefactors.micronsPerPixel
}

function countRetainedPositions(
  positions: VisiumHdTissuePositions,
  options: CreateVisiumHdBinnedOverviewOptions,
): number {
  let count = 0

  for (let index = 0; index < positions.ids.length; index += 1) {
    if (shouldRetainPosition(positions, index, options)) {
      count += 1
    }
  }

  return count
}

function shouldRetainPosition(
  positions: VisiumHdTissuePositions,
  index: number,
  options: CreateVisiumHdBinnedOverviewOptions,
): boolean {
  return options.includeOutOfTissue === true || positions.inTissue[index] === 1
}

function basisSampleStride(
  retainedCount: number,
  maxBasisFitSamples = DEFAULT_VISIUM_HD_MAX_BASIS_FIT_SAMPLES,
): number {
  if (!Number.isFinite(maxBasisFitSamples) || maxBasisFitSamples < 3) {
    throw new RangeError('Visium HD basis fitting needs at least three samples.')
  }

  return Math.max(1, Math.ceil(retainedCount / maxBasisFitSamples))
}

async function visiumHdFileFromUrl(
  options: ReadVisiumHdTissuePositionsOptions,
): Promise<AsyncBuffer> {
  if (options.url === undefined) {
    throw new Error('readVisiumHdTissuePositions requires either url or file.')
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
  options: VisiumHdParquetReadObjectsOptions,
): Promise<readonly Record<string, unknown>[]> {
  return (await parquetReadObjects({
    file: options.file,
    columns: [...options.columns],
    rowFormat: options.rowFormat,
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
    ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
  })) as readonly Record<string, unknown>[]
}

async function readVisiumHdPositionRowsWithContext(
  options: VisiumHdParquetReadObjectsOptions & {
    readonly readObjects: VisiumHdParquetObjectReader
    readonly url: string | undefined
  },
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await options.readObjects({
      file: options.file,
      columns: options.columns,
      rowFormat: options.rowFormat,
      ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
      ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
    })
  } catch (error) {
    if (isLowLevelParquetReadFailure(error)) {
      throw createTissuePositionsDecodeError(error, options.columns, options.url)
    }

    throw error
  }
}

async function loadDefaultCompressors(): Promise<Compressors> {
  const { compressors } = await import('hyparquet-compressors')
  return compressors
}

function readJsonNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  throw new Error(`Expected Visium HD scalefactors ${key} to be a finite number.`)
}

function readOptionalJsonNumber<
  OutputKey extends keyof Pick<
    VisiumHdScalefactors,
    | 'binSizeMicrometers'
    | 'spotDiameterFullres'
    | 'registrationTargetImageScale'
    | 'tissueHiresImageWidth'
    | 'tissueHiresImageHeight'
    | 'tissueLowresImageWidth'
    | 'tissueLowresImageHeight'
  >,
>(
  source: Record<string, unknown>,
  jsonKey: string,
  outputKey: OutputKey,
): Pick<VisiumHdScalefactors, OutputKey> | Record<string, never> {
  const value = source[jsonKey]

  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return { [outputKey]: value } as Pick<VisiumHdScalefactors, OutputKey>
  }

  throw new Error(`Expected Visium HD scalefactors ${jsonKey} to be a finite number.`)
}

function readOptionalRegistrationTargetImageScale(
  source: Record<string, unknown>,
): Pick<VisiumHdScalefactors, 'registrationTargetImageScale'> | Record<string, never> {
  if (source.regist_target_img_scalef !== undefined) {
    return readOptionalJsonNumber(
      source,
      'regist_target_img_scalef',
      'registrationTargetImageScale',
    )
  }

  return readOptionalJsonNumber(
    source,
    'registration_target_image_scale',
    'registrationTargetImageScale',
  )
}

function readInTissue(row: Record<string, unknown>): 0 | 1 {
  const value = row.in_tissue

  if (value === true || value === 1 || value === 1n) {
    return 1
  }

  if (value === false || value === 0 || value === 0n) {
    return 0
  }

  throw new Error('Expected tissue_positions.parquet in_tissue to be 0 or 1.')
}

function readIntegerColumn(row: Record<string, unknown>, key: string): number {
  const value = readNumericColumn(row, key)

  if (!Number.isInteger(value)) {
    throw new Error(`Expected tissue_positions.parquet ${key} to be an integer.`)
  }

  return value
}

function readNumericColumn(row: Record<string, unknown>, key: string): number {
  const value = row[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  throw new Error(`Expected tissue_positions.parquet ${key} to be numeric.`)
}

function isLowLevelParquetReadFailure(error: unknown): boolean {
  const message = readUnknownErrorMessage(error).toLowerCase()

  return (
    message.includes('offset is outside the bounds of the dataview') ||
    message.includes('invalid typed array length')
  )
}

function createTissuePositionsDecodeError(
  cause: unknown,
  columns: readonly string[],
  url: string | undefined,
): Error {
  const location =
    url === undefined
      ? 'the provided tissue_positions.parquet file'
      : `tissue_positions.parquet at ${url}`
  return new VisiumHdTissuePositionsDecodeError(
    `Unable to decode tissue_positions.parquet while reading columns (${columns.join(', ')}). The file was reachable, but the browser Parquet reader failed on ${location}: ${readUnknownErrorMessage(cause)}.`,
  )
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return String(error)
}
