import { describe, expect, it } from 'vitest'
import {
  plotGeneStatsFor,
  plotTestInput as input,
  testExportPaint as exportPaint,
} from '../../test/plotFixtures'
import { dotPlotModel, dotPlotSvg, dotRadius, meansPlotTable } from './dotPlot'
import { heatmapModel, heatmapRowHeight, heatmapSvg } from './heatmap'
import { plotFileName, plotStatsCsv } from './plotExport'
import { PANEL_PLOT_PAINT, truncateLabel } from './plotModel'
import { svgDocument, svgMarkup } from './svgMarkup'

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'image/svg+xml')
}

describe('dot plot (plan 22-E)', () => {
  it('takes means with zeros counted and colours them on one range', () => {
    const model = dotPlotModel(input)
    const actbRoi = model.cells.find(
      (cell) => cell.geneIndex === 0 && cell.groupIndex === 0,
    )

    expect(actbRoi).toMatchObject({ percent: 50, mean: 2, intensity: 1 })
    expect(model.colourRange).toEqual({ low: 0, high: 2 })
    // Genes still reading have no dots; empty groups have no share.
    expect(model.cells.some((cell) => cell.geneIndex === 2)).toBe(false)
    expect(model.cells.find((cell) => cell.groupIndex === 2)?.percent).toBeNull()
    expect(model.summary).toBe(
      'Dot plot of Actb, Gad1 and Gapdh across 3 groups of cluster',
    )
  })

  it('scales each gene from its lowest to highest mean when asked', () => {
    const model = dotPlotModel({ ...input, colour: 'per-gene' })
    const gad1 = model.cells.filter((cell) => cell.geneIndex === 1 && cell.mean !== null)

    expect(model.colourRange).toBeNull()
    expect(gad1.map((cell) => cell.intensity)).toEqual([0, 1])
  })

  it('scales a gene expressed in every group from its lowest mean, not 0', () => {
    // Class A holds rows 0–1, class B rows 2–3.
    const rows = ['a1', 'a2', 'b1', 'b2']
    const groups = { selection: null, classes: [rows.slice(0, 2), rows.slice(2)] }
    const model = dotPlotModel({
      ...input,
      colour: 'per-gene',
      scale: 'stored',
      groups: input.groups.slice(1),
      genes: [
        // Means 5 and 6.
        {
          gene: 'Actb',
          stats: plotGeneStatsFor('Actb', rows, groups, [
            [0, 5],
            [1, 5],
            [2, 6],
            [3, 6],
          ]),
        },
        // One mean everywhere.
        {
          gene: 'Gapdh',
          stats: plotGeneStatsFor('Gapdh', rows, groups, [
            [0, 8],
            [1, 8],
            [2, 8],
            [3, 8],
          ]),
        },
      ],
    })
    const intensities = (geneIndex: number) =>
      model.cells
        .filter((cell) => cell.geneIndex === geneIndex)
        .map((cell) => cell.intensity)

    expect(intensities(0)).toEqual([0, 1])
    expect(intensities(1)).toEqual([0, 0])
  })

  it('draws a dot per group and gene with cells expressing, each with a title', () => {
    const svg = dotPlotSvg(dotPlotModel(input), PANEL_PLOT_PAINT, 'test')
    const document = parse(
      svgMarkup({ ...svg, attrs: { ...svg.attrs, xmlns: 'http://www.w3.org/2000/svg' } }),
    )
    const root = document.documentElement
    // Two genes read, by two groups with cells; Gad1 in ROI 1 has none.
    const dots = root.querySelectorAll('g > circle[r]:not([fill-opacity])')

    expect(root.getAttribute('role')).toBe('img')
    expect(root.getAttribute('aria-labelledby')).toBe('test-title test-desc')
    expect(dots).toHaveLength(3)
    expect(
      [...root.querySelectorAll('title')].map((title) => title.textContent),
    ).toContain('ROI 1, Actb: 4 cells, 50% expressing, mean counts 2')
    expect(root.querySelector('line.plot-rule')).not.toBeNull()
    expect(root.textContent).toContain('B & <C>')
  })

  it('writes a file with colours and the font inlined', () => {
    const markup = svgDocument(dotPlotSvg(dotPlotModel(input), exportPaint, 'dot-plot'))
    const root = parse(markup).documentElement

    expect(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(root.querySelector('parsererror')).toBeNull()
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect(root.getAttribute('font-family')).toBe('Avenir Next, sans-serif')
    expect(root.querySelector('[class]')).toBeNull()
    expect(root.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff')
    expect(root.querySelectorAll('linearGradient stop')).toHaveLength(5)
  })

  it('sizes dots by area and cuts long labels', () => {
    expect(dotRadius(100)).toBeCloseTo(4 * dotRadius(6.25))
    expect(dotRadius(0)).toBe(0)
    expect(truncateLabel('Normal Epithelium', 8)).toBe('Normal …')
  })
})

describe('heatmap (plan 22-G)', () => {
  it('colours each group mean, and writes a tile for each group with cells', () => {
    const model = heatmapModel(input)
    const root = parse(
      svgDocument(heatmapSvg(model, exportPaint, 'heatmap')),
    ).documentElement
    // A tile per gene read and group with cells: two genes by two groups.
    // Swatches are the groups' hex colours; tiles are the palette's.
    const tiles = root.querySelectorAll('rect[fill^="rgb"]')

    expect(model.summary).toBe(
      'Heatmap of Actb, Gad1 and Gapdh across 3 groups of cluster',
    )
    expect(
      model.cells.find((cell) => cell.geneIndex === 0 && cell.groupIndex === 0),
    ).toMatchObject({
      mean: 2,
      intensity: 1,
    })
    expect(root.querySelector('parsererror')).toBeNull()
    expect(tiles).toHaveLength(4)
    // No size legend: only the colour bar.
    expect(root.querySelectorAll('circle')).toHaveLength(0)
    expect(root.querySelectorAll('linearGradient')).toHaveLength(1)
    expect(meansPlotTable(model).rows).toHaveLength(6)
  })

  it('makes rows shorter past the dot plot’s classes', () => {
    expect(heatmapRowHeight(61)).toBe(22)
    expect(heatmapRowHeight(500)).toBe(12)
  })
})

describe('plot exports (plan 22-H)', () => {
  it('writes each group and gene on the plot’s scale, with quartiles', () => {
    const csv = plotStatsCsv({
      setLabel: 'cluster',
      groups: input.groups,
      genes: input.genes,
      scale: 'stored',
      valueLabel: 'counts',
    })

    expect(csv.split('\n').slice(0, 3)).toEqual([
      'set,group,group_kind,gene,values,cells,cells_expressing,percent_expressing,mean,median,q1,q3,min,max,median_expressing,q1_expressing,q3_expressing',
      ',ROI 1,selection,Actb,counts,4,2,50,2,2,0,4,0,4,4,4,4',
      'cluster,A,class,Actb,counts,10,5,50,1,1,0,2,0,2,2,2,2',
    ])
    expect(csv).toContain('cluster,B & <C>,class,Actb,counts,0,0,,,,,,,,,,')
    expect(csv).not.toContain('Gapdh')
  })

  it('writes log1p numbers when the plot shows log1p', () => {
    const csv = plotStatsCsv({
      setLabel: 'cluster',
      groups: input.groups,
      genes: input.genes,
      scale: 'log1p',
      valueLabel: 'log1p(counts)',
    })

    expect(csv.split('\n')[1]).toBe(
      ',ROI 1,selection,Actb,log1p(counts),4,2,50,0.804719,0.804719,0,1.60944,0,1.60944,1.60944,1.60944,1.60944',
    )
  })

  it('names files after the dataset, plot and set', () => {
    expect(
      plotFileName(
        'https://example.test/data/heart.h5ad',
        'dot-plot',
        'Cell type',
        'svg',
      ),
    ).toBe('heart-dot-plot-cell-type.svg')
    expect(plotFileName('https://example.test/run/', 'violin', null, 'png')).toBe(
      'run-violin.png',
    )
  })
})
