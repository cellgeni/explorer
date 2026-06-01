import type { BBox } from '../data/coords'
import type { OverviewViewState } from './deckLayers'

export const BOUNDARY_VIEWPORT_CELL_LIMIT = 500
export const BOUNDARY_MIN_ZOOM = -1

export interface BoundaryViewportCandidate {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: OverviewViewState
}

export function shouldLoadBoundaryPolygons(
  candidate: BoundaryViewportCandidate,
): boolean {
  if (candidate.visibleCellCount <= 0) {
    return false
  }

  return (
    candidate.visibleCellCount <= BOUNDARY_VIEWPORT_CELL_LIMIT ||
    candidate.viewState.zoom >= BOUNDARY_MIN_ZOOM
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
