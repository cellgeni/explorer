import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { overviewCellsInBbox } from './cellAggregation'
import {
  countOverviewCellsInBbox,
  createOverviewCellIndex,
  overviewCellIndicesNear,
} from './overviewCellIndex'
import type { OverviewCellDatum } from './deckLayerTypes'

function seededRandom(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32
    return state / 2 ** 32
  }
}

const random = seededRandom(7)
const cells: OverviewCellDatum[] = Array.from({ length: 5_000 }, (_value, index) => ({
  id: `cell-${index}`,
  position: [random() * 2_000, -random() * 1_000, 0],
  radiusPixels: 2,
  radiusMicrometers: 1 + random() * 6,
  fillColor: [0, 0, 0, 255],
}))

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

describe('overview cell index', () => {
  const index = createOverviewCellIndex(cells)

  it.each([
    bbox(0, 0, 2_000, 1_000),
    bbox(120, 340, 760, 410),
    bbox(-50, -50, 10, 10),
    bbox(1_999, 999, 3_000, 2_000),
  ])('counts the cells in view exactly', (box) => {
    expect(countOverviewCellsInBbox(index, box)).toBe(
      overviewCellsInBbox(cells, box).length,
    )
  })

  it('finds every cell that could contain a point', () => {
    const x = (cells[123]?.position[0] ?? 0) + 0.5
    const y = -(cells[123]?.position[1] ?? 0) - 0.5
    const near = new Set(overviewCellIndicesNear(index, x, y))
    const containing = cells.flatMap((cell, cellIndex) => {
      const dx = (cell.position[0] ?? 0) - x
      const dy = -(cell.position[1] ?? 0) - y
      const radius = cell.radiusMicrometers ?? cell.radiusPixels
      return dx * dx + dy * dy <= radius * radius ? [cellIndex] : []
    })

    expect(containing.length).toBeGreaterThan(0)
    expect(containing.every((cellIndex) => near.has(cellIndex))).toBe(true)
  })
})
