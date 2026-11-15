// 10x Market Exchange (MEX) feature-barcode matrices: `matrix.mtx.gz` (Matrix
// Market coordinate format, features × barcodes, 1-based), `barcodes.tsv.gz`,
// and `features.tsv.gz` (Cell Ranger 2 named it `genes.tsv`). Space Ranger
// writes them to `filtered_feature_bc_matrix/` next to the .h5, and most GEO
// Visium samples deposit only these. The matrix is parsed as it streams in,
// straight into the barcodes × features CSR arrays the .h5 reader returns, so
// the inflated text is never held whole.

import { readMaybeGzipText } from '../data/readMaybeGzipText'
import { urlFileName as fileName } from '../data/urlFileName'
import type { FeatureBarcodeMatrix } from './visiumDataset'
import { VISIUM_MATRIX_MAX_BYTES, VisiumMatrixTooLargeError } from './visiumFormat'

export interface FeatureBarcodeMexUrls {
  readonly matrix: string
  readonly barcodes: string
  readonly features: string
}

export interface ReadFeatureBarcodeMexOptions {
  readonly urls: FeatureBarcodeMexUrls
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly onProgress?: (message: string) => void
}

export type FeatureBarcodeMexReader = (
  options: ReadFeatureBarcodeMexOptions,
) => Promise<FeatureBarcodeMatrix>

export interface MatrixMarketCsr {
  readonly featureCount: number
  readonly barcodeCount: number
  readonly data: Int32Array | Float32Array
  readonly indices: Int32Array
  readonly indptr: Float64Array
  readonly softwareVersion?: string
}

const NEWLINE = 0x0a
const PERCENT = 0x25
const EMPTY = new Uint8Array(0)

type MatrixMarketField = 'integer' | 'real' | 'pattern'

// Matrix Market coordinate entries, fed in chunks of any size. Entries go to
// barcode (column) rows as they arrive; Space Ranger writes them sorted by
// barcode, then feature, so the arrays need no reordering. Other orders are
// sorted at the end.
export class MatrixMarketCsrParser {
  private readonly label: string
  private carry: Uint8Array = EMPTY
  private sawBanner = false
  private field: MatrixMarketField = 'integer'
  private softwareVersion: string | undefined
  private featureCount = 0
  private barcodeCount = 0
  private declaredEntries = 0
  private entries = 0
  private data: Int32Array | Float32Array | null = null
  private indices = new Int32Array(0)
  // Entries per barcode at index barcode + 1, summed into offsets at the end.
  private indptr = new Float64Array(1)
  // Each entry's barcode, kept only once an entry arrives out of barcode order.
  private entryBarcodes: Int32Array | null = null
  private lastBarcode = 0
  private lastFeature = -1
  private featuresInOrder = true
  private cursor = 0

  constructor(label: string) {
    this.label = label
  }

  push(chunk: Uint8Array): void {
    let lineStart = 0

    if (this.carry.length > 0) {
      const newline = chunk.indexOf(NEWLINE)

      if (newline === -1) {
        this.carry = concatBytes(this.carry, chunk)
        return
      }

      const line = concatBytes(this.carry, chunk.subarray(0, newline))
      this.carry = EMPTY
      this.line(line, 0, line.length)
      lineStart = newline + 1
    }

    let newline = chunk.indexOf(NEWLINE, lineStart)

    while (newline !== -1) {
      this.line(chunk, lineStart, newline)
      lineStart = newline + 1
      newline = chunk.indexOf(NEWLINE, lineStart)
    }

    if (lineStart < chunk.length) {
      this.carry = chunk.slice(lineStart)
    }
  }

  finish(): MatrixMarketCsr {
    if (this.carry.length > 0) {
      const line = this.carry
      this.carry = EMPTY
      this.line(line, 0, line.length)
    }

    const { data, indptr } = this

    if (data === null) {
      throw new Error(`${this.label} has no Matrix Market size line.`)
    }

    if (this.entries !== this.declaredEntries) {
      throw new Error(
        `${this.label} ends after ${this.entries.toLocaleString()} of ${this.declaredEntries.toLocaleString()} entries.`,
      )
    }

    for (let barcode = 0; barcode < this.barcodeCount; barcode += 1) {
      indptr[barcode + 1] = (indptr[barcode + 1] ?? 0) + (indptr[barcode] ?? 0)
    }

    let indices: Int32Array = this.indices
    let values: Int32Array | Float32Array = data

    if (this.entryBarcodes !== null) {
      const sorted = placeByBarcode(this.entryBarcodes, indices, data, indptr)
      indices = sorted.indices
      values = sorted.data
    }

    if (!this.featuresInOrder || this.entryBarcodes !== null) {
      sortRowFeatures(indices, values, indptr)
    }

    return {
      featureCount: this.featureCount,
      barcodeCount: this.barcodeCount,
      data: values,
      indices,
      indptr,
      ...(this.softwareVersion === undefined
        ? {}
        : { softwareVersion: this.softwareVersion }),
    }
  }

