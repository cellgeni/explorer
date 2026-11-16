import { describe, expect, it } from 'vitest'
import {
  dotPlotModel,
  dotPlotSvg,
  dotRadius,
  PANEL_PLOT_PAINT,
  truncateLabel,
  type DotPlotInput,
} from './dotPlot'
import { exportPlotPaint, plotFileName, plotStatsCsv } from './plotExport'
import type { PlotGeneStats } from './plotStats'
import { svgDocument, svgMarkup } from './svgMarkup'

function stats(gene: string, groups: readonly [number, number, number][]): PlotGeneStats {
  return {
    gene,
    groups: groups.map(([cells, expressing, sum]) => ({
      cells,
      expressing,
      sum,
      sumLog1p: Math.log1p(sum),
    })),
    wholeNumbers: true,
    negative: false,
  }
}

const input: DotPlotInput = {
  groups: [
    { id: 'selection', label: 'ROI 1', color: '#f0c84b', kind: 'selection' },
    { id: 'analysis:cluster:a', label: 'A', color: '#1f77b4', kind: 'class' },
    { id: 'analysis:cluster:b', label: 'B & <C>', color: '#ff7f0e', kind: 'class' },
  ],
  genes: [
    {
      gene: 'Actb',
      stats: stats('Actb', [
        [4, 2, 8],
        [10, 5, 10],
        [0, 0, 0],
      ]),
    },
    {
      gene: 'Gad1',
      stats: stats('Gad1', [
        [4, 0, 0],
        [10, 1, 1],
        [0, 0, 0],
      ]),
    },
    { gene: 'Gapdh', stats: null },
  ],
  scale: 'stored',
  colour: 'shared',
  colorScale: 'viridis',
  valueLabel: 'counts',
  setLabel: 'cluster',
}

const exportPaint = exportPlotPaint({
  text: '#111111',
  muted: '#555555',
  rule: '#999999',
  background: '#ffffff',
  font: 'Avenir Next, sans-serif',
})

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

describe('plot exports (plan 22-H)', () => {
  it('writes each group and gene, with both means', () => {
    const csv = plotStatsCsv({
      setLabel: 'cluster',
      groups: input.groups,
      genes: input.genes,
    })

    expect(csv.split('\n').slice(0, 3)).toEqual([
      'set,group,group_kind,gene,cells,cells_expressing,percent_expressing,mean,mean_log1p',
      ',ROI 1,selection,Actb,4,2,50,2,0.549306',
      'cluster,A,class,Actb,10,5,50,1,0.23979',
    ])
    expect(csv).toContain('cluster,B & <C>,class,Actb,0,0,,,')
    expect(csv).not.toContain('Gapdh')
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
    expect(plotFileName('https://example.test/run/', 'dot-plot', null, 'csv')).toBe(
      'run-dot-plot.csv',
    )
  })
})
