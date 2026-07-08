import { micrometers, type DataPoint } from '../../data/coords'
import {
  annotationPaletteColor,
  normalizeAnnotationColor,
} from '../../rendering/annotationPalette'
import { slug } from '../../utils/slug'
import type { RoiSelection } from '../../data/roiSelection'

export type GeoJsonCoordinateUnit = 'pixel' | 'micrometer'

export interface GeometricAnnotationFeature {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly visible: boolean
  readonly geometry: GeometricAnnotationGeometry
}

export type GeometricAnnotationGeometry =
  | {
      readonly type: 'Polygon'
      readonly coordinates: readonly GeometricAnnotationRing[]
    }
  | {
      readonly type: 'MultiPolygon'
      readonly coordinates: readonly (readonly GeometricAnnotationRing[])[]
    }

export type GeometricAnnotationRing = readonly DataPoint[]

export interface ParseGeometricAnnotationsOptions {
  readonly defaultCoordinateUnit: GeoJsonCoordinateUnit
  readonly micrometersPerPixel: number
  readonly idPrefix?: string
}

interface GeoJsonFeatureRecord {
  readonly type: 'Feature'
  readonly properties?: Readonly<Record<string, unknown>> | null
  readonly geometry?: GeoJsonGeometryRecord | null
}

type GeoJsonGeometryRecord =
  | {
      readonly type: 'Polygon'
      readonly coordinates: unknown
    }
  | {
      readonly type: 'MultiPolygon'
      readonly coordinates: unknown
    }

export function parseGeometricAnnotationsGeoJson(
  text: string,
  options: ParseGeometricAnnotationsOptions,
): readonly GeometricAnnotationFeature[] {
  const trimmedText = text.trim()

  if (trimmedText.length === 0) {
    return []
  }

  const value: unknown = JSON.parse(trimmedText)
  const features = geoJsonFeatures(value)
  const usedIds = new Set<string>()

  return features.flatMap((feature, index) => {
    if (feature.geometry === null || feature.geometry === undefined) {
      return []
    }

    const properties = feature.properties ?? {}
    const unit = coordinateUnitFromProperties(properties) ?? options.defaultCoordinateUnit
    const color =
      normalizeAnnotationColor(
        readStringProperty(properties, ['color', 'stroke', 'fill']) ?? '',
      ) ?? annotationPaletteColor(index)
    const label =
      readStringProperty(properties, ['label', 'name', 'title']) ?? `Shape ${index + 1}`
    const id = uniqueAnnotationId(
      `${options.idPrefix ?? 'geojson'}:${slug(label) || 'shape'}`,
      usedIds,
    )
    const geometry = parseGeoJsonGeometry(feature.geometry, {
      micrometersPerPixel: options.micrometersPerPixel,
      unit,
    })

    return [
      {
        id,
        label,
        color,
        visible: true,
        geometry,
      },
    ]
  })
}

export function geometricAnnotationFromRoiSelection(options: {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly selection: RoiSelection
}): GeometricAnnotationFeature {
  return {
    id: options.id,
    label: options.label,
    color: options.color,
    visible: true,
    geometry: {
      type: 'Polygon',
      coordinates: [roiSelectionToRing(options.selection)],
    },
  }
}

export function geometricAnnotationsToGeoJson(
  features: readonly GeometricAnnotationFeature[],
): string {
  return `${JSON.stringify(
    {
      type: 'FeatureCollection',
      features: features.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          label: feature.label,
          color: feature.color,
          visible: feature.visible,
          coordinate_unit: 'micrometer',
        },
        geometry: geometryToGeoJson(feature.geometry),
      })),
    },
    null,
    2,
  )}\n`
}

export function removeGeometricAnnotation(
  features: readonly GeometricAnnotationFeature[],
  annotationId: string,
): readonly GeometricAnnotationFeature[] {
  return features.filter((feature) => feature.id !== annotationId)
}

export function updateGeometricAnnotationColor(
  features: readonly GeometricAnnotationFeature[],
  annotationId: string,
  color: string,
): readonly GeometricAnnotationFeature[] {
  const normalizedColor = normalizeAnnotationColor(color)

  if (normalizedColor === null) {
    return features
  }

  return features.map((feature) =>
    feature.id === annotationId ? { ...feature, color: normalizedColor } : feature,
  )
}

export function updateGeometricAnnotationVisibility(
  features: readonly GeometricAnnotationFeature[],
  annotationId: string,
  visible: boolean,
): readonly GeometricAnnotationFeature[] {
  return features.map((feature) =>
    feature.id === annotationId ? { ...feature, visible } : feature,
  )
}

function geoJsonFeatures(value: unknown): readonly GeoJsonFeatureRecord[] {
  if (!isRecord(value)) {
    throw new Error('GeoJSON must be a FeatureCollection or Feature.')
  }

  if (value.type === 'FeatureCollection') {
    if (!Array.isArray(value.features)) {
      throw new Error('GeoJSON FeatureCollection needs a features array.')
    }

    return value.features.map((feature) => {
      if (!isRecord(feature) || feature.type !== 'Feature') {
        throw new Error('GeoJSON features must be Feature objects.')
      }

      return feature as unknown as GeoJsonFeatureRecord
    })
  }

  if (value.type === 'Feature') {
    return [value as unknown as GeoJsonFeatureRecord]
  }

  throw new Error('GeoJSON must be a FeatureCollection or Feature.')
}

