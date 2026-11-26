import { xeniumCellIdText } from './cellid'
import type { NumericArrayLike } from './numericArray'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import { throwIfAborted } from '../utils/abort'

// A gene's value in every cell of a dataset, for the Plots panel (plan
// 22-A). A read gives each gene's cells with a stored value other than 0, by
// matrix row, with negative values kept; every other row is 0. The panel
// joins the rows to annotation classes by `geneValuesRowIds` (22-B).

export interface GeneValues {
  readonly gene: string
  // Matrix rows with a stored value other than 0, and those values.
  readonly rows: Uint32Array
  readonly values: Float32Array
}

export interface GeneValuesError {
  readonly gene: string
  readonly error: string
}

export type GeneValuesRead = GeneValues | GeneValuesError

// What reading genes would take, checked before reading (22-D7). `bytes` is
// the matrix values and indices a read decodes. The download is often far
// smaller: a CSR table of counts compressed 14 times over. A matrix held in
// memory reads nothing.
export type GeneValuesReadEstimate =
  | {
      readonly kind: 'read'
      readonly bytes: number
      // How the matrix's layout sets the size, for the panel to say.
      readonly detail?: string
    }
  | { readonly kind: 'unavailable'; readonly reason: string }

// Each matrix row's cell ID, as annotation classes and selections list
// cells. Xenium's come as the matrix stores them, two integers per row, and
// are made text in the plot worker: decoding 1.4 million IDs here would
// stall the page.
export type GeneValuesRowIds =
  | readonly string[]
  | {
      readonly kind: 'xenium'
      // `stride` integers per row, the first two the ID's prefix and suffix.
      readonly pairs: Uint32Array
      readonly stride: number
      readonly count: number
    }

// Each row's ID as text, by row, from either form.
export function geneValuesRowIdAt(rowIds: GeneValuesRowIds): {
  readonly count: number
  readonly idAt: (row: number) => string
} {
  if ('kind' in rowIds) {
    const { pairs, stride } = rowIds
    return {
      count: rowIds.count,
      idAt: (row) =>
        xeniumCellIdText(pairs[row * stride] ?? 0, pairs[row * stride + 1] ?? 0),
    }
  }

  return { count: rowIds.length, idAt: (row) => rowIds[row] ?? '' }
}

export interface GeneValuesSource {
  geneValuesRowIds(): Promise<GeneValuesRowIds>
  // `layer` names a matrix other than the one Plots reads, as an AnnData
  // layer or `raw`; without one, that matrix.
  estimateGeneValuesRead(
    genes: readonly string[],
    options?: { readonly layer?: string | undefined },
  ): Promise<GeneValuesReadEstimate>
  // One result per gene, in the order asked.
  geneValues(
    genes: readonly string[],
    options?: {
      readonly signal?: AbortSignal | undefined
      readonly layer?: string | undefined
    },
  ): Promise<readonly GeneValuesRead[]>
  // The matrices `layer` can name; absent for a source with one matrix.
  geneValuesLayers?(): Promise<readonly string[]>
}

// What a source with one matrix says to a layer asked for.
export function noGeneValuesLayerMessage(
  platform: string,
  matrix: string,
  layer: string,
): string {
  return `${platform} has one matrix (${matrix}); it has no layer "${layer}".`
}

export function isGeneValuesSource(value: unknown): value is GeneValuesSource {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Partial<Record<keyof GeneValuesSource, unknown>>

  return (
    typeof source.geneValuesRowIds === 'function' &&
    typeof source.estimateGeneValuesRead === 'function' &&
    typeof source.geneValues === 'function'
  )
}

export function isGeneValuesError(read: GeneValuesRead): read is GeneValuesError {
  return 'error' in read
}

export interface GeneValuesScanOptions {
  readonly signal?: AbortSignal | undefined
  // Stored values read between yields to the event loop, so a scan of a
  // large table on the main thread does not stall it.
  readonly yieldEvery?: number
}

const DEFAULT_YIELD_EVERY = 1_000_000
// Reads of a matrix over HTTP: columns or chunks in flight at once, and the
// stored values of a CSR batch (32 MiB of float32 values and int32 indices).
const DEFAULT_READ_CONCURRENCY = 4
const DEFAULT_CSR_BATCH_VALUES = 4_000_000

export interface SparseMatrixArrays {
  readonly data: NumericArrayLike
  readonly indices: NumericArrayLike
  readonly indptr: NumericArrayLike
  readonly rows: number
  readonly cols: number
}

export interface DenseMatrixArray {
  readonly values: NumericArrayLike
  readonly rows: number
  readonly cols: number
}

type ColumnValues = Pick<GeneValues, 'rows' | 'values'>

