import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'
import type {
  GeneValuesReadEstimate,
  GeneValuesRowIds,
  GeneValuesSource,
} from './geneValues'
import {
  GeneReadRefused,
  GeneReadTooLarge,
  GeneRowReader,
  joinGeneRowsToOverview,
  overviewGeneValues,
} from './geneValuesByRow'

const MIB = 1024 * 1024

// Each overview row's value by a plain lookup: the matrix's first row for
// the cell, its stored value or 0, and NaN for a cell the matrix lacks.
function byLookup(
  matrixIds: readonly string[],
  overviewIds: readonly string[],
  stored: ReadonlyMap<number, number>,
): number[] {
  const firstRow = new Map<string, number>()
  matrixIds.forEach((id, row) => {
    if (!firstRow.has(id)) firstRow.set(id, row)
  })
  const firstOverview = new Map<string, number>()
  overviewIds.forEach((id, row) => {
    if (!firstOverview.has(id)) firstOverview.set(id, row)
  })

  return overviewIds.map((id, overviewRow) => {
    const row = firstRow.get(id)
    // A later overview row for the same cell is not joined.
    if (row === undefined || firstOverview.get(id) !== overviewRow) return Number.NaN
    return Math.fround(stored.get(row) ?? 0)
  })
}

function columnFrom(stored: ReadonlyMap<number, number>) {
  return {
    rows: Uint32Array.from(stored.keys()),
    values: Float32Array.from(stored.values()),
  }
}

// IDs drawn from a few, so the matrix and the overview share some, lack
// some, and list some twice.
const idArbitrary = fc.integer({ min: 0, max: 30 }).map((n) => `cell-${n}`)

describe('joinGeneRowsToOverview', () => {
  it('places each stored value as a plain lookup would', () => {
    fc.assert(
      fc.property(
        fc.array(idArbitrary, { maxLength: 40 }),
        fc.array(idArbitrary, { maxLength: 40 }),
        fc.array(
          fc.tuple(fc.nat(60), fc.float({ noNaN: true, noDefaultInfinity: true })),
          {
            maxLength: 40,
          },
        ),
        (matrixIds, overviewIds, entries) => {
          const stored = new Map(
            entries
              .filter(([row]) => row < matrixIds.length)
              .map(([row, value]) => [row, value]),
          )
          const join = joinGeneRowsToOverview(matrixIds, overviewIds)
          const values = overviewGeneValues(join, columnFrom(stored))

          expect(values).toHaveLength(overviewIds.length)
          expect([...values]).toEqual(byLookup(matrixIds, overviewIds, stored))
        },
      ),
    )
  })

  it('reads Xenium IDs from their integer pairs', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 1, max: 2 })),
          {
            maxLength: 20,
          },
        ),
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 1, max: 2 })),
          {
            maxLength: 20,
          },
        ),
        fc.integer({ min: 2, max: 3 }),
        (matrixPairs, overviewPairs, stride) => {
          // A third integer per row, as a dataset index, which the ID leaves out.
          const pairs = new Uint32Array(matrixPairs.length * stride)
          matrixPairs.forEach(([prefix, suffix], row) => {
            pairs[row * stride] = prefix
            pairs[row * stride + 1] = suffix
            if (stride === 3) pairs[row * stride + 2] = 7
          })
          const rowIds: GeneValuesRowIds = {
            kind: 'xenium',
            pairs,
            stride,
            count: matrixPairs.length,
          }
          const matrixIds = matrixPairs.map(([prefix, suffix]) =>
            intToCellId(prefix, suffix),
          )
          const overviewIds = overviewPairs.map(([prefix, suffix]) =>
            intToCellId(prefix, suffix),
          )
          const stored = new Map(matrixPairs.map((_pair, row) => [row, row + 1]))

          const values = overviewGeneValues(
            joinGeneRowsToOverview(rowIds, overviewIds),
            columnFrom(stored),
          )

          expect([...values]).toEqual(byLookup(matrixIds, overviewIds, stored))
        },
      ),
    )
  })

  it('leaves the empty overview untouched between reads', () => {
    const join = joinGeneRowsToOverview(['a', 'b'], ['b', 'c', 'a'])

    expect([...overviewGeneValues(join, columnFrom(new Map([[0, 2]])))]).toEqual([
      0,
      Number.NaN,
      2,
    ])
    expect([...overviewGeneValues(join, columnFrom(new Map([[1, 5]])))]).toEqual([
      5,
      Number.NaN,
      0,
    ])
  })
})

