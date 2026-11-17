import type { GridCellDatum, OverviewCellDatum } from '../rendering/deckLayerTypes'
import {
  gridCellAt,
  gridCellIndexAtPoint,
  gridCellTileIndex,
  isRenderLodGridCellColumns,
  type GridCellColumns,
} from '../rendering/gridCellColumns'
import {
  overviewCellIndicesNear,
  type OverviewCellIndex,
} from '../rendering/overviewCellIndex'

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
  gridCells: GridCellColumns,
  x: number,
  y: number,
): GridCellDatum | null {
  if (isRenderLodGridCellColumns(gridCells)) {
    return null
  }

  const index = gridCellIndexAtPoint(gridCellTileIndex(gridCells), x, y)

  return index < 0 ? null : gridCellAt(gridCells, index)
}
