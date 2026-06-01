import type { OverviewCellDatum } from './deckLayers'
import type { CellBoundaryDatum } from './deckLayers'

export const ROUGH_BOUNDARY_MULTIPLIER = 3
export const ROUGH_BOUNDARY_VERTEX_COUNT = 4
export const ROUGH_BOUNDARY_FALLBACK_RADIUS_MICROMETERS = 5

export interface RoughCellBoundaryOptions {
  readonly maxCells: number
}

export function roughBoundaryCellLimit(fullBoundaryCellLimit: number): number {
  return Math.max(0, Math.round(fullBoundaryCellLimit * ROUGH_BOUNDARY_MULTIPLIER))
}

export function roughCellBoundariesForVisibleCells(
  cells: readonly OverviewCellDatum[],
  options: RoughCellBoundaryOptions,
): readonly CellBoundaryDatum[] {
  if (cells.length === 0 || cells.length > options.maxCells) {
    return []
  }

  return cells.map(roughCellBoundary)
}

function roughCellBoundary(cell: OverviewCellDatum): CellBoundaryDatum {
  const [x = 0, y = 0] = cell.position
  const radius =
    cell.radiusMicrometers ??
    Math.max(cell.radiusPixels, ROUGH_BOUNDARY_FALLBACK_RADIUS_MICROMETERS)

  return {
    id: `rough-boundary:${cell.id}`,
    polygon: [
      [x, y - radius, 0],
      [x + radius, y, 0],
      [x, y + radius, 0],
      [x - radius, y, 0],
    ],
    fillColor: [32, 102, 83, 18],
    lineColor: [246, 242, 232, 112],
  }
}
