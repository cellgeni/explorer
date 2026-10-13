import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import type { AsyncBuffer, Compressors, FileMetaData } from 'hyparquet'
import { affineScale, applyAffine, type Affine2D } from './spatialDataTransforms'

export interface SpatialDataPoint {
  readonly x: number
  readonly y: number
}

export type SpatialDataShapeGeometry =
  | {
      readonly kind: 'circle'
      readonly center: SpatialDataPoint
      readonly radius: number
    }
  | {
      readonly kind: 'polygon'
      readonly rings: readonly (readonly SpatialDataPoint[])[]
    }

export interface SpatialDataShape {
  readonly id: string
  readonly geometry: SpatialDataShapeGeometry
  readonly centroid: SpatialDataPoint
}

export interface ReadSpatialDataShapesOptions {
  readonly url: string
  readonly affine: Affine2D
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly compressors?: Compressors
}

export type SpatialDataShapesReader = (
  options: ReadSpatialDataShapesOptions,
) => Promise<readonly SpatialDataShape[]>

interface GeoJsonGeometry {
  readonly type: string
  readonly coordinates: unknown
}

const DEFAULT_CIRCLE_RADIUS = 1

export const readSpatialDataShapes: SpatialDataShapesReader = async (options) => {
  const file = await asyncBufferFromUrl({
    url: options.url,
    ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
  const metadata = await parquetMetadataAsync(file)
  const compressors = options.compressors ?? (await loadDefaultCompressors())
  const layout = shapesParquetLayout(metadata)
  const rows = await parquetReadObjects({
    file: file as AsyncBuffer,
    metadata,
    columns: layout.columns,
    compressors,
  })

  return shapesFromRows(rows, layout, options.affine)
}

export interface SpatialDataShapesParquetLayout {
  readonly columns: string[]
  readonly geometryColumn: string
  readonly radiusColumn?: string
  readonly index:
    | { readonly kind: 'column'; readonly column: string }
    | { readonly kind: 'range'; readonly start: number; readonly step: number }
}

export function shapesParquetLayout(
  metadata: FileMetaData,
): SpatialDataShapesParquetLayout {
  const columnNames = new Set(metadata.schema.slice(1).map((element) => element.name))
  const keyValues = new Map(
    (metadata.key_value_metadata ?? []).map((entry) => [entry.key, entry.value]),
  )
  const geo = parseJsonRecord(keyValues.get('geo'))
  const pandas = parseJsonRecord(keyValues.get('pandas'))
  const geometryColumn =
    typeof geo?.primary_column === 'string' ? geo.primary_column : 'geometry'

  if (!columnNames.has(geometryColumn)) {
    throw new Error(
      `SpatialData shapes parquet does not contain a ${geometryColumn} geometry column.`,
    )
  }

  const radiusColumn = columnNames.has('radius') ? 'radius' : undefined
  const indexEntry = Array.isArray(pandas?.index_columns)
    ? pandas.index_columns[0]
    : undefined
  const indexRecord =
    typeof indexEntry === 'object' && indexEntry !== null
      ? (indexEntry as Record<string, unknown>)
      : null
  const index: SpatialDataShapesParquetLayout['index'] =
    typeof indexEntry === 'string' && columnNames.has(indexEntry)
      ? { kind: 'column', column: indexEntry }
      : indexRecord?.kind === 'range'
        ? {
            kind: 'range',
            start: typeof indexRecord.start === 'number' ? indexRecord.start : 0,
            step: typeof indexRecord.step === 'number' ? indexRecord.step : 1,
          }
        : { kind: 'range', start: 0, step: 1 }

  return {
    columns: [
      geometryColumn,
      ...(radiusColumn === undefined ? [] : [radiusColumn]),
      ...(index.kind === 'column' ? [index.column] : []),
    ],
    geometryColumn,
    ...(radiusColumn === undefined ? {} : { radiusColumn }),
    index,
  }
}

export function shapesFromRows(
  rows: readonly Record<string, unknown>[],
  layout: SpatialDataShapesParquetLayout,
  affine: Affine2D,
): readonly SpatialDataShape[] {
  const radiusScale = affineScale(affine)
  const shapes: SpatialDataShape[] = []

  rows.forEach((row, rowIndex) => {
    const id =
      layout.index.kind === 'column'
        ? instanceIdString(row[layout.index.column])
        : String(layout.index.start + rowIndex * layout.index.step)
    const rawGeometry = row[layout.geometryColumn]
    const geometry =
      rawGeometry instanceof Uint8Array ? geometryFromWkb(rawGeometry) : rawGeometry

    if (id === null || !isGeoJsonGeometry(geometry)) {
      return
    }

    const radius =
      layout.radiusColumn === undefined
        ? undefined
        : finiteNumber(row[layout.radiusColumn])
    const shape = shapeFromGeometry(id, geometry, radius, affine, radiusScale)

    if (shape !== null) {
      shapes.push(shape)
    }
  })

  return shapes
}

export function instanceIdString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toFixed(0) : String(value)
  }

  return null
}

