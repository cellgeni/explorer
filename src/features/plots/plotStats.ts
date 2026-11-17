import { xeniumCellIdText } from '../../data/cellid'
import type { GeneValues, GeneValuesRowIds } from '../../data/geneValues'

// The numbers behind the plots (plan 22-B, 22-C), computed where the gene
// values are: in the plot worker, or on this thread without one. Groups are
// joined to genes by matrix row. A class lists its cells by ID; each ID is
// mapped to its row once, when the classes are given. A gene's stored values
// are added to the groups of their rows, and every other cell of a group
// counts as a 0 (22-D5), so the numbers are exact and cost one pass over the
// gene's stored values.

export interface PlotGroupsInput {
  // Each class's cells by ID, in the order the plot shows the classes.
  readonly classes: readonly (readonly string[])[]
  // The active selection's cells, an extra group that overlaps the classes
  // (22-D3), or null without one.
  readonly selection: readonly string[] | null
}

export interface PlotGroupsSummary {
  // Cells matched to a row, per class.
  readonly classSizes: readonly number[]
  readonly selectionSize: number
  // IDs listed by a class or the selection that match no row.
  readonly unmatchedIds: number
  // Cells listed by two or more classes, counted in each.
  readonly repeatedCells: number
}

// One group's sums for a gene; means and shares are taken from them.
export interface PlotGroupStats {
  readonly cells: number
  // Cells with a stored value above 0.
  readonly expressing: number
  readonly sum: number
  // Sum of log1p of the values; NaN when a value is -1 or less.
  readonly sumLog1p: number
}

// The spread of one group's values on one scale (22-C), for the violin
// (22-F) and the CSV. Quartiles are interpolated between values, as numpy's
// default is, on the scale shown.
export interface PlotDistribution {
  // The values it describes: the group's cells, or its expressing cells.
  readonly count: number
  readonly min: number
  readonly q1: number
  readonly median: number
  readonly q3: number
  readonly max: number
  // A smoothed histogram on the gene's grid, summing to 1; null when there
  // are more groups than PLOT_DENSITY_MAX_GROUPS.
  readonly density: Float32Array | null
}

// A gene's distributions on one scale.
export interface PlotScaleDistributions {
  // The grid every density of the gene is on: PLOT_DENSITY_STEPS points from
  // its lowest value to its highest, 0 included when a cell holds none.
  readonly low: number
  readonly high: number
  // Per group, null when it has no such cells: every cell, zeros counted,
  // and the cells with a value above 0 (Include zeros off, 22-F).
  readonly all: readonly (PlotDistribution | null)[]
  readonly expressing: readonly (PlotDistribution | null)[]
}

export interface PlotGeneStats {
  readonly gene: string
  // The selection first when there is one, then the classes in order.
  readonly groups: readonly PlotGroupStats[]
  // Every stored value is a whole number, as counts are (22-D4).
  readonly wholeNumbers: boolean
  // Some stored value is below 0, as in a scaled matrix.
  readonly negative: boolean
  // log1p is null when a value is below 0, where the panel turns it off.
  readonly distributions: {
    readonly stored: PlotScaleDistributions
    readonly log1p: PlotScaleDistributions | null
  }
}

export interface PlotStatsResult {
  readonly stats: readonly PlotGeneStats[]
  // Genes asked for whose values are not held: never given, or evicted.
  readonly missing: readonly string[]
}

const NO_CLASS = 0xffff
// Codes are 16 bits, with one value kept for "no class"; the panel shows
// at most a few hundred classes (22-D2).
export const PLOT_MAX_CLASSES = NO_CLASS - 1
// Gene values kept for reuse, by their bytes (22-D12).
export const PLOT_GENE_CACHE_BYTES = 128 * 1024 * 1024
// Densities are on this many points of a gene's range (22-C).
export const PLOT_DENSITY_STEPS = 128
// Densities are made for up to this many groups: the violin's classes and
// the selection. The heatmap, which shows more classes, needs none.
export const PLOT_DENSITY_MAX_GROUPS = 64

