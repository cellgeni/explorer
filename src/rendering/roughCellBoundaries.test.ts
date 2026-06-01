import { describe, expect, it } from 'vitest'
import {
  ROUGH_BOUNDARY_VERTEX_COUNT,
  roughBoundaryCellLimit,
  roughCellBoundariesForVisibleCells,
} from './roughCellBoundaries'
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

describe('rough cell boundaries', () => {
  it('derives the intermediate rough-boundary limit from the full boundary limit', () => {
    expect(roughBoundaryCellLimit(500)).toBe(1500)
  })

  it('creates four-point centroid polygons for visible cells below the limit', () => {
    const roughBoundaries = roughCellBoundariesForVisibleCells(cells, {
      maxCells: 1500,
    })

    expect(roughBoundaries).toHaveLength(2)
    expect(roughBoundaries[0]).toMatchObject({
      id: 'rough-boundary:cell-1',
      polygon: [
        [10, -26, 0],
        [16, -20, 0],
        [10, -14, 0],
        [4, -20, 0],
      ],
    })
    expect(roughBoundaries[0]?.polygon).toHaveLength(ROUGH_BOUNDARY_VERTEX_COUNT)
  })

  it('skips rough polygons above the intermediate visible-cell limit', () => {
    expect(roughCellBoundariesForVisibleCells(cells, { maxCells: 1 })).toEqual([])
  })
})
