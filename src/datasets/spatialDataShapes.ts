import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import type { AsyncBuffer, Compressors, FileMetaData, ParquetParsers } from 'hyparquet'
import { DEFAULT_PARSERS } from 'hyparquet/src/convert.js'
import { readMaybeGzipBytes } from '../data/readMaybeGzipText'
import {
  affineScale,
  applyAffine,
  IDENTITY_AFFINE,
  type Affine2D,
} from './spatialDataTransforms'

export const SHAPE_CIRCLE = 0
export const SHAPE_POLYGON = 1

// The shapes of one element as columns. A 600,000-cell segmentation is then a
// few typed arrays, cheap to transfer from a worker and light on the main
// thread's heap, instead of an object and a ring per cell.
export interface SpatialDataShapes {
  // Instance id per shape.
  readonly ids: readonly string[]
  // SHAPE_CIRCLE or SHAPE_POLYGON per shape.
  readonly kinds: Uint8Array
  // x, y per shape: a circle's centre, or the area-weighted centroid of a
  // polygon's ring.
  readonly centroids: Float64Array
  // Circle radius per shape; 0 for polygons.
  readonly radii: Float64Array
  // Ring area per shape; NaN for circles.
  readonly areas: Float64Array
  // minX, minY, maxX, maxY per shape.
  readonly bounds: Float64Array
  // Polygon i's outer ring is coords[ringOffsets[i]] up to
  // coords[ringOffsets[i + 1]], as interleaved x, y; circles have none. Holes,
  // and all but the largest polygon of a MultiPolygon, are dropped. Float32
  // keeps a 600,000-cell segmentation (about 25 vertices a cell) near 120 MB.
  readonly ringOffsets: Uint32Array
  readonly coords: Float32Array
  // The plane kept when the file has one row per plane (`planeColumn`).
  readonly plane?: number
}

// How a shapes file other than a SpatialData element is read.
export interface SpatialDataShapesReadLayout {
  // Instance IDs come from this column instead of the pandas index (MERSCOPE
  // `EntityID`).
  readonly idColumn?: string
  // Rows are one per z plane, numbered in this column; only the middle plane
  // present is kept (MERSCOPE `ZIndex`).
  readonly planeColumn?: string
  // Fetches the file in one request, inflated when its bytes are gzip,
  // instead of reading ranges: for files read whole anyway.
  readonly wholeFile?: boolean
}

export interface ReadSpatialDataShapesOptions extends SpatialDataShapesReadLayout {
  readonly url: string
  // The file's bytes when they are not fetched from `url`, as for a zipped
  // store.
  readonly file?: AsyncBuffer
  readonly affine: Affine2D
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly compressors?: Compressors
}

export type SpatialDataShapesReader = (
  options: ReadSpatialDataShapesOptions,
) => Promise<SpatialDataShapes>

interface GeoJsonGeometry {
  readonly type: string
  readonly coordinates: unknown
}

const DEFAULT_CIRCLE_RADIUS = 1
// Geometry stays WKB so rows are read straight into typed rings: hyparquet's
// GeoJSON costs an array per vertex, gigabytes for a large segmentation.
// hyparquet replaces rather than merges a partial `parsers`, so all are given.
const WKB_PARSERS: ParquetParsers = {
  ...DEFAULT_PARSERS,
  geometryFromBytes: (bytes) => bytes,
  geographyFromBytes: (bytes) => bytes,
}

export const readSpatialDataShapes: SpatialDataShapesReader = async (options) => {
  const file =
    options.file ??
    (options.wholeFile === true
      ? await fetchWholeFile(options)
      : await asyncBufferFromUrl({
          url: options.url,
          ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
          ...(options.signal === undefined
            ? {}
            : { requestInit: { signal: options.signal } }),
        }))
  const metadata = await parquetMetadataAsync(file)
  const compressors = options.compressors ?? (await loadDefaultCompressors())
  const layout = shapesParquetLayout(metadata, options)
  const rows = await parquetReadObjects({
    file: file as AsyncBuffer,
    metadata,
    columns: layout.columns,
    compressors,
    parsers: WKB_PARSERS,
  })

  return shapesFromRows(rows, layout, options.affine)
}

