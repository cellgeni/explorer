import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { ViewerLegendSection } from '../../components/viewerLegendTypes'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import {
  cssGradientStops,
  estimateTextWidth,
  fitText,
  screenshotOverlayPaint,
  screenshotOverlaySvg,
  screenshotSelectionPaths,
  type ScreenshotInclude,
  type ScreenshotOverlayModels,
} from './screenshotOverlay'

const frame = { width: 800, height: 600 }
const ALL: ScreenshotInclude = {
  scaleBar: true,
  legend: true,
  axes: true,
  selections: true,
}
const NONE: ScreenshotInclude = {
  scaleBar: false,
  legend: false,
  axes: false,
  selections: false,
}
const paint = screenshotOverlayPaint('canvas', null)
const measure = estimateTextWidth

const categories: ViewerLegendSection = {
  kind: 'categories',
  id: 'clusters',
  title: 'Clusters',
  items: [
    { id: 'a', label: 'Astrocytes', color: '#ff0000', count: 1200, visible: true },
    { id: 'b', label: 'Neurons <deep>', color: '#00ff00', count: 30, visible: true },
    { id: 'c', label: 'Hidden class', color: '#0000ff', count: 9, visible: false },
  ],
  moreCount: 4,
}
const expression: ViewerLegendSection = {
  kind: 'continuous',
  id: 'expression',
  title: 'SNAP25',
  detail: 'Counts per cell',
  gradient:
    'linear-gradient(90deg, rgba(0, 0, 4, 1) 0%, rgba(187, 55, 84, 1) 50%, #fcfdbf 100%)',
  min: '0',
  max: '12',
}
const models: ScreenshotOverlayModels = {
  scaleBar: { label: '50 µm', widthPixels: 80 },
  axes: {
    x: [{ position: 120, label: '1,000' }],
    y: [{ position: 300, label: '2,000' }],
    unitLabel: 'µm',
  },
  legend: [expression, categories],
  selections: [
    { d: 'M0 0L10 10Z', color: '#f0c84b', saved: false },
    { d: 'M5 5L20 20Z', color: '#58a6ff', saved: true },
  ],
}

