import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from 'hyparquet'
import type { AsyncBuffer, Compressors, FileMetaData, ParquetParsers } from 'hyparquet'
import { DEFAULT_PARSERS } from 'hyparquet/src/convert.js'
import { retryingFetch } from '../data/fetchRetry'
import { createGeojsonFeatureStream } from '../data/geojsonFeatureStream'
import { forEachMaybeGzipLine, forEachMaybeGzipText } from '../data/readMaybeGzipText'
import { looksLikeWktPolygon, wktOuterRing } from '../data/wktPolygons'
import {
  geoJsonOuterRing,
  instanceIdString,
  SpatialDataShapesBuilder,
  wkbOuterRing,
  type SpatialDataShapes,
} from './spatialDataShapes'
import type { Affine2D } from './spatialDataTransforms'
import { throwIfAborted } from '../utils/abort'

// Reads polygon segmentations into shape columns (see SpatialDataShapes): a
// GeoJSON FeatureCollection (QuPath's bare feature array too), WKT text (one
// polygon a line, or a CSV/TSV column), or Parquet (GeoParquet WKB, a WKT
// column, or one row per vertex as Xenium writes). Text is read as it
// arrives and Parquet a row group at a time, so a million-cell file is never
// held whole. Only outer rings are kept, as for SpatialData shapes.

export type VectorSegmentationFormat = 'geojson' | 'wkt' | 'parquet'

export type VectorSegmentationFile =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'file'; readonly file: Blob }

export interface ReadVectorSegmentationOptions {
  readonly file: VectorSegmentationFile
  readonly format: VectorSegmentationFormat
  // Micrometres per file coordinate: the image's pixel size for pixel
  // coordinates, or 1. `yMicrometersPerUnit` is the pixel height when it
  // differs from the width.
  readonly micrometersPerUnit: number
  readonly yMicrometersPerUnit?: number
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly compressors?: Compressors
  // Called as shapes are read, with the count so far.
  readonly onProgress?: (shapeCount: number) => void
}

type AddShape = (id: string, ring: ArrayLike<number>) => void

const PROGRESS_EVERY_SHAPES = 4096

// Column names that hold an element's ID, in order of preference
// (case-insensitive).
// Most specific first: MERSCOPE boundary files have a per-row `ID` beside the
// cell's `EntityID`.
const ID_COLUMN_NAMES = [
  'cell_id',
  'cellid',
  'cell',
  'label_id',
  'label',
  'entityid',
  'id',
  'object_id',
  'objectid',
  'instance_id',
  'name',
  'barcode',
]
const UNNAMED_INDEX_COLUMN = /^__index_level_\d+__$/

const GEOMETRY_COLUMN_NAMES = [
  'geometry',
  'geom',
  'wkt',
  'wkb',
  'polygon',
  'polygons',
  'boundary',
  'outline',
  'shape',
  'the_geom',
]
const VERTEX_X_COLUMN_NAMES = ['vertex_x', 'x', 'x_location', 'x_coord', 'xcoord']
const VERTEX_Y_COLUMN_NAMES = ['vertex_y', 'y', 'y_location', 'y_coord', 'ycoord']
// GeoJSON feature properties that hold its ID, before the feature's own
// `id` (QuPath writes a UUID there).
const GEOJSON_ID_PROPERTIES = ['cell_id', 'cellId', 'label', 'label_id', 'id']
const GEOJSON_FALLBACK_ID_PROPERTIES = ['object_id', 'objectId', 'name']

// Geometry stays WKB; hyparquet's GeoJSON costs an array per vertex.
const WKB_PARSERS: ParquetParsers = {
  ...DEFAULT_PARSERS,
  geometryFromBytes: (bytes) => bytes,
  geographyFromBytes: (bytes) => bytes,
}

