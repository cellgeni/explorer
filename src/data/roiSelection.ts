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

// The selection's area in µm²: the box, or the region the lasso selects by
// the even-odd rule, as `roiSelectionContains` does. A lasso that crosses
// itself selects each lobe, whichever way it winds.
export function roiSelectionArea(selection: RoiSelection): number {
  if (selection.kind === 'box') {
    const { minX, minY, maxX, maxY } = selection.bbox
    return Math.abs((maxX - minX) * (maxY - minY))
  }

  const cached = lassoAreas.get(selection.points)
  if (cached !== undefined) return cached
  const area = evenOddArea(selection.points)
  lassoAreas.set(selection.points, area)
  return area
}

const lassoAreas = new WeakMap<readonly DataPoint[], number>()

interface AreaEdge {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

const edgeX = (edge: AreaEdge, y: number) =>
  edge.x0 + ((y - edge.y0) * (edge.x1 - edge.x0)) / (edge.y1 - edge.y0)

// The polygon cut into horizontal slabs at its vertices, and again where two
// edges cross, so that no edges cross inside a slab. Sorted along x, each
// pair of edges then bounds a trapezoid inside the polygon.
function evenOddArea(points: readonly DataPoint[]): number {
  const edges: AreaEdge[] = []
  const vertexYs: number[] = []

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (current === undefined || next === undefined) continue
    vertexYs.push(current.y)
    // Edges along x bound no slab.
    if (current.y === next.y) continue
    edges.push(
      current.y < next.y
        ? { x0: current.x, y0: current.y, x1: next.x, y1: next.y }
        : { x0: next.x, y0: next.y, x1: current.x, y1: current.y },
    )
  }

  edges.sort((a, b) => a.y0 - b.y0)
  const ys = [...new Set(vertexYs)].sort((a, b) => a - b)
  let active: AreaEdge[] = []
  let nextEdge = 0
  let area = 0

  for (let slab = 0; slab + 1 < ys.length; slab += 1) {
    const top = ys[slab] ?? 0
    const bottom = ys[slab + 1] ?? 0

    active = active.filter((edge) => edge.y1 > top)
    for (; nextEdge < edges.length && (edges[nextEdge]?.y0 ?? 0) <= top; nextEdge += 1) {
      const edge = edges[nextEdge]
      if (edge !== undefined && edge.y1 > top) active.push(edge)
    }

    const cuts = [top, bottom]

    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i]
        const b = active[j]
        if (a === undefined || b === undefined) continue
        const before = edgeX(a, top) - edgeX(b, top)
        const after = edgeX(a, bottom) - edgeX(b, bottom)
        if (before * after < 0) {
          cuts.push(top + ((bottom - top) * before) / (before - after))
        }
      }
    }

    cuts.sort((a, b) => a - b)

    for (let cut = 0; cut + 1 < cuts.length; cut += 1) {
      const from = cuts[cut] ?? 0
      const to = cuts[cut + 1] ?? 0
      if (!(to > from)) continue
      const middle = (from + to) / 2
      const sorted = active
        .map((edge) => ({ edge, x: edgeX(edge, middle) }))
        .sort((a, b) => a.x - b.x)

      for (let pair = 0; pair + 1 < sorted.length; pair += 2) {
        const left = sorted[pair]?.edge
        const right = sorted[pair + 1]?.edge
        if (left === undefined || right === undefined) continue
        const widthFrom = edgeX(right, from) - edgeX(left, from)
        const widthTo = edgeX(right, to) - edgeX(left, to)
        area += ((widthFrom + widthTo) / 2) * (to - from)
      }
    }
  }

  return area
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