function shapeFromGeometry(
  id: string,
  geometry: GeoJsonGeometry,
  radius: number | undefined,
  affine: Affine2D,
  radiusScale: number,
): SpatialDataShape | null {
  if (geometry.type === 'Point') {
    const point = readPosition(geometry.coordinates)

    if (point === null) {
      return null
    }

    const center = applyAffine(affine, point.x, point.y)

    return {
      id,
      geometry: {
        kind: 'circle',
        center,
        radius: (radius ?? DEFAULT_CIRCLE_RADIUS) * radiusScale,
      },
      centroid: center,
    }
  }

  const polygon =
    geometry.type === 'Polygon'
      ? readRings(geometry.coordinates)
      : geometry.type === 'MultiPolygon'
        ? largestPolygon(geometry.coordinates)
        : null
  const outer = polygon?.[0]

  if (
    polygon === null ||
    polygon === undefined ||
    outer === undefined ||
    outer.length < 3
  ) {
    return null
  }

  const rings = polygon.map((ring) =>
    ring.map((point) => applyAffine(affine, point.x, point.y)),
  )

  return {
    id,
    geometry: { kind: 'polygon', rings },
    centroid: ringCentroid(rings[0] ?? []),
  }
}

function largestPolygon(value: unknown): readonly (readonly SpatialDataPoint[])[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  let largest: readonly (readonly SpatialDataPoint[])[] | null = null
  let largestArea = -1

  for (const polygonCoordinates of value) {
    const rings = readRings(polygonCoordinates)
    const outer = rings?.[0]

    if (rings === null || outer === undefined) {
      continue
    }

    const area = Math.abs(signedRingArea(outer))

    if (area > largestArea) {
      largest = rings
      largestArea = area
    }
  }

  return largest
}

function readRings(value: unknown): readonly (readonly SpatialDataPoint[])[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const rings: SpatialDataPoint[][] = []

  for (const ringCoordinates of value) {
    if (!Array.isArray(ringCoordinates)) {
      return null
    }

    const ring: SpatialDataPoint[] = []

    for (const position of ringCoordinates) {
      const point = readPosition(position)

      if (point === null) {
        return null
      }

      ring.push(point)
    }

    rings.push(ring)
  }

  return rings
}

function readPosition(value: unknown): SpatialDataPoint | null {
  if (!Array.isArray(value)) {
    return null
  }

  const x = finiteNumber(value[0])
  const y = finiteNumber(value[1])
  return x === undefined || y === undefined ? null : { x, y }
}

function ringCentroid(ring: readonly SpatialDataPoint[]): SpatialDataPoint {
  const area = signedRingArea(ring)

  if (Math.abs(area) > 1e-12) {
    let cx = 0
    let cy = 0

    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index]
      const next = ring[(index + 1) % ring.length]

      if (current === undefined || next === undefined) {
        continue
      }

      const cross = current.x * next.y - next.x * current.y
      cx += (current.x + next.x) * cross
      cy += (current.y + next.y) * cross
    }

    return { x: cx / (6 * area), y: cy / (6 * area) }
  }

  let sumX = 0
  let sumY = 0

  for (const point of ring) {
    sumX += point.x
    sumY += point.y
  }

  return ring.length === 0
    ? { x: 0, y: 0 }
    : { x: sumX / ring.length, y: sumY / ring.length }
}

function signedRingArea(ring: readonly SpatialDataPoint[]): number {
  let area = 0

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]

    if (current !== undefined && next !== undefined) {
      area += current.x * next.y - next.x * current.y
    }
  }

  return area / 2
}

// Minimal WKB decoder for GeoParquet files written without `geo` metadata,
// where hyparquet returns raw geometry bytes. Supports the geometry types
// SpatialData shapes use: Point, Polygon, and MultiPolygon (2D, ISO or EWKB).
export function geometryFromWkb(bytes: Uint8Array): GeoJsonGeometry | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return readWkbGeometry(view, { offset: 0 })
  } catch {
    return null
  }
}

function readWkbGeometry(
  view: DataView,
  cursor: { offset: number },
): GeoJsonGeometry | null {
  const littleEndian = view.getUint8(cursor.offset) === 1
  cursor.offset += 1
  const rawType = view.getUint32(cursor.offset, littleEndian)
  cursor.offset += 4

  const hasZ =
    (rawType & 0x80000000) !== 0 || Math.floor((rawType & 0xffff) / 1000) % 2 === 1
  const hasM = (rawType & 0x40000000) !== 0 || Math.floor((rawType & 0xffff) / 1000) >= 2
  const hasSrid = (rawType & 0x20000000) !== 0
  const type = (rawType & 0xffff) % 1000
  const dimensions = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0)

  if (hasSrid) {
    cursor.offset += 4
  }

  const readPoint = (): [number, number] => {
    const x = view.getFloat64(cursor.offset, littleEndian)
    const y = view.getFloat64(cursor.offset + 8, littleEndian)
    cursor.offset += 8 * dimensions
    return [x, y]
  }
  const readCount = (): number => {
    const count = view.getUint32(cursor.offset, littleEndian)
    cursor.offset += 4
    return count
  }
  const readPolygonRings = (): [number, number][][] =>
    Array.from({ length: readCount() }, () =>
      Array.from({ length: readCount() }, () => readPoint()),
    )

  if (type === 1) {
    return { type: 'Point', coordinates: readPoint() }
  }

  if (type === 3) {
    return { type: 'Polygon', coordinates: readPolygonRings() }
  }

  if (type === 6) {
    const polygons = Array.from({ length: readCount() }, () => {
      const polygon = readWkbGeometry(view, cursor)
      return polygon?.type === 'Polygon' ? polygon.coordinates : []
    })
    return { type: 'MultiPolygon', coordinates: polygons }
  }

  return null
}

function isGeoJsonGeometry(value: unknown): value is GeoJsonGeometry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === 'string' &&
    'coordinates' in value
  )
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'bigint' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (value === undefined) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function loadDefaultCompressors(): Promise<Compressors> {
  const { compressors } = await import('hyparquet-compressors')
  return compressors
}