export async function readVectorSegmentation(
  options: ReadVectorSegmentationOptions,
): Promise<SpatialDataShapes> {
  const scale = options.micrometersPerUnit
  const yScale = options.yMicrometersPerUnit ?? scale

  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(yScale) || yScale <= 0) {
    throw new Error(
      'Segmentation coordinates need a positive micrometres-per-unit scale.',
    )
  }

  const builder = new SpatialDataShapesBuilder()
  const affine: Affine2D = { a: scale, b: 0, c: 0, d: 0, e: yScale, f: 0 }
  let count = 0
  const add: AddShape = (id, ring) => {
    builder.addPolygon(id, ring, affine)
    count += 1

    if (count % PROGRESS_EVERY_SHAPES === 0) {
      throwIfAborted(options.signal)
      options.onProgress?.(count)
    }
  }

  if (options.format === 'parquet') {
    await readParquetSegmentation(await parquetFile(options), add, options)
  } else {
    const response = await textResponse(options)

    if (options.format === 'geojson') {
      await readGeojsonSegmentation(response, add)
    } else {
      await readWktSegmentation(response, add)
    }
  }

  const shapes = builder.build()

  if (shapes.ids.length === 0) {
    throw new Error(
      options.format === 'parquet'
        ? 'The Parquet file has no polygons.'
        : options.format === 'geojson'
          ? 'The GeoJSON has no Polygon or MultiPolygon features.'
          : 'The file has no WKT POLYGON or MULTIPOLYGON values.',
    )
  }

  options.onProgress?.(shapes.ids.length)
  return shapes
}

async function textResponse(options: ReadVectorSegmentationOptions): Promise<Response> {
  if (options.file.kind === 'file') {
    return new Response(options.file.file)
  }

  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const response = await fetcher(
    options.file.url,
    options.signal === undefined ? {} : { signal: options.signal },
  )

  if (!response.ok) {
    throw new Error(
      `Segmentation file returned HTTP ${response.status.toString()}: ${options.file.url}`,
    )
  }

  return response
}

