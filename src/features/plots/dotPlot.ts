import { geneExpressionColor } from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import {
  plotGroupMean,
  plotGroupPercentExpressing,
  type PlotGeneStats,
  type PlotScale,
} from './plotStats'
import type { PlotGroup } from './plotsPanelModel'
import { svgNode, type SvgChild, type SvgNode } from './svgMarkup'

// The dot plot (plan 22-E): groups down, genes across, as in Scanpy. A
// dot's area is the share of the group's cells expressing the gene, and its
// colour the group's mean, with zeros counted.

// Mean colours: one range for every gene, or each gene's own lowest to
// highest mean, like Scanpy's standard_scale='var' (22-D8).
export type PlotColourMode = 'shared' | 'per-gene'

export interface DotPlotGene {
  readonly gene: string
  // Null while the gene is read, or after it failed.
  readonly stats: PlotGeneStats | null
}

export interface DotPlotInput {
  readonly groups: readonly Pick<PlotGroup, 'id' | 'label' | 'color' | 'kind'>[]
  readonly genes: readonly DotPlotGene[]
  readonly scale: PlotScale
  readonly colour: PlotColourMode
  readonly colorScale: GeneExpressionColorScale
  // What the values are, for titles: "log1p(counts)", "X".
  readonly valueLabel: string
  readonly setLabel: string | null
}

