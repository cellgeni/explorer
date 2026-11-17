import { describe, expect, it } from 'vitest'
import {
  plotTestInput as input,
  testExportPaint as exportPaint,
} from '../../test/plotFixtures'
import { PANEL_PLOT_PAINT } from './plotModel'
import { PLOT_DENSITY_STEPS, type PlotDistribution } from './plotStats'
import { svgDocument, svgMarkup } from './svgMarkup'
import {
  violinOutline,
  violinPlotModel,
  violinPlotSvg,
  violinPlotTable,
  type ViolinPlotInput,
} from './violinPlot'

const violinInput: ViolinPlotInput = {
  groups: input.groups,
  genes: input.genes,
  scale: 'stored',
  valueLabel: 'counts',
  setLabel: 'cluster',
  includeZeros: true,
}

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'image/svg+xml')
}

function panelSvg(model: ReturnType<typeof violinPlotModel>): Element {
  const svg = violinPlotSvg(model, PANEL_PLOT_PAINT, 'test')
  return parse(
    svgMarkup({ ...svg, attrs: { ...svg.attrs, xmlns: 'http://www.w3.org/2000/svg' } }),
  ).documentElement
}

describe('violin plot (plan 22-F)', () => {
  it('shows every cell, zeros counted, on each gene’s own axis', () => {
    const model = violinPlotModel(violinInput)
    const roiActb = model.cells.find(
      (cell) => cell.geneIndex === 0 && cell.groupIndex === 0,
    )

    expect(model.summary).toBe(
      'Violin plot of Actb, Gad1 and Gapdh across 3 groups of cluster',
    )
    expect(model.ranges).toEqual([{ low: 0, high: 4 }, { low: 0, high: 1 }, null])
    expect(roiActb?.distribution).toMatchObject({ count: 4, median: 2, q1: 0, q3: 4 })
    // The empty class has no violin.
    expect(model.cells.find((cell) => cell.groupIndex === 2)?.distribution).toBeNull()
  })

  it('shows expressing cells only with Include zeros off, and says so', () => {
    const model = violinPlotModel({ ...violinInput, includeZeros: false })
    const gad1Roi = model.cells.find(
      (cell) => cell.geneIndex === 1 && cell.groupIndex === 0,
    )
    const root = panelSvg(model)

    expect(model.distributionLabel).toBe('counts of expressing cells')
    expect(gad1Roi?.distribution).toBeNull()
    expect(root.textContent).toContain('Values: counts of expressing cells.')
    expect(
      [...root.querySelectorAll('title')].map((title) => title.textContent),
    ).toContain('ROI 1, Gad1: 4 cells, none expressing')
  })

  it('draws a violin, box and median per group with cells, each with a title', () => {
    const root = panelSvg(violinPlotModel(violinInput))
    // Actb in ROI 1 and A; Gad1 in A. Gad1 in ROI 1 is all zeros: a flat
    // violin at 0.
    const violins = root.querySelectorAll('path')

    expect(root.getAttribute('role')).toBe('img')
    expect(violins).toHaveLength(4)
    expect(violins[0]?.getAttribute('d')).toMatch(/^M.* Z$/)
    expect(root.querySelectorAll('rect.plot-mark')).toHaveLength(4)
    expect(root.querySelectorAll('line.plot-surface')).toHaveLength(4)
    expect(root.querySelector('line.plot-rule')).not.toBeNull()
    expect(
      [...root.querySelectorAll('title')].map((title) => title.textContent),
    ).toContain('ROI 1, Actb: 4 cells, 50% expressing, median counts 2, quartiles 0 to 4')
  })

  it('writes a file with colours inlined', () => {
    const markup = svgDocument(
      violinPlotSvg(violinPlotModel(violinInput), exportPaint, 'violin'),
    )
    const root = parse(markup).documentElement

    expect(root.querySelector('parsererror')).toBeNull()
    expect(root.querySelector('[class]')).toBeNull()
    expect(root.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff')
  })

  it('lists the medians and quartiles shown', () => {
    const table = violinPlotTable(
      violinPlotModel({ ...violinInput, includeZeros: false }),
    )

    expect(table.columns).toEqual([
      'Gene',
      'Expressing cells',
      '% expressing',
      'Median counts of expressing cells',
      'Lower quartile',
      'Upper quartile',
    ])
    expect(table.rows[0]).toEqual({
      key: '0:0',
      group: 'ROI 1 (selection)',
      values: ['Actb', '2', '50%', '4', '4', '4'],
    })
    expect(table.rows[2]?.values).toEqual(['Actb', '0', '–', '–', '–', '–'])
  })
})

describe('violinOutline', () => {
  const flat = new Float32Array(PLOT_DENSITY_STEPS).fill(1 / PLOT_DENSITY_STEPS)
  const spread = (overrides: Partial<PlotDistribution>): PlotDistribution => ({
    count: 10,
    min: 0,
    q1: 1,
    median: 2,
    q3: 3,
    max: 4,
    density: flat,
    ...overrides,
  })

  it('runs from the lowest value to the highest, widest at 1', () => {
    const outline = violinOutline(spread({ min: 1, max: 3 }), { low: 0, high: 4 })

    expect(outline[0]?.value).toBe(1)
    expect(outline.at(-1)?.value).toBe(3)
    expect(Math.max(...outline.map((point) => point.width))).toBe(1)
    expect(outline.every((point) => point.value >= 1 && point.value <= 3)).toBe(true)
  })

  it('is a flat line for one value, and nothing without a density', () => {
    expect(violinOutline(spread({ min: 2, max: 2 }), { low: 0, high: 4 })).toEqual([
      { value: 2, width: 1 },
      { value: 2, width: 1 },
    ])
    expect(violinOutline(spread({ density: null }), { low: 0, high: 4 })).toEqual([])
  })
})