// CSR, cells by row: one pass over every stored value finds all the columns
// at once, so 32 genes cost one scan.
export async function geneValuesFromCsr(
  matrix: SparseMatrixArrays,
  cols: readonly number[],
  options: GeneValuesScanOptions = {},
): Promise<readonly ColumnValues[]> {
  const scan = new CsrColumnScan(matrix.cols, cols)
  const pointer = numericReader(matrix.indptr)
  const values = { indices: matrix.indices, data: matrix.data }
  const yieldEvery = options.yieldEvery ?? DEFAULT_YIELD_EVERY

  throwIfAborted(options.signal)

  for (const batch of csrRowBatches(pointer, matrix.rows, yieldEvery)) {
    scan.rows(pointer, batch.rowStart, batch.rowEnd, values, 0)
    await nextTask()
    throwIfAborted(options.signal)
  }

  return scan.finish()
}

// CSC, cells by column: each gene is one column's slice.
export async function geneValuesFromCsc(
  matrix: SparseMatrixArrays,
  cols: readonly number[],
  options: GeneValuesScanOptions = {},
): Promise<readonly ColumnValues[]> {
  const index = numericReader(matrix.indices)
  const value = numericReader(matrix.data)
  const pointer = numericReader(matrix.indptr)
  const columns: ColumnValues[] = []

  for (const col of cols) {
    throwIfAborted(options.signal)
    const builder = new ColumnBuilder()

    if (col >= 0 && col < matrix.cols) {
      const end = pointer(col + 1)

      for (let cursor = pointer(col); cursor < end; cursor += 1) {
        const stored = value(cursor)
        if (stored !== 0) builder.push(index(cursor), stored)
      }
    }

    columns.push(builder.finish())
    await nextTask()
  }

  throwIfAborted(options.signal)
  return columns
}

// Dense, row-major: each gene is every row's value in its column.
export async function geneValuesFromDense(
  matrix: DenseMatrixArray,
  cols: readonly number[],
  options: GeneValuesScanOptions = {},
): Promise<readonly ColumnValues[]> {
  const value = numericReader(matrix.values)
  const columns: ColumnValues[] = []

  for (const col of cols) {
    throwIfAborted(options.signal)
    const builder = new ColumnBuilder()

    if (col >= 0 && col < matrix.cols) {
      for (let row = 0; row < matrix.rows; row += 1) {
        const stored = value(row * matrix.cols + col)
        if (stored !== 0) builder.push(row, stored)
      }
    }

    columns.push(builder.finish())
    await nextTask()
  }

  throwIfAborted(options.signal)
  return columns
}

// A range of a sparse matrix's stored values: each one's row (CSC) or
// column (CSR), and the value.
export interface SparseValueRange {
  readonly indices: NumericArrayLike
  readonly data: NumericArrayLike
}

// A sparse matrix whose pointers are in memory and whose stored values are
// read in ranges, over HTTP.
export interface RangeReadSparseMatrix {
  readonly indptr: NumericArrayLike
  readonly rows: number
  readonly cols: number
  readValues(start: number, end: number): Promise<SparseValueRange>
}

// A dense row-major matrix read chunk by chunk. `stride` steps a chunk's
// values by row and by column, so C and F order both read.
export interface ChunkReadDenseMatrix {
  readonly rows: number
  readonly cols: number
  readonly chunkShape: readonly [number, number]
  readChunk(
    rowChunk: number,
    colChunk: number,
  ): Promise<{ readonly values: NumericArrayLike; readonly stride: readonly number[] }>
}

export interface GeneValuesReadOptions {
  readonly signal?: AbortSignal | undefined
  // Reads in flight at once.
  readonly concurrency?: number
  // Stored values per CSR read.
  readonly batchValues?: number
}

// Columns stored together, read over HTTP: a CSC matrix, or Xenium's
// feature-major `cell_features`. Each gene is one slice of the values.
export async function geneValuesFromColumnSlices(
  matrix: RangeReadSparseMatrix,
  cols: readonly number[],
  options: GeneValuesReadOptions = {},
): Promise<readonly ColumnValues[]> {
  const pointer = numericReader(matrix.indptr)
  const distinct = [...new Set(cols)]
  const columns = await mapWithConcurrency(
    distinct,
    options.concurrency ?? DEFAULT_READ_CONCURRENCY,
    async (col) => {
      throwIfAborted(options.signal)
      const start = col >= 0 && col < matrix.cols ? pointer(col) : 0
      const end = col >= 0 && col < matrix.cols ? pointer(col + 1) : 0

      if (end <= start) return emptyColumn()

      const range = await matrix.readValues(start, end)
      throwIfAborted(options.signal)
      const index = numericReader(range.indices)
      const value = numericReader(range.data)
      const builder = new ColumnBuilder()

      for (let cursor = 0; cursor < end - start; cursor += 1) {
        const stored = value(cursor)
        if (stored !== 0) builder.push(index(cursor), stored)
      }

      return builder.finish()
    },
  )
  const byCol = new Map(
    distinct.map((col, slot) => [col, columns[slot] ?? emptyColumn()] as const),
  )

  return resultPerAsk(cols, byCol)
}