  private line(bytes: Uint8Array, start: number, end: number): void {
    if (this.data === null) {
      this.headerLine(latin1(bytes, start, end).trim())
    } else {
      this.entry(bytes, start, end)
    }
  }

  private headerLine(text: string): void {
    if (!this.sawBanner) {
      const banner =
        /^%%MatrixMarket\s+matrix\s+coordinate\s+(integer|real|pattern)\s+general$/i.exec(
          text,
        )

      if (banner === null) {
        throw new Error(
          text.startsWith('%%MatrixMarket')
            ? `${this.label} is a Matrix Market file of an unsupported kind (${text.slice(15)}); only general coordinate matrices are read.`
            : `${this.label} is not a Matrix Market file.`,
        )
      }

      this.sawBanner = true
      this.field = (banner[1] ?? 'integer').toLowerCase() as MatrixMarketField
      return
    }

    if (text.length === 0) {
      return
    }

    if (text.startsWith('%')) {
      this.readMetadataComment(text)
      return
    }

    const size = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(text)

    if (size === null) {
      throw new Error(`${this.label} has an unreadable Matrix Market size line.`)
    }

    this.featureCount = Number(size[1])
    this.barcodeCount = Number(size[2])
    this.declaredEntries = Number(size[3])

    try {
      this.indices = new Int32Array(this.declaredEntries)
      this.data =
        this.field === 'real'
          ? new Float32Array(this.declaredEntries)
          : new Int32Array(this.declaredEntries)
      this.indptr = new Float64Array(this.barcodeCount + 1)
    } catch {
      throw new Error(
        `${this.label} declares ${this.declaredEntries.toLocaleString()} entries, too many to hold in browser memory.`,
      )
    }
  }

  // Space Ranger writes `%metadata_json: {"software_version": ...}`.
  private readMetadataComment(text: string): void {
    const json = /^%\s*metadata_json:\s*(\{.*\})$/.exec(text)?.[1]

    if (json === undefined) {
      return
    }

    try {
      const metadata = JSON.parse(json) as { software_version?: unknown }

      if (typeof metadata.software_version === 'string') {
        this.softwareVersion = metadata.software_version
      }
    } catch {
      // Not JSON: an ordinary comment.
    }
  }

  private entry(bytes: Uint8Array, start: number, end: number): void {
    this.cursor = start
    this.skipSpaces(bytes, end)

    if (this.cursor === end || bytes[this.cursor] === PERCENT) {
      return
    }

    const feature = this.readIndex(bytes, end, this.featureCount, 'row')
    const barcode = this.readIndex(bytes, end, this.barcodeCount, 'column')
    const value = this.field === 'pattern' ? 1 : this.readValue(bytes, end)
    const entry = this.entries

    if (entry >= this.declaredEntries) {
      throw new Error(
        `${this.label} has more than the ${this.declaredEntries.toLocaleString()} entries its size line declares.`,
      )
    }

    if (this.entryBarcodes === null) {
      if (barcode < this.lastBarcode) {
        this.leaveBarcodeOrder(entry)
      } else if (barcode === this.lastBarcode && feature <= this.lastFeature) {
        this.featuresInOrder = false
      }
    }

    if (this.entryBarcodes !== null) {
      this.entryBarcodes[entry] = barcode
    }

    this.lastBarcode = barcode
    this.lastFeature = feature
    this.indices[entry] = feature
    ;(this.data as Int32Array | Float32Array)[entry] = value
    this.indptr[barcode + 1] = (this.indptr[barcode + 1] ?? 0) + 1
    this.entries = entry + 1
  }

