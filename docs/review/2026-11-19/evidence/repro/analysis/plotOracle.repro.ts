// ANA review: an independent oracle for the Plots panel's numbers (plan 22-B,
// 22-C) on a tiny dataset whose answers can be checked by hand, and the
// agreement of the CSV export and the panel's tables with them.
//
// The oracle below is plain TypeScript written for this review: dense
// per-cell values, explicit group membership, numpy-style linear quantiles.
// It imports nothing from src/ for its expected values.
//
// Run:
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/analysis/plotOracle.repro.ts
import { describe, expect, it } from 'vitest'
import type { GeneValues } from '../../../../../../src/data/geneValues'
import {
  meansPlotTable,
  dotPlotModel,
} from '../../../../../../src/features/plots/dotPlot'
import { plotStatsCsv } from '../../../../../../src/features/plots/plotExport'
import type { PlotGene } from '../../../../../../src/features/plots/plotModel'
import { PlotStatsStore } from '../../../../../../src/features/plots/plotStats'
import {
  violinPlotModel,
  violinPlotTable,
} from '../../../../../../src/features/plots/violinPlot'

// ---- The dataset -----------------------------------------------------------
// 8 cells, rows r0..r7.
const ROWS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']
// Dense values per row (0 = not stored).
const DENSE: Record<string, readonly number[]> = {
  // counts
  A: [1, 3, 0, 2, 0, 7, 0, 1],
  // scaled, with negatives
  B: [-0.5, 1.5, 0, 0, -2, 0, 0, 0],
}
// Groups: the selection first, then classes in order. K2 lists r5 twice,
// K3 is empty, K4 names an ID with no row. r3 is in K1 and K2.
const SELECTION = ['r1', 'r5', 'r7', 'zz']
const CLASSES: Record<string, readonly string[]> = {
  K1: ['r0', 'r1', 'r2', 'r3'],
  K2: ['r3', 'r4', 'r5', 'r5'],
  K3: [],
  K4: ['r6', 'missing'],
}

// ---- The oracle ------------------------------------------------------------
function members(ids: readonly string[]): number[] {
  return [...new Set(ids)].flatMap((id) => {
    const row = ROWS.indexOf(id)
    return row < 0 ? [] : [row]
  })
}

function quantile(sorted: readonly number[], share: number): number {
  const position = (sorted.length - 1) * share
  const below = Math.floor(position)
  const low = sorted[below] as number
  const high = sorted[Math.min(below + 1, sorted.length - 1)] as number
  return low + (position - below) * (high - low)
}

interface Expected {
  cells: number
  expressing: number
  mean: number | null
  meanLog1p: number | null
  median: number | null
  q1: number | null
  q3: number | null
  min: number | null
  max: number | null
  medianExpressing: number | null
}

function oracle(gene: string, ids: readonly string[]): Expected {
  const rows = members(ids)
  const values = rows.map((row) => DENSE[gene]?.[row] ?? 0)
  const sorted = [...values].sort((a, b) => a - b)
  const expressing = sorted.filter((value) => value > 0)
  const empty = values.length === 0
  return {
    cells: values.length,
    expressing: expressing.length,
    mean: empty ? null : values.reduce((s, v) => s + v, 0) / values.length,
    meanLog1p: empty
      ? null
      : values.reduce((s, v) => s + Math.log1p(v), 0) / values.length,
    median: empty ? null : quantile(sorted, 0.5),
    q1: empty ? null : quantile(sorted, 0.25),
    q3: empty ? null : quantile(sorted, 0.75),
    min: empty ? null : (sorted[0] as number),
    max: empty ? null : (sorted.at(-1) as number),
    medianExpressing: expressing.length === 0 ? null : quantile(expressing, 0.5),
  }
}

function sparse(gene: string): GeneValues {
  const entries = (DENSE[gene] ?? []).flatMap((value, row) =>
    value === 0 ? [] : [[row, value] as const],
  )
  return {
    gene,
    rows: Uint32Array.from(entries, ([row]) => row),
    values: Float32Array.from(entries, ([, value]) => value),
  }
}