interface PlotGroups {
  // Each row's first class, or NO_CLASS.
  readonly codes: Uint16Array
  // Rows in more than one class: their further classes.
  readonly extraClasses: ReadonlyMap<number, readonly number[]>
  // 1 for rows in the selection; null without one.
  readonly selection: Uint8Array | null
  readonly summary: PlotGroupsSummary
}

export class PlotStatsStore {
  private rowById: ReadonlyMap<string, number> = new Map()
  private rowCount = 0
  private groups: PlotGroups | null = null
  // Insertion order is use order, oldest first.
  private readonly genes = new Map<string, GeneValues>()
  private geneBytes = 0
  private readonly maxGeneBytes: number

  constructor(options: { readonly maxGeneBytes?: number } = {}) {
    this.maxGeneBytes = options.maxGeneBytes ?? PLOT_GENE_CACHE_BYTES
  }

  // The dataset's matrix rows by cell ID. Another dataset drops the groups
  // and the genes.
  setRows(rowIds: GeneValuesRowIds): void {
    const rowById = new Map<string, number>()
    const rowCount = 'kind' in rowIds ? rowIds.count : rowIds.length
    const idAt =
      'kind' in rowIds
        ? (row: number) =>
            xeniumCellIdText(
              rowIds.pairs[row * rowIds.stride] ?? 0,
              rowIds.pairs[row * rowIds.stride + 1] ?? 0,
            )
        : (row: number) => rowIds[row] ?? ''

    for (let row = 0; row < rowCount; row += 1) {
      const id = idAt(row)
      if (!rowById.has(id)) rowById.set(id, row)
    }

    this.rowById = rowById
    this.rowCount = rowCount
    this.groups = null
    this.genes.clear()
    this.geneBytes = 0
  }

  setGroups(input: PlotGroupsInput): PlotGroupsSummary {
    if (input.classes.length > PLOT_MAX_CLASSES) {
      throw new Error(`Plots group by at most ${PLOT_MAX_CLASSES} classes.`)
    }

    const codes = new Uint16Array(this.rowCount).fill(NO_CLASS)
    const extraClasses = new Map<number, number[]>()
    const classSizes = input.classes.map(() => 0)
    let unmatchedIds = 0

    input.classes.forEach((cellIds, classIndex) => {
      for (const id of cellIds) {
        const row = this.rowById.get(id)

        if (row === undefined) {
          unmatchedIds += 1
          continue
        }

        const first = codes[row] ?? NO_CLASS

        if (first === NO_CLASS) {
          codes[row] = classIndex
        } else {
          // A class listing a cell twice counts it once.
          const extra = extraClasses.get(row) ?? []
          if (first === classIndex || extra.includes(classIndex)) continue
          extra.push(classIndex)
          extraClasses.set(row, extra)
        }

        classSizes[classIndex] = (classSizes[classIndex] ?? 0) + 1
      }
    })

    let selection: Uint8Array | null = null
    let selectionSize = 0

    if (input.selection !== null) {
      selection = new Uint8Array(this.rowCount)

      for (const id of input.selection) {
        const row = this.rowById.get(id)

        if (row === undefined) {
          unmatchedIds += 1
        } else if (selection[row] === 0) {
          selection[row] = 1
          selectionSize += 1
        }
      }
    }

    const summary: PlotGroupsSummary = {
      classSizes,
      selectionSize,
      unmatchedIds,
      repeatedCells: extraClasses.size,
    }
    this.groups = { codes, extraClasses, selection, summary }
    return summary
  }

  // Keeps a gene's values, evicting the least recently used over the cache
  // size. Values for rows the dataset does not have are ignored.
  addGene(values: GeneValues): void {
    this.dropGene(values.gene)
    this.genes.set(values.gene, values)
    this.geneBytes += geneValuesBytes(values)

    for (const [gene, held] of this.genes) {
      if (this.geneBytes <= this.maxGeneBytes || held === values) break
      this.dropGene(gene)
    }
  }

