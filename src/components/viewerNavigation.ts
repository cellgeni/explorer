import type { KeyboardEvent, PointerEvent } from 'react'
import { micrometers, scaleFromZoom } from '../data/coords'
import type { BBox, DataPoint } from '../data/coords'
import type { GridCellDatum, OverviewViewState } from '../rendering/deckLayers'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { InitialViewStateOverride, ViewerCoordinateUnit } from './viewerCoreTypes'
import { formatCoordinateValue, safeMicrometersPerPixel } from './viewerMeasurements'

export interface BoundaryStyleViewport {
  readonly bbox: BBox
  readonly zoom: number
}

export interface MouseCoordinate {
  readonly xMicrometers: number
  readonly yMicrometers: number
}

export function pointerEventToDataPoint(
  event: PointerEvent<HTMLDivElement>,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): DataPoint {
  const rect = event.currentTarget.getBoundingClientRect()
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: micrometers((event.clientX - rect.left - offsetX) / scale),
    y: micrometers((event.clientY - rect.top - offsetY) / scale),
  }
}

export function bboxFromCircle(center: DataPoint, radius: number): BBox {
  return {
    minX: micrometers(Math.max(0, center.x - radius)),
    maxX: micrometers(center.x + radius),
    minY: micrometers(Math.max(0, center.y - radius)),
    maxY: micrometers(center.y + radius),
  }
}

export function countGridCellsInBbox(
  gridCells: readonly GridCellDatum[],
  bbox: BBox,
): number {
  let count = 0

  for (const cell of gridCells) {
    if (gridCellIntersectsBbox(cell, bbox)) {
      count += 1
    }
  }

  return count
}

export function formatMouseCoordinate(
  coordinate: MouseCoordinate,
  unit: ViewerCoordinateUnit,
  micrometersPerPixel: number,
): string {
  if (unit === 'px') {
    const pixelSize = safeMicrometersPerPixel(micrometersPerPixel)

    return `X ${formatCoordinateValue(coordinate.xMicrometers / pixelSize)} px | Y ${formatCoordinateValue(coordinate.yMicrometers / pixelSize)} px`
  }

  return `X ${formatCoordinateValue(coordinate.xMicrometers)} μm | Y ${formatCoordinateValue(coordinate.yMicrometers)} μm`
}

export function mergeInitialViewState(
  fittedViewState: OverviewViewState,
  override: InitialViewStateOverride | undefined,
): OverviewViewState {
  if (override === undefined) {
    return fittedViewState
  }

  const nextViewState = normaliseViewState({
    ...fittedViewState,
    ...override,
    target: override.target ?? fittedViewState.target,
    minZoom: fittedViewState.minZoom,
    maxZoom: fittedViewState.maxZoom,
  })

  return {
    ...nextViewState,
    zoom: clampZoom(nextViewState.zoom, fittedViewState),
  }
}

export function viewStateFromKeyboardEvent(
  event: KeyboardEvent<HTMLDivElement>,
  viewState: OverviewViewState,
  initialViewState: OverviewViewState,
): OverviewViewState | null {
  const panStep = (event.shiftKey ? 256 : 64) / scaleFromZoom(viewState.zoom)

  switch (event.key) {
    case 'ArrowLeft':
      return {
        ...viewState,
        target: [viewState.target[0] - panStep, viewState.target[1], viewState.target[2]],
      }
    case 'ArrowRight':
      return {
        ...viewState,
        target: [viewState.target[0] + panStep, viewState.target[1], viewState.target[2]],
      }
    case 'ArrowUp':
      return {
        ...viewState,
        target: [viewState.target[0], viewState.target[1] - panStep, viewState.target[2]],
      }
    case 'ArrowDown':
      return {
        ...viewState,
        target: [viewState.target[0], viewState.target[1] + panStep, viewState.target[2]],
      }
    case '+':
    case '=':
      return {
        ...viewState,
        zoom: clampZoom(viewState.zoom + 0.5, viewState),
      }
    case '-':
    case '_':
      return {
        ...viewState,
        zoom: clampZoom(viewState.zoom - 0.5, viewState),
      }
    case 'Home':
      return initialViewState
    default:
      return null
  }
}

export function normaliseViewState(viewState: {
  readonly target?: readonly [number, number] | readonly [number, number, number]
  readonly zoom?: number
  readonly minZoom?: number
  readonly maxZoom?: number
}): OverviewViewState {
  const target = viewState.target ?? [0, 0, 0]

  return {
    target: [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0],
    zoom: viewState.zoom ?? 0,
    minZoom: viewState.minZoom ?? -10,
    maxZoom: viewState.maxZoom ?? 10,
  }
}

export function equivalentViewState(
  left: OverviewViewState,
  right: OverviewViewState,
): boolean {
  return (
    nearlyEqual(left.target[0], right.target[0], 0.5) &&
    nearlyEqual(left.target[1], right.target[1], 0.5) &&
    nearlyEqual(left.target[2], right.target[2], 0.5) &&
    nearlyEqual(left.zoom, right.zoom, 0.001) &&
    nearlyEqual(left.minZoom, right.minZoom, 0.001) &&
    nearlyEqual(left.maxZoom, right.maxZoom, 0.001)
  )
}

export function equivalentViewportSize(
  left: CssViewportSize,
  right: CssViewportSize,
): boolean {
  return (
    nearlyEqual(left.width, right.width, 0.5) &&
    nearlyEqual(left.height, right.height, 0.5)
  )
}

export function equivalentBoundaryStyleViewport(
  left: BoundaryStyleViewport | null,
  right: BoundaryStyleViewport,
): boolean {
  return (
    left !== null &&
    nearlyEqual(left.zoom, right.zoom, 0.001) &&
    nearlyEqual(left.bbox.minX, right.bbox.minX, 0.5) &&
    nearlyEqual(left.bbox.maxX, right.bbox.maxX, 0.5) &&
    nearlyEqual(left.bbox.minY, right.bbox.minY, 0.5) &&
    nearlyEqual(left.bbox.maxY, right.bbox.maxY, 0.5)
  )
}

export function viewStateKey(viewState: OverviewViewState): string {
  return `${viewState.target.join(':')}:${viewState.zoom}`
}

function clampZoom(zoom: number, viewState: OverviewViewState): number {
  return Math.min(viewState.maxZoom, Math.max(viewState.minZoom, zoom))
}

function gridCellIntersectsBbox(cell: GridCellDatum, bbox: BBox): boolean {
  if (cell.polygon.length === 0) {
    return false
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x = 0, deckY = 0] of cell.polygon) {
    const rawY = -deckY
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  return maxX >= bbox.minX && minX <= bbox.maxX && maxY >= bbox.minY && minY <= bbox.maxY
}

function nearlyEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance
}
