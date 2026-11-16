import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  geneValuesFromCsc,
  geneValuesFromCsr,
  geneValuesFromDense,
  isGeneValuesSource,
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

    expect(second).toBe(first)
    expect(unknown?.rows).toHaveLength(0)
  })

  it('stops when aborted, between batches of stored values', async () => {
    const csr = sparseFrom(dense.values, 4, 3, 'csr')
    const controller = new AbortController()
    controller.abort()

    await expect(
      geneValuesFromCsr(csr, [0], { signal: controller.signal, yieldEvery: 1 }),
    ).rejects.toThrow()
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
