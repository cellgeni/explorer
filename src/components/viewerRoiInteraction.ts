import { micrometers } from '../data/coords'
import type { BBox, DataPoint } from '../data/coords'
import type { RoiSelection } from '../data/roiSelection'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import { rawDataPointToScreen, type ScreenPoint } from './viewerMeasurements'

export type RoiDraft =
  | {
      readonly kind: 'box'
      readonly start: DataPoint
      readonly current: DataPoint
    }
  | {
      readonly kind: 'lasso'
      readonly points: readonly DataPoint[]
      readonly current: DataPoint
    }

export interface RoiPathOverlay {
  readonly d: string
  readonly isDraft: boolean
}

export interface RoiScreenRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function dataPointsToBbox(first: DataPoint, second: DataPoint): BBox {
  return {
    minX: micrometers(Math.min(first.x, second.x)),
    maxX: micrometers(Math.max(first.x, second.x)),
    minY: micrometers(Math.min(first.y, second.y)),
    maxY: micrometers(Math.max(first.y, second.y)),
  }
}

export function roiBboxToScreenRect(
  bbox: BBox | null,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): RoiScreenRect | null {
  if (bbox === null) {
    return null
  }

  const topLeft = rawDataPointToScreen(
    { x: bbox.minX, y: bbox.minY },
    viewState,
    viewport,
  )
  const bottomRight = rawDataPointToScreen(
    { x: bbox.maxX, y: bbox.maxY },
    viewState,
    viewport,
  )
  const left = Math.min(topLeft.x, bottomRight.x)
  const top = Math.min(topLeft.y, bottomRight.y)
  const right = Math.max(topLeft.x, bottomRight.x)
  const bottom = Math.max(topLeft.y, bottomRight.y)

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

export function dataPointsToPathOverlay(
  points: readonly DataPoint[],
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  isDraft: boolean,
): RoiPathOverlay | null {
  if (points.length < 2) {
    return null
  }

  const screenPoints = points.map((point) =>
    rawDataPointToScreen(point, viewState, viewport),
  )

  return {
    d: screenPointsToPath(screenPoints, !isDraft && screenPoints.length >= 3),
    isDraft,
  }
}

export function roiSelectionFromBox(
  first: DataPoint,
  second: DataPoint,
): RoiSelection | null {
  const bbox = dataPointsToBbox(first, second)

  return hasMinimumRoiSize(bbox) ? { kind: 'box', bbox } : null
}

export function roiSelectionFromLasso(points: readonly DataPoint[]): RoiSelection | null {
  const bbox = dataPointArrayToBbox(points)

  if (bbox === null || points.length < 3 || !hasMinimumRoiSize(bbox)) {
    return null
  }

  return { kind: 'lasso', bbox, points }
}

export function hasMinimumPointStep(
  first: DataPoint,
  second: DataPoint,
  minDistance: number,
): boolean {
  const deltaX = second.x - first.x
  const deltaY = second.y - first.y

  return deltaX * deltaX + deltaY * deltaY >= minDistance * minDistance
}

function dataPointArrayToBbox(points: readonly DataPoint[]): BBox | null {
  if (points.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function screenPointsToPath(points: readonly ScreenPoint[], closePath: boolean): string {
  const [firstPoint, ...remainingPoints] = points

  if (firstPoint === undefined) {
    return ''
  }

  const lineCommands = remainingPoints
    .map((point) => `L ${formatPathPoint(point.x)} ${formatPathPoint(point.y)}`)
    .join(' ')

  return [
    `M ${formatPathPoint(firstPoint.x)} ${formatPathPoint(firstPoint.y)}`,
    lineCommands,
    closePath ? 'Z' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function formatPathPoint(value: number): string {
  return value.toFixed(2)
}

function hasMinimumRoiSize(bbox: BBox): boolean {
  return bbox.maxX - bbox.minX >= 1 && bbox.maxY - bbox.minY >= 1
}
