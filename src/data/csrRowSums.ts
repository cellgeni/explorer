import { numericReader, plainNumbers, type NumericArrayLike } from './numericArray'

// A gene's counts per cell from a CSR matrix (cells by row): each row's
// values of the requested columns, added up. The H5AD reader sums a matrix
// in memory this way, and the H5 file worker one it holds (O17).

// A CSR row's values of the requested columns, added in the order asked, as
// h5adDataset.ts's sparseVectorCell and cellFromCountsByColumn give them.
export class CsrRowSums {
  // Each column's slot, or -1 for a column not asked for.
  readonly #slotByCol: Int32Array
  // Each requested column's slot, in the order asked: a column asked for
  // twice is added twice.
  readonly #requestedSlots: Int32Array
  readonly #values: Float64Array
  readonly #seen: Uint8Array
  readonly #touched: Int32Array
  #touchedCount = 0

  private constructor(requestedCols: readonly number[], cols: number) {
    this.#slotByCol = new Int32Array(cols).fill(-1)
    this.#requestedSlots = new Int32Array(requestedCols.length)
    let slots = 0

    requestedCols.forEach((col, request) => {
      let slot = this.#slotByCol[col] ?? -1

      if (slot === -1) {
        slot = slots
        slots += 1
        this.#slotByCol[col] = slot
      }

      this.#requestedSlots[request] = slot
    })

    this.#values = new Float64Array(slots)
    this.#seen = new Uint8Array(slots)
    this.#touched = new Int32Array(slots)
  }

  // Null when a column is outside the matrix, which the per-cell path reads.
  static of(requestedCols: readonly number[], cols: number): CsrRowSums | null {
    return requestedCols.every((col) => Number.isInteger(col) && col >= 0 && col < cols)
      ? new CsrRowSums(requestedCols, cols)
      : null
  }

  // Indexed directly: a reader function per value was half of the scan's
  // time on the 460-plex's range-read slices.
  row(
    indices: ArrayLike<number>,
    data: ArrayLike<number>,
    start: number,
    end: number,
  ): number {
    for (let position = start; position < end; position += 1) {
      const slot = this.#slotByCol[Math.trunc(indices[position] ?? 0)] ?? -1

      if (slot !== -1) {
        if (this.#seen[slot] === 0) {
          this.#seen[slot] = 1
          this.#touched[this.#touchedCount] = slot
          this.#touchedCount += 1
        }

        // A column stored twice keeps its last value.
        this.#values[slot] = data[position] ?? 0
      }
    }

    let sum = 0

    for (const slot of this.#requestedSlots) {
      sum += this.#seen[slot] === 1 ? (this.#values[slot] ?? 0) : 0
    }

    for (let touched = 0; touched < this.#touchedCount; touched += 1) {
      this.#seen[this.#touched[touched] ?? 0] = 0
    }

    this.#touchedCount = 0
    return sum
  }
}

export interface CsrArrays {
  readonly data: NumericArrayLike
  readonly indices: NumericArrayLike
  readonly indptr: NumericArrayLike
}

// Each of `rows`' sums, in the order given.
export function sumCsrRows(
  matrix: CsrArrays,
  rows: ArrayLike<number>,
  sums: CsrRowSums,
): Float64Array {
  const counts = new Float64Array(rows.length)
  const pointer = numericReader(matrix.indptr)
  const indices = plainNumbers(matrix.indices)
  const data = plainNumbers(matrix.data)

  for (let slot = 0; slot < rows.length; slot += 1) {
    const row = rows[slot] ?? 0
    counts[slot] = sums.row(
      indices,
      data,
      Math.trunc(pointer(row)),
      Math.trunc(pointer(row + 1)),
    )
  }

  return counts
}
