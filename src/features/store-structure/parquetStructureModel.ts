import type { SchemaElement } from 'hyparquet'
import { wkbToGeojson } from 'hyparquet/src/wkb.js'
import { previewRowGroup } from '../../data/parquetRows'
import {
  isParquetFileName,
  type ParquetFileRef,
  type ParquetKeyValue,
  type ParquetSchemaNode,
  type ParquetStatValue,
  type ParquetStructure,
} from '../../data/parquetStructure'
import { formatBytes, formatCount } from './storeStructureModel'

// Addresses whose structure Browse File can show: a Parquet file, by name.
export function isParquetUrl(value: string): boolean {
  try {
    return isParquetFileName(new URL(value.trim()).pathname)
  } catch {
    return false
  }
}

export function sameParquetFile(a: ParquetFileRef, b: ParquetFileRef): boolean {
  return a.url === b.url && a.zipPath === b.zipPath
}

const TIME_UNITS: Readonly<Record<string, string>> = {
  MILLIS: 'ms',
  MICROS: 'us',
  NANOS: 'ns',
}

const CONVERTED_TYPES: Readonly<Record<string, string>> = {
  UTF8: 'string',
  ENUM: 'enum',
  JSON: 'json',
  BSON: 'bson',
  DATE: 'date',
  TIME_MILLIS: 'time[ms]',
  TIME_MICROS: 'time[us]',
  TIMESTAMP_MILLIS: 'timestamp[ms]',
  TIMESTAMP_MICROS: 'timestamp[us]',
  UINT_8: 'uint8',
  UINT_16: 'uint16',
  UINT_32: 'uint32',
  UINT_64: 'uint64',
  INT_8: 'int8',
  INT_16: 'int16',
  INT_32: 'int32',
  INT_64: 'int64',
  LIST: 'list',
  MAP: 'map',
  MAP_KEY_VALUE: 'map',
  INTERVAL: 'interval',
}

const PHYSICAL_TYPES: Readonly<Record<string, string>> = {
  BOOLEAN: 'boolean',
  INT32: 'int32',
  INT64: 'int64',
  INT96: 'int96',
  FLOAT: 'float',
  DOUBLE: 'double',
  BYTE_ARRAY: 'binary',
}

// The type a reader sees, from the logical type, else the converted type,
// else the physical type, in Arrow's words: `string`, `int64`,
// `timestamp[us, UTC]`, `decimal(10, 2)`, `list`, `struct`.
export function parquetTypeLabel(element: SchemaElement): string {
  const logical = element.logical_type

  if (logical !== undefined) {
    switch (logical.type) {
      case 'INTEGER':
        return `${logical.isSigned ? 'int' : 'uint'}${logical.bitWidth}`
      case 'DECIMAL':
        return `decimal(${logical.precision}, ${logical.scale})`
      case 'TIME':
        return `time[${TIME_UNITS[logical.unit] ?? logical.unit}]`
      case 'TIMESTAMP':
        return `timestamp[${TIME_UNITS[logical.unit] ?? logical.unit}${logical.isAdjustedToUTC ? ', UTC' : ''}]`
      default:
        return logical.type.toLowerCase()
    }
  }

  if (element.converted_type === 'DECIMAL') {
    return `decimal(${element.precision ?? '?'}, ${element.scale ?? 0})`
  }

  if (element.converted_type !== undefined) {
    return CONVERTED_TYPES[element.converted_type] ?? element.converted_type.toLowerCase()
  }

  if (element.type === 'FIXED_LEN_BYTE_ARRAY') {
    return `fixed binary[${element.type_length ?? '?'}]`
  }

  return element.type === undefined
    ? 'struct'
    : (PHYSICAL_TYPES[element.type] ?? element.type.toLowerCase())
}

