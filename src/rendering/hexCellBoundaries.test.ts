import { describe, expect, it } from 'vitest'
import {
  HEX_BOUNDARY_VERTEX_COUNT,
  hexBoundaryCellLimit,
  hexCellBoundariesForVisibleCells,
} from './hexCellBoundaries'
import type { OverviewCellDatum } from './deckLayers'

const cells: readonly OverviewCellDatum[] = [
  {
    id: 'cell-1',
    position: [10, -20, 0],
    radiusPixels: 4,
    radiusMicrometers: 6,
    fillColor: [215, 63, 124, 220],
  },
  {
    id: 'cell-2',
    position: [30, -40, 0],
    radiusPixels: 4,
    fillColor: [215, 63, 124, 220],
  },
]

describe('hex cell boundaries', () => {
  it('derives the intermediate hex-boundary limit from the full boundary limit', () => {
    expect(hexBoundaryCellLimit(500)).toBe(3000)
  })

  it('creates six-point centroid hexagons for visible cells below the limit', () => {
    const hexBoundaries = hexCellBoundariesForVisibleCells(cells, {
      maxCells: 3000,
    })

    expect(hexBoundaries).toHaveLength(2)
    expect(hexBoundaries[0]).toMatchObject({
      id: 'hex-boundary:cell-1',
    })
    expect(hexBoundaries[0]?.polygon).toHaveLength(HEX_BOUNDARY_VERTEX_COUNT)
    expect(hexBoundaries[0]?.polygon[0]).toEqual([10, -26, 0])
    expect(hexBoundaries[0]?.polygon[3]).toEqual([10, -14, 0])
  })

  it('skips hexagons above the intermediate visible-cell limit', () => {
    expect(hexCellBoundariesForVisibleCells(cells, { maxCells: 1 })).toEqual([])
  })

  it('can use cell colors for expression-filled hexagons', () => {
    const [hexBoundary] = hexCellBoundariesForVisibleCells(cells, {
      maxCells: 3000,
      fillColorSource: 'cell',
      lineColor: [255, 253, 247, 210],
    })

    expect(hexBoundary?.fillColor).toEqual(cells[0]?.fillColor)
    expect(hexBoundary?.lineColor).toEqual([255, 253, 247, 210])
  })

  it('can use cell colors for visible hexagon outlines', () => {
    const [hexBoundary] = hexCellBoundariesForVisibleCells(cells, {
      maxCells: 3000,
      fillColorSource: 'cell',
      lineColorSource: 'cell',
    })

    expect(hexBoundary?.fillColor).toEqual(cells[0]?.fillColor)
    expect(hexBoundary?.lineColor).toEqual([215, 63, 124, 220])
  })
})
