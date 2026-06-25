import type { BBox } from '../data/coords'
import type { OverviewViewState } from './deckLayers'

export const BOUNDARY_VIEWPORT_CELL_LIMIT = 50_000
export const MIN_BOUNDARY_VIEWPORT_CELL_LIMIT = 1
export const MAX_BOUNDARY_VIEWPORT_CELL_LIMIT = 100_000
export const BOUNDARY_VIEWPORT_CELL_SCALE_ZOOM = -0.25

export interface BoundaryViewportCandidate {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: OverviewViewState
}

export interface BoundaryViewportOptions {
  readonly cellLimit?: number
  readonly cellScaleZoom?: number
}

export function shouldLoadBoundaryPolygons(
  candidate: BoundaryViewportCandidate,
  options: BoundaryViewportOptions = {},
): boolean {
  if (candidate.visibleCellCount <= 0) {
    return false
  }

  if (candidate.viewState.zoom >= normalizeCellScaleZoom(options.cellScaleZoom)) {
    return true
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

function normalizeCellScaleZoom(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? BOUNDARY_VIEWPORT_CELL_SCALE_ZOOM
    : value
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
