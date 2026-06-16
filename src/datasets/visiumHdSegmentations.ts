import { micrometers, type BBox, type DataPoint } from '../data/coords'
import { datasetFileUrl } from '../data/datasetFiles'
import type { SpatialElement } from './spatialDataset'

export interface VisiumHdSegmentedOutputPaths {
  readonly scalefactorsPath?: string
  readonly filteredFeatureCellMatrixH5Path?: string
  readonly rawFeatureCellMatrixH5Path?: string
  readonly cellSegmentationsGeojsonPath?: string
  readonly nucleusSegmentationsGeojsonPath?: string
  readonly nucleusInstanceMaskTiffPath?: string
  readonly graphclustAnnotatedCellSegmentationsGeojsonPath?: string
  readonly graphclustAnnotatedNucleusSegmentationsGeojsonPath?: string
}

export type VisiumHdSegmentationKind = 'cell' | 'nucleus'

export interface VisiumHdSegmentationScalefactors {
  readonly micronsPerPixel: number
}

export interface ReadVisiumHdSegmentationElementsOptions {
  readonly path: string
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly kind?: VisiumHdSegmentationKind
  readonly bbox?: BBox
  readonly maxFullFileBytes?: number
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface ParseVisiumHdSegmentationGeojsonOptions {
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly kind?: VisiumHdSegmentationKind
  readonly bbox?: BBox
}

export class VisiumHdSegmentationGeojsonBudgetExceededError extends Error {
  override readonly name = 'VisiumHdSegmentationGeojsonBudgetExceededError'

  constructor(
    readonly url: string,
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(
      `Visium HD segmentation GeoJSON is ${formatByteCount(
        byteLength,
      )}, exceeding the interactive full-file budget of ${formatByteCount(maxBytes)}.`,
    )
  }
}

type GeojsonPolygon = readonly (readonly (readonly number[])[])[]
type GeojsonMultiPolygon = readonly GeojsonPolygon[]

export async function readVisiumHdSegmentationElements(
  baseUrl: string,
  options: ReadVisiumHdSegmentationElementsOptions,
): Promise<readonly SpatialElement[]> {
  const url = datasetFileUrl(baseUrl, options.path)
  const fetcher = options.fetcher ?? fetch

  if (options.maxFullFileBytes !== undefined) {
    await assertSegmentationGeojsonWithinBudget(
      url,
      options.maxFullFileBytes,
      fetcher,
      options.signal,
    )
  }

  throwIfAborted(options.signal)
  const response = await fetcher(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(
      `Unable to read Visium HD segmentation GeoJSON at ${url}: HTTP ${response.status}`,
    )
  }

  const geojson = (await response.json()) as unknown
  throwIfAborted(options.signal)

  return parseVisiumHdSegmentationGeojson(geojson, options)
}

export function parseVisiumHdSegmentationGeojson(
  value: unknown,
  options: ParseVisiumHdSegmentationGeojsonOptions,
): readonly SpatialElement[] {
  assertPositiveMicronsPerPixel(options.scalefactors.micronsPerPixel)
  const source = expectObject(value, 'Visium HD segmentation GeoJSON')

  if (source.type !== 'FeatureCollection') {
    throw new Error('Expected Visium HD segmentation GeoJSON to be a FeatureCollection.')
  }

  if (!Array.isArray(source.features)) {
    throw new Error('Expected Visium HD segmentation GeoJSON features to be an array.')
  }

  const elements: SpatialElement[] = []
  const kind = options.kind ?? 'cell'

  for (let featureIndex = 0; featureIndex < source.features.length; featureIndex += 1) {
    const feature = expectObject(
      source.features[featureIndex],
      `Visium HD segmentation feature ${featureIndex}`,
    )
    const featureElements = segmentationFeatureToElements(feature, featureIndex, {
      kind,
      scalefactors: options.scalefactors,
    })

    for (const element of featureElements) {
      elements.push(element)
    }
  }

  return options.bbox === undefined
    ? elements
    : filterVisiumHdSegmentationElementsByBbox(elements, options.bbox)
}

export function normalizeVisiumHdGeojsonCellId(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return null
    }