  hasGene(gene: string): boolean {
    return this.genes.has(gene)
  }

  stats(genes: readonly string[]): PlotStatsResult {
    const groups = this.groups

    if (groups === null) {
      throw new Error('Plot groups are not set.')
    }

    const stats: PlotGeneStats[] = []
    const missing: string[] = []

    for (const gene of genes) {
      const values = this.genes.get(gene)

      if (values === undefined) {
        missing.push(gene)
        continue
      }

      // Used now, so last to be evicted.
      this.genes.delete(gene)
      this.genes.set(gene, values)
      stats.push(geneStats(values, groups, this.rowCount))
    }

    return { stats, missing }
  }

  private dropGene(gene: string): void {
    const held = this.genes.get(gene)
    if (held === undefined) return
    this.genes.delete(gene)
    this.geneBytes -= geneValuesBytes(held)
  }
}

function geneValuesBytes(values: GeneValues): number {
  return values.rows.byteLength + values.values.byteLength
}

function geneStats(
  values: GeneValues,
  groups: PlotGroups,
  rowCount: number,
): PlotGeneStats {
  const { selection, summary } = groups
  const groupCount = summary.classSizes.length + (selection === null ? 0 : 1)
  const expressing = new Float64Array(groupCount)
  const sum = new Float64Array(groupCount)
  const sumLog1p = new Float64Array(groupCount)
  // Stored values per group, to place each group's values together below.
  const stored = new Uint32Array(groupCount)
  // Over every value read, in a group or not (22-D4).
  let wholeNumbers = true
  let negative = false

  for (let index = 0; index < values.rows.length; index += 1) {
    if ((values.rows[index] ?? rowCount) >= rowCount) continue
    const value = values.values[index] ?? 0
    if (wholeNumbers && !Number.isInteger(value)) wholeNumbers = false
    if (value < 0) negative = true
  }

  forEachGroupValue(values, groups, rowCount, (group, value) => {
    sum[group] = (sum[group] ?? 0) + value
    // log1p is undefined at -1 and below; the panel turns it off for
    // negative values anyway (22-D4).
    sumLog1p[group] =
      (sumLog1p[group] ?? 0) + (value > -1 ? Math.log1p(value) : Number.NaN)
    if (value > 0) expressing[group] = (expressing[group] ?? 0) + 1
    stored[group] = (stored[group] ?? 0) + 1
  })

  const sizes =
    selection === null
      ? summary.classSizes
      : [summary.selectionSize, ...summary.classSizes]
  const sorted = sortedGroupValues(values, groups, rowCount, stored)
  const withDensities = groupCount <= PLOT_DENSITY_MAX_GROUPS

  return {
    gene: values.gene,
    groups: sizes.map((cells, group) => ({
      cells,
      expressing: expressing[group] ?? 0,
      sum: sum[group] ?? 0,
      sumLog1p: sumLog1p[group] ?? 0,
    })),
    wholeNumbers,
    negative,
    distributions: {
      stored: scaleDistributions(sorted, sizes, (value) => value, withDensities),
      log1p: negative
        ? null
        : scaleDistributions(sorted, sizes, Math.log1p, withDensities),
    },
  }
}

// Calls `visit` with each stored value of a row in the dataset, once for
// each group its row is in: the selection (group 0 when there is one), its
// class, and further classes that list it.
function forEachGroupValue(
  values: GeneValues,
  groups: PlotGroups,
  rowCount: number,
  visit: (group: number, value: number) => void,
): void {
  const { codes, extraClasses, selection } = groups
  const offset = selection === null ? 0 : 1
  const hasExtra = extraClasses.size > 0

  for (let index = 0; index < values.rows.length; index += 1) {
    const row = values.rows[index] ?? rowCount
    if (row >= rowCount) continue

    const value = values.values[index] ?? 0
    if (selection !== null && selection[row] === 1) visit(0, value)

    const code = codes[row] ?? NO_CLASS
    if (code === NO_CLASS) continue
    visit(code + offset, value)

    if (hasExtra) {
      for (const extra of extraClasses.get(row) ?? []) visit(extra + offset, value)
    }
  }
}