// The annotation as the file stores it: `STRING`, `INTEGER(8, unsigned)`,
// `TIMESTAMP(MICROS, UTC)`. Null when there is none.
export function parquetAnnotationLabel(element: SchemaElement): string | null {
  const logical = element.logical_type

  if (logical !== undefined) {
    switch (logical.type) {
      case 'INTEGER':
        return `INTEGER(${logical.bitWidth}, ${logical.isSigned ? 'signed' : 'unsigned'})`
      case 'DECIMAL':
        return `DECIMAL(${logical.precision}, ${logical.scale})`
      case 'TIME':
      case 'TIMESTAMP':
        return `${logical.type}(${logical.unit}${logical.isAdjustedToUTC ? ', UTC' : ''})`
      default:
        return logical.type
    }
  }

  return element.converted_type ?? null
}

export function parquetPhysicalLabel(element: SchemaElement): string | null {
  if (element.type === undefined) return null
  return element.type === 'FIXED_LEN_BYTE_ARRAY'
    ? `FIXED_LEN_BYTE_ARRAY(${element.type_length ?? '?'})`
    : element.type
}

export function parquetKindLabel(node: ParquetSchemaNode): string {
  if (node.path === '') return 'File (Parquet)'
  if (node.children.length === 0) return 'Column'

  switch (parquetTypeLabel(node.element)) {
    case 'list':
      return 'List'
    case 'map':
      return 'Map'
    default:
      return 'Struct'
  }
}

// The short description beside a field's name.
export function parquetNodeSummary(node: ParquetSchemaNode): string {
  const type = parquetTypeLabel(node.element)

  if (node.path === '') {
    return formatCount(node.children.length, 'field')
  }

  if (node.children.length > 0) {
    return type === 'struct'
      ? `struct · ${formatCount(node.children.length, 'field')}`
      : type
  }

  return node.column === undefined
    ? type
    : `${type} · ${formatBytes(node.column.compressedBytes)}`
}

// Dotted, as Parquet tools name nested columns.
export function parquetFieldLabel(node: ParquetSchemaNode): string {
  return node.fieldPath.length === 0 ? '(root)' : node.fieldPath.join('.')
}

// Groups opened at first: the root, and its nested fields when the schema is
// small enough to show them all.
export function initiallyExpandedParquet(
  structure: ParquetStructure,
): ReadonlySet<string> {
  const expanded = new Set([''])

  if (structure.columnCount <= 200) {
    for (const child of structure.root.children) {
      if (child.children.length > 0) expanded.add(child.path)
    }
  }

  return expanded
}

export function parquetContentsLabel(structure: ParquetStructure): string {
  return [
    formatCount(structure.rowCount, 'row'),
    formatCount(structure.columnCount, 'column'),
    formatCount(structure.rowGroups.length, 'row group'),
  ].join(' · ')
}

export function parquetFormatLabel(structure: ParquetStructure): string {
  return `Parquet, format version ${structure.formatVersion}`
}

// What the key-value metadata says wrote the file, as `GeoParquet 1.1.0`.
export function parquetConventions(structure: ParquetStructure): readonly string[] {
  const conventions: string[] = []
  const geo = geoMetadata(structure)
  const pandas = recordOrNull(keyValue(structure, 'pandas')?.json)

  if (geo !== null) {
    conventions.push(
      typeof geo.version === 'string' ? `GeoParquet ${geo.version}` : 'GeoParquet',
    )
  }

  if (pandas !== null) {
    conventions.push(
      typeof pandas.pandas_version === 'string'
        ? `pandas ${pandas.pandas_version}`
        : 'pandas',
    )
  }

  if (keyValue(structure, 'ARROW:schema') !== undefined) {
    conventions.push('Arrow schema')
  }

  if (keyValue(structure, 'org.apache.spark.sql.parquet.row.metadata') !== undefined) {
    conventions.push('Spark')
  }

  return conventions
}

