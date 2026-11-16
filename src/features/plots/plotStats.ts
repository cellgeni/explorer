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

export interface PlotGeneStats {
  readonly gene: string
  // The selection first when there is one, then the classes in order.
  readonly groups: readonly PlotGroupStats[]
  // Every stored value is a whole number, as counts are (22-D4).
  readonly wholeNumbers: boolean
  // Some stored value is below 0, as in a scaled matrix.
  readonly negative: boolean
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
  const { codes, extraClasses, selection, summary } = groups
  const offset = selection === null ? 0 : 1
  const groupCount = summary.classSizes.length + offset
  const expressing = new Float64Array(groupCount)
  const sum = new Float64Array(groupCount)
  const sumLog1p = new Float64Array(groupCount)
  const hasExtra = extraClasses.size > 0
  let wholeNumbers = true
  let negative = false

  const add = (group: number, value: number, log1p: number) => {
    sum[group] = (sum[group] ?? 0) + value
    sumLog1p[group] = (sumLog1p[group] ?? 0) + log1p
    if (value > 0) expressing[group] = (expressing[group] ?? 0) + 1
  }

  for (let index = 0; index < values.rows.length; index += 1) {
    const row = values.rows[index] ?? rowCount
    if (row >= rowCount) continue

    const value = values.values[index] ?? 0
    // log1p is undefined at -1 and below; the panel turns it off for
    // negative values anyway (22-D4).
    const log1p = value > -1 ? Math.log1p(value) : Number.NaN

    if (wholeNumbers && !Number.isInteger(value)) wholeNumbers = false
    if (value < 0) negative = true

    if (selection !== null && selection[row] === 1) add(0, value, log1p)

    const code = codes[row] ?? NO_CLASS
    if (code === NO_CLASS) continue
    add(code + offset, value, log1p)

    if (hasExtra) {
      for (const extra of extraClasses.get(row) ?? []) add(extra + offset, value, log1p)
    }
  }

  const sizes =
    selection === null
      ? summary.classSizes
      : [summary.selectionSize, ...summary.classSizes]

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
  }
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
