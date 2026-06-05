import type { BBox } from '../data/coords'
import type { OverviewViewState } from './deckLayers'

export const BOUNDARY_VIEWPORT_CELL_LIMIT = 50_000
export const MIN_BOUNDARY_VIEWPORT_CELL_LIMIT = 1
export const MAX_BOUNDARY_VIEWPORT_CELL_LIMIT = 100_000

export interface BoundaryViewportCandidate {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: OverviewViewState
}

export interface BoundaryViewportOptions {
  readonly cellLimit?: number
}

export function shouldLoadBoundaryPolygons(
  candidate: BoundaryViewportCandidate,
  options: BoundaryViewportOptions = {},
): boolean {
  if (candidate.visibleCellCount <= 0) {
    return false
  }

  return candidate.visibleCellCount < normalizeBoundaryCellLimit(options.cellLimit)
}

export function normalizeBoundaryCellLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return BOUNDARY_VIEWPORT_CELL_LIMIT
  }

  return Math.max(
    MIN_BOUNDARY_VIEWPORT_CELL_LIMIT,
    Math.min(MAX_BOUNDARY_VIEWPORT_CELL_LIMIT, Math.round(value)),
  )
}

export function boundaryViewportKey(baseUrl: string, bbox: BBox): string {
  return [
    baseUrl.replace(/\/+$/, ''),
    quantizeMicrometers(bbox.minX),
    quantizeMicrometers(bbox.maxX),
    quantizeMicrometers(bbox.minY),
    quantizeMicrometers(bbox.maxY),
  ].join(':')
}

function quantizeMicrometers(value: number): number {
  return Math.round(value / 50) * 50
}
