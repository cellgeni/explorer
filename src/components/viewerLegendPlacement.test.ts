import { describe, expect, it } from 'vitest'
import {
  clampLegendPlacement,
  clampLegendPoint,
  legendPlacementStyle,
  legendPlacementText,
  placeLegend,
} from './viewerLegendPlacement'

const view = { width: 1000, height: 800 }
const legend = { width: 260, height: 300 }

describe('placeLegend', () => {
  it('measures from the edges nearer its centre', () => {
    expect(placeLegend({ left: 100, top: 50 }, legend, view, true)).toEqual({
      fromRight: false,
      fromBottom: false,
      x: 100,
      y: 50,
    })
    expect(placeLegend({ left: 700, top: 450 }, legend, view, true)).toEqual({
      fromRight: true,
      fromBottom: true,
      x: 40,
      y: 50,
    })
  })

  it('keeps the legend inside the view', () => {
    expect(placeLegend({ left: 900, top: -40 }, legend, view, true)).toEqual({
      fromRight: true,
      fromBottom: false,
      x: 12,
      y: 12,
    })
  })

  it('puts a legend dropped in the bottom-left corner back in the stack', () => {
    expect(placeLegend({ left: 24, top: 476 }, legend, view, true)).toBeNull()
    // Arrow keys move it there without docking it.
    expect(placeLegend({ left: 24, top: 476 }, legend, view, false)).toEqual({
      fromRight: false,
      fromBottom: true,
      x: 24,
      y: 24,
    })
    // Along the bottom, but away from the corner.
    expect(placeLegend({ left: 60, top: 470 }, legend, view, true)).toEqual({
      fromRight: false,
      fromBottom: true,
      x: 60,
      y: 30,
    })
  })
})

describe('clampLegendPlacement', () => {
  it('keeps its corner as the view shrinks, inside the view', () => {
    const placement = { fromRight: true, fromBottom: false, x: 40, y: 600 }

    expect(clampLegendPlacement(placement, legend, view)).toEqual({
      ...placement,
      y: 488,
    })
    expect(clampLegendPlacement(placement, { width: 260, height: 28 }, view)).toEqual(
      placement,
    )
  })

  it('pins a legend larger than the view at its corner', () => {
    expect(
      clampLegendPoint({ left: 50, top: 50 }, legend, { width: 200, height: 200 }),
    ).toEqual({ left: 12, top: 12 })
  })
})

describe('legendPlacementStyle', () => {
  it('sets the edges it is measured from', () => {
    expect(
      legendPlacementStyle({ fromRight: true, fromBottom: false, x: 40, y: 12 }),
    ).toEqual({ right: 40, top: 12 })
    expect(
      legendPlacementStyle({ fromRight: false, fromBottom: true, x: 12, y: 80 }),
    ).toEqual({ left: 12, bottom: 80 })
  })
})

describe('legendPlacementText', () => {
  it('says where the legend is', () => {
    expect(legendPlacementText(null)).toBe('At the bottom left')
    expect(
      legendPlacementText({ fromRight: true, fromBottom: false, x: 40, y: 12 }),
    ).toBe('12 px from the top, 40 px from the right')
  })
})