function parseGeoJsonGeometry(
  geometry: GeoJsonGeometryRecord,
  options: {
    readonly micrometersPerPixel: number
    readonly unit: GeoJsonCoordinateUnit
  },
): GeometricAnnotationGeometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: parsePolygonCoordinates(geometry.coordinates, options),
    }
  }

  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) {
      throw new Error('GeoJSON MultiPolygon coordinates must be an array.')
    }

    const polygons = geometry.coordinates.map((polygon) =>
      parsePolygonCoordinates(polygon, options),
    )

    if (polygons.length === 0) {
      throw new Error('GeoJSON MultiPolygon must contain at least one polygon.')
    }

    return {
      type: 'MultiPolygon',
      coordinates: polygons,
    }
  }

  throw new Error('GeoJSON geometry must be Polygon or MultiPolygon.')
}

function parsePolygonCoordinates(
  value: unknown,
  options: {
    readonly micrometersPerPixel: number
    readonly unit: GeoJsonCoordinateUnit
  },
): readonly GeometricAnnotationRing[] {
  if (!Array.isArray(value)) {
    throw new Error('GeoJSON Polygon coordinates must be an array.')
  }

  const rings = value.map((ring) => parseLinearRing(ring, options))

  if (rings.length === 0) {
    throw new Error('GeoJSON Polygon must contain at least one ring.')
  }

  return rings
}

function parseLinearRing(
  value: unknown,
  options: {
    readonly micrometersPerPixel: number
    readonly unit: GeoJsonCoordinateUnit
  },
): GeometricAnnotationRing {
  if (!Array.isArray(value)) {
    throw new Error('GeoJSON Polygon rings must be coordinate arrays.')
  }

  const points = value.map((coordinate) => parseCoordinate(coordinate, options))
  const uniquePointCount = new Set(points.map((point) => `${point.x}:${point.y}`)).size

  if (points.length < 4 || uniquePointCount < 3) {
    throw new Error('GeoJSON Polygon rings need at least three distinct points.')
  }

  return stripClosingPoint(points)
}

function parseCoordinate(
  value: unknown,
  options: {
    readonly micrometersPerPixel: number
    readonly unit: GeoJsonCoordinateUnit
  },
): DataPoint {
  if (!Array.isArray(value)) {
    throw new Error('GeoJSON coordinates must be arrays.')
  }

  const x = value[0]
  const y = value[1]

  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('GeoJSON coordinates must contain numeric x/y values.')
  }

  const scale = options.unit === 'pixel' ? options.micrometersPerPixel : 1

  return {
    x: micrometers(x * scale),
    y: micrometers(y * scale),
  }
}

function coordinateUnitFromProperties(
  properties: Readonly<Record<string, unknown>>,
): GeoJsonCoordinateUnit | null {
  const value = readStringProperty(properties, ['coordinate_unit', 'coordinateUnit'])
    ?.trim()
    .toLowerCase()

  if (value === 'micrometer' || value === 'micrometers' || value === 'um') {
    return 'micrometer'
  }

  if (value === 'pixel' || value === 'pixels' || value === 'px') {
    return 'pixel'
  }

  return null
}

function readStringProperty(
  properties: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = properties[key]

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

function roiSelectionToRing(selection: RoiSelection): GeometricAnnotationRing {
  if (selection.kind === 'lasso' && selection.points.length >= 3) {
    return selection.points
  }

  return [
    { x: selection.bbox.minX, y: selection.bbox.minY },
    { x: selection.bbox.maxX, y: selection.bbox.minY },
    { x: selection.bbox.maxX, y: selection.bbox.maxY },
    { x: selection.bbox.minX, y: selection.bbox.maxY },
  ]
}

function geometryToGeoJson(geometry: GeometricAnnotationGeometry): {
  readonly type: 'Polygon' | 'MultiPolygon'
  readonly coordinates: readonly unknown[]
} {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: polygonToGeoJson(geometry.coordinates),
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map(polygonToGeoJson),
  }
}

function polygonToGeoJson(
  polygon: readonly GeometricAnnotationRing[],
): readonly (readonly number[][])[] {
  return polygon.map((ring) => {
    const closedRing = closeRing(ring)
    return closedRing.map((point) => [point.x, point.y])
  })
}

function stripClosingPoint(points: readonly DataPoint[]): readonly DataPoint[] {
  const first = points[0]
  const last = points[points.length - 1]

  if (
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    return points.slice(0, -1)
  }

  return points
}

function closeRing(ring: readonly DataPoint[]): readonly DataPoint[] {
  const first = ring[0]
  const last = ring[ring.length - 1]

  if (
    first === undefined ||
    last === undefined ||
    (first.x === last.x && first.y === last.y)
  ) {
    return ring
  }

  return [...ring, first]
}

function uniqueAnnotationId(baseId: string, usedIds: Set<string>): string {
  let id = baseId
  let suffix = 2

  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }

  usedIds.add(id)
  return id
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