// The whole file as one buffer, which hyparquet reads like ranges.
async function fetchWholeFile(
  options: ReadSpatialDataShapesOptions,
): Promise<AsyncBuffer> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const response = await fetcher(
    options.url,
    options.signal === undefined ? {} : { signal: options.signal },
  )

  if (!response.ok) {
    throw new Error(`Shapes file returned HTTP ${response.status}: ${options.url}`)
  }

  const bytes = await readMaybeGzipBytes(response)

  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer)
}

export interface SpatialDataShapesParquetLayout {
  readonly columns: string[]
  readonly geometryColumn: string
  readonly radiusColumn?: string
  readonly planeColumn?: string
  readonly index:
    | { readonly kind: 'column'; readonly column: string }
    | { readonly kind: 'range'; readonly start: number; readonly step: number }
}

export function shapesParquetLayout(
  metadata: FileMetaData,
  readLayout: SpatialDataShapesReadLayout = {},
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

  if (readLayout.idColumn !== undefined && !columnNames.has(readLayout.idColumn)) {
    throw new Error(`Shapes parquet does not contain a ${readLayout.idColumn} column.`)
  }

  const radiusColumn = columnNames.has('radius') ? 'radius' : undefined
  const planeColumn =
    readLayout.planeColumn !== undefined && columnNames.has(readLayout.planeColumn)
      ? readLayout.planeColumn
      : undefined
  const indexEntry = Array.isArray(pandas?.index_columns)
    ? pandas.index_columns[0]
    : undefined
  const indexRecord =
    typeof indexEntry === 'object' && indexEntry !== null
      ? (indexEntry as Record<string, unknown>)
      : null
  const index: SpatialDataShapesParquetLayout['index'] =
    readLayout.idColumn !== undefined
      ? { kind: 'column', column: readLayout.idColumn }
      : typeof indexEntry === 'string' && columnNames.has(indexEntry)
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
      ...(planeColumn === undefined ? [] : [planeColumn]),
      ...(index.kind === 'column' ? [index.column] : []),
    ],
    geometryColumn,
    ...(radiusColumn === undefined ? {} : { radiusColumn }),
    ...(planeColumn === undefined ? {} : { planeColumn }),
    index,
  }
}

export function shapesFromRows(
  rows: readonly Record<string, unknown>[],
  layout: SpatialDataShapesParquetLayout,
  affine: Affine2D,
): SpatialDataShapes {
  const radiusScale = affineScale(affine)
  const shapes = new SpatialDataShapesBuilder()
  const plane =
    layout.planeColumn === undefined ? undefined : middlePlane(rows, layout.planeColumn)

  rows.forEach((row, rowIndex) => {
    if (
      plane !== undefined &&
      layout.planeColumn !== undefined &&
      finiteNumber(row[layout.planeColumn]) !== plane
    ) {
      return
    }

    const id =
      layout.index.kind === 'column'
        ? instanceIdString(row[layout.index.column])
        : String(layout.index.start + rowIndex * layout.index.step)
    const geometry = row[layout.geometryColumn]
    const parsed =
      geometry instanceof Uint8Array
        ? wkbGeometry(geometry)
        : isGeoJsonGeometry(geometry)
          ? geoJsonGeometry(geometry)
          : null

    if (id === null || parsed === null) {
      return
    }

    if (parsed.kind === 'polygon') {
      shapes.addPolygon(id, parsed.ring, affine)
      return
    }

    const center = applyAffine(affine, parsed.x, parsed.y)
    const radius =
      layout.radiusColumn === undefined
        ? undefined
        : finiteNumber(row[layout.radiusColumn])
    shapes.addCircle(
      id,
      center.x,
      center.y,
      (radius ?? DEFAULT_CIRCLE_RADIUS) * radiusScale,
    )
  })

  const built = shapes.build()
  return plane === undefined ? built : { ...built, plane }
}