// Each group's stored values in ascending order, as views of one array.
function sortedGroupValues(
  values: GeneValues,
  groups: PlotGroups,
  rowCount: number,
  stored: Uint32Array,
): readonly Float32Array[] {
  const starts = new Uint32Array(stored.length + 1)
  for (let group = 0; group < stored.length; group += 1) {
    starts[group + 1] = (starts[group] ?? 0) + (stored[group] ?? 0)
  }

  const all = new Float32Array(starts[stored.length] ?? 0)
  const next = starts.slice(0, stored.length)
  forEachGroupValue(values, groups, rowCount, (group, value) => {
    const index = next[group] ?? 0
    all[index] = value
    next[group] = index + 1
  })

  return [...stored].map((_, group) =>
    all.subarray(starts[group] ?? 0, starts[group + 1] ?? 0).sort(),
  )
}

// A group's values in order, with the cells that store none counted as 0.
interface OrderedValues {
  readonly count: number
  at(index: number): number
  // Each run of equal values in order, with how many cells hold it.
  forEach(visit: (value: number, cells: number) => void): void
}

function everyCellValues(sorted: Float32Array, cells: number): OrderedValues {
  const zeros = Math.max(0, cells - sorted.length)
  const negatives = firstIndexWhere(sorted, (value) => value >= 0)

  return {
    count: sorted.length + zeros,
    at: (index) =>
      index < negatives
        ? (sorted[index] ?? 0)
        : index < negatives + zeros
          ? 0
          : (sorted[index - zeros] ?? 0),
    forEach: (visit) => {
      for (let index = 0; index < negatives; index += 1) visit(sorted[index] ?? 0, 1)
      if (zeros > 0) visit(0, zeros)
      for (let index = negatives; index < sorted.length; index += 1) {
        visit(sorted[index] ?? 0, 1)
      }
    },
  }
}

function expressingValues(sorted: Float32Array): OrderedValues {
  const first = firstIndexWhere(sorted, (value) => value > 0)

  return {
    count: sorted.length - first,
    at: (index) => sorted[first + index] ?? 0,
    forEach: (visit) => {
      for (let index = first; index < sorted.length; index += 1) {
        visit(sorted[index] ?? 0, 1)
      }
    },
  }
}

// The first index of an ascending array where `test` holds, or its length.
function firstIndexWhere(sorted: Float32Array, test: (value: number) => boolean): number {
  let low = 0
  let high = sorted.length

  while (low < high) {
    const middle = (low + high) >>> 1
    if (test(sorted[middle] ?? 0)) high = middle
    else low = middle + 1
  }

  return low
}

function scaleDistributions(
  sorted: readonly Float32Array[],
  sizes: readonly number[],
  transform: (value: number) => number,
  withDensities: boolean,
): PlotScaleDistributions {
  const all = sorted.map((values, group) => everyCellValues(values, sizes[group] ?? 0))
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY

  for (const values of all) {
    if (values.count === 0) continue
    low = Math.min(low, values.at(0))
    high = Math.max(high, values.at(values.count - 1))
  }

  const grid = Number.isFinite(low)
    ? { low: transform(low), high: transform(high) }
    : { low: 0, high: 0 }
  const describe = (values: OrderedValues) =>
    distribution(values, transform, withDensities ? grid : null)

  return {
    ...grid,
    all: all.map(describe),
    expressing: sorted.map((values) => describe(expressingValues(values))),
  }
}