// CSR read over HTTP: every stored value, in batches of whole rows, each
// scanned for all the genes and then dropped. The genes' rows come back in
// no particular order.
export async function geneValuesFromCsrBatches(
  matrix: RangeReadSparseMatrix,
  cols: readonly number[],
  options: GeneValuesReadOptions = {},
): Promise<readonly ColumnValues[]> {
  const scan = new CsrColumnScan(matrix.cols, cols)
  const pointer = numericReader(matrix.indptr)
  const batches = csrRowBatches(
    pointer,
    matrix.rows,
    options.batchValues ?? DEFAULT_CSR_BATCH_VALUES,
  )

  throwIfAborted(options.signal)
  await mapWithConcurrency(
    batches,
    options.concurrency ?? DEFAULT_READ_CONCURRENCY,
    async (batch) => {
      throwIfAborted(options.signal)
      if (batch.end <= batch.start) return

      const values = await matrix.readValues(batch.start, batch.end)
      throwIfAborted(options.signal)
      scan.rows(pointer, batch.rowStart, batch.rowEnd, values, batch.start)
    },
  )

  return scan.finish()
}

// Dense, read by chunk: every chunk in the genes' columns of chunks, each
// read once for all the genes it holds.
export async function geneValuesFromDenseChunks(
  matrix: ChunkReadDenseMatrix,
  cols: readonly number[],
  options: GeneValuesReadOptions = {},
): Promise<readonly ColumnValues[]> {
  const [chunkRows, chunkCols] = matrix.chunkShape
  const distinct = [...new Set(cols)].filter((col) => col >= 0 && col < matrix.cols)
  const builders = new Map(distinct.map((col) => [col, new ColumnBuilder()]))
  const colsByChunk = new Map<number, number[]>()

  for (const col of distinct) {
    const chunk = Math.floor(col / chunkCols)
    colsByChunk.set(chunk, [...(colsByChunk.get(chunk) ?? []), col])
  }

  const rowChunks = Math.ceil(matrix.rows / chunkRows)
  const reads = [...colsByChunk].flatMap(([colChunk, chunkColumns]) =>
    Array.from({ length: rowChunks }, (_, rowChunk) => ({
      rowChunk,
      colChunk,
      chunkColumns,
    })),
  )

  throwIfAborted(options.signal)
  await mapWithConcurrency(
    reads,
    options.concurrency ?? DEFAULT_READ_CONCURRENCY,
    async ({ rowChunk, colChunk, chunkColumns }) => {
      throwIfAborted(options.signal)
      const chunk = await matrix.readChunk(rowChunk, colChunk)
      throwIfAborted(options.signal)
      const value = numericReader(chunk.values)
      const [rowStride = chunkCols, colStride = 1] = chunk.stride
      const firstRow = rowChunk * chunkRows
      // Edge chunks are padded past the matrix.
      const chunkRowCount = Math.min(chunkRows, matrix.rows - firstRow)

      for (const col of chunkColumns) {
        const builder = builders.get(col)
        const colOffset = (col - colChunk * chunkCols) * colStride

        for (let row = 0; row < chunkRowCount; row += 1) {
          const stored = value(row * rowStride + colOffset)
          if (stored !== 0) builder?.push(firstRow + row, stored)
        }
      }
    },
  )

  const finished = new Map([...builders].map(([col, builder]) => [col, builder.finish()]))
  return resultPerAsk(cols, finished)
}

// Bytes a read decodes (22-D7). `bytesPerValue` is a stored value's bytes,
// and its index's for a sparse matrix.

// Columns stored together: each gene's slice.
export function columnSlicesReadBytes(
  matrix: Pick<RangeReadSparseMatrix, 'indptr' | 'cols'>,
  cols: readonly number[],
  bytesPerValue: number,
): number {
  const pointer = numericReader(matrix.indptr)
  let values = 0

  for (const col of new Set(cols)) {
    if (col >= 0 && col < matrix.cols) values += pointer(col + 1) - pointer(col)
  }

  return values * bytesPerValue
}

// CSR: every stored value, whichever genes are read.
export function csrReadBytes(
  matrix: Pick<RangeReadSparseMatrix, 'indptr' | 'rows'>,
  bytesPerValue: number,
): number {
  const pointer = numericReader(matrix.indptr)
  return (pointer(matrix.rows) - pointer(0)) * bytesPerValue
}