// A matrix of cells a to c, CD3E stored in a and c, whose read costs
// `estimate`.
function fakeSource(
  estimate: GeneValuesReadEstimate,
  extra: Partial<
    Pick<GeneValuesSource, 'estimateGeneValuesRead' | 'geneValuesLayers'>
  > = {},
) {
  return {
    geneValuesRowIds: vi.fn<GeneValuesSource['geneValuesRowIds']>(async () => [
      'cell-a',
      'cell-b',
      'cell-c',
    ]),
    estimateGeneValuesRead: async () => estimate,
    geneValues: vi.fn<GeneValuesSource['geneValues']>(async (genes) =>
      genes.map((gene) =>
        gene === 'CD3E'
          ? { gene, rows: new Uint32Array([0, 2]), values: new Float32Array([1.5, 4]) }
          : { gene, error: `${gene} is not in the expression matrix.` },
      ),
    ),
    ...extra,
  } satisfies GeneValuesSource
}

describe('GeneRowReader', () => {
  const overview = ['cell-c', 'cell-x', 'cell-b', 'cell-a']

  it('reads one value per overview row, joining the rows once', async () => {
    const source = fakeSource({ kind: 'read', bytes: 0 })
    const reader = new GeneRowReader(source, overview)

    await expect(reader.read('CD3E')).resolves.toEqual(
      new Float32Array([4, Number.NaN, 0, 1.5]),
    )
    await reader.read('CD3E')
    expect(source.geneValuesRowIds).toHaveBeenCalledTimes(1)
  })

  it.each([
    { bytes: 32 * MIB, allowLarge: false, outcome: 'read' },
    { bytes: 32 * MIB + 1, allowLarge: false, outcome: GeneReadTooLarge },
    { bytes: 120 * MIB, allowLarge: true, outcome: 'read' },
    { bytes: 256 * MIB, allowLarge: true, outcome: 'read' },
    { bytes: 256 * MIB + 1, allowLarge: false, outcome: GeneReadRefused },
    { bytes: 300 * MIB, allowLarge: true, outcome: GeneReadRefused },
  ] as const)(
    'keeps the Plots budget: $bytes bytes, allowLarge $allowLarge',
    async ({ bytes, allowLarge, outcome }) => {
      const source = fakeSource({ kind: 'read', bytes })
      const read = new GeneRowReader(source, overview).read('CD3E', { allowLarge })

      if (outcome === 'read') {
        await expect(read).resolves.toHaveLength(4)
      } else {
        await expect(read).rejects.toBeInstanceOf(outcome)
        expect(source.geneValues).not.toHaveBeenCalled()
      }
    },
  )

  it('says how to read a large gene anyway, with its layer', async () => {
    const reader = new GeneRowReader(
      fakeSource({ kind: 'read', bytes: 120 * MIB }),
      overview,
    )

    const error = await reader.read('CD3E', { layer: 'counts' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GeneReadTooLarge)
    expect(error).toMatchObject({
      name: 'GeneReadTooLarge',
      bytes: 120 * MIB,
      message:
        'Reading CD3E from layer "counts" would read about 120 MiB. Call cells.gene("CD3E", layer="counts", allow_large=True) to read it anyway.',
    })
    await expect(
      new GeneRowReader(fakeSource({ kind: 'read', bytes: 512 * MIB }), overview).read(
        'CD3E',
      ),
    ).rejects.toMatchObject({
      name: 'GeneReadRefused',
      message:
        'Reading CD3E would read about 512 MiB, over the 256 MiB limit Plots also keeps.',
    })
  })

  it("passes on the source's errors", async () => {
    await expect(
      new GeneRowReader(fakeSource({ kind: 'read', bytes: 0 }), overview).read('Nope'),
    ).rejects.toThrow('Nope is not in the expression matrix.')
    await expect(
      new GeneRowReader(
        fakeSource({ kind: 'unavailable', reason: 'This store has no table.' }),
        overview,
      ).read('CD3E'),
    ).rejects.toThrow('This store has no table.')
  })

  it('passes the layer to the source, and lists its layers', async () => {
    const estimate = vi.fn(async () => ({ kind: 'read', bytes: 0 }) as const)
    const source = fakeSource(
      { kind: 'read', bytes: 0 },
      {
        estimateGeneValuesRead: estimate,
        geneValuesLayers: async () => ['counts', 'raw'],
      },
    )
    const reader = new GeneRowReader(source, overview)

    await reader.read('CD3E', { layer: 'raw' })

    expect(estimate).toHaveBeenCalledWith(['CD3E'], { layer: 'raw' })
    expect(source.geneValues).toHaveBeenCalledWith(['CD3E'], {
      signal: undefined,
      layer: 'raw',
    })
    await expect(reader.layers()).resolves.toEqual(['counts', 'raw'])
    await expect(
      new GeneRowReader(fakeSource({ kind: 'read', bytes: 0 }), overview).layers(),
    ).resolves.toEqual([])
  })
})
