import type { NumericArrayLike } from '../datasets/h5adDataset'

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
// what would be fetched; a matrix held in memory reads nothing.
export type GeneValuesReadEstimate =
  | { readonly kind: 'read'; readonly bytes: number }
  | { readonly kind: 'unavailable'; readonly reason: string }

export interface GeneValuesSource {
  // Each matrix row's cell ID, as annotation classes and selections list
  // cells.
  geneValuesRowIds(): Promise<readonly string[]>
  estimateGeneValuesRead(genes: readonly string[]): Promise<GeneValuesReadEstimate>
  // One result per gene, in the order asked.
  geneValues(
    genes: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly GeneValuesRead[]>
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
  const slotByCol = new Int32Array(matrix.cols).fill(-1)
  cols.forEach((col, slot) => {
    if (col >= 0 && col < matrix.cols && slotByCol[col] === -1) slotByCol[col] = slot
  })
  const builders = cols.map(() => new ColumnBuilder())
  const index = numericReader(matrix.indices)
  const value = numericReader(matrix.data)
  const pointer = numericReader(matrix.indptr)
  const yieldEvery = options.yieldEvery ?? DEFAULT_YIELD_EVERY
  let sinceYield = 0

  throwIfAborted(options.signal)

  for (let row = 0; row < matrix.rows; row += 1) {
    const start = pointer(row)
    const end = pointer(row + 1)

    for (let cursor = start; cursor < end; cursor += 1) {
      const slot = slotByCol[index(cursor)] ?? -1

      if (slot === -1) continue

      const stored = value(cursor)
      if (stored !== 0) builders[slot]?.push(row, stored)
    }

    sinceYield += end - start

    if (sinceYield >= yieldEvery) {
      sinceYield = 0
      await nextTask()
      throwIfAborted(options.signal)
    }
  }

  return sharedColumns(cols, builders)
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

// A column asked for twice shares one result.
function sharedColumns(
  cols: readonly number[],
  builders: readonly ColumnBuilder[],
): readonly ColumnValues[] {
  const firstSlot = new Map<number, number>()
  const finished = builders.map((builder) => builder.finish())

  return cols.map((col, slot) => {
    const first = firstSlot.get(col)
    if (first === undefined) {
      firstSlot.set(col, slot)
      return finished[slot] ?? emptyColumn()
    }
    return finished[first] ?? emptyColumn()
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError')
  }
}
