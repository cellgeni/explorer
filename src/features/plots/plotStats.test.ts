import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { intToCellId } from '../../data/cellid'
import type { GeneValues } from '../../data/geneValues'
import {
  PLOT_DENSITY_MAX_GROUPS,
  PLOT_DENSITY_STEPS,
  plotGroupMean,
  plotGroupPercentExpressing,
  PlotStatsStore,
  type PlotDistribution,
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

  it("leaves a non-finite value and its cell out of the gene's numbers", () => {
    const store = storeWith(
      gene('N', [
        [0, Number.NaN],
        [1, 2],
        [2, 4],
        [3, Number.POSITIVE_INFINITY],
      ]),
    )
    store.setGroups({ classes: [['a', 'b', 'c', 'd', 'e']], selection: null })
    const stats = store.stats(['N']).stats[0]
    const group = stats?.groups[0] as PlotGroupStats
    const all = stats?.distributions.stored.all[0]

    // b, c and e: 2, 4 and an unstored 0.
    expect(stats).toMatchObject({ nonFinite: 2, wholeNumbers: true, negative: false })
    expect(group).toMatchObject({ cells: 3, expressing: 2, sum: 6 })
    expect(plotGroupMean(group, 'stored')).toBe(2)
    expect(plotGroupMean(group, 'log1p')).toBeCloseTo((Math.log(3) + Math.log(5)) / 3)
    expect(all).toMatchObject({ count: 3, min: 0, median: 2, max: 4 })
    expect(stats?.distributions.stored).toMatchObject({ low: 0, high: 4 })
    expect([...(all?.density ?? [])].every(Number.isFinite)).toBe(true)
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

  it('gives quartiles with the zeros counted, and of expressing cells only', () => {
    const store = storeWith(
      gene('Actb', [
        [0, 3],
        [2, 1],
        [4, 7],
      ]),
    )
    store.setGroups({ classes: [ROWS], selection: null })
    const stored = store.stats(['Actb']).stats[0]?.distributions.stored

    // Every cell: 0, 0, 0, 1, 3, 7.
    expect(stored).toMatchObject({ low: 0, high: 7 })
    expect(stored?.all[0]).toMatchObject({
      count: 6,
      min: 0,
      q1: 0,
      median: 0.5,
      q3: 2.5,
      max: 7,
    })
    // Expressing cells: 1, 3, 7.
    expect(stored?.expressing[0]).toMatchObject({
      count: 3,
      min: 1,
      q1: 2,
      median: 3,
      q3: 5,
      max: 7,
    })
  })

  it('has no distribution for an empty group, and no log1p below 0', () => {
    const store = storeWith(
      gene('Scaled', [
        [0, -2],
        [1, 0.5],
      ]),
    )
    store.setGroups({ classes: [['a', 'b', 'c'], ['missing']], selection: null })
    const { distributions } = store.stats(['Scaled']).stats[0] ?? {}

    expect(distributions?.log1p).toBeNull()
    // Negative values come before the zero of the cell that stores none.
    expect(distributions?.stored.all[0]).toMatchObject({ min: -2, median: 0, max: 0.5 })
    expect(distributions?.stored.all[1]).toBeNull()
    expect(distributions?.stored.expressing[1]).toBeNull()
  })

  it('makes densities only for as many groups as a violin shows', () => {
    const rows = Array.from(
      { length: PLOT_DENSITY_MAX_GROUPS + 1 },
      (_, row) => `r${row}`,
    )
    const store = new PlotStatsStore()
    store.setRows(rows)
    store.addGene(gene('Actb', [[0, 2]]))

    store.setGroups({ classes: rows.slice(1).map((id) => [id]), selection: null })
    expect(
      store.stats(['Actb']).stats[0]?.distributions.stored.all[0]?.density,
    ).toHaveLength(PLOT_DENSITY_STEPS)

    store.setGroups({ classes: rows.map((id) => [id]), selection: null })
    const many = store.stats(['Actb']).stats[0]?.distributions.stored
    expect(many?.all[0]).toMatchObject({ median: 2, density: null })
  })

  it('matches dense quartiles, and densities sum to 1, for any values and groups', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant(0),
            fc.integer({ min: 1, max: 40 }),
            fc.float({ min: -5, max: 5, noNaN: true }).map(Math.fround),
          ),
          { minLength: 1, maxLength: 40 },
        ),
        fc.array(fc.integer({ min: -1, max: 3 }), { minLength: 40, maxLength: 40 }),
        fc.boolean(),
        (values, classOfRow, withSelection) => {
          const rowIds = values.map((_, row) => `cell-${row}`)
          const classes = [0, 1, 2, 3].map((classIndex) =>
            rowIds.filter((_, row) => classOfRow[row] === classIndex),
          )
          const selection = withSelection
            ? rowIds.filter((_, row) => row % 3 === 0)
            : null
          const store = new PlotStatsStore()
          store.setRows(rowIds)
          store.setGroups({ classes, selection })
          store.addGene(
            gene(
              'G',
              values.flatMap((value, row) =>
                value === 0 ? [] : [[row, value] as const],
              ),
            ),
          )
          const stats = store.stats(['G']).stats[0]
          const memberLists = [
            ...(selection === null ? [] : [values.filter((_, row) => row % 3 === 0)]),
            ...classes.map((_, classIndex) =>
              values.filter((_, row) => classOfRow[row] === classIndex),
            ),
          ]
          const negative = values.some((value) => value < 0)

          expect(stats?.distributions.log1p === null).toBe(negative)

          for (const [scale, transform] of [
            ['stored', (value: number) => value],
            ['log1p', Math.log1p],
          ] as const) {
            const distributions = stats?.distributions[scale]
            if (distributions === null || distributions === undefined) continue

            memberLists.forEach((members, group) => {
              const every = members.map(transform).sort((a, b) => a - b)
              const expressing = members
                .filter((value) => value > 0)
                .map(transform)
                .sort((a, b) => a - b)
              expectDistribution(distributions.all[group] ?? null, every)
              expectDistribution(distributions.expressing[group] ?? null, expressing)
            })
          }
        },
      ),
      { numRuns: 80 },
    )
  })
})

function denseQuantile(sorted: readonly number[], share: number): number {
  const position = (sorted.length - 1) * share
  const below = Math.floor(position)
  const value = sorted[below] ?? 0
  return value + (position - below) * ((sorted[below + 1] ?? value) - value)
}

function expectDistribution(
  distribution: PlotDistribution | null,
  sorted: readonly number[],
): void {
  if (sorted.length === 0) {
    expect(distribution).toBeNull()
    return
  }

  expect(distribution?.count).toBe(sorted.length)
  expect(distribution?.min).toBeCloseTo(sorted[0] ?? 0, 5)
  expect(distribution?.q1).toBeCloseTo(denseQuantile(sorted, 0.25), 5)
  expect(distribution?.median).toBeCloseTo(denseQuantile(sorted, 0.5), 5)
  expect(distribution?.q3).toBeCloseTo(denseQuantile(sorted, 0.75), 5)
  expect(distribution?.max).toBeCloseTo(sorted.at(-1) ?? 0, 5)

  const density = distribution?.density ?? new Float32Array()
  expect(density).toHaveLength(PLOT_DENSITY_STEPS)
  expect(density.every((value) => value >= 0 && Number.isFinite(value))).toBe(true)
  expect(density.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 4)
}
