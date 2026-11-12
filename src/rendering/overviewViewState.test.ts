import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import type { OverviewCellDatum, OverviewViewState } from './deckLayerTypes'
import {
  FIT_FALLBACK_VIEWPORT,
  extentKey,
  fitExtentViewState,
  overviewFitExtent,
  viewStateForBbox,
} from './overviewViewState'

function cell(x: number, y: number): OverviewCellDatum {
  return { position: [x, y] } as unknown as OverviewCellDatum
}

describe('fit to view (F18)', () => {
  const cells = [cell(0, 0), cell(2000, -1000)]

  it('keeps the 720 px fit until the canvas is measured', () => {
    expect(
      fitExtentViewState(overviewFitExtent(cells), FIT_FALLBACK_VIEWPORT),
    ).toMatchObject({
      target: [1000, -500, 0],
      zoom: Math.log2(720 / 2000),
    })
  })

  it('fills the real canvas, less the padding, on its tighter side', () => {
    const extent = overviewFitExtent(cells)

    expect(fitExtentViewState(extent, { width: 1080, height: 852 }, 24).zoom).toBeCloseTo(
      Math.log2((1080 - 48) / 2000),
    )
    expect(fitExtentViewState(extent, { width: 2048, height: 548 }, 24).zoom).toBeCloseTo(
      Math.log2((548 - 48) / 1000),
    )
  })

  it('includes the image extent, flipped into deck.gl y', () => {
    const extent = overviewFitExtent([], [], {
      minX: micrometers(0),
      maxX: micrometers(100),
      minY: micrometers(10),
      maxY: micrometers(50),
    })

    expect(extent).toEqual({ minX: 0, maxX: 100, minY: -50, maxY: -10 })
    expect(extentKey(extent)).toBe('0:100:-50:-10')
    expect(extentKey(null)).toBe('empty')
  })
})

describe('viewStateForBbox', () => {
  const current: OverviewViewState = {
    target: [0, 0, 0],
    zoom: 0,
    minZoom: -10,
    maxZoom: 10,
  }

  it('centres and fits a data region, y down', () => {
    const view = viewStateForBbox(
      {
        minX: micrometers(100),
        maxX: micrometers(300),
        minY: micrometers(40),
        maxY: micrometers(60),
      },
      { width: 448, height: 448 },
      current,
    )

    expect(view.target).toEqual([200, -50, 0])
    expect(view.zoom).toBeCloseTo(1)
  })

  it('stays within the view limits', () => {
    const view = viewStateForBbox(
      {
        minX: micrometers(0),
        maxX: micrometers(0.001),
        minY: micrometers(0),
        maxY: micrometers(0.001),
      },
      { width: 800, height: 600 },
      { ...current, maxZoom: 4 },
    )

    expect(view.zoom).toBe(4)
  })
})
