import {
  formatPercent,
  formatPlotNumber,
  plotSummary,
  plotTableGroupLabel,
  selectionGroupTitle,
  truncateLabel,
  type PlotInput,
  type PlotPaint,
  type PlotRange,
  type PlotTable,
} from './plotModel'
import { plotGroupPercentExpressing, type PlotDistribution } from './plotStats'
import { svgNode, type SvgChild, type SvgNode } from './svgMarkup'

// The violin (plan 22-F): a row per gene and a violin per group, so several
// genes stack as in Scanpy's stacked violin. Each gene's violins share its
// value axis, every violin is as wide as the others at its widest, a box
// spans the quartiles and a line marks the median. With Include zeros off,
// the violins show the expressing cells only.

export interface ViolinPlotInput extends PlotInput {
  readonly includeZeros: boolean
}

export interface ViolinCell {
  readonly groupIndex: number
  readonly geneIndex: number
  readonly cells: number
  // 0 to 100; null for an empty group.
  readonly percent: number | null
  // Null without cells to show: an empty group, or none expressing.
  readonly distribution: PlotDistribution | null
}

export interface ViolinPlotModel extends ViolinPlotInput {
  readonly cells: readonly ViolinCell[]
  // Each gene's value axis; null while the gene is read.
  readonly ranges: readonly (PlotRange | null)[]
  // What a violin shows: "log1p(counts)", or "log1p(counts) of expressing
  // cells".
  readonly distributionLabel: string
  readonly summary: string
  readonly description: string
}

export function violinPlotModel(input: ViolinPlotInput): ViolinPlotModel {
  const cells: ViolinCell[] = []
  const ranges = input.genes.map(({ stats }, geneIndex) => {
    const distributions = stats?.distributions[input.scale] ?? null
    if (stats === null || distributions === null) return null

    input.groups.forEach((_, groupIndex) => {
      const group = stats.groups[groupIndex]
      if (group === undefined) return
      const shown = input.includeZeros ? distributions.all : distributions.expressing
      cells.push({
        groupIndex,
        geneIndex,
        cells: group.cells,
        percent: plotGroupPercentExpressing(group),
        distribution: shown[groupIndex] ?? null,
      })
    })

    return { low: distributions.low, high: distributions.high }
  })
  const distributionLabel = input.includeZeros
    ? input.valueLabel
    : `${input.valueLabel} of expressing cells`

  return {
    ...input,
    cells,
    ranges,
    distributionLabel,
    summary: plotSummary('Violin plot', input),
    description: `Each violin is the spread of ${distributionLabel} in a group, as wide as the others at its widest. The box spans the quartiles and the line is the median.${input.includeZeros ? ' Cells that store no value count as 0.' : ' Cells at 0 are left out.'}`,
  }
}

export function violinPlotTable(model: ViolinPlotModel): PlotTable {
  const label = model.distributionLabel
  return {
    caption: model.summary,
    columns: [
      'Gene',
      model.includeZeros ? 'Cells' : 'Expressing cells',
      '% expressing',
      `Median ${label}`,
      'Lower quartile',
      'Upper quartile',
    ],
    rows: model.cells.map((cell) => {
      const distribution = cell.distribution
      const number = (value: number | undefined) =>
        value === undefined ? '–' : formatPlotNumber(value)
      return {
        key: `${cell.groupIndex}:${cell.geneIndex}`,
        group: plotTableGroupLabel(model.groups[cell.groupIndex]),
        values: [
          model.genes[cell.geneIndex]?.gene ?? '',
          (model.includeZeros ? cell.cells : (distribution?.count ?? 0)).toLocaleString(),
          cell.percent === null ? '–' : formatPercent(cell.percent),
          number(distribution?.median),
          number(distribution?.q1),
          number(distribution?.q3),
        ],
      }
    }),
  }
}

const COLUMN = 24
// Taller rows for a few genes, so each violin's shape shows.
export function violinRowHeight(geneCount: number): number {
  if (geneCount <= 3) return 96
  return geneCount <= 8 ? 72 : 60
}
// Space above and below a gene's violins inside its row.
const ROW_INSET = 6
const HALF_WIDTH = COLUMN / 2 - 2
const BOX_WIDTH = 4
// A rough width of one character at 11 px, and at 10 px.
const CHAR_WIDTH = 6.4
const SMALL_CHAR_WIDTH = 5.8
const GROUP_LABEL_MAX_CHARS = 24
const GENE_LABEL_MAX_CHARS = 16
const SWATCH = 10
const PAD = 8

