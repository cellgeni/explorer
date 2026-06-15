import { datasetFileUrl } from '../data/datasetFiles'
import { readMaybeGzipText } from '../data/readMaybeGzipText'
import { VisiumHdFilteredBarcodeBudgetExceededError } from './visiumHdStrategy'
import type { SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'

export interface VisiumHdSquareBarcode {
  readonly barcode: SpatialElementId
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly row: number
  readonly col: number
}

export interface ReadVisiumHdFilteredMatrixBarcodesOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly maxBarcodeCount?: number
}

const VISIUM_HD_SQUARE_BARCODE_PATTERN =
  /^(?:s|square)_(?<size>\d{3})um_(?<row>\d+)_(?<col>\d+)(?:-\d+)?$/u

export async function readVisiumHdFilteredMatrixBarcodes(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFilteredMatrixBarcodesOptions = {},
): Promise<readonly VisiumHdSquareBarcode[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const url = datasetFileUrl(
    baseUrl,
    `${bin.outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`,
  )
  const response =
    options.signal === undefined
      ? await fetcher(url)
      : await fetcher(url, { signal: options.signal })

  if (!response.ok) {
    throw new Error(`Unable to load Visium HD barcodes.tsv.gz: HTTP ${response.status}.`)
  }

  return parseVisiumHdFilteredMatrixBarcodes(await readMaybeGzipText(response), {
    binSizeMicrometers: bin.binSizeMicrometers,
    ...(options.maxBarcodeCount === undefined
      ? {}
      : { maxBarcodeCount: options.maxBarcodeCount }),
  })
}

export function parseVisiumHdFilteredMatrixBarcodes(
  text: string,
  options: {
    readonly binSizeMicrometers?: VisiumHdBinSizeMicrometers
    readonly maxBarcodeCount?: number
  } = {},
): readonly VisiumHdSquareBarcode[] {
  const normalizedMaxBarcodeCount = normalizeMaxBarcodeCount(options.maxBarcodeCount)
  const barcodes: VisiumHdSquareBarcode[] = []

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const barcode = (line.split('\t')[0] ?? '').trim()

    if (barcode.length === 0) {
      continue
    }

    const parsed = parseVisiumHdSquareBarcode(barcode)

    if (parsed === null) {
      throw new Error(
        `Unable to parse Visium HD square barcode on line ${lineIndex + 1}: ${barcode}`,
      )
    }

    if (
      options.binSizeMicrometers !== undefined &&
      parsed.binSizeMicrometers !== options.binSizeMicrometers
    ) {
      throw new Error(
        `Expected ${options.binSizeMicrometers} µm barcode on line ${
          lineIndex + 1
        }, received ${parsed.binSizeMicrometers} µm: ${barcode}`,
      )
    }

    barcodes.push(parsed)

    if (
      normalizedMaxBarcodeCount !== undefined &&
      barcodes.length > normalizedMaxBarcodeCount
    ) {
      throw new VisiumHdFilteredBarcodeBudgetExceededError(
        parsed.binSizeMicrometers,
        barcodes.length,
        normalizedMaxBarcodeCount,
      )
    }
  }

  return barcodes
}

export function parseVisiumHdSquareBarcode(
  barcode: string,
): VisiumHdSquareBarcode | null {
  const match = VISIUM_HD_SQUARE_BARCODE_PATTERN.exec(barcode)

  if (match?.groups === undefined) {
    return null
  }

  const binSizeMicrometers = Number(match.groups.size)
  const row = Number(match.groups.row)
  const col = Number(match.groups.col)

  if (
    !isVisiumHdBinSize(binSizeMicrometers) ||
    !isSafeGridIndex(row) ||
    !isSafeGridIndex(col)
  ) {
    return null
  }

  return {
    barcode,
    binSizeMicrometers,
    row,
    col,
  }
}

function isVisiumHdBinSize(value: number): value is VisiumHdBinSizeMicrometers {
  return value === 2 || value === 8 || value === 16
}

function isSafeGridIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function normalizeMaxBarcodeCount(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `Filtered barcode budget must be a non-negative finite number, received ${value}.`,
    )
  }

  return Math.floor(value)
}