function distribution(
  values: OrderedValues,
  transform: (value: number) => number,
  grid: { readonly low: number; readonly high: number } | null,
): PlotDistribution | null {
  const { count } = values
  if (count === 0) return null

  // Linear between the two values either side, as numpy's default.
  const quantile = (share: number) => {
    const position = (count - 1) * share
    const below = Math.floor(position)
    const value = transform(values.at(below))
    return position === below
      ? value
      : value + (position - below) * (transform(values.at(below + 1)) - value)
  }

  return {
    count,
    min: transform(values.at(0)),
    q1: quantile(0.25),
    median: quantile(0.5),
    q3: quantile(0.75),
    max: transform(values.at(count - 1)),
    density: grid === null ? null : density(values, transform, grid.low, grid.high),
  }
}

// A histogram on the grid, each value split between its two nearest points,
// smoothed with a Gaussian kernel whose width follows Scott's rule, as
// scipy's gaussian_kde, behind seaborn's and Scanpy's violins, does. The
// grid stops at the gene's lowest and highest values, and the kernel is
// reflected at both ends, so a spike of zeros at an end keeps its mass.
function density(
  values: OrderedValues,
  transform: (value: number) => number,
  low: number,
  high: number,
): Float32Array {
  const steps = PLOT_DENSITY_STEPS
  const span = high - low
  const histogram = new Float64Array(steps)
  let sum = 0
  let sumSquares = 0

  values.forEach((stored, cells) => {
    const value = transform(stored)
    sum += value * cells
    sumSquares += value * value * cells

    if (span <= 0) {
      histogram[0] = (histogram[0] ?? 0) + cells
      return
    }

    const position = ((value - low) / span) * (steps - 1)
    const index = Math.min(steps - 2, Math.max(0, Math.floor(position)))
    const above = Math.min(1, Math.max(0, position - index))
    histogram[index] = (histogram[index] ?? 0) + cells * (1 - above)
    histogram[index + 1] = (histogram[index + 1] ?? 0) + cells * above
  })

  const mean = sum / values.count
  const deviation = Math.sqrt(Math.max(0, sumSquares / values.count - mean * mean))
  const bandwidth = deviation * values.count ** -0.2
  const sigma = span > 0 ? bandwidth / (span / (steps - 1)) : 0
  const smoothed = sigma > 0 ? gaussianSmooth(histogram, sigma) : histogram
  const total = smoothed.reduce((runningTotal, value) => runningTotal + value, 0)

  return Float32Array.from(smoothed, (value) => (total > 0 ? value / total : 0))
}

function gaussianSmooth(histogram: Float64Array, sigma: number): Float64Array {
  const steps = histogram.length
  const radius = Math.min(steps - 1, Math.ceil(sigma * 4))
  const kernel = Float64Array.from({ length: radius + 1 }, (_, distance) =>
    Math.exp(-0.5 * (distance / sigma) ** 2),
  )
  const smoothed = new Float64Array(steps)

  for (let source = 0; source < steps; source += 1) {
    const mass = histogram[source] ?? 0
    if (mass === 0) continue

    for (let offset = -radius; offset <= radius; offset += 1) {
      let target = source + offset
      if (target < 0) target = -target
      else if (target >= steps) target = 2 * (steps - 1) - target
      smoothed[target] = (smoothed[target] ?? 0) + mass * (kernel[Math.abs(offset)] ?? 0)
    }
  }

  return smoothed
}

export type PlotScale = 'log1p' | 'stored'

// A group's mean on the scale, with its zeros counted; null for an empty
// group, or log1p of a value at -1 or below.
export function plotGroupMean(stats: PlotGroupStats, scale: PlotScale): number | null {
  if (stats.cells === 0) return null
  const mean = (scale === 'log1p' ? stats.sumLog1p : stats.sum) / stats.cells
  return Number.isFinite(mean) ? mean : null
}

// The share of a group's cells with a stored value above 0, 0 to 100; null
// for an empty group.
export function plotGroupPercentExpressing(stats: PlotGroupStats): number | null {
  return stats.cells === 0 ? null : (stats.expressing / stats.cells) * 100
}