  // A 1-based index token, returned 0-based.
  private readIndex(
    bytes: Uint8Array,
    end: number,
    count: number,
    axis: 'row' | 'column',
  ): number {
    this.skipSpaces(bytes, end)
    const tokenStart = this.cursor
    let value = 0

    while (this.cursor < end) {
      const digit = (bytes[this.cursor] ?? 0) - 48

      if (digit < 0 || digit > 9) {
        break
      }

      value = value * 10 + digit
      this.cursor += 1
    }

    if (this.cursor === tokenStart || value < 1 || value > count) {
      throw new Error(
        `${this.label} entry ${(this.entries + 1).toLocaleString()} has an invalid ${axis} index (${latin1(bytes, tokenStart, Math.max(this.cursor, tokenStart + 1)).trim() || 'missing'}).`,
      )
    }

    return value - 1
  }

  private readValue(bytes: Uint8Array, end: number): number {
    this.skipSpaces(bytes, end)
    const tokenStart = this.cursor
    let value = 0
    let digitsOnly = true

    while (this.cursor < end && !isSpace(bytes[this.cursor] ?? 0)) {
      const digit = (bytes[this.cursor] ?? 0) - 48

      if (digit < 0 || digit > 9) {
        digitsOnly = false
      } else {
        value = value * 10 + digit
      }

      this.cursor += 1
    }

    if (digitsOnly && this.cursor > tokenStart) {
      return value
    }

    const parsed = Number(latin1(bytes, tokenStart, this.cursor))

    if (
      this.cursor === tokenStart ||
      !Number.isFinite(parsed) ||
      (this.field === 'integer' && !Number.isInteger(parsed))
    ) {
      throw new Error(
        `${this.label} entry ${(this.entries + 1).toLocaleString()} has an invalid value (${latin1(bytes, tokenStart, this.cursor) || 'missing'}).`,
      )
    }

    return parsed
  }

  private skipSpaces(bytes: Uint8Array, end: number): void {
    while (this.cursor < end && isSpace(bytes[this.cursor] ?? 0)) {
      this.cursor += 1
    }
  }

  // The entries so far were in barcode order, so the counts give each one's
  // barcode.
  private leaveBarcodeOrder(entriesSoFar: number): void {
    const entryBarcodes = new Int32Array(this.declaredEntries)
    let entry = 0

    for (let barcode = 0; entry < entriesSoFar; barcode += 1) {
      const count = this.indptr[barcode + 1] ?? 0
      entryBarcodes.fill(barcode, entry, entry + count)
      entry += count
    }

    this.entryBarcodes = entryBarcodes
  }
}

export function parseMexBarcodes(text: string): readonly string[] {
  return tsvRows(text).map((fields) => fields[0] ?? '')
}

export interface MexFeatures {
  readonly ids: readonly string[]
  readonly names: readonly string[]
  readonly types: readonly string[]
}

// `id<TAB>name<TAB>type` (Cell Ranger 3+), or `id<TAB>name` (Cell Ranger 2's
// genes.tsv), whose features are all genes.
export function parseMexFeatures(text: string): MexFeatures {
  const rows = tsvRows(text)

  return {
    ids: rows.map((fields) => fields[0] ?? ''),
    names: rows.map((fields) => fields[1] ?? fields[0] ?? ''),
    types: rows.map((fields) => fields[2] ?? 'Gene Expression'),
  }
}

export const readFeatureBarcodeMex: FeatureBarcodeMexReader = async (options) => {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const { urls, signal, onProgress } = options
  const [csr, barcodes, features] = await Promise.all([
    readMatrix(urls.matrix, fetcher, signal),
    readList(urls.barcodes, fetcher, signal).then(parseMexBarcodes),
    readList(urls.features, fetcher, signal).then(parseMexFeatures),
  ])

  if (barcodes.length !== csr.barcodeCount) {
    throw new Error(
      `${fileName(urls.barcodes)} lists ${barcodes.length.toLocaleString()} barcodes; ${fileName(urls.matrix)} has ${csr.barcodeCount.toLocaleString()} columns.`,
    )
  }

  if (features.ids.length !== csr.featureCount) {
    throw new Error(
      `${fileName(urls.features)} lists ${features.ids.length.toLocaleString()} features; ${fileName(urls.matrix)} has ${csr.featureCount.toLocaleString()} rows.`,
    )
  }

  onProgress?.(
    `${fileName(urls.matrix)} read: ${csr.barcodeCount.toLocaleString()} barcodes × ${csr.featureCount.toLocaleString()} features, ${(csr.indptr[csr.barcodeCount] ?? 0).toLocaleString()} non-zero`,
  )

  return {
    barcodes,
    featureNames: features.names,
    featureIds: features.ids,
    featureTypes: features.types,
    data: csr.data,
    indices: csr.indices,
    indptr: csr.indptr,
    ...(csr.softwareVersion === undefined
      ? {}
      : { softwareVersion: csr.softwareVersion }),
  }
}