// Minimal RFC 4180 reader for the exported CSV.
function readCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const GROUPS = [
  { id: 'selection', label: 'ROI 1', color: '#ff0000', kind: 'selection' as const },
  ...Object.keys(CLASSES).map((label) => ({
    id: label,
    label,
    color: '#00ff00',
    kind: 'class' as const,
  })),
]
const GROUP_IDS: readonly (readonly string[])[] = [SELECTION, ...Object.values(CLASSES)]

function computed() {
  const store = new PlotStatsStore()
  store.setRows(ROWS)
  const summary = store.setGroups({
    classes: Object.values(CLASSES),
    selection: SELECTION,
  })
  store.addGene(sparse('A'))
  store.addGene(sparse('B'))
  return { summary, result: store.stats(['A', 'B']) }
}

describe('ANA: Plots numbers against an independent oracle', () => {
  it('counts groups, unmatched IDs and repeated cells as the oracle does', () => {
    const { summary } = computed()
    // Hand count: selection {r1,r5,r7}, K1 4, K2 {r3,r4,r5}, K3 0, K4 {r6}.
    expect(summary.selectionSize).toBe(3)
    expect(summary.classSizes).toEqual([4, 3, 0, 1])
    // 'zz' and 'missing'.
    expect(summary.unmatchedIds).toBe(2)
    // r3 is in K1 and K2.
    expect(summary.repeatedCells).toBe(1)
  })

  it('matches the oracle for every group on both scales, and the CSV says the same', () => {
    const { result } = computed()
    const genes: PlotGene[] = result.stats.map((stats) => ({ gene: stats.gene, stats }))

    for (const stats of result.stats) {
      stats.groups.forEach((group, index) => {
        const expected = oracle(stats.gene, GROUP_IDS[index] as readonly string[])
        expect(group.cells).toBe(expected.cells)
        expect(group.expressing).toBe(expected.expressing)
        if (expected.mean === null) {
          expect(group.cells).toBe(0)
        } else {
          expect(group.sum / group.cells).toBeCloseTo(expected.mean, 6)
        }
        const all = stats.distributions.stored.all[index] ?? null
        if (expected.median === null) expect(all).toBeNull()
        else {
          expect(all?.median).toBeCloseTo(expected.median, 6)
          expect(all?.q1).toBeCloseTo(expected.q1 as number, 6)
          expect(all?.q3).toBeCloseTo(expected.q3 as number, 6)
          expect(all?.min).toBeCloseTo(expected.min as number, 6)
          expect(all?.max).toBeCloseTo(expected.max as number, 6)
        }
        const expressing = stats.distributions.stored.expressing[index] ?? null
        if (expected.medianExpressing === null) expect(expressing).toBeNull()
        else expect(expressing?.median).toBeCloseTo(expected.medianExpressing, 6)
      })
    }

    // B has negatives, so log1p is off for it.
    expect(result.stats[1]?.negative).toBe(true)
    expect(result.stats[1]?.distributions.log1p).toBeNull()

    // CSV on the stored scale, compared with the oracle row by row.
    const csv = readCsv(
      plotStatsCsv({
        setLabel: 'set',
        groups: GROUPS,
        genes,
        scale: 'stored',
        valueLabel: 'X',
      }),
    )
    const header = csv[0] as string[]
    const column = (row: string[], name: string) => row[header.indexOf(name)] ?? ''
    const body = csv.slice(1).filter((row) => row.length > 1)
    expect(body).toHaveLength(2 * GROUPS.length)
    for (const row of body) {
      const gene = column(row, 'gene')
      const index = GROUPS.findIndex((group) => group.label === column(row, 'group'))
      const expected = oracle(gene, GROUP_IDS[index] as readonly string[])
      expect(Number(column(row, 'cells'))).toBe(expected.cells)
      expect(Number(column(row, 'cells_expressing'))).toBe(expected.expressing)
      const num = (name: string) =>
        column(row, name) === '' ? null : Number(column(row, name))
      for (const [name, value] of [
        ['mean', expected.mean],
        ['median', expected.median],
        ['q1', expected.q1],
        ['q3', expected.q3],
        ['min', expected.min],
        ['max', expected.max],
        ['median_expressing', expected.medianExpressing],
      ] as const) {
        if (value === null) expect(num(name)).toBeNull()
        else expect(num(name)).toBeCloseTo(value, 4)
      }
      // The selection row has no set name; classes do.
      expect(column(row, 'set')).toBe(index === 0 ? '' : 'set')
    }

    // CSV on log1p for the counts gene A.
    const log1pCsv = readCsv(
      plotStatsCsv({
        setLabel: 'set',
        groups: GROUPS,
        genes: genes.slice(0, 1),
        scale: 'log1p',
        valueLabel: 'log1p(counts)',
      }),
    )
    for (const row of log1pCsv.slice(1).filter((r) => r.length > 1)) {
      const index = GROUPS.findIndex((group) => group.label === row[1])
      const expected = oracle('A', GROUP_IDS[index] as readonly string[])
      const mean = row[log1pCsv[0]?.indexOf('mean') ?? -1] ?? ''
      if (expected.meanLog1p === null) expect(mean).toBe('')
      else expect(Number(mean)).toBeCloseTo(expected.meanLog1p, 4)
    }
  })

  it('shows the same means and medians in Show numbers as in the CSV', () => {
    const { result } = computed()
    const genes: PlotGene[] = result.stats.map((stats) => ({ gene: stats.gene, stats }))
    const input = {
      groups: GROUPS,
      genes,
      scale: 'stored' as const,
      valueLabel: 'X',
      setLabel: 'set',
    }
    const table = meansPlotTable(
      dotPlotModel({ ...input, colour: 'shared', colorScale: 'plasma' }),
    )
    const violin = violinPlotTable(violinPlotModel({ ...input, includeZeros: true }))
    // K1 x A: mean (1+3+0+2)/4 = 1.5, median of [0,1,2,3] = 1.5.
    const k1a = table.rows.find((row) => row.group === 'K1' && row.values[0] === 'A')
    expect(k1a?.values).toEqual(['A', '4', '75%', '1.5'])
    const k1aViolin = violin.rows.find(
      (row) => row.group === 'K1' && row.values[0] === 'A',
    )
    expect(k1aViolin?.values.slice(3)).toEqual(['1.5', '0.75', '2.25'])
    // K3 is empty: no mean, no median.
    const k3 = table.rows.find((row) => row.group === 'K3' && row.values[0] === 'A')
    expect(k3?.values).toEqual(['A', '0', '–', '–'])
  })

  it('records what a stored NaN does (dense X with missing values)', () => {
    const store = new PlotStatsStore()
    store.setRows(['a', 'b', 'c', 'd'])
    store.setGroups({ classes: [['a', 'b', 'c', 'd']], selection: null })
    store.addGene({
      gene: 'N',
      rows: Uint32Array.of(0, 1, 2),
      values: Float32Array.of(Number.NaN, 2, 4),
    })
    const stats = store.stats(['N']).stats[0]
    const group = stats?.groups[0]
    const all = stats?.distributions.stored.all[0]
    // Observed, recorded for the notes: the mean is NaN (shown as "–"), the
    // NaN sorts last and is taken as the maximum, and the gene's value axis
    // ends at NaN.
    const observed = {
      sum: group?.sum,
      expressing: group?.expressing,
      median: all?.median,
      max: all?.max,
      high: stats?.distributions.stored.high,
      densityFinite: [...(all?.density ?? [])].every(Number.isFinite),
    }
    console.log('NaN case', JSON.stringify(observed))
    expect(Number.isNaN(observed.sum)).toBe(true)
    expect(Number.isNaN(observed.max)).toBe(true)
    expect(Number.isNaN(observed.high)).toBe(true)
  })
})
