import { describe, expect, it } from 'vitest'
import type { GridCellDatum, OverviewCellDatum } from '../rendering/deckLayerTypes'
import { createOverviewCellIndex } from '../rendering/overviewCellIndex'
import { gridCellAtPoint, nearestOverviewCell } from './viewerKeyboardPick'

function cell(id: string, x: number, y: number, radius = 2): OverviewCellDatum {
  // Deck y is the data y negated.
  return {
    id,
    position: [x, -y, 0],
    radiusMicrometers: radius,
  } as unknown as OverviewCellDatum
}

function bin(id: string, x: number, y: number, size = 16): GridCellDatum {
  return {
    id,
    gridId: 'grid',
    row: 0,
    col: 0,
    polygon: [
      [x, -y, 0],
      [x + size, -y, 0],
      [x + size, -(y + size), 0],
      [x, -(y + size), 0],
    ],
    fillColor: [0, 0, 0, 255],
    lineColor: [0, 0, 0, 255],
  }
}

describe('keyboard picking (15.5-D)', () => {
  const cells = [cell('a', 0, 0), cell('b', 10, 0), cell('c', 30, 30, 20)]
  const index = createOverviewCellIndex(cells)

  it('opens the cell nearest the centre within reach', () => {
    expect(nearestOverviewCell(index, cells, 4, 1, 6)?.id).toBe('a')
    expect(nearestOverviewCell(index, cells, 7, 0, 6)?.id).toBe('b')
    expect(nearestOverviewCell(index, cells, 5, 15, 6)).toBeNull()
  })

  it('opens a large cell whose disk holds the centre, beyond reach', () => {
    expect(nearestOverviewCell(index, cells, 42, 40, 1)?.id).toBe('c')
  })

  it('opens the bin that holds the centre', () => {
    const bins = [bin('x', 0, 0), bin('y', 16, 0)]

    expect(gridCellAtPoint(bins, 20, 8)?.id).toBe('y')
    expect(gridCellAtPoint(bins, 40, 8)).toBeNull()
    expect(
      gridCellAtPoint(
        [{ ...bin('lod', 0, 0), renderLodSourceBinSizeMicrometers: 2 }],
        4,
        4,
      ),
    ).toBeNull()
  })
})