    return formatVisiumHdMatrixCellId(value)
  }

  if (typeof value === 'bigint') {
    if (value < 0n) {
      return null
    }

    return formatVisiumHdMatrixCellId(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  if (/^\d+$/.test(trimmed)) {
    return formatVisiumHdMatrixCellId(BigInt(trimmed))
  }

  const matrixId = /^cellid_(\d+)(-\d+)?$/i.exec(trimmed)

  if (matrixId !== null) {
    const digits = matrixId[1] ?? ''
    const suffix = matrixId[2] ?? '-1'
    return `cellid_${digits.padStart(9, '0')}${suffix}`
  }

  return trimmed
}

export function filterVisiumHdSegmentationElementsByBbox(
  elements: readonly SpatialElement[],
  bbox: BBox,
): readonly SpatialElement[] {
  return elements.filter((element) => elementIntersectsBbox(element, bbox))
}

async function assertSegmentationGeojsonWithinBudget(
  url: string,
  maxBytes: number,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError('Segmentation GeoJSON full-file budget must be non-negative.')
  }

  const response = await fetcher(url, {
    method: 'HEAD',
    ...(signal === undefined ? {} : { signal }),
  })

  if (!response.ok) {
    throw new Error(`segmentation GeoJSON HEAD returned HTTP ${response.status}.`)
  }

  const contentLength = response.headers.get('content-length')

  if (contentLength === null) {
    throw new Error(
      'Segmentation GeoJSON size is not exposed through Content-Length, so the interactive full-file read budget cannot be verified.',
    )
  }

  const byteLength = Number(contentLength)

  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error(
      `Segmentation GeoJSON returned invalid Content-Length ${contentLength}.`,
    )
  }

  if (byteLength > maxBytes) {
    throw new VisiumHdSegmentationGeojsonBudgetExceededError(url, byteLength, maxBytes)
  }
}

function segmentationFeatureToElements(
  feature: Record<string, unknown>,
  featureIndex: number,
  options: {
    readonly kind: VisiumHdSegmentationKind
    readonly scalefactors: VisiumHdSegmentationScalefactors
  },
): readonly SpatialElement[] {
  if (feature.type !== 'Feature') {
    throw new Error(
      `Expected Visium HD segmentation feature ${featureIndex} to be a Feature.`,
    )
  }

  const geometry = expectObject(
    feature.geometry,
    `Visium HD segmentation feature ${featureIndex} geometry`,
  )
  const polygonRings = readGeometryPolygons(geometry, featureIndex, options.scalefactors)
  const baseId = readSegmentationFeatureId(feature, featureIndex, options.kind)
  const elements: SpatialElement[] = []

  for (let polygonIndex = 0; polygonIndex < polygonRings.length; polygonIndex += 1) {
    const rings = polygonRings[polygonIndex]

    if (rings === undefined || rings.length === 0) {
      continue
    }

    elements.push({
      id: polygonIndex === 0 ? baseId : `${baseId}#${polygonIndex + 1}`,
      geometry: { kind: 'polygon', rings },
    })
  }

  return elements
}

function readGeometryPolygons(
  geometry: Record<string, unknown>,
  featureIndex: number,
  scalefactors: VisiumHdSegmentationScalefactors,
): readonly (readonly DataPoint[][])[] {
  if (geometry.type === 'Polygon') {
    return [
      readPolygonRings(
        expectGeojsonPolygon(geometry.coordinates, featureIndex),
        featureIndex,
        0,
        scalefactors,
      ),
    ]
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = expectGeojsonMultiPolygon(geometry.coordinates, featureIndex)
    return polygons.map((polygon, polygonIndex) =>
      readPolygonRings(polygon, featureIndex, polygonIndex, scalefactors),
    )
  }

  throw new Error(
    `Expected Visium HD segmentation feature ${featureIndex} geometry to be Polygon or MultiPolygon.`,
  )
}

function readPolygonRings(
  polygon: GeojsonPolygon,
  featureIndex: number,
  polygonIndex: number,
  scalefactors: VisiumHdSegmentationScalefactors,
): readonly DataPoint[][] {
  const rings: DataPoint[][] = []

  for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
    const ring = polygon[ringIndex]

    if (!Array.isArray(ring)) {
      throw new Error(
        `Expected Visium HD segmentation feature ${featureIndex} polygon ${polygonIndex} ring ${ringIndex} to be an array.`,
      )
    }

    const points = ring.map((coordinate, pointIndex) =>
      readGeojsonPosition(coordinate, {
        featureIndex,
        polygonIndex,
        ringIndex,
        pointIndex,
        scalefactors,
      }),
    )

    if (points.length >= 3) {
      rings.push(points)
    }
  }

  return rings
}