async function parquetFile(options: ReadVectorSegmentationOptions): Promise<AsyncBuffer> {
  if (options.file.kind === 'file') {
    const { file } = options.file
    return {
      byteLength: file.size,
      slice: (start, end) => file.slice(start, end).arrayBuffer(),
    }
  }

  return asyncBufferFromUrl({
    url: options.file.url,
    fetch: retryingFetch(
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    ),
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
}

async function readGeojsonSegmentation(response: Response, add: AddShape): Promise<void> {
  const features = createGeojsonFeatureStream(
    (feature, featureIndex) => {
      const record = recordOrNull(feature)
      const ring = geoJsonOuterRing(record?.geometry)

      if (record !== null && ring !== null) {
        add(geojsonFeatureId(record, featureIndex), ring)
      }
    },
    { label: 'segmentation' },
  )

  await forEachMaybeGzipText(response, (text) => {
    features.push(text)
  })
  features.finish()
}

export function geojsonFeatureId(
  feature: Readonly<Record<string, unknown>>,
  featureIndex: number,
): string {
  const properties = recordOrNull(feature.properties)
  const fromProperties = (names: readonly string[]) => {
    for (const name of names) {
      const id = instanceIdString(properties?.[name])

      if (id !== null && id.length > 0) {
        return id
      }
    }

    return null
  }

  return (
    fromProperties(GEOJSON_ID_PROPERTIES) ??
    nonEmpty(instanceIdString(feature.id)) ??
    fromProperties(GEOJSON_FALLBACK_ID_PROPERTIES) ??
    featureIndex.toString()
  )
}

async function readWktSegmentation(response: Response, add: AddShape): Promise<void> {
  const table = createWktTableReader(add)

  await forEachMaybeGzipLine(response, (line) => {
    table.line(line)
  })
}

// Reads WKT polygons from lines of text: one WKT value a line, or a
// delimited table (comma, tab or semicolon) with a header naming the
// geometry column (`geometry`, `wkt`, …) and the ID column (`cell_id`,
// `label`, …, or an unnamed first column as pandas writes its index). Without
// an ID column, shapes are numbered from 0 in file order.
export function createWktTableReader(add: AddShape): { line(text: string): void } {
  let layout: WktTableLayout | null = null
  let header: readonly string[] | null = null
  let row = 0

  const addRow = (fields: readonly string[], layout: WktTableLayout) => {
    const geometry = fields[layout.geometryColumn]
    const ring = geometry === undefined ? null : wktOuterRing(unquote(geometry))
    const id =
      layout.idColumn === undefined
        ? undefined
        : nonEmpty(unquote(fields[layout.idColumn] ?? '').trim())

    if (ring !== null) {
      add(id ?? row.toString(), ring)
    }

    row += 1
  }

  return {
    line(text) {
      if (text.trim().length === 0) {
        return
      }

      if (layout === null) {
        const delimiter = detectDelimiter(text)
        const fields = splitDelimited(text, delimiter)
        const geometryColumn = fields.findIndex((field) => looksLikeWktPolygon(field))

        if (header === null && geometryColumn < 0) {
          // A header; the geometry column is found by name or on the first row.
          header = fields.map((field) => unquote(field).trim().toLowerCase())
          const named = firstColumnNamed(header, GEOMETRY_COLUMN_NAMES)

          if (named !== undefined) {
            layout = { delimiter, geometryColumn: named, ...idColumnFor(header) }
          }

          return
        }

        if (geometryColumn < 0) {
          throw new Error(
            'No WKT POLYGON or MULTIPOLYGON column was found. Name it geometry or wkt.',
          )
        }

        layout = {
          delimiter,
          geometryColumn,
          ...(header === null
            ? fields.length > 1
              ? { idColumn: geometryColumn === 0 ? 1 : 0 }
              : {}
            : idColumnFor(header)),
        }
        addRow(fields, layout)
        return
      }

      addRow(splitDelimited(text, layout.delimiter), layout)
    },
  }
}

interface WktTableLayout {
  readonly delimiter: string | null
  readonly geometryColumn: number
  readonly idColumn?: number
}

function idColumnFor(header: readonly string[]): { readonly idColumn?: number } {
  const named = firstColumnNamed(header, ID_COLUMN_NAMES)

  if (named !== undefined) {
    return { idColumn: named }
  }

  // pandas writes its index as an unnamed first column.
  return header[0] === '' || header[0] === 'unnamed: 0' ? { idColumn: 0 } : {}
}

function firstColumnNamed(
  header: readonly string[],
  names: readonly string[],
): number | undefined {
  for (const name of names) {
    const index = header.indexOf(name)

    if (index >= 0) {
      return index
    }
  }

  return undefined
}

// Tab, comma or semicolon outside quotes and parentheses; null when the line
// has none (one WKT value a line).
function detectDelimiter(line: string): string | null {
  for (const delimiter of ['\t', ',', ';']) {
    if (splitDelimited(line, delimiter).length > 1) {
      return delimiter
    }
  }

  return null
}

// Splits at `delimiter` outside double quotes and parentheses, so WKT left
// unquoted in a CSV stays one field.
export function splitDelimited(line: string, delimiter: string | null): string[] {
  if (delimiter === null) {
    return [line]
  }

  const fields: string[] = []
  let start = 0
  let depth = 0
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === '(') {
      depth += 1
    } else if (!quoted && char === ')') {
      depth = Math.max(0, depth - 1)
    } else if (!quoted && depth === 0 && char === delimiter) {
      fields.push(line.slice(start, index))
      start = index + 1
    }
  }

  fields.push(line.slice(start))
  return fields
}

function unquote(field: string): string {
  const trimmed = field.trim()

  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed
}

type SegmentationParquetLayout =
  | {
      readonly kind: 'geometry'
      readonly geometryColumn: string
      readonly idColumn?: string
      readonly index: { readonly start: number; readonly step: number }
    }
  | {
      readonly kind: 'vertices'
      readonly idColumn: string
      readonly xColumn: string
      readonly yColumn: string
    }

