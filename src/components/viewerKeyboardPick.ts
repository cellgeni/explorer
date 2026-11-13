import { micrometers, type BBox } from '../data/coords'
import type { GridCellDatum, OverviewCellDatum } from '../rendering/deckLayerTypes'
import {
  overviewCellIndicesNear,
  type OverviewCellIndex,
} from '../rendering/overviewCellIndex'
import { gridCellIntersectsBbox, isRenderLodGridCell } from './viewerGridCellIndex'

// Enter on the canvas (plan 15.5-D) opens what is at the centre
// of the view, which a crosshair marks while the canvas has keyboard focus,
// so a Cell or Bin card can be opened without a pointer.

// How far from the centre a cell may be, in screen pixels.
export const KEYBOARD_PICK_RADIUS_PIXELS = 24

// The cell whose centre is nearest the point (data µm, y down), within
// reach (µm) or inside its own drawn radius.
export function nearestOverviewCell(
  index: OverviewCellIndex,
  cells: readonly OverviewCellDatum[],
  x: number,
  y: number,
  reach: number,
): OverviewCellDatum | null {
  const radius = Math.max(reach, index.maxRadius)
  let nearest: OverviewCellDatum | null = null
  let nearestDistance = Infinity

  for (const cellIndex of overviewCellIndicesNear(index, x, y, radius)) {
    const cell = cells[cellIndex]
    if (cell === undefined) continue

    const distance = Math.hypot(
      (index.xs[cellIndex] ?? 0) - x,
      (index.ys[cellIndex] ?? 0) - y,
    )
    const cellReach = Math.max(reach, cell.radiusMicrometers ?? 0)

    if (distance <= cellReach && distance < nearestDistance) {
      nearest = cell
      nearestDistance = distance
    }
  }

  return nearest
}

// The drawn bin that holds the point (data µm, y down). Coarse bins drawn
// while zoomed out are not bins a card can show.
export function gridCellAtPoint(
  gridCells: readonly GridCellDatum[],
  x: number,
  y: number,
): GridCellDatum | null {
  const point: BBox = {
    minX: micrometers(x),
    maxX: micrometers(x),
    minY: micrometers(y),
    maxY: micrometers(y),
  }

  for (let index = gridCells.length - 1; index >= 0; index -= 1) {
    const cell = gridCells[index]
    if (
      cell !== undefined &&
      !isRenderLodGridCell(cell) &&
      gridCellIntersectsBbox(cell, point)
    ) {
      return cell
    }
  }

  return null
}
