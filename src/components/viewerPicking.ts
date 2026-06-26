import type { Position } from '@deck.gl/core'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
  TranscriptAggregateDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'

export function isOverviewCellDatum(value: unknown): value is OverviewCellDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<OverviewCellDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.radiusPixels === 'number'
  )
}

export function isCellBoundaryDatum(value: unknown): value is CellBoundaryDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<CellBoundaryDatum>

  return typeof candidate.id === 'string' && Array.isArray(candidate.polygon)
}

export function isGridCellDatum(value: unknown): value is GridCellDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<GridCellDatum>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.gridId === 'string' &&
    typeof candidate.row === 'number' &&
    typeof candidate.col === 'number' &&
    Array.isArray(candidate.polygon)
  )
}

export function isTranscriptPointDatum(value: unknown): value is TranscriptPointDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<TranscriptPointDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.featureName === 'string' &&
    typeof candidate.qv === 'number'
  )
}

export function isTranscriptAggregateDatum(
  value: unknown,
): value is TranscriptAggregateDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<TranscriptAggregateDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.count === 'number' &&
    typeof candidate.radiusMicrometers === 'number'
  )
}

export function cellForDeckCoordinate(
  coordinate: readonly number[] | undefined,
  boundaries: readonly CellBoundaryDatum[],
  cells: readonly OverviewCellDatum[],
  cellById: ReadonlyMap<string, OverviewCellDatum>,
): OverviewCellDatum | null {
  const x = coordinate?.[0]
  const y = coordinate?.[1]

  if (x === undefined || y === undefined) {
    return null
  }

  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index]

    if (boundary === undefined || !polygonContainsDeckPoint(boundary.polygon, x, y)) {
      continue
    }

    return cellById.get(boundary.id) ?? null
  }

  for (const cell of cells) {
    const [cellX = 0, cellY = 0] = cell.position
    const radius = Math.max(0, cell.radiusMicrometers ?? cell.radiusPixels)
    const dx = x - cellX
    const dy = y - cellY

    if (dx * dx + dy * dy <= radius * radius) {
      return cell
    }
  }

  return null
}

function polygonContainsDeckPoint(
  polygon: readonly Position[],
  x: number,
  y: number,
): boolean {
  if (polygon.length < 3) {
    return false
  }

  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]

    if (current === undefined || previous === undefined) {
      continue
    }

    const currentX = current[0] ?? 0
    const currentY = current[1] ?? 0
    const previousX = previous[0] ?? 0
    const previousY = previous[1] ?? 0
    const crossesY = currentY > y !== previousY > y

    if (
      crossesY &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    ) {
      inside = !inside
    }
  }

  return inside
}
