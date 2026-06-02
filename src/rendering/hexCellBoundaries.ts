import { overviewCellColor } from './deckLayers'
import type { CellColorLookup, OverviewCellDatum } from './deckLayers'
import type { CellBoundaryDatum } from './deckLayers'

export const HEX_BOUNDARY_MULTIPLIER = 6
export const HEX_BOUNDARY_VERTEX_COUNT = 6
export const HEX_BOUNDARY_FALLBACK_RADIUS_MICROMETERS = 5

export interface HexCellBoundaryOptions {
  readonly maxCells: number
  readonly fillColorSource?: 'default' | 'cell'
  readonly lineColor?: CellBoundaryDatum['lineColor']
  readonly lineColorSource?: 'default' | 'cell'
  readonly cellColorLookup?: CellColorLookup | null
}

export function hexBoundaryCellLimit(fullBoundaryCellLimit: number): number {
  return Math.max(0, Math.round(fullBoundaryCellLimit * HEX_BOUNDARY_MULTIPLIER))
}

export function hexCellBoundariesForVisibleCells(
  cells: readonly OverviewCellDatum[],
  options: HexCellBoundaryOptions,
): readonly CellBoundaryDatum[] {
  if (cells.length === 0 || cells.length > options.maxCells) {
    return []
  }

  return cells.map((cell) => hexCellBoundary(cell, options))
}

function hexCellBoundary(
  cell: OverviewCellDatum,
  options: HexCellBoundaryOptions,
): CellBoundaryDatum {
  const [x = 0, y = 0] = cell.position
  const radius =
    cell.radiusMicrometers ??
    Math.max(cell.radiusPixels, HEX_BOUNDARY_FALLBACK_RADIUS_MICROMETERS)
  const color = overviewCellColor(cell, options.cellColorLookup ?? null)

  return {
    id: `hex-boundary:${cell.id}`,
    polygon: hexagonPolygon(x, y, radius),
    fillColor: options.fillColorSource === 'cell' ? color : [32, 102, 83, 18],
    lineColor:
      options.lineColorSource === 'cell'
        ? cellLineColor(color)
        : (options.lineColor ?? [246, 242, 232, 112]),
  }
}

function cellLineColor(
  color: CellBoundaryDatum['lineColor'],
): CellBoundaryDatum['lineColor'] {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(235, Math.max(160, color[3] ?? 210)),
  ]
}

function hexagonPolygon(
  centerX: number,
  centerY: number,
  radius: number,
): CellBoundaryDatum['polygon'] {
  const points: [number, number, number][] = []

  for (let index = 0; index < HEX_BOUNDARY_VERTEX_COUNT; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3
    points.push([
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
      0,
    ])
  }

  return points
}