// Dense: every chunk in the genes' columns of chunks, whole.
export function denseChunksReadBytes(
  matrix: Pick<ChunkReadDenseMatrix, 'rows' | 'cols' | 'chunkShape'>,
  cols: readonly number[],
  bytesPerValue: number,
): number {
  const [chunkRows, chunkCols] = matrix.chunkShape
  const colChunks = new Set(
    cols
      .filter((col) => col >= 0 && col < matrix.cols)
      .map((col) => Math.floor(col / chunkCols)),
  )

  return (
    colChunks.size *
    Math.ceil(matrix.rows / chunkRows) *
    chunkRows *
    chunkCols *
    bytesPerValue
  )
}

// One pass over CSR rows finds every gene asked for: each column's slot in
// a table, so each stored value costs one lookup.
class CsrColumnScan {
  private readonly cols: readonly number[]
  private readonly slotByCol: Int32Array
  private readonly builders: ColumnBuilder[]

  constructor(matrixCols: number, cols: readonly number[]) {
    this.cols = cols
    this.slotByCol = new Int32Array(matrixCols).fill(-1)
    cols.forEach((col, slot) => {
      if (col >= 0 && col < matrixCols && this.slotByCol[col] === -1) {
        this.slotByCol[col] = slot
      }
    })
    this.builders = cols.map(() => new ColumnBuilder())
  }

  // Rows rowStart to rowEnd, whose stored values start at `offset` in
  // `values`.
  rows(
    pointer: (index: number) => number,
    rowStart: number,
    rowEnd: number,
    values: SparseValueRange,
    offset: number,
  ): void {
    const index = numericReader(values.indices)
    const value = numericReader(values.data)

    for (let row = rowStart; row < rowEnd; row += 1) {
      const end = pointer(row + 1) - offset

      for (let cursor = pointer(row) - offset; cursor < end; cursor += 1) {
        const slot = this.slotByCol[index(cursor)] ?? -1

        if (slot === -1) continue

        const stored = value(cursor)
        if (stored !== 0) this.builders[slot]?.push(row, stored)
      }
    }
  }

  finish(): readonly ColumnValues[] {
    const byCol = new Map<number, ColumnValues>()

    this.cols.forEach((col, slot) => {
      if (!byCol.has(col)) byCol.set(col, this.builders[slot]?.finish() ?? emptyColumn())
    })

    return resultPerAsk(this.cols, byCol)
  }
}

// Whole rows with at most `maxValues` stored values between them; a row
// with more is a batch of its own.
function csrRowBatches(
  pointer: (index: number) => number,
  rows: number,
  maxValues: number,
): readonly {
  readonly rowStart: number
  readonly rowEnd: number
  readonly start: number
  readonly end: number
}[] {
  const batches = []
  let rowStart = 0

  while (rowStart < rows) {
    const start = pointer(rowStart)
    let rowEnd = rowStart + 1

    while (rowEnd < rows && pointer(rowEnd + 1) - start <= maxValues) rowEnd += 1

    batches.push({ rowStart, rowEnd, start, end: pointer(rowEnd) })
    rowStart = rowEnd
  }

  return batches
}

// One result per ask, from each distinct column's. A column asked for twice,
// as for two spellings of one gene, is read once, and each later ask gets a
// copy: readers hand the arrays to workers by transfer, which would leave a
// shared one empty for the other ask.
function resultPerAsk(
  cols: readonly number[],
  byCol: ReadonlyMap<number, ColumnValues>,
): readonly ColumnValues[] {
  const given = new Set<number>()

  return cols.map((col) => {
    const column = byCol.get(col)

    if (column === undefined) return emptyColumn()
    if (!given.has(col)) {
      given.add(col)
      return column
    }

    return { rows: column.rows.slice(), values: column.values.slice() }
  })
}

function emptyColumn(): ColumnValues {
  return { rows: new Uint32Array(0), values: new Float32Array(0) }
}

// Rows and values grown by doubling, then cut to length.
class ColumnBuilder {
  private rows = new Uint32Array(64)
  private values = new Float32Array(64)
  private length = 0

  push(row: number, value: number): void {
    if (this.length === this.rows.length) {
      const rows = new Uint32Array(this.rows.length * 2)
      const values = new Float32Array(this.values.length * 2)
      rows.set(this.rows)
      values.set(this.values)
      this.rows = rows
      this.values = values
    }

    this.rows[this.length] = row
    this.values[this.length] = value
    this.length += 1
  }

  finish(): ColumnValues {
    return {
      rows: this.rows.slice(0, this.length),
      values: this.values.slice(0, this.length),
    }
  }
}

// 64-bit indices and pointers, as h5py writes them, read as numbers.
function numericReader(values: NumericArrayLike): (index: number) => number {
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
    return (index) => Number(values[index] ?? 0n)
  }

  const numbers = values as ArrayLike<number>
  return (index) => numbers[index] ?? 0
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
