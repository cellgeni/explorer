import {
  dataToImagePixel,
  imagePixelToData,
  micrometers,
  type DataPoint,
  type ImagePixelFrame,
} from '../../data/coords'
import {
  annotationPaletteColor,
  normalizeAnnotationColor,
} from '../../rendering/annotationPalette'
import { slug } from '../../utils/slug'
import type { RoiSelection } from '../../data/roiSelection'

export type GeoJsonCoordinateUnit = 'pixel' | 'micrometer'

export interface GeometricAnnotationFeature {
  readonly id: string
  // The shape's identity in GeoJSON: the feature's `id`, a UUID as QuPath
  // writes it, kept from the file or made for a new shape.
  readonly objectId: string
  readonly label: string
  readonly color: string
  readonly visible: boolean
  readonly geometry: GeometricAnnotationGeometry
  readonly classification?: GeometricAnnotationClass
  // Properties the viewer does not read, such as QuPath's measurements and
  // metadata, written back on export.
  readonly properties?: Readonly<Record<string, unknown>>
}

// A QuPath classification: its name's parts ("Tumor: Positive" is a derived
// class, ['Tumor', 'Positive']) and its colour, when the file gives one.
export interface GeometricAnnotationClass {
  readonly names: readonly string[]
  readonly color: string | null
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
  // For features without a `coordinate_unit` property.
  readonly defaultCoordinateUnit: GeoJsonCoordinateUnit
  // Where pixel coordinates sit: the image's full-resolution pixels.
  readonly pixelFrame: ImagePixelFrame
  readonly idPrefix?: string
}

export interface GeometricAnnotationImport {
  readonly annotations: readonly GeometricAnnotationFeature[]
  // Features left out, by kind: a geometry type such as 'Point', a QuPath
  // object type such as 'detection', or 'none' for no geometry.
  readonly skipped: Readonly<Record<string, number>>
}

// Shown under Import GeoJSON after an import.
export interface GeometricAnnotationImportMessage {
  readonly tone: 'error' | 'notice'
  readonly text: string
}

interface GeoJsonFeatureRecord {
  readonly type: 'Feature'
  readonly id?: unknown
  readonly properties?: Readonly<Record<string, unknown>> | null
  readonly geometry?: GeoJsonGeometryRecord | null
}

interface GeoJsonGeometryRecord {
  readonly type: string
  readonly coordinates?: unknown
  readonly geometries?: unknown
}

type PolygonCoordinates = readonly GeometricAnnotationRing[]

// QuPath object types that are not annotations, as written (0.4 and later)
// or as 0.2 named them in the feature's `id`.
const QUPATH_SKIPPED_OBJECT_TYPES: Readonly<Record<string, string>> = {
  detection: 'detection',
  PathDetectionObject: 'detection',
  cell: 'cell',
  PathCellObject: 'cell',
  tile: 'tile',
  PathTileObject: 'tile',
  tmaCore: 'tmaCore',
  tma_core: 'tmaCore',
  TMACoreObject: 'tmaCore',
}
const QUPATH_LEGACY_OBJECT_IDS = new Set([
  'PathAnnotationObject',
  'PathDetectionObject',
  'PathCellObject',
  'PathTileObject',
  'TMACoreObject',
  'PathRootObject',
])
// Properties the importer reads, or the exporter writes from the shape.
const READ_PROPERTY_KEYS = new Set([
  'classification',
  'color',
  'coordinateUnit',
  'coordinate_unit',
  'fill',
  'id',
  'label',
  'name',
  'objectType',
  'object_type',
  'stroke',
  'title',
  'visible',
])
const GEOJSON_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
])

export function parseGeometricAnnotationsGeoJson(
  text: string,
  options: ParseGeometricAnnotationsOptions,
): GeometricAnnotationImport {
  const trimmedText = text.trim()
  const skipped: Record<string, number> = {}

  if (trimmedText.length === 0) {
    return { annotations: [], skipped }
  }

  const value: unknown = JSON.parse(trimmedText)
  const features = geoJsonFeatures(value)
  const usedIds = new Set<string>()
  const annotations = features.flatMap((feature, index) => {
    const parsed = parseFeature(feature, index, options, usedIds)

    if (typeof parsed === 'string') {
      skipped[parsed] = (skipped[parsed] ?? 0) + 1
      return []
    }

    return [parsed]
  })

  return { annotations, skipped }
}

