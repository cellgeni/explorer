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

// A saved selection's outline on screen, closed.
export function roiSelectionToScreenPath(
  selection: RoiSelection,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): string | null {
  const { minX, minY, maxX, maxY } = selection.bbox
  const points =
    selection.kind === 'lasso'
      ? selection.points
      : [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ]

  return dataPointsToPathOverlay(points, viewState, viewport, false)?.d ?? null
}

export function roiSelectionFromBox(
  first: DataPoint,
  second: DataPoint,
): RoiSelection | null {
  const bbox = dataPointsToBbox(first, second)

  return hasMinimumRoiSize(bbox) ? { kind: 'box', bbox } : null
}

// A lasso as drawn, with points no further than `tolerance` (one screen
// pixel, in data units) from the path left out. The pointer adds a point every
// few pixels, so a lasso would otherwise keep hundreds that a share link
// writes out one by one.
export function roiSelectionFromLasso(
  drawnPoints: readonly DataPoint[],
  tolerance = 0,
): RoiSelection | null {
  const points = simplifyLassoPoints(drawnPoints, tolerance)
  const bbox = dataPointArrayToBbox(points)

  if (bbox === null || points.length < 3 || !hasMinimumRoiSize(bbox)) {
    return null
  }

  return { kind: 'lasso', bbox, points }
}

// Douglas–Peucker: the first and last points and, between them, each point
// further than `tolerance` from the line through its neighbours kept.
export function simplifyLassoPoints(
  points: readonly DataPoint[],
  tolerance: number,
): readonly DataPoint[] {
  if (!(tolerance > 0) || points.length <= 3) {
    return points
  }

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const spans: [number, number][] = [[0, points.length - 1]]

  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [first, last] = span
    let farthest = -1
    let farthestDistance = tolerance

    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(points[index], points[first], points[last])

      if (distance > farthestDistance) {
        farthest = index
        farthestDistance = distance
      }
    }

    if (farthest >= 0) {
      keep[farthest] = 1
      spans.push([first, farthest], [farthest, last])
    }
  }

  const kept = points.filter((_, index) => keep[index] === 1)
  return kept.length >= 3 ? kept : points
}

function distanceToSegment(
  point: DataPoint | undefined,
  start: DataPoint | undefined,
  end: DataPoint | undefined,
): number {
  if (point === undefined || start === undefined || end === undefined) {
    return 0
  }

  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
          ),
        )

  return Math.hypot(
    point.x - (start.x + along * deltaX),
    point.y - (start.y + along * deltaY),
  )
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
