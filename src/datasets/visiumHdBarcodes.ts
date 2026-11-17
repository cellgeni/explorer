import { datasetFileUrl } from '../data/datasetFiles'
import { forEachMaybeGzipLine } from '../data/readMaybeGzipText'
import {
  VisiumHdFilteredBarcodeBudgetExceededError,
  visiumHdFilteredBarcodesPath,
} from './visiumHdStrategy'
import type { SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'

export interface VisiumHdSquareBarcode {
  readonly barcode: SpatialElementId
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly row: number
  readonly col: number
}

// A tier's square barcodes as columns: 3.4 million on the reference
// dataset's 2 µm tier.
export interface VisiumHdSquareBarcodeColumns {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly ids: readonly SpatialElementId[]
  readonly rows: Int32Array
  readonly cols: Int32Array
}

export interface ReadVisiumHdFilteredMatrixBarcodesOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly maxBarcodeCount?: number
}

const VISIUM_HD_SQUARE_BARCODE_PATTERN =
  /^(?:s|square)_(?<size>\d{3})um_(?<row>\d+)_(?<col>\d+)(?:-\d+)?$/u

// Read as it downloads, one line at a time, into columns: the reference 2 µm
// file is 20 MB gzipped and 75 MB of text. A budget overrun stops the
// download.
export async function readVisiumHdFilteredMatrixBarcodes(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFilteredMatrixBarcodesOptions = {},
): Promise<VisiumHdSquareBarcodeColumns> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const url = datasetFileUrl(baseUrl, visiumHdFilteredBarcodesPath(bin.outputPath))
  const response =
    options.signal === undefined
      ? await fetcher(url)
      : await fetcher(url, { signal: options.signal })

  if (!response.ok) {
    throw new Error(`Unable to load Visium HD barcodes.tsv.gz: HTTP ${response.status}.`)
  }

  const columns = new SquareBarcodeColumnsBuilder(
    bin.binSizeMicrometers,
    options.maxBarcodeCount,
  )
  await forEachMaybeGzipLine(response, (line, lineIndex) => {
    columns.add(line, lineIndex)
  })
  return columns.finish()
}

export function parseVisiumHdFilteredMatrixBarcodes(
  text: string,
  options: {
    readonly binSizeMicrometers?: VisiumHdBinSizeMicrometers
    readonly maxBarcodeCount?: number
  } = {},
): VisiumHdSquareBarcodeColumns {
  const columns = new SquareBarcodeColumnsBuilder(
    options.binSizeMicrometers,
    options.maxBarcodeCount,
  )

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    columns.add(line, lineIndex)
  }

  return columns.finish()
}

// Barcodes of one bin size, the first line's unless one is given, added a
// line at a time into growing typed arrays.
class SquareBarcodeColumnsBuilder {
  private readonly ids: SpatialElementId[] = []
  private rows: Int32Array<ArrayBuffer> = new Int32Array(1024)
  private cols: Int32Array<ArrayBuffer> = new Int32Array(1024)
  private binSizeMicrometers: VisiumHdBinSizeMicrometers | undefined
  private readonly maxBarcodeCount: number | undefined

  constructor(
    binSizeMicrometers: VisiumHdBinSizeMicrometers | undefined,
    maxBarcodeCount: number | undefined,
  ) {
    this.binSizeMicrometers = binSizeMicrometers
    this.maxBarcodeCount = normalizeMaxBarcodeCount(maxBarcodeCount)
  }

  add(line: string, lineIndex: number): void {
    const tab = line.indexOf('\t')
    const barcode = (tab === -1 ? line : line.slice(0, tab)).trim()

    if (barcode.length === 0) {
      return
    }

    const parsed = parseVisiumHdSquareBarcode(barcode)

    if (parsed === null) {
      throw new Error(
        `Unable to parse Visium HD square barcode on line ${lineIndex + 1}: ${barcode}`,
      )
    }

    this.binSizeMicrometers ??= parsed.binSizeMicrometers

    if (parsed.binSizeMicrometers !== this.binSizeMicrometers) {
      throw new Error(
        `Expected ${this.binSizeMicrometers} µm barcode on line ${
          lineIndex + 1
        }, received ${parsed.binSizeMicrometers} µm: ${barcode}`,
      )
    }

    const index = this.ids.length

    if (this.maxBarcodeCount !== undefined && index + 1 > this.maxBarcodeCount) {
      throw new VisiumHdFilteredBarcodeBudgetExceededError(
        parsed.binSizeMicrometers,
        index + 1,
        this.maxBarcodeCount,
      )
    }

    if (index === this.rows.length) {
      this.rows = grow(this.rows)
      this.cols = grow(this.cols)
    }

    this.ids.push(barcode)
    this.rows[index] = parsed.row
    this.cols[index] = parsed.col
  }

  finish(): VisiumHdSquareBarcodeColumns {
    const count = this.ids.length

    return {
      binSizeMicrometers: this.binSizeMicrometers ?? 2,
      ids: this.ids,
      rows: this.rows.slice(0, count),
      cols: this.cols.slice(0, count),
    }
  }
}

function grow(array: Int32Array): Int32Array<ArrayBuffer> {
  const grown = new Int32Array(array.length * 2)
  grown.set(array)
  return grown
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
