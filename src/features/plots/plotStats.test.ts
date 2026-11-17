import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { intToCellId } from '../../data/cellid'
import type { GeneValues } from '../../data/geneValues'
import {
  plotGroupMean,
  plotGroupPercentExpressing,
  PlotStatsStore,
  type PlotGroupStats,
} from './plotStats'

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

function gene(name: string, entries: readonly (readonly [number, number])[]): GeneValues {
  return {
    gene: name,
    rows: new Uint32Array(entries.map(([row]) => row)),
    values: new Float32Array(entries.map(([, value]) => value)),
  }
}

function storeWith(...genes: GeneValues[]): PlotStatsStore {
  const store = new PlotStatsStore()
  store.setRows(ROWS)
  for (const values of genes) store.addGene(values)
  return store
}

describe('plot statistics (plan 22-B, 22-C)', () => {
  it('counts zeros from the group size and sums only stored values', () => {
    const store = storeWith(
      gene('Actb', [
        [0, 3],
        [2, 1],
        [4, 7],
      ]),
    )
    const summary = store.setGroups({
      classes: [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
      ],
      selection: null,
    })
    const { stats, missing } = store.stats(['Actb'])
    const [first, second] = stats[0]?.groups ?? []

    expect(summary).toEqual({
      classSizes: [3, 3],
      selectionSize: 0,
      unmatchedIds: 0,
      repeatedCells: 0,
    })
    expect(missing).toEqual([])
    expect(first).toMatchObject({ cells: 3, expressing: 2, sum: 4 })
    expect(second).toMatchObject({ cells: 3, expressing: 1, sum: 7 })
    expect(plotGroupMean(first as PlotGroupStats, 'stored')).toBeCloseTo(4 / 3)
    expect(plotGroupMean(first as PlotGroupStats, 'log1p')).toBeCloseTo(
      (Math.log1p(3) + Math.log1p(1)) / 3,
    )
    expect(plotGroupPercentExpressing(first as PlotGroupStats)).toBeCloseTo(200 / 3)
    expect(stats[0]).toMatchObject({ wholeNumbers: true, negative: false })
  })

  it('puts the selection first, overlapping the classes', () => {
    const store = storeWith(
      gene('Actb', [
        [1, 2],
        [3, 4],
      ]),
    )
    const summary = store.setGroups({
      classes: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      selection: ['b', 'c', 'zz'],
    })
    const groups = store.stats(['Actb']).stats[0]?.groups ?? []

    expect(summary.selectionSize).toBe(2)
    expect(summary.unmatchedIds).toBe(1)
    expect(groups.map((group) => [group.cells, group.sum])).toEqual([
      [2, 2],
      [2, 2],
      [2, 4],
    ])
  })

  it('counts a cell in every class that lists it, and a repeated ID once', () => {
    const store = storeWith(gene('Actb', [[0, 5]]))
    const summary = store.setGroups({
      classes: [['a', 'a', 'b'], ['a'], ['missing']],
      selection: null,
    })
    const groups = store.stats(['Actb']).stats[0]?.groups ?? []

    expect(summary).toMatchObject({
      classSizes: [2, 1, 0],
      unmatchedIds: 1,
      repeatedCells: 1,
    })
    expect(groups.map((group) => group.sum)).toEqual([5, 5, 0])
    // An empty group has no mean and no share, rather than NaN.
    expect(plotGroupMean(groups[2] as PlotGroupStats, 'stored')).toBeNull()
    expect(plotGroupPercentExpressing(groups[2] as PlotGroupStats)).toBeNull()
  })

  it('reports negative and fractional values, and turns log1p off below -1', () => {
    const store = storeWith(
      gene('Scaled', [
        [0, -1.5],
        [1, 0.25],
      ]),
    )
    store.setGroups({ classes: [['a', 'b']], selection: null })
    const stats = store.stats(['Scaled']).stats[0]

    expect(stats).toMatchObject({ wholeNumbers: false, negative: true })
    expect(plotGroupMean(stats?.groups[0] as PlotGroupStats, 'log1p')).toBeNull()
    expect(plotGroupMean(stats?.groups[0] as PlotGroupStats, 'stored')).toBeCloseTo(
      -0.625,
    )
    expect(stats?.groups[0]?.expressing).toBe(1)
  })

  it('lists genes it does not hold, and evicts the least recently used', () => {
    // Each gene below is 2 entries, 16 bytes.
    const store = new PlotStatsStore({ maxGeneBytes: 40 })
    store.setRows(ROWS)
    store.setGroups({ classes: [ROWS], selection: null })
    store.addGene(
      gene('A', [
        [0, 1],
        [1, 1],
      ]),
    )
    store.addGene(
      gene('B', [
        [0, 1],
        [1, 1],
      ]),
    )
    store.stats(['A'])
    store.addGene(
      gene('C', [
        [0, 1],
        [1, 1],
      ]),
    )

    expect(store.stats(['A', 'B', 'C']).missing).toEqual(['B'])
    expect(store.hasGene('A')).toBe(true)
  })

  it('joins classes to Xenium rows given as integer pairs', () => {
    const store = new PlotStatsStore()
    // Three rows, three integers each, as cell_features/cell_id may hold.
    store.setRows({
      kind: 'xenium',
      pairs: new Uint32Array([1, 1, 0, 2, 1, 0, 3, 1, 0]),
      stride: 3,
      count: 3,
    })
    store.addGene(gene('Actb', [[2, 5]]))

    const summary = store.setGroups({
      classes: [[intToCellId(3, 1), intToCellId(1, 1), 'aaaaaaaa-9']],
      selection: null,
    })

    expect(summary).toMatchObject({ classSizes: [2], unmatchedIds: 1 })
    expect(store.stats(['Actb']).stats[0]?.groups[0]).toMatchObject({
      cells: 2,
      sum: 5,
    })
  })

  it('needs groups before stats, and forgets genes for another dataset', () => {
    const store = storeWith(gene('A', [[0, 1]]))

    expect(() => store.stats(['A'])).toThrow('Plot groups are not set.')
    store.setRows(['x'])
    store.setGroups({ classes: [['x']], selection: null })
    expect(store.stats(['A']).missing).toEqual(['A'])
  })

  it('matches a dense computation for any values and groups', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 40 })), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.array(fc.integer({ min: -1, max: 3 }), { minLength: 30, maxLength: 30 }),
        (values, classOfRow) => {
          const rowIds = values.map((_, row) => `cell-${row}`)
          const classes = [0, 1, 2, 3].map((classIndex) =>
            rowIds.filter((_, row) => classOfRow[row] === classIndex),
          )
          const store = new PlotStatsStore()
          store.setRows(rowIds)
          store.setGroups({ classes, selection: null })
          store.addGene(
            gene(
              'G',
              values.flatMap((value, row) =>
                value === 0 ? [] : [[row, value] as const],
              ),
            ),
          )
          const groups = store.stats(['G']).stats[0]?.groups ?? []

          classes.forEach((cellIds, classIndex) => {
            const members = values.filter((_, row) => classOfRow[row] === classIndex)
            const group = groups[classIndex] as PlotGroupStats
            const percent = plotGroupPercentExpressing(group)

            expect(group.cells).toBe(cellIds.length)
            if (members.length === 0) {
              expect(plotGroupMean(group, 'log1p')).toBeNull()
              return
            }
            expect(plotGroupMean(group, 'log1p')).toBeCloseTo(
              members.reduce((sum, value) => sum + Math.log1p(value), 0) / members.length,
            )
            expect(percent).toBeGreaterThanOrEqual(0)
            expect(percent).toBeLessThanOrEqual(100)
          })
        },
      ),
      { numRuns: 80 },
    )
  })
})
