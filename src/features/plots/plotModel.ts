import { geneExpressionColor } from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import {
  plotGroupMean,
  plotGroupPercentExpressing,
  type PlotGeneStats,
  type PlotScale,
} from './plotStats'
import type { PlotGroup } from './plotsPanelModel'

// What the dot plot, violin and heatmap share (plan 22-D8, 22-D9): their
// input, the group means with their colours, labels and numbers, the table
// Show numbers swaps in, and the paints for the panel and for files.

export type PlotKind = 'dot' | 'violin' | 'heatmap'

// Mean colours: one range for every gene, or each gene's own lowest to
// highest mean, like Scanpy's standard_scale='var' (22-D8).
export type PlotColourMode = 'shared' | 'per-gene'

export interface PlotGene {
  readonly gene: string
  // Null while the gene is read, or after it failed.
  readonly stats: PlotGeneStats | null
}

export interface PlotInput {
  readonly groups: readonly Pick<PlotGroup, 'id' | 'label' | 'color' | 'kind'>[]
  readonly genes: readonly PlotGene[]
  readonly scale: PlotScale
  // What the values are, for titles: "log1p(counts)", "X".
  readonly valueLabel: string
  readonly setLabel: string | null
}

export interface PlotRange {
  readonly low: number
  readonly high: number
}

// A group's mean for a gene, coloured on the plot's range.
export interface PlotMeanCell {
  readonly groupIndex: number
  readonly geneIndex: number
  readonly cells: number
  readonly expressing: number
  // 0 to 100; null for an empty group.
  readonly percent: number | null
  readonly mean: number | null
  // Position on the colour scale, 0 to 1.
  readonly intensity: number | null
}

export interface PlotMeansInput extends PlotInput {
  readonly colour: PlotColourMode
  readonly colorScale: GeneExpressionColorScale
}

export interface PlotMeans {
  readonly cells: readonly PlotMeanCell[]
  // The shared colour range; null per gene or without means.
  readonly colourRange: PlotRange | null
}

// Each group's mean for each gene read, with zeros counted.
export function plotMeans(input: PlotMeansInput): PlotMeans {
  const cells: PlotMeanCell[] = []

  input.genes.forEach(({ stats }, geneIndex) => {
    if (stats === null) return

    input.groups.forEach((_, groupIndex) => {
      const group = stats.groups[groupIndex]
      if (group === undefined) return
      cells.push({
        groupIndex,
        geneIndex,
        cells: group.cells,
        expressing: group.expressing,
        percent: plotGroupPercentExpressing(group),
        mean: plotGroupMean(group, input.scale),
        intensity: null,
      })
    })
  })

  const colourRange = input.colour === 'shared' ? meanRange(cells, true) : null
  // Per gene runs from the gene's own lowest mean, as Scanpy's
  // standard_scale='var' does, so a gene expressed everywhere still spans
  // the colour bar.
  const geneRanges = input.genes.map((_, geneIndex) =>
    meanRange(
      cells.filter((cell) => cell.geneIndex === geneIndex),
      false,
    ),
  )

  return {
    cells: cells.map((cell) => {
      const range = colourRange ?? geneRanges[cell.geneIndex] ?? null
      return { ...cell, intensity: intensityIn(cell.mean, range) }
    }),
    colourRange,
  }
}

// From the lowest mean to the highest; with `fromZero`, from 0 when the
// lowest is above it.
function meanRange(cells: readonly PlotMeanCell[], fromZero: boolean): PlotRange | null {
  let low = fromZero ? 0 : Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY

  for (const { mean } of cells) {
    if (mean === null) continue
    low = Math.min(low, mean)
    high = Math.max(high, mean)
  }

  return Number.isFinite(high) ? { low, high } : null
}

function intensityIn(mean: number | null, range: PlotRange | null): number | null {
  if (mean === null || range === null) return null
  const span = range.high - range.low
  return span > 0 ? Math.min(1, Math.max(0, (mean - range.low) / span)) : 0
}