export function featureBarcodeMatrixTransferables(
  matrix: FeatureBarcodeMatrix,
): Transferable[] {
  return [matrix.data.buffer, matrix.indices.buffer, matrix.indptr.buffer]
}

async function readMatrix(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<MatrixMarketCsr> {
  const response = await fetcher(url, signal === undefined ? {} : { signal })

  if (!response.ok) {
    throw new Error(`${fileName(url)} returned HTTP ${response.status}.`)
  }

  const declared = Number(response.headers.get('Content-Length'))

  if (Number.isFinite(declared) && declared > VISIUM_MATRIX_MAX_BYTES) {
    await response.body?.cancel()
    throw new VisiumMatrixTooLargeError(url, declared)
  }

  const parser = new MatrixMarketCsrParser(fileName(url))
  const reader = (await maybeGunzip(limitBytes(response, url))).getReader()

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      return parser.finish()
    }

    parser.push(value)
  }
}

async function readList(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<string> {
  const response = await fetcher(url, signal === undefined ? {} : { signal })

  if (!response.ok) {
    throw new Error(`${fileName(url)} returned HTTP ${response.status}.`)
  }

  return readMaybeGzipText(response)
}

// The body, cut off with an error once it passes the matrix load limit (for
// hosts that send no Content-Length).
function limitBytes(response: Response, url: string): ReadableStream<Uint8Array> {
  const body = response.body ?? new Response(EMPTY).body

  if (body === null) {
    throw new Error(`${fileName(url)} has no body.`)
  }

  let received = 0

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength

        if (received > VISIUM_MATRIX_MAX_BYTES) {
          controller.error(new VisiumMatrixTooLargeError(url, received))
          return
        }

        controller.enqueue(chunk)
      },
    }),
  )
}

// The stream, inflated when its first bytes are the gzip magic number.
async function maybeGunzip(
  stream: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader()
  let head: Uint8Array = EMPTY

  while (head.length < 2) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    head = concatBytes(head, value)
  }

  const replayed = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length > 0) {
        controller.enqueue(head)
      }
    },
    async pull(controller) {
      const { done, value } = await reader.read()

      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })

  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    return replayed
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression.')
  }

  return replayed.pipeThrough(
    new DecompressionStream('gzip') as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >,
  )
}

// Counting sort of the entries into barcode rows, keeping their file order
// within a row.
function placeByBarcode(
  entryBarcodes: Int32Array,
  indices: Int32Array,
  data: Int32Array | Float32Array,
  indptr: Float64Array,
): { indices: Int32Array; data: Int32Array | Float32Array } {
  const placedIndices = new Int32Array(indices.length)
  const placedData =
    data instanceof Float32Array
      ? new Float32Array(data.length)
      : new Int32Array(data.length)
  const next = Float64Array.from(indptr.subarray(0, indptr.length - 1))

  for (let entry = 0; entry < entryBarcodes.length; entry += 1) {
    const barcode = entryBarcodes[entry] ?? 0
    const target = next[barcode] ?? 0
    placedIndices[target] = indices[entry] ?? 0
    placedData[target] = data[entry] ?? 0
    next[barcode] = target + 1
  }

  return { indices: placedIndices, data: placedData }
}

// Sorts each row's entries by feature index, where they are not already.
function sortRowFeatures(
  indices: Int32Array,
  data: Int32Array | Float32Array,
  indptr: Float64Array,
): void {
  for (let row = 0; row + 1 < indptr.length; row += 1) {
    const start = indptr[row] ?? 0
    const end = indptr[row + 1] ?? start
    let sorted = true

    for (let entry = start + 1; entry < end && sorted; entry += 1) {
      sorted = (indices[entry - 1] ?? 0) < (indices[entry] ?? 0)
    }

    if (sorted) {
      continue
    }

    const order = Array.from({ length: end - start }, (_unused, offset) => start + offset)
    order.sort((left, right) => (indices[left] ?? 0) - (indices[right] ?? 0))
    const rowIndices = order.map((entry) => indices[entry] ?? 0)
    const rowData = order.map((entry) => data[entry] ?? 0)
    indices.set(rowIndices, start)
    data.set(rowData, start)
  }
}

function tsvRows(text: string): string[][] {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split('\t').map((field) => field.trim()))
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0d
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let text = ''

  for (let index = start; index < end; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0)
  }

  return text
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left, 0)
  joined.set(right, left.length)
  return joined
}
