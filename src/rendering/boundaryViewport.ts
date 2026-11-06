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

// Boundary requests cover the viewport plus this fraction of its width and
// height on each side, so short pans stay inside the loaded area.
export const BOUNDARY_VIEWPORT_PADDING = 0.25
// Zooming in by this much re-requests boundaries for finer label levels.
const BOUNDARY_REQUEST_ZOOM_STEP = 1

export interface BoundaryRequestArea {
  readonly bbox: BBox
  readonly zoom: number
}

// Pads the viewport, shrinking the padding when the padded area would hold
// more cells than the boundary limit.
export function paddedBoundaryBbox(
  candidate: BoundaryViewportCandidate,
  options: BoundaryViewportOptions = {},
): BBox {
  const limit = normalizeBoundaryCellLimit(options.cellLimit)
  const areaHeadroom =
    candidate.visibleCellCount > 0 ? limit / candidate.visibleCellCount : Infinity
  const padding = Math.max(
    0,
    Math.min(BOUNDARY_VIEWPORT_PADDING, (Math.sqrt(Math.max(1, areaHeadroom)) - 1) / 2),
  )
  const { bbox } = candidate
  const padX = (bbox.maxX - bbox.minX) * padding
  const padY = (bbox.maxY - bbox.minY) * padding

  return {
    minX: (bbox.minX - padX) as BBox['minX'],
    maxX: (bbox.maxX + padX) as BBox['maxX'],
    minY: (bbox.minY - padY) as BBox['minY'],
    maxY: (bbox.maxY + padY) as BBox['maxY'],
  }
}

// True when the last request already covers the viewport at a similar zoom.
export function boundaryRequestCovers(
  request: BoundaryRequestArea | null,
  candidate: BoundaryViewportCandidate,
): boolean {
  return (
    request !== null &&
    candidate.viewState.zoom - request.zoom < BOUNDARY_REQUEST_ZOOM_STEP &&
    request.bbox.minX <= candidate.bbox.minX &&
    request.bbox.maxX >= candidate.bbox.maxX &&
    request.bbox.minY <= candidate.bbox.minY &&
    request.bbox.maxY >= candidate.bbox.maxY
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
