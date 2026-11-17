import {
  formatPlotNumber,
  intensityColour,
  meanCellTitle,
  plotMeans,
  plotSummary,
  plotTableGroupLabel,
  selectionGroupTitle,
  truncateLabel,
  formatPercent,
  type PlotMeanCell,
  type PlotMeansInput,
  type PlotPaint,
  type PlotRange,
  type PlotTable,
} from './plotModel'
import { svgNode, type SvgChild, type SvgNode } from './svgMarkup'

// The dot plot (plan 22-E): groups down, genes across, as in Scanpy. A
// dot's area is the share of the group's cells expressing the gene, and its
// colour the group's mean, with zeros counted.

export type DotPlotInput = PlotMeansInput

// The dot plot and the heatmap: group means on a grid of groups down and
// genes across.
export type DotPlotModel = MeansPlotModel

export interface MeansPlotModel extends PlotMeansInput {
  readonly cells: readonly PlotMeanCell[]
  // The shared colour range; null per gene or without means.
  readonly colourRange: PlotRange | null
  // The summary screen readers hear for the plot.
  readonly summary: string
  readonly description: string
}

export function dotPlotModel(input: DotPlotInput): DotPlotModel {
  return {
    ...input,
    ...plotMeans(input),
    summary: plotSummary('Dot plot', input),
    description: `Dot size is the share of each group's cells with the gene above 0. Colour is the mean ${input.valueLabel} over all the group's cells${input.colour === 'per-gene' ? ', scaled from each gene’s lowest to highest mean' : ''}.`,
  }
}

// The dot plot's and the heatmap's numbers.
export function meansPlotTable(model: MeansPlotModel): PlotTable {
  return {
    caption: model.summary,
    columns: ['Gene', 'Cells', '% expressing', `Mean ${model.valueLabel}`],
    rows: model.cells.map((cell) => ({
      key: `${cell.groupIndex}:${cell.geneIndex}`,
      group: plotTableGroupLabel(model.groups[cell.groupIndex]),
      values: [
        model.genes[cell.geneIndex]?.gene ?? '',
        cell.cells.toLocaleString(),
        cell.percent === null ? '–' : formatPercent(cell.percent),
        cell.mean === null ? '–' : formatPlotNumber(cell.mean),
      ],
    })),
  }
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
  return meansGridSvg(model, paint, idPrefix, {
    mark: 'dot',
    columnWidth: CELL,
    rowHeight: CELL,
  })
}

// Group means on a grid of groups down and genes across: a dot sized by the
// share expressing, or a tile (the heatmap's file, 22-D10).
export interface MeansGridLayout {
  readonly mark: 'dot' | 'tile'
  readonly columnWidth: number
  readonly rowHeight: number
}

export function meansGridSvg(
  model: MeansPlotModel,
  paint: PlotPaint,
  idPrefix: string,
  { mark, columnWidth, rowHeight }: MeansGridLayout,
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
  const gridWidth = model.genes.length * columnWidth
  const gridHeight = model.groups.length * rowHeight
  const legendTop = top + gridHeight + 18
  const legendWidth = mark === 'dot' ? LEGEND_WIDTH : COLOUR_BAR_WIDTH
  const width = Math.ceil(Math.max(left + gridWidth + PAD, legendWidth + 2 * PAD))
  const swatch = Math.min(SWATCH, rowHeight - 2)
  const labelSize = rowHeight < 16 ? 10 : 11
  const height = Math.ceil(legendTop + 58 + PAD)
  const titleId = `${idPrefix}-title`
  const descId = `${idPrefix}-desc`
  const gradientId = `${idPrefix}-gradient`
  const selectionRows = model.groups.filter((group) => group.kind === 'selection').length

  const rows: SvgChild[] = model.groups.map((group, groupIndex) => {
    const y = top + groupIndex * rowHeight + rowHeight / 2
    return svgNode('g', {}, [
      svgNode('title', {}, [
        group.kind === 'selection' ? selectionGroupTitle(group.label) : group.label,
      ]),
      svgNode('rect', {
        x: left - 6 - SWATCH,
        y: y - swatch / 2,
        width: swatch,
        height: swatch,
        rx: group.kind === 'selection' ? 0 : 2,
        fill: group.color,
      }),
      svgNode(
        'text',
        {
          ...paint.text,
          x: left - 12 - SWATCH,
          y: y + labelSize * 0.36,
          'text-anchor': 'end',
          ...(labelSize === 11 ? {} : { 'font-size': labelSize }),
        },
        [groupLabels[groupIndex] ?? ''],
      ),
    ])
  })

  const columns: SvgChild[] = model.genes.map(({ gene }, geneIndex) => {
    const x = left + geneIndex * columnWidth + columnWidth / 2 + 4
    return svgNode(
      'text',
      { ...paint.text, transform: `translate(${x} ${top - 6}) rotate(-90)` },
      [svgNode('title', {}, [gene]), geneLabels[geneIndex] ?? ''],
    )
  })

  const marks: SvgChild[] = model.cells.map((cell) => {
    const group = model.groups[cell.groupIndex]
    const gene = model.genes[cell.geneIndex]?.gene ?? ''
    const x = left + cell.geneIndex * columnWidth
    const y = top + cell.groupIndex * rowHeight
    const fill = intensityColour(model.colorScale, cell.intensity ?? 0)
    const radius = cell.percent === null ? 0 : dotRadius(cell.percent)
    const shape =
      mark === 'tile'
        ? cell.mean === null
          ? []
          : [svgNode('rect', { x, y, width: columnWidth, height: rowHeight, fill })]
        : radius > 0
          ? [
              svgNode('circle', {
                cx: x + columnWidth / 2,
                cy: y + rowHeight / 2,
                r: radius,
                fill,
              }),
            ]
          : []
    return svgNode('g', {}, [
      svgNode('title', {}, [
        meanCellTitle(group?.label ?? '', gene, cell, model.valueLabel),
      ]),
      ...(mark === 'dot'
        ? [
            svgNode('rect', {
              x,
              y,
              width: columnWidth,
              height: rowHeight,
              fill: 'transparent',
            }),
          ]
        : []),
      ...shape,
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
            y1: top + selectionRows * rowHeight,
            y2: top + selectionRows * rowHeight,
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
      svgNode('g', {}, marks),
      svgNode('g', {}, selectionRule),
      ...(mark === 'dot' ? [sizeLegend(PAD, legendTop, paint)] : []),
      colourLegend(mark === 'dot' ? PAD + 180 : PAD, legendTop, model, paint, gradientId),
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
  model: MeansPlotModel,
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