// What a top-level column is to the convention that wrote it: a GeoParquet
// geometry, a pandas index. Null for plain columns.
export function parquetColumnRole(
  structure: ParquetStructure,
  node: ParquetSchemaNode,
): string | null {
  if (node.fieldPath.length !== 1) {
    return null
  }

  const geo = geoColumn(structure, node)

  if (geo !== null) {
    const encoding = typeof geo.encoding === 'string' ? geo.encoding : null
    return encoding === null ? 'geometry' : `${encoding} geometry`
  }

  const pandas = recordOrNull(keyValue(structure, 'pandas')?.json)
  const index = pandas?.index_columns

  if (Array.isArray(index) && index.includes(node.name)) {
    return 'pandas index'
  }

  return null
}

export interface GeoColumnFacts {
  readonly encoding: string | null
  readonly primary: boolean
  readonly geometryTypes: readonly string[]
  readonly crs: string
  readonly bbox: string | null
}

// A GeoParquet geometry column's entry in the `geo` metadata.
export function geoColumnFacts(
  structure: ParquetStructure,
  node: ParquetSchemaNode,
): GeoColumnFacts | null {
  const column = geoColumn(structure, node)

  if (column === null) {
    return null
  }

  const types = column.geometry_types
  const bbox = column.bbox

  return {
    encoding: typeof column.encoding === 'string' ? column.encoding : null,
    primary: geoMetadata(structure)?.primary_column === node.name,
    geometryTypes: Array.isArray(types)
      ? types.filter((type): type is string => typeof type === 'string')
      : [],
    crs: crsLabel(column),
    bbox:
      Array.isArray(bbox) && bbox.every((value) => typeof value === 'number')
        ? `[${bbox.map((value) => formatNumber(value)).join(', ')}]`
        : null,
  }
}

// GeoParquet: a missing crs means OGC:CRS84, null means none is known.
function crsLabel(column: Readonly<Record<string, unknown>>): string {
  if (!('crs' in column)) return 'OGC:CRS84 (the default)'
  const crs = column.crs
  if (crs === null) return 'None given'
  if (typeof crs === 'string') return crs

  const projjson = recordOrNull(crs)
  const id = recordOrNull(projjson?.id)
  const code =
    id !== null && typeof id.authority === 'string'
      ? `${id.authority}:${String(id.code)}`
      : null
  const name = typeof projjson?.name === 'string' ? projjson.name : null

  return code !== null && name !== null
    ? `${code} (${name})`
    : (code ?? name ?? 'PROJJSON')
}

function geoMetadata(
  structure: ParquetStructure,
): Readonly<Record<string, unknown>> | null {
  return recordOrNull(keyValue(structure, 'geo')?.json)
}

function geoColumn(
  structure: ParquetStructure,
  node: ParquetSchemaNode,
): Readonly<Record<string, unknown>> | null {
  if (node.fieldPath.length !== 1) return null
  const columns = recordOrNull(geoMetadata(structure)?.columns)
  return recordOrNull(columns?.[node.name])
}

function keyValue(structure: ParquetStructure, key: string): ParquetKeyValue | undefined {
  return structure.keyValueMetadata.find((entry) => entry.key === key)
}

const STAT_TEXT_LIMIT = 80