export function segmentationParquetLayout(
  metadata: FileMetaData,
): SegmentationParquetLayout {
  const columns = metadata.schema.slice(1).map((element) => element.name)
  const lowerColumns = columns.map((column) => column.toLowerCase())
  const columnNamed = (names: readonly string[]) => {
    const index = firstColumnNamed(lowerColumns, names)
    return index === undefined ? undefined : columns[index]
  }
  const keyValues = new Map(
    (metadata.key_value_metadata ?? []).map((entry) => [entry.key, entry.value]),
  )
  const geo = parseJsonRecord(keyValues.get('geo'))
  const pandas = parseJsonRecord(keyValues.get('pandas'))
  const primary =
    typeof geo?.primary_column === 'string' && columns.includes(geo.primary_column)
      ? geo.primary_column
      : undefined
  const geometryColumn = primary ?? columnNamed(GEOMETRY_COLUMN_NAMES)
  const indexEntry = Array.isArray(pandas?.index_columns)
    ? (pandas.index_columns[0] as unknown)
    : undefined
  const indexColumn =
    typeof indexEntry === 'string' && columns.includes(indexEntry)
      ? indexEntry
      : undefined
  // An unnamed pandas index (`__index_level_0__`, a filtered or concatenated
  // frame's row labels) gives way to a column named as an ID; a named index
  // (`cell_id` set as the index) is the ID.
  const namedIdColumn = columnNamed(ID_COLUMN_NAMES)
  const idColumn =
    indexColumn !== undefined && UNNAMED_INDEX_COLUMN.test(indexColumn)
      ? (namedIdColumn ?? indexColumn)
      : (indexColumn ?? namedIdColumn)

  if (geometryColumn !== undefined) {
    const range = recordOrNull(indexEntry)
    return {
      kind: 'geometry',
      geometryColumn,
      ...(idColumn === undefined ? {} : { idColumn }),
      index:
        range?.kind === 'range'
          ? {
              start: typeof range.start === 'number' ? range.start : 0,
              step: typeof range.step === 'number' ? range.step : 1,
            }
          : { start: 0, step: 1 },
    }
  }

  const xColumn = columnNamed(VERTEX_X_COLUMN_NAMES)
  const yColumn = columnNamed(VERTEX_Y_COLUMN_NAMES)

  if (xColumn !== undefined && yColumn !== undefined && idColumn !== undefined) {
    return { kind: 'vertices', idColumn, xColumn, yColumn }
  }

  throw new Error(
    'The Parquet file has neither a geometry column (WKB or WKT, named geometry or wkt) nor vertex columns (cell_id, vertex_x, vertex_y).',
  )
}

async function readParquetSegmentation(
  file: AsyncBuffer,
  add: AddShape,
  options: ReadVectorSegmentationOptions,
): Promise<void> {
  const metadata = await parquetMetadataAsync(file)
  const layout = segmentationParquetLayout(metadata)
  const columns =
    layout.kind === 'geometry'
      ? [
          layout.geometryColumn,
          ...(layout.idColumn === undefined ? [] : [layout.idColumn]),
        ]
      : [layout.idColumn, layout.xColumn, layout.yColumn]
  const compressors = options.compressors ?? (await loadDefaultCompressors())
  const decoder = new TextDecoder()
  // A shape whose vertex rows run on into the next row group.
  const vertices: { pending: { id: string; ring: number[] } | null } = { pending: null }
  let rowStart = 0

  for (const rowGroup of metadata.row_groups) {
    throwIfAborted(options.signal)
    const rowCount = Number(rowGroup.num_rows)
    const rowEnd = rowStart + rowCount
    const values = await readRowGroupColumns(file, metadata, columns, compressors, {
      rowStart,
      rowEnd,
    })

    if (layout.kind === 'geometry') {
      const geometries = values.get(layout.geometryColumn) ?? []
      const ids = layout.idColumn === undefined ? undefined : values.get(layout.idColumn)

      for (let row = 0; row < rowCount; row += 1) {
        const ring = parquetGeometryRing(geometries[row], decoder)

        if (ring === null) {
          continue
        }

        const id =
          ids === undefined
            ? String(layout.index.start + (rowStart + row) * layout.index.step)
            : parquetIdString(ids[row], decoder)

        if (id !== undefined) {
          add(id, ring)
        }
      }
    } else {
      const ids = values.get(layout.idColumn) ?? []
      const xs = values.get(layout.xColumn) ?? []
      const ys = values.get(layout.yColumn) ?? []

      for (let row = 0; row < rowCount; row += 1) {
        const id = parquetIdString(ids[row], decoder)
        const x = finiteNumber(xs[row])
        const y = finiteNumber(ys[row])

        if (id === undefined || x === undefined || y === undefined) {
          continue
        }

        let { pending } = vertices

        if (pending?.id !== id) {
          if (pending !== null) {
            add(pending.id, closedRingWithoutRepeat(pending.ring))
          }

          pending = { id, ring: [] }
          vertices.pending = pending
        }

        pending.ring.push(x, y)
      }
    }

    rowStart = rowEnd
  }

  if (vertices.pending !== null) {
    add(vertices.pending.id, closedRingWithoutRepeat(vertices.pending.ring))
  }
}