// "Dot plot of Actb and Gad1 across 2 groups of cell_type".
export function plotSummary(
  name: string,
  { genes, groups, setLabel }: PlotInput,
): string {
  const geneNames = genes.map(({ gene }) => gene)
  const geneText =
    geneNames.length <= 3
      ? listText(geneNames)
      : `${geneNames.slice(0, 2).join(', ')} and ${geneNames.length - 2} more genes`
  const groupText = `${groups.length.toLocaleString()} ${groups.length === 1 ? 'group' : 'groups'}`

  return `${name} of ${geneText} across ${groupText}${setLabel === null ? '' : ` of ${setLabel}`}`
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? 'no genes'
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

// "T cell, Actb: 2 cells, 50% expressing, mean log1p(counts) 0.347".
export function meanCellTitle(
  group: string,
  gene: string,
  cell: PlotMeanCell,
  valueLabel: string,
): string {
  if (cell.percent === null) return `${group}, ${gene}: no cells`
  return `${group}, ${gene}: ${formatCellCount(cell.cells)}, ${formatPercent(cell.percent)} expressing, mean ${valueLabel} ${formatPlotNumber(cell.mean ?? 0)}`
}

export function selectionGroupTitle(label: string): string {
  return `${label}: the selection. Its cells are in their classes too.`
}

// The plot's numbers, which is also its text alternative (22-D9): a row
// per group and gene, headed by the group.
export interface PlotTable {
  readonly caption: string
  // The columns after Group.
  readonly columns: readonly string[]
  readonly rows: readonly PlotTableRow[]
}

export interface PlotTableRow {
  readonly key: string
  readonly group: string
  readonly values: readonly string[]
}

export function plotTableGroupLabel(
  group: Pick<PlotGroup, 'label' | 'kind'> | undefined,
): string {
  if (group === undefined) return ''
  return group.kind === 'selection' ? `${group.label} (selection)` : group.label
}

// Paints for the plot's text and lines: CSS classes in the panel, which
// follow the theme, and colours written out in an exported file.
export interface PlotPaint {
  readonly root: Readonly<Record<string, string>>
  readonly text: Readonly<Record<string, string>>
  readonly muted: Readonly<Record<string, string>>
  // A dashed line, such as the one between the selection and the classes.
  readonly rule: Readonly<Record<string, string>>
  // Axis lines.
  readonly axis: Readonly<Record<string, string>>
  // Marks in the text colour, such as a violin's box.
  readonly mark: Readonly<Record<string, string>>
  // Marks in the background colour, such as a violin's median.
  readonly surface: Readonly<Record<string, string>>
  readonly background: string | null
}

export const PANEL_PLOT_PAINT: PlotPaint = {
  root: { class: 'plot-svg' },
  text: { class: 'plot-text' },
  muted: { class: 'plot-muted' },
  rule: { class: 'plot-rule' },
  axis: { class: 'plot-axis' },
  mark: { class: 'plot-mark' },
  surface: { class: 'plot-surface' },
  background: null,
}

// The colour scale's colour at an intensity, opaque.
export function intensityColour(
  scale: GeneExpressionColorScale,
  intensity: number,
): string {
  const [red = 0, green = 0, blue = 0] = geneExpressionColor(scale, intensity)
  return `rgb(${red}, ${green}, ${blue})`
}

export function truncateLabel(label: string, maxChars: number): string {
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1)}…`
}

const PLOT_NUMBER = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 })

export function formatPlotNumber(value: number): string {
  return PLOT_NUMBER.format(value)
}

// To one decimal, except that a share above 0 never reads 0%, nor one below
// 100 read 100%: one expressing cell in 10,000 is "<0.1%".
export function formatPercent(percent: number): string {
  if (percent > 0 && percent < 0.05) return '<0.1%'
  if (percent < 100 && percent >= 99.95) return '>99.9%'
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

// "1 cell", "2 cells".
export function formatCellCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'cell' : 'cells'}`
}
