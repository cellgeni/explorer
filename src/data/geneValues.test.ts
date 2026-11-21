import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  columnSlicesReadBytes,
  csrReadBytes,
  denseChunksReadBytes,
  geneValuesFromColumnSlices,
  geneValuesFromCsc,
  geneValuesFromCsr,
  geneValuesFromCsrBatches,
  geneValuesFromDense,
  geneValuesFromDenseChunks,
  isGeneValuesSource,
  type ChunkReadDenseMatrix,
  type RangeReadSparseMatrix,
  type SparseMatrixArrays,
} from './geneValues'

// A dense row-major matrix as CSR and CSC, with stored zeros kept so the
// scans have to skip them.
function sparseFrom(
  values: readonly number[],
  rows: number,
  cols: number,
  layout: 'csr' | 'csc',
): SparseMatrixArrays {
  const data: number[] = []
  const indices: number[] = []
  const indptr: number[] = [0]
  const outer = layout === 'csr' ? rows : cols
  const inner = layout === 'csr' ? cols : rows

  for (let major = 0; major < outer; major += 1) {
    for (let minor = 0; minor < inner; minor += 1) {
      const value =
        layout === 'csr' ? values[major * cols + minor] : values[minor * cols + major]
      // Every third zero is stored, as some writers do.
      if (value !== 0 || (major + minor) % 3 === 0) {
        data.push(value ?? 0)
        indices.push(minor)
      }
    }
    indptr.push(data.length)
  }

  return {
    data: new Float32Array(data),
    indices: new Int32Array(indices),
    indptr: new BigInt64Array(indptr.map(BigInt)),
    rows,
    cols,
  }
}

// The sparse matrix with its values read in ranges, as over HTTP, logging
// each range read.
function rangeRead(
  matrix: SparseMatrixArrays,
  reads: [number, number][] = [],
): RangeReadSparseMatrix {
  return {
    indptr: matrix.indptr,
    rows: matrix.rows,
    cols: matrix.cols,
    readValues: async (start, end) => {
      reads.push([start, end])
      await Promise.resolve()
      return {
        indices: (matrix.indices as Int32Array).slice(start, end),
        data: (matrix.data as Float32Array).slice(start, end),
      }
    },
  }
}

// The dense matrix in chunks, C or F order, with edge chunks padded by 99.
function chunked(
  values: readonly number[],
  rows: number,
  cols: number,
  chunkShape: readonly [number, number],
  order: 'C' | 'F',
  reads: string[] = [],
): ChunkReadDenseMatrix {
  const [chunkRows, chunkCols] = chunkShape

  return {
    rows,
    cols,
    chunkShape,
    readChunk: async (rowChunk, colChunk) => {
      reads.push(`${rowChunk}.${colChunk}`)
      const chunk = new Float32Array(chunkRows * chunkCols)

      for (let row = 0; row < chunkRows; row += 1) {
        for (let col = 0; col < chunkCols; col += 1) {
          const matrixRow = rowChunk * chunkRows + row
          const matrixCol = colChunk * chunkCols + col
          chunk[order === 'C' ? row * chunkCols + col : col * chunkRows + row] =
            matrixRow < rows && matrixCol < cols
              ? (values[matrixRow * cols + matrixCol] ?? 0)
              : 99
        }
      }

      return {
        values: chunk,
        stride: order === 'C' ? [chunkCols, 1] : [1, chunkRows],
      }
    },
  }
}

function sorted({ rows, values }: { rows: Uint32Array; values: Float32Array }) {
  return [...rows]
    .map((row, index) => [row, values[index] ?? 0] as const)
    .sort((left, right) => left[0] - right[0])
}

