import type { DataPoint, Micrometers } from './coords'

export type TranscriptScope = 'spatial' | 'cells-only'

export interface CircleSelection {
  readonly kind: 'circle'
  readonly cx: Micrometers
  readonly cy: Micrometers
  readonly radius: Micrometers
}

export interface PolygonSelection {
  readonly kind: 'polygon'
  readonly points: readonly DataPoint[]
}

export type Selection = CircleSelection | PolygonSelection
export type SqlParameter = string | number

export interface SqlFragment {
  readonly sql: string
  readonly params: readonly SqlParameter[]
}

export function selectionToSql(
  selection: Selection,
  xCol: string,
  yCol: string,
): SqlFragment {
  if (selection.kind === 'circle') {
    const { cx, cy, radius } = selection

    return {
      sql: `${xCol} BETWEEN ? AND ?
AND ${yCol} BETWEEN ? AND ?
AND (${xCol}-?)*(${xCol}-?) + (${yCol}-?)*(${yCol}-?) <= ?`,
      params: [
        cx - radius,
        cx + radius,
        cy - radius,
        cy + radius,
        cx,
        cx,
        cy,
        cy,
        radius * radius,
      ],
    }
  }

  const firstPoint = selection.points[0]

  if (firstPoint === undefined) {
    throw new Error('Polygon selection requires at least one point.')
  }

  const xs = selection.points.map((point) => point.x)
  const ys = selection.points.map((point) => point.y)
  const ring = selection.points.map((point) => `${point.x} ${point.y}`).join(', ')
  const wkt = `POLYGON((${ring}, ${firstPoint.x} ${firstPoint.y}))`

  return {
    sql: `${xCol} BETWEEN ? AND ?
AND ${yCol} BETWEEN ? AND ?
AND ST_Within(ST_Point(${xCol}, ${yCol}), ST_GeomFromText(?))`,
    params: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), wkt],
  }
}
