import { describe, expect, it } from 'vitest'
import { formatAxisValue, niceStepAtLeast, viewerAxesModel } from './viewerAxesModel'

// 1 px per µm, the view centred on (500, 250) µm (deck.gl y is negated).
const VIEW = { target: [500, -250, 0], zoom: 0, minZoom: -10, maxZoom: 10 } as const
const VIEWPORT = { width: 1_000, height: 500 }

describe('viewerAxesModel', () => {
  it('puts ticks at nice steps across the view, in µm', () => {
    const axes = viewerAxesModel(
      { ...VIEW, target: [...VIEW.target] },
      VIEWPORT,
      'um',
      0.5,
    )

    expect(axes?.unitLabel).toBe('µm')
    // 80 px at 1 px/µm rounds up to a 100 µm step.
    // 0 is under the corner, and 1,000 where the unit is.
    expect(axes?.x.map((tick) => tick.label)).toEqual([
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
    ])
    expect(axes?.x[0]?.position).toBeCloseTo(100)
    expect(axes?.y.map((tick) => tick.position)).toEqual([100, 200, 300, 400])
  })

  it('uses image pixels and finer steps when zoomed in', () => {
    const axes = viewerAxesModel(
      { ...VIEW, target: [...VIEW.target], zoom: 4 },
      VIEWPORT,
      'px',
      0.5,
      'units',
    )

    expect(axes?.unitLabel).toBe('px')
    // 16 px per µm is 8 px per image px: 80 / 8 = 10, so a step of 10 px.
    const values = axes?.x.map((tick) => Number(tick.label.replace(/,/g, ''))) ?? []
    expect(values.length).toBeGreaterThan(1)
    expect((values[1] ?? 0) - (values[0] ?? 0)).toBe(10)
  })

  it('rounds steps up to 1, 2 or 5 × 10ⁿ', () => {
    expect([0.03, 1, 1.5, 3, 7, 96].map(niceStepAtLeast)).toEqual([
      0.05, 1, 2, 5, 10, 100,
    ])
  })

  it('names the unknown unit and gives decimals for small steps', () => {
    expect(
      viewerAxesModel({ ...VIEW, target: [...VIEW.target] }, VIEWPORT, 'um', 1, 'units')
        ?.unitLabel,
    ).toBe('units')
    expect(formatAxisValue(0.30000000000000004, 0.1)).toBe('0.3')
    expect(formatAxisValue(1.5, 0.5)).toBe('1.5')
    expect(formatAxisValue(12_000, 2_000)).toBe('12,000')
  })

  it('has no axes before the canvas is measured', () => {
    expect(
      viewerAxesModel(
        { ...VIEW, target: [...VIEW.target] },
        { width: 0, height: 0 },
        'um',
        1,
      ),
    ).toBeNull()
  })
})
