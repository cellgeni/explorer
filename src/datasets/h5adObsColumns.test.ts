import { describe, expect, it } from 'vitest'
import { AnnDataH5adDataset } from './h5adDataset'
import type { AnnDataMemoryColumn } from './annDataMemory'

// The obs columns of a table as O15 reads them: string columns' distinct
// values counted with few hashes, and number columns kept as typed arrays.

const ROWS = 10_050

function memoryDataset(obs: readonly AnnDataMemoryColumn[]): AnnDataH5adDataset {
  const obsNames = Array.from({ length: ROWS }, (_value, row) => `cell-${row}`)

  return new AnnDataH5adDataset({
    url: 'memory://obs-columns',
    memorySource: {
      label: 'Memory table',
      load: async () => ({
        obsNames,
        obs,
        varNames: ['A'],
        X: {
          kind: 'csr' as const,
          data: new Float32Array(0),
          indices: new Int32Array(0),
          indptr: new Int32Array(ROWS + 1),
        },
        obsm: {
          spatial: {
            values: Float32Array.from({ length: ROWS * 2 }, (_value, index) => index),
            columns: 2,
          },
        },
      }),
    },
  })
}

describe('H5AD obs columns (O15)', () => {
  it('counts the distinct values of string columns, up to the limit', async () => {
    const dataset = memoryDataset([
      // More values than are compared one by one, in no order.
      {
        name: 'method',
        kind: 'string',
        values: Array.from({ length: ROWS }, (_value, row) => `m${(row * 7) % 20}`),
      },
      // Empty labels are not values.
      {
        name: 'slide',
        kind: 'string',
        values: Array.from({ length: ROWS }, (_value, row) =>
          row % 3 === 0 ? '' : 's1',
        ),
      },
      {
        name: 'barcode',
        kind: 'string',
        values: Array.from({ length: ROWS }, (_value, row) => `b${row}`),
      },
    ])
    const counts = Object.fromEntries(
      (await dataset.annotationGroups()).map((group) => [group.label, group.groupCount]),
    )

    expect(counts).toEqual({ method: 20, slide: 1, barcode: 10_001 })
  })

  it('keeps number columns as typed arrays with the same values', async () => {
    const area = Float64Array.from({ length: ROWS }, (_value, row) => row / 4)
    const dataset = memoryDataset([
      { name: 'area', kind: 'numeric', values: area },
      {
        name: 'count',
        kind: 'numeric',
        values: BigInt64Array.from({ length: ROWS }, (_value, row) => BigInt(row % 5)),
      },
      {
        name: 'score',
        kind: 'numeric',
        values: Float32Array.from({ length: ROWS }, (_value, row) => row / 3),
      },
      { name: 'none', kind: 'numeric', values: new Float64Array(ROWS).fill(Number.NaN) },
    ])

    const areaColumn = await dataset.numericObsColumn('area')
    expect(areaColumn).toBeInstanceOf(Float64Array)
    expect(Array.from(areaColumn ?? [])).toEqual(Array.from(area))
    expect(Array.from((await dataset.numericObsColumn('count')) ?? [])).toEqual(
      Array.from({ length: ROWS }, (_value, row) => row % 5),
    )
    expect(Array.from((await dataset.numericObsColumn('score')) ?? [])).toEqual(
      Array.from(Float32Array.from({ length: ROWS }, (_value, row) => row / 3)),
    )
    // A column with no finite value is not a track.
    await expect(dataset.numericObsColumn('none')).resolves.toBeNull()
    expect(
      (await dataset.metadataTracks()).map((track) => [
        track.label,
        track.min,
        track.max,
      ]),
    ).toEqual([
      ['area', 0, (ROWS - 1) / 4],
      ['count', 0, 4],
      ['score', 0, Math.fround((ROWS - 1) / 3)],
    ])
  })
})