export function formatStatValue(value: ParquetStatValue): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  }

  switch (typeof value) {
    case 'number':
      return formatNumber(value)
    case 'bigint':
      return value.toLocaleString()
    case 'boolean':
      return String(value)
    case 'string':
      return JSON.stringify(
        value.length > STAT_TEXT_LIMIT ? `${value.slice(0, STAT_TEXT_LIMIT)}…` : value,
      )
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

// Compressed and uncompressed sizes, with the ratio when it is worth saying.
export function compressionLabel(compressed: number, uncompressed: number): string {
  const ratio = compressed > 0 ? uncompressed / compressed : 0
  return `${formatBytes(compressed)} (${formatBytes(uncompressed)} uncompressed${
    ratio >= 1.1
      ? `, ${ratio.toLocaleString(undefined, { maximumFractionDigits: ratio < 10 ? 1 : 0 })}×`
      : ''
  })`
}

// A key-value entry that is not JSON, as shown: Arrow's serialised schema is
// base64 and says nothing to a reader, so only its length is given.
export function keyValueText(entry: ParquetKeyValue): {
  readonly text: string
  readonly note: string | null
} {
  if (entry.value === null) {
    return { text: '', note: 'No value.' }
  }

  if (entry.key === 'ARROW:schema') {
    return {
      text: '',
      note: `Arrow's schema for the file, base64-encoded (${entry.value.length.toLocaleString()} characters).`,
    }
  }

  return entry.value.length > KEY_VALUE_TEXT_LIMIT
    ? {
        text: `${entry.value.slice(0, KEY_VALUE_TEXT_LIMIT)}…`,
        note: `Showing the first ${KEY_VALUE_TEXT_LIMIT.toLocaleString()} of ${entry.value.length.toLocaleString()} characters.`,
      }
    : { text: entry.value, note: null }
}

const KEY_VALUE_TEXT_LIMIT = 4_000

function recordOrNull(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// The most a row preview can read: the row group it reads from, when every
// column chunk is one page. Null when the file has no rows.
export function previewReadBound(structure: ParquetStructure): number | null {
  const group = previewRowGroup(structure.metadata)
  return group === null ? null : (structure.rowGroups[group.index]?.compressedBytes ?? 0)
}

// Whether a top-level column holds GeoParquet WKB geometry.
export function isWkbColumn(structure: ParquetStructure, name: string): boolean {
  const node = structure.root.children.find((child) => child.name === name)
  return node !== undefined && geoColumnFacts(structure, node)?.encoding === 'WKB'
}

const PREVIEW_TEXT_LIMIT = 60
// A cell's tooltip shows its value whole, up to this.
export const PREVIEW_TITLE_LIMIT = 2_000

// A previewed value as shown in its cell, or null for a null; `limit` is
// where text is cut.
export function formatPreviewValue(
  value: unknown,
  {
    wkb = false,
    limit = PREVIEW_TEXT_LIMIT,
  }: { readonly wkb?: boolean; readonly limit?: number } = {},
): string | null {
  const truncate = (text: string) =>
    text.length > limit ? `${text.slice(0, limit)}…` : text

  if (value === null || value === undefined) return null
  if (value instanceof Uint8Array) return wkb ? wkbSummary(value) : bytesSummary(value)
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  }

  switch (typeof value) {
    case 'string':
      return truncate(value)
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value)
    default:
      return truncate(
        JSON.stringify(value, (_key, item: unknown) =>
          typeof item === 'bigint'
            ? item.toString()
            : item instanceof Uint8Array
              ? bytesSummary(item)
              : item,
        ),
      )
  }
}

function bytesSummary(bytes: Uint8Array): string {
  const hex = Array.from(bytes.subarray(0, 8), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `${formatCount(bytes.byteLength, 'byte')}: 0x${hex}${bytes.byteLength > 8 ? '…' : ''}`
}

// A geometry by its type and size, as `Polygon, 5 points`, or a point by its
// coordinates.
function wkbSummary(bytes: Uint8Array): string {
  try {
    const geometry = wkbToGeojson({
      view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      offset: 0,
    }) as {
      readonly type: string
      readonly coordinates?: unknown
      readonly geometries?: unknown
    }

    if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
      return `Point (${geometry.coordinates.map((value) => coordinateText(Number(value))).join(', ')})`
    }

    return `${geometry.type}, ${formatCount(countPositions(geometry), 'point')}`
  } catch {
    return bytesSummary(bytes)
  }
}

// Without digit grouping, which would read as more coordinates.
function coordinateText(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6, useGrouping: false })
}

function countPositions(value: unknown): number {
  if (!Array.isArray(value)) {
    const record = recordOrNull(value)
    return record === null
      ? 0
      : countPositions(record.coordinates ?? record.geometries ?? null)
  }

  return value.length > 0 && typeof value[0] === 'number'
    ? 1
    : value.reduce((total: number, item) => total + countPositions(item), 0)
}