describe('gene values (plan 22-A)', () => {
  const dense = { values: [1, 0, 5, 2, 3, 0, 0, 4, 6, 7, 0, -8], rows: 4, cols: 3 }

  it('reads each column of a dense matrix, keeping negative values', async () => {
    const [actb, gad1, gapdh] = await geneValuesFromDense(dense, [0, 1, 2])

    expect([...(actb?.rows ?? [])]).toEqual([0, 1, 3])
    expect([...(actb?.values ?? [])]).toEqual([1, 2, 7])
    expect([...(gad1?.rows ?? [])]).toEqual([1, 2])
    expect([...(gapdh?.values ?? [])]).toEqual([5, 6, -8])
  })

  it('gives the same values from CSR and CSC with 64-bit pointers', async () => {
    const csr = sparseFrom(dense.values, 4, 3, 'csr')
    const csc = sparseFrom(dense.values, 4, 3, 'csc')
    const expected = await geneValuesFromDense(dense, [2, 0])

    const fromCsr = await geneValuesFromCsr(csr, [2, 0])
    const fromCsc = await geneValuesFromCsc(csc, [2, 0])

    expect(fromCsr.map(sorted)).toEqual(expected.map(sorted))
    expect(fromCsc.map(sorted)).toEqual(expected.map(sorted))
  })

  it('reads a column asked for twice once, and an unknown column as empty', async () => {
    const csr = sparseFrom(dense.values, 4, 3, 'csr')
    const [first, second, unknown] = await geneValuesFromCsr(csr, [1, 1, 9])

    expect(second).toEqual(first)
    expect(unknown?.rows).toHaveLength(0)
  })

  it('gives each ask of a column its own arrays, as workers take them by transfer', async () => {
    const reads: [number, number][] = []
    const asked = [
      await geneValuesFromCsr(sparseFrom(dense.values, 4, 3, 'csr'), [2, 2]),
      await geneValuesFromCsrBatches(
        rangeRead(sparseFrom(dense.values, 4, 3, 'csr')),
        [2, 2],
      ),
      await geneValuesFromColumnSlices(
        rangeRead(sparseFrom(dense.values, 4, 3, 'csc'), reads),
        [2, 2],
      ),
      await geneValuesFromDenseChunks(chunked(dense.values, 4, 3, [2, 2], 'C'), [2, 2]),
    ]

    for (const [first, second] of asked) {
      expect(second).toEqual(first)
      expect(second?.rows.buffer).not.toBe(first?.rows.buffer)
      expect(second?.values.buffer).not.toBe(first?.values.buffer)
    }

    // The column itself is read once.
    expect(reads).toHaveLength(1)
  })

  it('stops when aborted, between batches of stored values', async () => {
    const csr = sparseFrom(dense.values, 4, 3, 'csr')
    const controller = new AbortController()
    controller.abort()

    await expect(
      geneValuesFromCsr(csr, [0], { signal: controller.signal, yieldEvery: 1 }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('matches a dense read on any matrix, in every layout', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 8 }),
        fc.infiniteStream(fc.oneof(fc.constant(0), fc.integer({ min: -5, max: 50 }))),
        fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 5 }),
        async (rows, cols, stream, wanted) => {
          const values = [...stream.take(rows * cols)]
          const columns = wanted.map((col) => col % cols)
          const expected = (
            await geneValuesFromDense({ values, rows, cols }, columns)
          ).map(sorted)

          const csr = await geneValuesFromCsr(
            sparseFrom(values, rows, cols, 'csr'),
            columns,
            { yieldEvery: 3 },
          )
          const csc = await geneValuesFromCsc(
            sparseFrom(values, rows, cols, 'csc'),
            columns,
          )

          expect(csr.map(sorted)).toEqual(expected)
          expect(csc.map(sorted)).toEqual(expected)
          for (const column of expected) {
            expect(column.every(([, value]) => value !== 0)).toBe(true)
          }
        },
      ),
      { numRuns: 60 },
    )
  })

  it('reads a matrix over HTTP the same as in memory, in every layout', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 8 }),
        fc.infiniteStream(fc.oneof(fc.constant(0), fc.integer({ min: -5, max: 50 }))),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 4 }),
        fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 4 })),
        fc.constantFrom('C' as const, 'F' as const),
        async (rows, cols, stream, wanted, batchValues, concurrency, shape, order) => {
          const values = [...stream.take(rows * cols)]
          // Some columns past the matrix, which read as empty.
          const columns = wanted.map((col) => (col < 8 ? col % cols : col))
          const expected = (
            await geneValuesFromDense({ values, rows, cols }, columns)
          ).map(sorted)
          const options = { batchValues, concurrency }

          const csr = await geneValuesFromCsrBatches(
            rangeRead(sparseFrom(values, rows, cols, 'csr')),
            columns,
            options,
          )
          const csc = await geneValuesFromColumnSlices(
            rangeRead(sparseFrom(values, rows, cols, 'csc')),
            columns,
            options,
          )
          const dense = await geneValuesFromDenseChunks(
            chunked(values, rows, cols, shape, order),
            columns,
            options,
          )

          expect(csr.map(sorted)).toEqual(expected)
          expect(csc.map(sorted)).toEqual(expected)
          expect(dense.map(sorted)).toEqual(expected)
        },
      ),
      { numRuns: 80 },
    )
  })

  it('reads CSR in batches of whole rows, every value once', async () => {
    const reads: [number, number][] = []
    const csr = sparseFrom(dense.values, 4, 3, 'csr')

    await geneValuesFromCsrBatches(rangeRead(csr, reads), [1], { batchValues: 4 })

    const pointers = [...(csr.indptr as BigInt64Array)].map(Number)
    expect(reads.flat().every((offset) => pointers.includes(offset))).toBe(true)
    expect(reads.map(([start, end]) => end - start).reduce((a, b) => a + b)).toBe(
      pointers.at(-1),
    )
    expect(reads.length).toBeGreaterThan(1)
  })

  it('reads each column slice and dense chunk once for the genes asked', async () => {
    const sliceReads: [number, number][] = []
    const chunkReads: string[] = []

    await geneValuesFromColumnSlices(
      rangeRead(sparseFrom(dense.values, 4, 3, 'csc'), sliceReads),
      [2, 2, 0],
    )
    await geneValuesFromDenseChunks(
      chunked(dense.values, 4, 3, [3, 2], 'C', chunkReads),
      [2, 2],
    )

    expect(sliceReads).toHaveLength(2)
    // Column 2 is in the second column of chunks, in both of its rows.
    expect(chunkReads.sort()).toEqual(['0.1', '1.1'])
  })

  it('stops reading over HTTP when aborted', async () => {
    const controller = new AbortController()
    const matrix = rangeRead(sparseFrom(dense.values, 4, 3, 'csr'))
    const read = geneValuesFromCsrBatches(
      {
        ...matrix,
        readValues: async (start, end) => {
          controller.abort()
          return matrix.readValues(start, end)
        },
      },
      [0],
      { signal: controller.signal, batchValues: 1, concurrency: 1 },
    )

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('estimates the bytes a read fetches, by layout', () => {
    const csr = sparseFrom(dense.values, 4, 3, 'csr')
    const csc = sparseFrom(dense.values, 4, 3, 'csc')
    const cscPointers = [...(csc.indptr as BigInt64Array)].map(Number)
    const column2 = (cscPointers[3] ?? 0) - (cscPointers[2] ?? 0)

    // Every stored value, whichever genes.
    expect(csrReadBytes(csr, 8)).toBe(Number((csr.indptr as BigInt64Array)[4]) * 8)
    // A column asked twice counts once; one past the matrix counts nothing.
    expect(columnSlicesReadBytes(csc, [2, 2, 7], 8)).toBe(column2 * 8)
    // Columns 0 and 1 share a column of 2 x 2 chunks; column 2 has its own.
    // Each column of chunks is two chunks of 4 values.
    expect(
      denseChunksReadBytes({ rows: 4, cols: 3, chunkShape: [2, 2] }, [0, 1], 4),
    ).toBe(2 * 4 * 4)
    expect(
      denseChunksReadBytes({ rows: 4, cols: 3, chunkShape: [2, 2] }, [0, 2], 4),
    ).toBe(4 * 4 * 4)
  })

  it('recognises a dataset that reads gene values', () => {
    expect(
      isGeneValuesSource({
        geneValuesRowIds: () => Promise.resolve([]),
        estimateGeneValuesRead: () => Promise.resolve({ kind: 'read', bytes: 0 }),
        geneValues: () => Promise.resolve([]),
      }),
    ).toBe(true)
    expect(isGeneValuesSource({ geneExpression: () => undefined })).toBe(false)
    expect(isGeneValuesSource(null)).toBe(false)
  })
})