export interface DotPlotCell {
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

export interface DotPlotModel extends DotPlotInput {
  readonly cells: readonly DotPlotCell[]
  // The shared colour range; null per gene or without means.
  readonly colourRange: { readonly low: number; readonly high: number } | null
  // The summary screen readers hear for the plot.
  readonly summary: string
  readonly description: string
}

export function dotPlotModel(input: DotPlotInput): DotPlotModel {
  const cells: DotPlotCell[] = []

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

  const colourRange = input.colour === 'shared' ? meanRange(cells) : null
  const geneRanges = input.genes.map((_, geneIndex) =>
    meanRange(cells.filter((cell) => cell.geneIndex === geneIndex)),
  )
  const coloured = cells.map((cell) => {
    const range = colourRange ?? geneRanges[cell.geneIndex] ?? null
    return { ...cell, intensity: intensityIn(cell.mean, range) }
  })

  return {
    ...input,
    cells: coloured,
    colourRange,
    summary: dotPlotSummary(input),
    description: `Dot size is the share of each group's cells with the gene above 0. Colour is the mean ${input.valueLabel} over all the group's cells${input.colour === 'per-gene' ? ', scaled from each gene’s lowest to highest mean' : ''}.`,
  }
}

function meanRange(
  cells: readonly DotPlotCell[],
): { readonly low: number; readonly high: number } | null {
  let low = 0
  let high = Number.NEGATIVE_INFINITY

  for (const { mean } of cells) {
    if (mean === null) continue
    low = Math.min(low, mean)
    high = Math.max(high, mean)
  }

  return Number.isFinite(high) ? { low, high } : null
}

function intensityIn(
  mean: number | null,
  range: { readonly low: number; readonly high: number } | null,
): number | null {
  if (mean === null || range === null) return null
  const span = range.high - range.low
  return span > 0 ? Math.min(1, Math.max(0, (mean - range.low) / span)) : 0
}

function dotPlotSummary({ genes, groups, setLabel }: DotPlotInput): string {
  const geneNames = genes.map(({ gene }) => gene)
  const geneText =
    geneNames.length <= 3
      ? listText(geneNames)
      : `${geneNames.slice(0, 2).join(', ')} and ${geneNames.length - 2} more genes`
  const groupText = `${groups.length.toLocaleString()} ${groups.length === 1 ? 'group' : 'groups'}`

  return `Dot plot of ${geneText} across ${groupText}${setLabel === null ? '' : ` of ${setLabel}`}`
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? 'no genes'
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

// Paints for the plot's text and lines: CSS classes in the panel, which
// follow the theme, and colours written out in an exported file.
export interface PlotPaint {
  readonly root: Readonly<Record<string, string>>
  readonly text: Readonly<Record<string, string>>
  readonly muted: Readonly<Record<string, string>>
  readonly rule: Readonly<Record<string, string>>
  readonly background: string | null
}

export const PANEL_PLOT_PAINT: PlotPaint = {
  root: { class: 'plot-svg' },
  text: { class: 'plot-text' },
  muted: { class: 'plot-muted' },
  rule: { class: 'plot-rule' },
  background: null,
}

const CELL = 22
const MAX_RADIUS = 9.5
// A rough width of one character at 11 px, to lay out labels.
const CHAR_WIDTH = 6.4
const GROUP_LABEL_MAX_CHARS = 24
const GENE_LABEL_MAX_CHARS = 16
const SWATCH = 10
const PAD = 8
const LEGEND_PERCENTS = [20, 40, 60, 80, 100] as const
const COLOUR_BAR_WIDTH = 120
const LEGEND_WIDTH = 330

export function dotRadius(percent: number): number {
  return MAX_RADIUS * Math.sqrt(Math.min(100, Math.max(0, percent)) / 100)
}

export function dotPlotSvg(
  model: DotPlotModel,
  paint: PlotPaint,
  idPrefix: string,
): SvgNode {
  const groupLabels = model.groups.map((group) =>
    truncateLabel(group.label, GROUP_LABEL_MAX_CHARS),
  )
  const geneLabels = model.genes.map(({ gene }) =>
    truncateLabel(gene, GENE_LABEL_MAX_CHARS),
  )
  const labelWidth = Math.max(4, ...groupLabels.map((label) => label.length)) * CHAR_WIDTH
  const left = PAD + labelWidth + 6 + SWATCH + 6
  const headerHeight =
    Math.max(4, ...geneLabels.map((label) => label.length)) * CHAR_WIDTH
  const top = PAD + headerHeight + 8
  const gridWidth = model.genes.length * CELL
  const gridHeight = model.groups.length * CELL
  const legendTop = top + gridHeight + 18
  const width = Math.ceil(Math.max(left + gridWidth + PAD, LEGEND_WIDTH + 2 * PAD))
  const height = Math.ceil(legendTop + 58 + PAD)
  const titleId = `${idPrefix}-title`
  const descId = `${idPrefix}-desc`
  const gradientId = `${idPrefix}-gradient`
  const selectionRows = model.groups.filter((group) => group.kind === 'selection').length

  const rows: SvgChild[] = model.groups.map((group, groupIndex) => {
    const y = top + groupIndex * CELL + CELL / 2
    return svgNode('g', {}, [
      svgNode('title', {}, [
        group.kind === 'selection'
          ? `${group.label}: the selection. Its cells are in their classes too.`
          : group.label,
      ]),
      svgNode('rect', {
        x: left - 6 - SWATCH,
        y: y - SWATCH / 2,
        width: SWATCH,
        height: SWATCH,
        rx: group.kind === 'selection' ? 0 : 2,
        fill: group.color,
      }),
      svgNode(
        'text',
        { ...paint.text, x: left - 12 - SWATCH, y: y + 4, 'text-anchor': 'end' },
        [groupLabels[groupIndex] ?? ''],
      ),
    ])
  })

  const columns: SvgChild[] = model.genes.map(({ gene }, geneIndex) => {
    const x = left + geneIndex * CELL + CELL / 2 + 4
    return svgNode(
      'text',
      { ...paint.text, transform: `translate(${x} ${top - 6}) rotate(-90)` },
      [svgNode('title', {}, [gene]), geneLabels[geneIndex] ?? ''],
    )
  })

  const dots: SvgChild[] = model.cells.map((cell) => {
    const group = model.groups[cell.groupIndex]
    const gene = model.genes[cell.geneIndex]?.gene ?? ''
    const x = left + cell.geneIndex * CELL
    const y = top + cell.groupIndex * CELL
    const radius = cell.percent === null ? 0 : dotRadius(cell.percent)
    return svgNode('g', {}, [
      svgNode('title', {}, [dotTitle(group?.label ?? '', gene, cell, model.valueLabel)]),
      svgNode('rect', { x, y, width: CELL, height: CELL, fill: 'transparent' }),
      ...(radius > 0
        ? [
            svgNode('circle', {
              cx: x + CELL / 2,
              cy: y + CELL / 2,
              r: radius,
              fill: intensityColour(model.colorScale, cell.intensity ?? 0),
            }),
          ]
        : []),
    ])
  })

  // A rule under the selection, which overlaps the classes below it.
  const selectionRule: SvgChild[] =
    selectionRows > 0 && model.groups.length > selectionRows
      ? [
          svgNode('line', {
            ...paint.rule,
            x1: PAD,
            x2: left + gridWidth,
            y1: top + selectionRows * CELL,
            y2: top + selectionRows * CELL,
          }),
        ]
      : []

  return svgNode(
    'svg',
    {
      ...paint.root,
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-labelledby': `${titleId} ${descId}`,
      'font-size': 11,
    },
    [
      svgNode('title', { id: titleId }, [model.summary]),
      svgNode('desc', { id: descId }, [model.description]),
      ...(paint.background === null
        ? []
        : [svgNode('rect', { x: 0, y: 0, width, height, fill: paint.background })]),
      svgNode('g', {}, rows),
      svgNode('g', {}, columns),
      svgNode('g', {}, selectionRule),
      svgNode('g', {}, dots),
      sizeLegend(PAD, legendTop, paint),
      colourLegend(PAD + 180, legendTop, model, paint, gradientId),
    ],
  )
}

function sizeLegend(x: number, y: number, paint: PlotPaint): SvgNode {
  return svgNode('g', {}, [
    svgNode('text', { ...paint.muted, x, y: y + 8, 'font-size': 10 }, [
      '% of cells expressing',
    ]),
    ...LEGEND_PERCENTS.flatMap((percent, index) => {
      const cx = x + MAX_RADIUS + index * 28
      return [
        svgNode('circle', {
          ...paint.muted,
          cx,
          cy: y + 26,
          r: dotRadius(percent),
          'fill-opacity': 0.7,
        }),
        svgNode(
          'text',
          { ...paint.muted, x: cx, y: y + 50, 'text-anchor': 'middle', 'font-size': 10 },
          [String(percent)],
        ),
      ]
    }),
  ])
}

function colourLegend(
  x: number,
  y: number,
  model: DotPlotModel,
  paint: PlotPaint,
  gradientId: string,
): SvgNode {
  const range = model.colourRange
  const [lowLabel, highLabel] =
    model.colour === 'per-gene'
      ? ['lowest', 'highest']
      : range === null
        ? ['', '']
        : [formatPlotNumber(range.low), formatPlotNumber(range.high)]

  return svgNode('g', {}, [
    svgNode('defs', {}, [
      svgNode(
        'linearGradient',
        { id: gradientId, x1: 0, x2: 1, y1: 0, y2: 0 },
        [0, 0.25, 0.5, 0.75, 1].map((offset) =>
          svgNode('stop', {
            offset,
            'stop-color': intensityColour(model.colorScale, offset),
          }),
        ),
      ),
    ]),
    svgNode('text', { ...paint.muted, x, y: y + 8, 'font-size': 10 }, [
      model.colour === 'per-gene'
        ? `Mean ${model.valueLabel}, per gene`
        : `Mean ${model.valueLabel}`,
    ]),
    svgNode('rect', {
      x,
      y: y + 20,
      width: COLOUR_BAR_WIDTH,
      height: 10,
      fill: `url(#${gradientId})`,
    }),
    svgNode('text', { ...paint.muted, x, y: y + 50, 'font-size': 10 }, [lowLabel]),
    svgNode(
      'text',
      {
        ...paint.muted,
        x: x + COLOUR_BAR_WIDTH,
        y: y + 50,
        'text-anchor': 'end',
        'font-size': 10,
      },
      [highLabel],
    ),
  ])
}

function dotTitle(
  group: string,
  gene: string,
  cell: DotPlotCell,
  valueLabel: string,
): string {
  if (cell.percent === null) return `${group}, ${gene}: no cells`
  return `${group}, ${gene}: ${cell.cells.toLocaleString()} cells, ${formatPercent(cell.percent)} expressing, mean ${valueLabel} ${formatPlotNumber(cell.mean ?? 0)}`
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

export function formatPercent(percent: number): string {
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}