function readGeojsonPosition(
  coordinate: readonly number[],
  context: {
    readonly featureIndex: number
    readonly polygonIndex: number
    readonly ringIndex: number
    readonly pointIndex: number
    readonly scalefactors: VisiumHdSegmentationScalefactors
  },
): DataPoint {
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    throw new Error(
      `Expected Visium HD segmentation feature ${context.featureIndex} polygon ${context.polygonIndex} ring ${context.ringIndex} point ${context.pointIndex} to be a coordinate pair.`,
    )
  }

  const x = coordinate[0]
  const y = coordinate[1]

  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error(
      `Expected Visium HD segmentation feature ${context.featureIndex} polygon ${context.polygonIndex} ring ${context.ringIndex} point ${context.pointIndex} to contain finite coordinates.`,
    )
  }

  return {
    x: micrometers(x * context.scalefactors.micronsPerPixel),
    y: micrometers(y * context.scalefactors.micronsPerPixel),
  }
}

function readSegmentationFeatureId(
  feature: Record<string, unknown>,
  featureIndex: number,
  kind: VisiumHdSegmentationKind,
): string {
  const properties =
    feature.properties === null || feature.properties === undefined
      ? {}
      : expectObject(
          feature.properties,
          `Visium HD segmentation feature ${featureIndex} properties`,
        )
  const preferredValue =
    kind === 'cell'
      ? readFirstProperty(properties, ['cell_id', 'Cell_id', 'cellId', 'CellID'])
      : readFirstProperty(properties, [
          'nucleus_id',
          'Nucleus_id',
          'nucleusId',
          'NucleusID',
        ])
  const normalizedId =
    kind === 'cell' ? normalizeVisiumHdGeojsonCellId(preferredValue) : null

  if (normalizedId !== null) {
    return normalizedId
  }

  const fallbackId = preferredValue ?? feature.id

  if (typeof fallbackId === 'string' && fallbackId.trim().length > 0) {
    return fallbackId.trim()
  }

  if (typeof fallbackId === 'number' && Number.isFinite(fallbackId)) {
    return `${kind}_${Math.trunc(fallbackId).toString().padStart(9, '0')}`
  }

  if (typeof fallbackId === 'bigint') {
    return `${kind}_${fallbackId.toString().padStart(9, '0')}`
  }

  return `${kind}_${featureIndex.toString().padStart(9, '0')}`
}

function readFirstProperty(
  source: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key]
    }
  }

  return undefined
}

function elementIntersectsBbox(element: SpatialElement, bbox: BBox): boolean {
  if (element.geometry.kind !== 'polygon') {
    return false
  }

  for (const ring of element.geometry.rings) {
    for (const point of ring) {
      if (
        point.x >= bbox.minX &&
        point.x <= bbox.maxX &&
        point.y >= bbox.minY &&
        point.y <= bbox.maxY
      ) {
        return true
      }
    }
  }

  return polygonBboxIntersectsBbox(element.geometry.rings, bbox)
}

function polygonBboxIntersectsBbox(
  rings: readonly (readonly DataPoint[])[],
  bbox: BBox,
): boolean {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return false
  }

  return maxX >= bbox.minX && minX <= bbox.maxX && maxY >= bbox.minY && minY <= bbox.maxY
}

function expectGeojsonPolygon(value: unknown, featureIndex: number): GeojsonPolygon {
  if (Array.isArray(value)) {
    return value as GeojsonPolygon
  }

  throw new Error(
    `Expected Visium HD segmentation feature ${featureIndex} Polygon coordinates to be an array.`,
  )
}

function expectGeojsonMultiPolygon(
  value: unknown,
  featureIndex: number,
): GeojsonMultiPolygon {
  if (Array.isArray(value)) {
    return value as GeojsonMultiPolygon
  }

  throw new Error(
    `Expected Visium HD segmentation feature ${featureIndex} MultiPolygon coordinates to be an array.`,
  )
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Expected ${label} to be an object.`)
}

function assertPositiveMicronsPerPixel(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Visium HD segmentation microns_per_pixel must be positive, received ${value}.`,
    )
  }
}

function formatVisiumHdMatrixCellId(value: number | bigint): string {
  const digits =
    typeof value === 'bigint' ? value.toString() : Math.trunc(value).toString()
  return `cellid_${digits.padStart(9, '0')}-1`
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Visium HD segmentation request aborted.')
  error.name = 'AbortError'
  return error
}

function formatByteCount(byteLength: number): string {
  if (byteLength >= 1024 * 1024 * 1024) {
    return `${(byteLength / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
  }

  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }

  return `${byteLength.toLocaleString()} B`
}