export function violinPlotSvg(
  model: ViolinPlotModel,
  paint: PlotPaint,
  idPrefix: string,
): SvgNode {
  const groupLabels = model.groups.map((group) =>
    truncateLabel(group.label, GROUP_LABEL_MAX_CHARS),
  )
  const geneLabels = model.genes.map(({ gene }) =>
    truncateLabel(gene, GENE_LABEL_MAX_CHARS),
  )
  const ticks = model.ranges.map((range) =>
    range === null ? null : [formatPlotNumber(range.high), formatPlotNumber(range.low)],
  )
  const geneLabelWidth =
    Math.max(4, ...geneLabels.map((label) => label.length)) * CHAR_WIDTH
  const tickWidth =
    Math.max(1, ...ticks.flatMap((pair) => pair ?? []).map((tick) => tick.length)) *
    SMALL_CHAR_WIDTH
  const left = PAD + geneLabelWidth + 10 + tickWidth + 6
  const headerHeight =
    Math.max(4, ...groupLabels.map((label) => label.length)) * CHAR_WIDTH
  const swatchTop = PAD + headerHeight + 8
  const top = swatchTop + SWATCH + 6
  const row = violinRowHeight(model.genes.length)
  const gridWidth = model.groups.length * COLUMN
  const gridHeight = model.genes.length * row
  const captionTop = top + gridHeight + 18
  const caption = `Values: ${model.distributionLabel}. Box: quartiles. Line: median.`
  const width = Math.ceil(
    Math.max(left + gridWidth + PAD, PAD * 2 + caption.length * SMALL_CHAR_WIDTH),
  )
  const height = Math.ceil(captionTop + PAD)
  const titleId = `${idPrefix}-title`
  const descId = `${idPrefix}-desc`
  const selectionColumns = model.groups.filter(
    (group) => group.kind === 'selection',
  ).length

  const columns: SvgChild[] = model.groups.map((group, groupIndex) => {
    const x = left + groupIndex * COLUMN + COLUMN / 2
    return svgNode('g', {}, [
      svgNode('title', {}, [
        group.kind === 'selection' ? selectionGroupTitle(group.label) : group.label,
      ]),
      svgNode('rect', {
        x: x - SWATCH / 2,
        y: swatchTop,
        width: SWATCH,
        height: SWATCH,
        rx: group.kind === 'selection' ? 0 : 2,
        fill: group.color,
      }),
      svgNode(
        'text',
        { ...paint.text, transform: `translate(${x + 4} ${swatchTop - 6}) rotate(-90)` },
        [groupLabels[groupIndex] ?? ''],
      ),
    ])
  })

  const rows: SvgChild[] = model.genes.map(({ gene }, geneIndex) => {
    const rowTop = top + geneIndex * row
    const pair = ticks[geneIndex]
    return svgNode('g', {}, [
      svgNode('text', { ...paint.text, x: PAD, y: rowTop + row / 2 + 4 }, [
        svgNode('title', {}, [gene]),
        geneLabels[geneIndex] ?? '',
      ]),
      svgNode('line', {
        ...paint.axis,
        x1: left - 3,
        x2: left - 3,
        y1: rowTop + ROW_INSET,
        y2: rowTop + row - ROW_INSET,
      }),
      ...(pair === null || pair === undefined
        ? []
        : pair.map((tick, index) =>
            svgNode(
              'text',
              {
                ...paint.muted,
                x: left - 6,
                y: rowTop + (index === 0 ? ROW_INSET + 4 : row - ROW_INSET + 3),
                'text-anchor': 'end',
                'font-size': 10,
              },
              [tick],
            ),
          )),
      ...(geneIndex === 0
        ? []
        : [
            svgNode('line', {
              ...paint.axis,
              x1: PAD,
              x2: left + gridWidth,
              y1: rowTop,
              y2: rowTop,
              'stroke-opacity': 0.4,
            }),
          ]),
    ])
  })

  const violins: SvgChild[] = model.cells.map((cell) => {
    const group = model.groups[cell.groupIndex]
    const gene = model.genes[cell.geneIndex]?.gene ?? ''
    const range = model.ranges[cell.geneIndex] ?? null
    const centre = left + cell.groupIndex * COLUMN + COLUMN / 2
    const rowTop = top + cell.geneIndex * row
    const valueY = (value: number) => {
      if (range === null || range.high <= range.low) return rowTop + row / 2
      const share = (value - range.low) / (range.high - range.low)
      return rowTop + row - ROW_INSET - share * (row - 2 * ROW_INSET)
    }
    const distribution = cell.distribution

    return svgNode('g', {}, [
      svgNode('title', {}, [violinTitle(group?.label ?? '', gene, cell, model)]),
      svgNode('rect', {
        x: centre - COLUMN / 2,
        y: rowTop,
        width: COLUMN,
        height: row,
        fill: 'transparent',
      }),
      ...(distribution === null || range === null
        ? []
        : violinMarks(
            distribution,
            range,
            centre,
            valueY,
            group?.color ?? '#888888',
            paint,
          )),
    ])
  })

  // A rule after the selection, which overlaps the classes beside it.
  const selectionRule: SvgChild[] =
    selectionColumns > 0 && model.groups.length > selectionColumns
      ? [
          svgNode('line', {
            ...paint.rule,
            x1: left + selectionColumns * COLUMN,
            x2: left + selectionColumns * COLUMN,
            y1: swatchTop,
            y2: top + gridHeight,
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
      svgNode('g', {}, columns),
      svgNode('g', {}, rows),
      svgNode('g', {}, violins),
      svgNode('g', {}, selectionRule),
      svgNode('text', { ...paint.muted, x: PAD, y: captionTop, 'font-size': 10 }, [
        caption,
      ]),
    ],
  )
}

function violinMarks(
  distribution: PlotDistribution,
  range: PlotRange,
  centre: number,
  valueY: (value: number) => number,
  colour: string,
  paint: PlotPaint,
): SvgNode[] {
  const outline = violinOutline(distribution, range)
  const right = outline.map(
    ({ value, width }) => `${round(centre + width * HALF_WIDTH)} ${round(valueY(value))}`,
  )
  const left = [...outline]
    .reverse()
    .map(
      ({ value, width }) =>
        `${round(centre - width * HALF_WIDTH)} ${round(valueY(value))}`,
    )
  const q3 = valueY(distribution.q3)
  const q1 = valueY(distribution.q1)
  const median = valueY(distribution.median)

  return [
    ...(outline.length === 0
      ? []
      : [
          svgNode('path', {
            d: `M${[...right, ...left].join(' L')} Z`,
            fill: colour,
            'fill-opacity': 0.7,
            stroke: colour,
            'stroke-width': 1,
          }),
        ]),
    svgNode('rect', {
      ...paint.mark,
      x: centre - BOX_WIDTH / 2,
      y: q3,
      width: BOX_WIDTH,
      height: Math.max(1, q1 - q3),
    }),
    svgNode('line', {
      ...paint.surface,
      x1: centre - BOX_WIDTH / 2,
      x2: centre + BOX_WIDTH / 2,
      y1: median,
      y2: median,
      'stroke-width': 1.5,
    }),
  ]
}

// The violin's half-widths, 0 to 1, from its lowest value to its highest:
// the density at each grid point between them, and at both ends, scaled so
// its widest is 1. A violin of one value is a flat line.
export function violinOutline(
  distribution: PlotDistribution,
  range: PlotRange,
): readonly { readonly value: number; readonly width: number }[] {
  const density = distribution.density
  if (density === null || density.length === 0) return []

  const { min, max } = distribution
  const span = range.high - range.low
  if (span <= 0 || max <= min) {
    return [
      { value: min, width: 1 },
      { value: max, width: 1 },
    ]
  }

  const steps = density.length
  const valueAt = (step: number) => range.low + (step / (steps - 1)) * span
  const densityAt = (value: number) => {
    const position = ((value - range.low) / span) * (steps - 1)
    const below = Math.min(steps - 2, Math.max(0, Math.floor(position)))
    const above = Math.min(1, Math.max(0, position - below))
    return (density[below] ?? 0) * (1 - above) + (density[below + 1] ?? 0) * above
  }
  const points = [{ value: min, density: densityAt(min) }]

  for (let step = 0; step < steps; step += 1) {
    const value = valueAt(step)
    if (value > min && value < max) points.push({ value, density: density[step] ?? 0 })
  }
  points.push({ value: max, density: densityAt(max) })

  const widest = Math.max(...points.map((point) => point.density))
  return points.map(({ value, density: pointDensity }) => ({
    value,
    width: widest > 0 ? pointDensity / widest : 0,
  }))
}

function violinTitle(
  group: string,
  gene: string,
  cell: ViolinCell,
  model: ViolinPlotModel,
): string {
  const distribution = cell.distribution
  if (cell.percent === null) return `${group}, ${gene}: no cells`
  const share = `${formatPercent(cell.percent)} expressing`
  if (distribution === null) {
    return `${group}, ${gene}: ${cell.cells.toLocaleString()} cells, none expressing`
  }

  const counted = model.includeZeros
    ? `${cell.cells.toLocaleString()} cells, ${share}`
    : `${distribution.count.toLocaleString()} expressing cells of ${cell.cells.toLocaleString()}`
  return `${group}, ${gene}: ${counted}, median ${model.distributionLabel} ${formatPlotNumber(distribution.median)}, quartiles ${formatPlotNumber(distribution.q1)} to ${formatPlotNumber(distribution.q3)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
