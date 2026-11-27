import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import { AnnDataH5adDataset } from './h5adDataset'

// geneExpression used to read every selected cell's genes through the matrix's
// per-cell path and add up its counts. Since O15 a CSR table in memory is read
// row by row into the sums. The counts must be the ones the per-cell path,
// which `matrix()` still reads, adds up.

const GENES = ['A', 'B', 'C', 'D', 'E']

const valueArb = fc.oneof(
  fc.integer({ min: 0, max: 9 }),
  fc.double({ min: -5, max: 5, noNaN: true }),
  fc.constant(Number.NaN),
)
// A row's stored columns: unsorted, and a column may be stored twice.
const rowArb = fc.array(
  fc.record({ col: fc.integer({ min: 0, max: GENES.length - 1 }), value: valueArb }),
  { maxLength: 7 },
)
const caseArb = fc.record({
  rows: fc.array(rowArb, { minLength: 1, maxLength: 12 }),
  // Repeated genes count twice; a gene not in the table counts nothing.
  genes: fc.array(fc.constantFrom(...GENES, 'missing'), { minLength: 1, maxLength: 4 }),
  float64: fc.boolean(),
})

describe('H5AD expression counts (O15)', () => {
  it('are the per-cell counts added up', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (example) => {
        const indptr = [0]
        const indices: number[] = []
        const values: number[] = []

        for (const row of example.rows) {
          for (const { col, value } of row) {
            indices.push(col)
            values.push(value)
          }

          indptr.push(indices.length)
        }

        const cellIds = example.rows.map((_row, index) => `cell-${index}`)
        const dataset = new AnnDataH5adDataset({
          url: 'memory://expression-counts',
          memorySource: {
            label: 'Memory table',
            load: async () => ({
              obsNames: cellIds,
              obs: [],
              varNames: GENES,
              X: {
                kind: 'csr' as const,
                data: example.float64
                  ? new Float64Array(values)
                  : new Float32Array(values),
                indices: new Int32Array(indices),
                indptr: new Int32Array(indptr),
              },
              obsm: {
                spatial: {
                  values: new Float32Array(
                    cellIds.flatMap((_id, index) => [index, index]),
                  ),
                  columns: 2,
                },
              },
            }),
          },
        })
        const expression = await dataset.geneExpression(
          {
            minX: micrometers(-1),
            maxX: micrometers(100),
            minY: micrometers(-100),
            maxY: micrometers(100),
          },
          example.genes,
        )
        // Every gene through the per-cell path, which geneExpression read
        // the genes asked for through before.
        const matrix = await dataset.matrix(cellIds)
        const expected = cellIds.map((id) => {
          const cell = matrix.cells.get(id as never)
          let sum = 0

          for (const gene of example.genes) {
            const index = cell?.geneNames.indexOf(gene) ?? -1
            sum += index === -1 ? 0 : (cell?.counts[index] ?? 0)
          }

          return sum
        })

        expect(expression.elements.map((element) => element.id)).toEqual(cellIds)
        expect(expression.elements.map((element) => element.count)).toEqual(expected)
      }),
    )
  })
})