async function readRowGroupColumns(
  file: AsyncBuffer,
  metadata: FileMetaData,
  columns: readonly string[],
  compressors: Compressors,
  rows: { readonly rowStart: number; readonly rowEnd: number },
): Promise<Map<string, ArrayLike<unknown>>> {
  const chunks = new Map<
    string,
    { readonly rowStart: number; readonly values: ArrayLike<unknown> }[]
  >(columns.map((column) => [column, []]))

  await parquetRead({
    file,
    metadata,
    columns: [...columns],
    compressors,
    parsers: WKB_PARSERS,
    utf8: false,
    rowStart: rows.rowStart,
    rowEnd: rows.rowEnd,
    onChunk: ({ columnName, columnData, rowStart }) => {
      chunks.get(columnName)?.push({ rowStart, values: columnData })
    },
  })

  const rowCount = rows.rowEnd - rows.rowStart
  const joined = new Map<string, ArrayLike<unknown>>()

  for (const [column, columnChunks] of chunks) {
    const values = new Array<unknown>(rowCount)

    for (const chunk of columnChunks) {
      const offset = chunk.rowStart - rows.rowStart

      for (let index = 0; index < chunk.values.length; index += 1) {
        const target = offset + index

        if (target >= 0 && target < rowCount) {
          values[target] = chunk.values[index]
        }
      }
    }

    joined.set(column, values)
  }

  return joined
}

// WKB bytes (first byte 0 or 1, the byte order), WKT bytes or a WKT string.
function parquetGeometryRing(
  value: unknown,
  decoder: TextDecoder,
): ArrayLike<number> | null {
  if (value instanceof Uint8Array) {
    return value[0] === 0 || value[0] === 1
      ? wkbOuterRing(value)
      : wktOuterRing(decoder.decode(value))
  }

  return typeof value === 'string' ? wktOuterRing(value) : null
}

function parquetIdString(value: unknown, decoder: TextDecoder): string | undefined {
  return value instanceof Uint8Array
    ? nonEmpty(decoder.decode(value))
    : nonEmpty(instanceIdString(value))
}

// Vertex tables repeat the first vertex last; outlines do not need it.
function closedRingWithoutRepeat(ring: number[]): number[] {
  const length = ring.length

  return length >= 8 && ring[0] === ring[length - 2] && ring[1] === ring[length - 1]
    ? ring.slice(0, -2)
    : ring
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'bigint' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value.length === 0 ? undefined : value
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (value === undefined) {
    return null
  }

  try {
    return recordOrNull(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

async function loadDefaultCompressors(): Promise<Compressors> {
  const { compressors } = await import('hyparquet-compressors')
  return compressors
}