describe('screenshot overlays (plan 27, task E)', () => {
  it('draws nothing when nothing is included', () => {
    expect(screenshotOverlaySvg(frame, models, NONE, paint, measure)).toBeNull()
  })

  it('draws the frame’s marks in CSS pixels', () => {
    const svg = screenshotOverlaySvg(frame, models, ALL, paint, measure) ?? ''

    expect(svg).toMatch(/^<svg [^>]*width="800" height="600" viewBox="0 0 800 600"/)
    expect(svg).toContain('>50 µm</text>')
    expect(svg).toContain('>1,000</text>')
    expect(svg).toContain('rotate(-90)')
    expect(svg).toContain('>SNAP25</text>')
    expect(svg).toContain('>Counts per cell</text>')
    expect(svg).toContain('<stop offset="0.5" stop-color="rgba(187, 55, 84, 1)"/>')
    expect(svg).toContain('>Astrocytes</text>')
    expect(svg).toContain('>1,200</text>')
  })

  it('leaves hidden classes out of the legend and counts the rest as more', () => {
    const svg = screenshotOverlaySvg(frame, models, ALL, paint, measure) ?? ''

    expect(svg).not.toContain('Hidden class')
    expect(svg).toContain('>+4 more</text>')
  })

  it('prints the Python layers as a list and a scale per ramp (plan 29-D8)', () => {
    const python: ViewerLegendSection = {
      kind: 'python',
      id: 'python',
      title: 'Python',
      noun: { singular: 'cell', plural: 'cells' },
      items: [
        {
          id: 'color:ROI picks',
          label: 'ROI picks',
          count: 4,
          swatch: { kind: 'color', color: '#ffa500' },
        },
        {
          id: 'color:Result',
          label: 'Result',
          count: 5,
          swatch: {
            kind: 'ramp',
            gradient: 'linear-gradient(90deg, #008000, #d9ecd9)',
            min: '0',
            max: '250',
          },
        },
      ],
    }
    const svg =
      screenshotOverlaySvg(frame, { ...models, legend: [python] }, ALL, paint, measure) ??
      ''

    expect(svg).toContain('>Python</text>')
    expect(svg).toContain('>ROI picks</text>')
    expect(svg).toContain('fill="#ffa500"')
    expect(svg).toContain('>Python: Result</text>')
    expect(svg).toContain('>5 cells</text>')
    expect(svg).toContain('>250</text>')
  })

  it('escapes text and colours', () => {
    const svg = screenshotOverlaySvg(frame, models, ALL, paint, measure) ?? ''

    expect(svg).toContain('Neurons &lt;deep&gt;')
    expect(svg).not.toContain('<deep>')
  })

  it('dashes saved selections and fills the active one', () => {
    const svg =
      screenshotOverlaySvg(
        frame,
        models,
        { ...NONE, selections: true },
        paint,
        measure,
      ) ?? ''

    expect(svg).toContain(
      '<path d="M5 5L20 20Z" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-dasharray="6 4"',
    )
    expect(svg).toContain(
      '<path d="M0 0L10 10Z" fill="#f0c84b" fill-opacity="0.15" stroke="#f0c84b"',
    )
  })

  it('puts the scale bar at the bottom right and the legend at the bottom left', () => {
    const scaleBar =
      screenshotOverlaySvg(frame, models, { ...NONE, scaleBar: true }, paint, measure) ??
      ''
    const legend =
      screenshotOverlaySvg(frame, models, { ...NONE, legend: true }, paint, measure) ?? ''
    const box = (svg: string) => {
      const match = /<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)"/.exec(
        svg,
      )
      return match === null ? null : match.slice(1).map(Number)
    }
    const [barX, barY, barWidth, barHeight] = box(scaleBar) ?? []
    const [legendX, legendY, , legendHeight] = box(legend) ?? []

    // Boxes are drawn half a pixel in, so their 1 px borders are crisp.
    expect((barX ?? 0) + (barWidth ?? 0)).toBe(frame.width - 12.5)
    expect((barY ?? 0) + (barHeight ?? 0)).toBe(frame.height - 12.5)
    expect(legendX).toBe(12.5)
    expect((legendY ?? 0) + (legendHeight ?? 0)).toBe(frame.height - 12.5)
  })

  it('turns the boxes white with dark text on a white background (D8)', () => {
    const white = screenshotOverlayPaint('white', null)

    expect(white.background).toBe('#ffffff')
    expect(white.box).toBe('#ffffff')
    expect(white.text).not.toBe(paint.text)
    expect(screenshotOverlayPaint('transparent', null).background).toBeNull()
    expect(paint.background).toBe('#000')
  })

  it('reads the stops of the app’s gradients', () => {
    expect(
      cssGradientStops('linear-gradient(90deg, rgba(1, 2, 3, 0.5) 0%, #fff 100%)'),
    ).toEqual([
      { offset: 0, color: 'rgba(1, 2, 3, 0.5)' },
      { offset: 1, color: '#fff' },
    ])
    expect(cssGradientStops('linear-gradient(to right, red, green, blue)')).toEqual([
      { offset: 0, color: 'red' },
      { offset: 0.5, color: 'green' },
      { offset: 1, color: 'blue' },
    ])
  })

  it('cuts text to fit with an ellipsis', () => {
    const font = '400 10px sans-serif'

    expect(fitText('Astrocytes', 100, font, measure)).toBe('Astrocytes')
    expect(fitText('Oligodendrocyte precursors', 60, font, measure)).toBe('Oligodend…')
  })

  it('draws saved selections dashed and the card’s own as it is drawn', () => {
    const viewState: OverviewViewState = {
      target: [50, -50, 0],
      zoom: 0,
      minZoom: -10,
      maxZoom: 10,
    }
    const box = {
      kind: 'box' as const,
      bbox: {
        minX: micrometers(10),
        maxX: micrometers(20),
        minY: micrometers(10),
        maxY: micrometers(20),
      },
    }
    const paths = screenshotSelectionPaths(
      [
        { id: 'saved', color: '#58a6ff', active: false, selection: box },
        { id: 'active', color: '#f0c84b', active: true, selection: box },
      ],
      box,
      '#f0c84b',
      viewState,
      { width: 100, height: 100 },
    )

    expect(paths.map((path) => [path.color, path.saved])).toEqual([
      ['#58a6ff', true],
      ['#f0c84b', false],
    ])
    expect(paths[0]?.d).toBe('M 10.00 10.00 L 20.00 10.00 L 20.00 20.00 L 10.00 20.00 Z')
  })
})
