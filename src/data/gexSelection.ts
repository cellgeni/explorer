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

// The Parquet type of a coordinate column. Xenium stores cell centroids as
// DOUBLE, and boundary vertices and transcript locations as FLOAT.
export type SqlCoordinateType = 'DOUBLE' | 'FLOAT'

// DuckDB compares a FLOAT column with a DOUBLE parameter by casting the
// column, and a cast column cannot be checked against Parquet row-group
// statistics, so every row group is read. Casting the bounds to FLOAT keeps
// the comparison on the column. On a DOUBLE column the bounds then move by at
// most half a FLOAT step, under 1 nm for coordinates below 32,768 µm.
export function betweenSql(column: string, type: SqlCoordinateType = 'DOUBLE'): string {
  return type === 'FLOAT'
    ? `${column} BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)`
    : `${column} BETWEEN ? AND ?`
}

export function selectionToSql(
  selection: Selection,
  xCol: string,
  yCol: string,
  type: SqlCoordinateType = 'DOUBLE',
): SqlFragment {
  if (selection.kind === 'circle') {
    const { cx, cy, radius } = selection

    return {
      sql: `${betweenSql(xCol, type)}
AND ${betweenSql(yCol, type)}
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
    sql: `${betweenSql(xCol, type)}
AND ${betweenSql(yCol, type)}
AND ST_Within(ST_Point(${xCol}, ${yCol}), ST_GeomFromText(?))`,
    params: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), wkt],
  }
}
