import type { BBox, DataPoint } from './coords'
import type { Selection } from './gex'

export type RoiSelection =
  | { readonly kind: 'box'; readonly bbox: BBox }
  | {
      readonly kind: 'lasso'
      readonly bbox: BBox
      readonly points: readonly DataPoint[]
    }

export type RoiSelectionInput = BBox | RoiSelection

export function normalizeRoiSelection(input: RoiSelectionInput): RoiSelection {
  return isRoiSelection(input) ? input : { kind: 'box', bbox: input }
}

export function roiSelectionToSpatialSelection(
  selection: RoiSelection,
): Selection | null {
  return selection.kind === 'lasso' ? { kind: 'polygon', points: selection.points } : null
}

export function isRoiSelection(input: RoiSelectionInput): input is RoiSelection {
  return 'kind' in input
}

// The selection's area in µm²: the box, or the lasso's polygon.
export function roiSelectionArea(selection: RoiSelection): number {
  if (selection.kind === 'box') {
    const { minX, minY, maxX, maxY } = selection.bbox
    return Math.abs((maxX - minX) * (maxY - minY))
  }

  let twiceArea = 0
  const { points } = selection

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (current === undefined || next === undefined) continue

    twiceArea += current.x * next.y - next.x * current.y
  }

  return Math.abs(twiceArea) / 2
}

// Whether a point (data µm) is inside the box, or inside the lasso's polygon
// (even-odd rule).
export function roiSelectionContains(selection: RoiSelection, point: DataPoint): boolean {
  const { minX, minY, maxX, maxY } = selection.bbox

  if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
    return false
  }

  if (selection.kind === 'box') return true

  const { points } = selection
  let inside = false

  for (let index = 0, previous = points.length - 1; index < points.length; index += 1) {
    const current = points[index]
    const before = points[previous]
    previous = index

    if (current === undefined || before === undefined) continue

    if (
      current.y > point.y !== before.y > point.y &&
      point.x <
        ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) +
          current.x
    ) {
      inside = !inside
    }
  }

  return inside
}