// The middle of the planes present, the lower one of an even count; rows
// without a plane are not counted.
function middlePlane(
  rows: readonly Record<string, unknown>[],
  column: string,
): number | undefined {
  const planes = new Set<number>()

  for (const row of rows) {
    const plane = finiteNumber(row[column])

    if (plane !== undefined) {
      planes.add(plane)
    }
  }

  const sorted = Array.from(planes).sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export class SpatialDataShapesBuilder {
  private readonly ids: string[] = []
  private readonly kinds: number[] = []
  private readonly centroids: number[] = []
  private readonly radii: number[] = []
  private readonly areas: number[] = []
  private readonly bounds: number[] = []
  private readonly ringOffsets: number[] = [0]
  private coords = new Float32Array(1024)
  private coordCount = 0

  addCircle(id: string, x: number, y: number, radius: number): void {
    this.add(id, SHAPE_CIRCLE, x, y, radius, Number.NaN, [
      x - radius,
      y - radius,
      x + radius,
      y + radius,
    ])
  }

  // Adds a polygon from its outer ring as interleaved x, y, placed by
  // `affine`. Rings of fewer than three points are left out.
  addPolygon(id: string, source: ArrayLike<number>, affine = IDENTITY_AFFINE): void {
    if (source.length < 6) {
      return
    }

    const start = this.coordCount
    this.reserve(source.length)
    const ring = this.coords.subarray(start, start + source.length)

    for (let index = 0; index < source.length; index += 2) {
      const point = applyAffine(affine, source[index] ?? 0, source[index + 1] ?? 0)
      ring[index] = point.x
      ring[index + 1] = point.y
    }

    this.coordCount += source.length
    const centroid = ringCentroid(ring)
    this.add(
      id,
      SHAPE_POLYGON,
      centroid.x,
      centroid.y,
      0,
      ringArea(ring),
      ringBounds(ring),
    )
  }

  build(): SpatialDataShapes {
    return {
      ids: this.ids,
      kinds: Uint8Array.from(this.kinds),
      centroids: Float64Array.from(this.centroids),
      radii: Float64Array.from(this.radii),
      areas: Float64Array.from(this.areas),
      bounds: Float64Array.from(this.bounds),
      ringOffsets: Uint32Array.from(this.ringOffsets),
      coords: this.coords.slice(0, this.coordCount),
    }
  }

  private add(
    id: string,
    kind: number,
    x: number,
    y: number,
    radius: number,
    area: number,
    bounds: readonly number[],
  ): void {
    this.ids.push(id)
    this.kinds.push(kind)
    this.centroids.push(x, y)
    this.radii.push(radius)
    this.areas.push(area)
    this.bounds.push(...bounds)
    this.ringOffsets.push(this.coordCount)
  }

  private reserve(length: number): void {
    if (this.coordCount + length <= this.coords.length) {
      return
    }

    const grown = new Float32Array(
      Math.max(this.coords.length * 2, this.coordCount + length),
    )
    grown.set(this.coords.subarray(0, this.coordCount))
    this.coords = grown
  }
}

// Polygon `index`'s outer ring, a view into `coords`; empty for a circle.
export function shapeRing(shapes: SpatialDataShapes, index: number): Float32Array {
  return shapes.coords.subarray(
    shapes.ringOffsets[index] ?? 0,
    shapes.ringOffsets[index + 1] ?? 0,
  )
}

// Every column has a buffer of its own.
export function spatialDataShapesTransferables(shapes: SpatialDataShapes): ArrayBuffer[] {
  return [
    shapes.kinds,
    shapes.centroids,
    shapes.radii,
    shapes.areas,
    shapes.bounds,
    shapes.ringOffsets,
    shapes.coords,
  ].map((column) => column.buffer as ArrayBuffer)
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

// A shape before placement: a point, or one polygon's outer ring as
// interleaved x, y.
type ParsedGeometry =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'polygon'; readonly ring: ArrayLike<number> }

function geoJsonGeometry(geometry: GeoJsonGeometry): ParsedGeometry | null {
  if (geometry.type === 'Point') {
    const position = readPosition(geometry.coordinates)
    return position === null ? null : { kind: 'point', x: position[0], y: position[1] }
  }

  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
        ? geometry.coordinates
        : []
  const rings = polygons.flatMap((polygon: unknown) => {
    const outer = Array.isArray(polygon) ? readRing(polygon[0]) : null
    return outer === null ? [] : [outer]
  })
  const ring = largestRing(rings)

  return ring === null ? null : { kind: 'polygon', ring }
}

function readRing(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const ring: number[] = []

  for (const position of value) {
    const point = readPosition(position)

    if (point === null) {
      return null
    }

    ring.push(point[0], point[1])
  }

  return ring
}

function readPosition(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const x = finiteNumber(value[0])
  const y = finiteNumber(value[1])
  return x === undefined || y === undefined ? null : [x, y]
}

function largestRing<T extends ArrayLike<number>>(rings: readonly T[]): T | null {
  let largest: T | null = null
  let largestArea = -1

  for (const ring of rings) {
    const area = ringArea(ring)

    if (area > largestArea) {
      largest = ring
      largestArea = area
    }
  }

  return largest
}

// Area of an interleaved x, y ring.
export function ringArea(ring: ArrayLike<number>): number {
  return Math.abs(signedRingArea(ring))
}

function ringBounds(ring: ArrayLike<number>): readonly number[] {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index < ring.length; index += 2) {
    const x = ring[index] ?? 0
    const y = ring[index + 1] ?? 0
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  return [minX, minY, maxX, maxY]
}

function ringCentroid(ring: ArrayLike<number>): {
  readonly x: number
  readonly y: number
} {
  const area = signedRingArea(ring)
  const count = ring.length / 2

  if (Math.abs(area) > 1e-12) {
    let cx = 0
    let cy = 0

    for (let index = 0; index < ring.length; index += 2) {
      const next = (index + 2) % ring.length
      const x = ring[index] ?? 0
      const y = ring[index + 1] ?? 0
      const nextX = ring[next] ?? 0
      const nextY = ring[next + 1] ?? 0
      const cross = x * nextY - nextX * y
      cx += (x + nextX) * cross
      cy += (y + nextY) * cross
    }

    return { x: cx / (6 * area), y: cy / (6 * area) }
  }

  let sumX = 0
  let sumY = 0

  for (let index = 0; index < ring.length; index += 2) {
    sumX += ring[index] ?? 0
    sumY += ring[index + 1] ?? 0
  }

  return count === 0 ? { x: 0, y: 0 } : { x: sumX / count, y: sumY / count }
}

function signedRingArea(ring: ArrayLike<number>): number {
  let area = 0

  for (let index = 0; index < ring.length; index += 2) {
    const next = (index + 2) % ring.length
    area +=
      (ring[index] ?? 0) * (ring[next + 1] ?? 0) -
      (ring[next] ?? 0) * (ring[index + 1] ?? 0)
  }

  return area / 2
}

// WKB as GeoParquet stores it (ISO or EWKB, 2D to 4D): Point, Polygon, and
// MultiPolygon, the types SpatialData shapes use. Only outer rings are read.
function wkbGeometry(bytes: Uint8Array): ParsedGeometry | null {
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
): ParsedGeometry | null {
  const littleEndian = view.getUint8(cursor.offset) === 1
  cursor.offset += 1
  const rawType = view.getUint32(cursor.offset, littleEndian)
  cursor.offset += 4

  const hasZ =
    (rawType & 0x80000000) !== 0 || Math.floor((rawType & 0xffff) / 1000) % 2 === 1
  const hasM = (rawType & 0x40000000) !== 0 || Math.floor((rawType & 0xffff) / 1000) >= 2
  const hasSrid = (rawType & 0x20000000) !== 0
  const type = (rawType & 0xffff) % 1000
  const pointBytes = 8 * (2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0))

  if (hasSrid) {
    cursor.offset += 4
  }

  const readCount = (): number => {
    const count = view.getUint32(cursor.offset, littleEndian)
    cursor.offset += 4
    return count
  }

  if (type === 1) {
    const x = view.getFloat64(cursor.offset, littleEndian)
    const y = view.getFloat64(cursor.offset + 8, littleEndian)
    cursor.offset += pointBytes
    return { kind: 'point', x, y }
  }

  if (type === 3) {
    const ringCount = readCount()
    let outer = new Float64Array(0)

    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
      const pointCount = readCount()

      if (ringIndex === 0) {
        outer = new Float64Array(pointCount * 2)

        for (let point = 0; point < pointCount; point += 1) {
          outer[point * 2] = view.getFloat64(cursor.offset, littleEndian)
          outer[point * 2 + 1] = view.getFloat64(cursor.offset + 8, littleEndian)
          cursor.offset += pointBytes
        }
      } else {
        cursor.offset += pointCount * pointBytes
      }
    }

    return { kind: 'polygon', ring: outer }
  }

  if (type === 6) {
    const rings: ArrayLike<number>[] = []

    for (let count = readCount(), index = 0; index < count; index += 1) {
      const polygon = readWkbGeometry(view, cursor)

      if (polygon?.kind === 'polygon') {
        rings.push(polygon.ring)
      }
    }

    const ring = largestRing(rings)
    return ring === null ? null : { kind: 'polygon', ring }
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