function parseFeature(
  feature: GeoJsonFeatureRecord,
  index: number,
  options: ParseGeometricAnnotationsOptions,
  usedIds: Set<string>,
): GeometricAnnotationFeature | string {
  const properties = feature.properties ?? {}
  const legacyObjectType =
    typeof feature.id === 'string' && QUPATH_LEGACY_OBJECT_IDS.has(feature.id)
      ? feature.id
      : undefined
  const objectType =
    readStringProperty(properties, ['objectType', 'object_type']) ?? legacyObjectType
  const skippedObjectType =
    objectType === undefined ? undefined : QUPATH_SKIPPED_OBJECT_TYPES[objectType]

  if (skippedObjectType !== undefined) {
    return skippedObjectType
  }

  if (feature.geometry === null || feature.geometry === undefined) {
    return 'none'
  }

  const unit = coordinateUnitFromProperties(properties) ?? options.defaultCoordinateUnit
  const geometry = parseGeoJsonGeometry(feature.geometry, {
    pixelFrame: options.pixelFrame,
    unit,
  })

  if (typeof geometry === 'string') {
    return geometry
  }

  const classification = parseClassification(properties.classification)
  const color =
    normalizeAnnotationColor(
      readStringProperty(properties, ['color', 'stroke', 'fill']) ?? '',
    ) ??
    quPathColor(properties.color) ??
    classification?.color ??
    annotationPaletteColor(index)
  const label =
    readStringProperty(properties, ['label', 'name', 'title']) ??
    (classification === undefined
      ? `Shape ${index + 1}`
      : classificationName(classification))
  const id = uniqueAnnotationId(
    `${options.idPrefix ?? 'geojson'}:${slug(label) || 'shape'}`,
    usedIds,
  )
  const objectId =
    (legacyObjectType === undefined ? featureId(feature.id) : null) ??
    featureId(properties.id) ??
    newObjectId()
  const otherProperties = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !READ_PROPERTY_KEYS.has(key)),
  )

  return {
    id,
    objectId,
    label,
    color,
    visible: true,
    geometry,
    ...(classification === undefined ? {} : { classification }),
    ...(Object.keys(otherProperties).length === 0 ? {} : { properties: otherProperties }),
  }
}

function featureId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

// A class's name as QuPath shows it: "Tumor: Positive".
export function classificationName(classification: GeometricAnnotationClass): string {
  return classification.names.join(': ')
}

// Shown under Import GeoJSON when a file adds no shapes.
export function geometricAnnotationsEmptyMessage(
  fileName: string,
  skipped: Readonly<Record<string, number>> = {},
): string {
  return [`${fileName} has no Polygon or MultiPolygon shapes.`, skippedSentence(skipped)]
    .filter((sentence) => sentence.length > 0)
    .join(' ')
}

// What an import that added shapes left out, or null when it read them all.
export function geometricAnnotationsSkippedMessage(
  fileName: string,
  imported: number,
  skipped: Readonly<Record<string, number>>,
): string | null {
  const sentence = skippedSentence(skipped)

  if (sentence.length === 0) {
    return null
  }

  const shapes = `${imported.toLocaleString()} ${imported === 1 ? 'shape' : 'shapes'}`

  return `Imported ${shapes} from ${fileName}. ${sentence}`
}

const SKIPPED_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  Point: ['point', 'points'],
  MultiPoint: ['point', 'points'],
  LineString: ['line', 'lines'],
  MultiLineString: ['line', 'lines'],
  GeometryCollection: [
    'geometry collection without polygons',
    'geometry collections without polygons',
  ],
  detection: ['QuPath detection', 'QuPath detections'],
  cell: ['QuPath cell', 'QuPath cells'],
  tile: ['QuPath tile', 'QuPath tiles'],
  tmaCore: ['TMA core', 'TMA cores'],
  none: ['feature without geometry', 'features without geometry'],
}

function skippedSentence(skipped: Readonly<Record<string, number>>): string {
  // Kinds sharing a noun (Point and MultiPoint) are counted together.
  const counts = new Map<string, { readonly many: string; count: number }>()

  for (const [kind, count] of Object.entries(skipped)) {
    const [one, many] = SKIPPED_NOUNS[kind] ?? [`${kind} feature`, `${kind} features`]
    const entry = counts.get(one) ?? { many, count: 0 }
    entry.count += count
    counts.set(one, entry)
  }

  const parts = [...counts].map(
    ([one, { many, count }]) => `${count.toLocaleString()} ${count === 1 ? one : many}`,
  )
  const last = parts.pop()

  if (last === undefined) {
    return ''
  }

  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`
  const segmentationHint =
    (skipped.detection ?? 0) + (skipped.cell ?? 0) > 0
      ? ' Open detections and cells in the Segmentation section to draw them as outlines.'
      : ''

  return `Skipped ${list}.${segmentationHint}`
}

export function geometricAnnotationsImportFailedMessage(
  fileName: string,
  error: unknown,
): string {
  const reason =
    error instanceof SyntaxError
      ? 'The file is not valid JSON.'
      : error instanceof Error && error.message.length > 0
        ? error.message
        : 'The file could not be read.'

  return `Could not import ${fileName}. ${reason}`
}

export function geometricAnnotationFromRoiSelection(options: {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly selection: RoiSelection
}): GeometricAnnotationFeature {
  return {
    id: options.id,
    objectId: newObjectId(),
    label: options.label,
    color: options.color,
    visible: true,
    geometry: {
      type: 'Polygon',
      coordinates: [roiSelectionToRing(options.selection)],
    },
  }
}

export interface GeometricAnnotationsExportOptions {
  readonly coordinateUnit: GeoJsonCoordinateUnit
  // Where pixel coordinates sit: the image's full-resolution pixels.
  readonly pixelFrame: ImagePixelFrame
}

// A FeatureCollection QuPath reads as annotations (the feature `id` is the
// object's UUID; `name`, `classification` and `color` as QuPath writes them)
// and the importer reads back, with `coordinate_unit` saying the units.
export function geometricAnnotationsToGeoJson(
  features: readonly GeometricAnnotationFeature[],
  options: GeometricAnnotationsExportOptions,
): string {
  const toFile =
    options.coordinateUnit === 'pixel'
      ? (point: DataPoint): readonly number[] => {
          const pixel = dataToImagePixel(options.pixelFrame, point)
          return [roundPixel(pixel.x), roundPixel(pixel.y)]
        }
      : (point: DataPoint): readonly number[] => [point.x, point.y]

  return `${JSON.stringify(
    {
      type: 'FeatureCollection',
      features: features.map((feature) => ({
        type: 'Feature',
        id: feature.objectId,
        geometry: geometryToGeoJson(feature.geometry, toFile),
        properties: {
          ...feature.properties,
          objectType: 'annotation',
          name: feature.label,
          ...(feature.classification === undefined
            ? {}
            : {
                classification: classificationToGeoJson(
                  feature.classification,
                  feature.color,
                ),
              }),
          // Unset, QuPath draws the shape in its class's colour.
          ...(feature.classification?.color === feature.color
            ? {}
            : { color: hexToRgb(feature.color) }),
          coordinate_unit: options.coordinateUnit,
        },
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

// A FeatureCollection, a Feature, a bare array of features (QuPath without
// FEATURE_COLLECTION), or a bare geometry.
function geoJsonFeatures(value: unknown): readonly GeoJsonFeatureRecord[] {
  if (Array.isArray(value)) {
    return featureRecords(value)
  }

  if (!isRecord(value)) {
    throw new Error('GeoJSON must be a FeatureCollection or Feature.')
  }

  if (value.type === 'FeatureCollection') {
    if (!Array.isArray(value.features)) {
      throw new Error('GeoJSON FeatureCollection needs a features array.')
    }

    return featureRecords(value.features)
  }

  if (value.type === 'Feature') {
    return [value as unknown as GeoJsonFeatureRecord]
  }

  if (typeof value.type === 'string' && GEOJSON_GEOMETRY_TYPES.has(value.type)) {
    return [{ type: 'Feature', geometry: value as unknown as GeoJsonGeometryRecord }]
  }

  throw new Error('GeoJSON must be a FeatureCollection or Feature.')
}

function featureRecords(values: readonly unknown[]): readonly GeoJsonFeatureRecord[] {
  return values.map((feature) => {
    if (!isRecord(feature) || feature.type !== 'Feature') {
      throw new Error('GeoJSON features must be Feature objects.')
    }

    return feature as unknown as GeoJsonFeatureRecord
  })
}

interface CoordinateOptions {
  readonly pixelFrame: ImagePixelFrame
  readonly unit: GeoJsonCoordinateUnit
}

// The shape's geometry, or the geometry type when it has no polygons.
function parseGeoJsonGeometry(
  geometry: GeoJsonGeometryRecord,
  options: CoordinateOptions,
): GeometricAnnotationGeometry | string {
  const polygons = geometryPolygons(geometry, options)

  if (polygons === null) {
    return typeof geometry.type === 'string' ? geometry.type : 'unknown'
  }

  const [first] = polygons

  if (first === undefined) {
    throw new Error('GeoJSON MultiPolygon must contain at least one polygon.')
  }

  return geometry.type === 'MultiPolygon' || polygons.length > 1
    ? { type: 'MultiPolygon', coordinates: polygons }
    : { type: 'Polygon', coordinates: first }
}

// A geometry's polygons, or null for one without any: a GeometryCollection
// keeps its Polygon and MultiPolygon members.
function geometryPolygons(
  geometry: GeoJsonGeometryRecord,
  options: CoordinateOptions,
): readonly PolygonCoordinates[] | null {
  if (geometry.type === 'Polygon') {
    return [parsePolygonCoordinates(geometry.coordinates, options)]
  }

  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) {
      throw new Error('GeoJSON MultiPolygon coordinates must be an array.')
    }

    return geometry.coordinates.map((polygon) =>
      parsePolygonCoordinates(polygon, options),
    )
  }

  if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    const polygons = geometry.geometries.flatMap((member) =>
      isRecord(member)
        ? (geometryPolygons(member as unknown as GeoJsonGeometryRecord, options) ?? [])
        : [],
    )

    return polygons.length === 0 ? null : polygons
  }

  return null
}

function parsePolygonCoordinates(
  value: unknown,
  options: CoordinateOptions,
): PolygonCoordinates {
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
  options: CoordinateOptions,
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

function parseCoordinate(value: unknown, options: CoordinateOptions): DataPoint {
  if (!Array.isArray(value)) {
    throw new Error('GeoJSON coordinates must be arrays.')
  }

  const x: unknown = value[0]
  const y: unknown = value[1]

  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('GeoJSON coordinates must contain numeric x/y values.')
  }

  return options.unit === 'pixel'
    ? imagePixelToData(options.pixelFrame, x, y)
    : { x: micrometers(x), y: micrometers(y) }
}

// QuPath writes a class as { name, color } or, derived, { names, color };
// 0.2 wrote { name, colorRGB }; a bare string names it too.
function parseClassification(value: unknown): GeometricAnnotationClass | undefined {
  if (typeof value === 'string') {
    const names = splitClassName(value)
    return names.length === 0 ? undefined : { names, color: null }
  }

  if (!isRecord(value)) {
    return undefined
  }

  const names =
    typeof value.name === 'string'
      ? splitClassName(value.name)
      : Array.isArray(value.names)
        ? value.names.flatMap((name) =>
            typeof name === 'string' && name.trim().length > 0 ? [name.trim()] : [],
          )
        : []

  if (names.length === 0) {
    return undefined
  }

  return { names, color: quPathColor(value.color) ?? quPathColor(value.colorRGB) }
}

// QuPath's PathClassTools.splitNames: parts between colons.
function splitClassName(name: string): readonly string[] {
  return name
    .split(':')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

// A colour as QuPath writes one: [r, g, b], [r, g, b, a], or a packed
// (A)RGB integer, alone or in a one-element array.
function quPathColor(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return rgbToHex((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
  }

  if (!Array.isArray(value)) {
    return null
  }

  if (value.length === 1) {
    return quPathColor(value[0])
  }

  const [r, g, b] = value as readonly unknown[]

  return (value.length === 3 || value.length === 4) &&
    isColorByte(r) &&
    isColorByte(g) &&
    isColorByte(b)
    ? rgbToHex(r, g, b)
    : null
}

function classificationToGeoJson(
  classification: GeometricAnnotationClass,
  shapeColor: string,
): Readonly<Record<string, unknown>> {
  // QuPath refuses a class with a name but no colour.
  const color = hexToRgb(classification.color ?? shapeColor)
  const [name] = classification.names

  return classification.names.length === 1 && name !== undefined
    ? { name, color }
    : { names: classification.names, color }
}

function isColorByte(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
  )
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(color: string): readonly [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16)

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

// QuPath writes pixels to two decimals.
function roundPixel(value: number): number {
  return Math.round(value * 100) / 100
}

// A version 4 UUID. crypto.randomUUID needs a secure context;
// getRandomValues does not.
function newObjectId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
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

function geometryToGeoJson(
  geometry: GeometricAnnotationGeometry,
  toFile: (point: DataPoint) => readonly number[],
): {
  readonly type: 'Polygon' | 'MultiPolygon'
  readonly coordinates: readonly unknown[]
} {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: polygonToGeoJson(geometry.coordinates, toFile),
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) => polygonToGeoJson(polygon, toFile)),
  }
}

function polygonToGeoJson(
  polygon: readonly GeometricAnnotationRing[],
  toFile: (point: DataPoint) => readonly number[],
): readonly (readonly (readonly number[])[])[] {
  return polygon.map((ring) => closeRing(ring).map(toFile))
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
