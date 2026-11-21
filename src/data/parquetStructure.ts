import {
  asyncBufferFromUrl,
  parquetMetadataAsync,
  parquetSchema,
  type AsyncBuffer,
  type FileMetaData,
  type SchemaElement,
  type SchemaTree,
  type Statistics,
} from 'hyparquet'
import { abortable } from '../utils/abortable'

// The structure of one Parquet file, for browsing it: the schema as a tree,
// each column's chunks summed over the row groups, the row groups, and the
// key-value metadata. Only the footer is read, never the column data.

export interface ParquetFileRef {
  // The file's address; with `zipPath`, the address of the zipped Zarr store
  // that holds it.
  readonly url: string
  // The file's path inside the zipped store, from the store's root.
  readonly zipPath?: string
}

// Statistics shown as they are; binary values are left out.
export type ParquetStatValue = number | bigint | string | boolean | Date

export interface ParquetColumnSummary {
  // Position among the leaf columns, as in each row group's column chunks.
  readonly index: number
  // Distinct over the row groups, in the order first seen.
  readonly codecs: readonly string[]
  readonly encodings: readonly string[]
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  // Values stored, counting nulls and each element of a list.
  readonly valueCount: number
  // Summed over the row groups, when every row group gives it.
  readonly nullCount?: number
  // The least and greatest values in the row groups' statistics, when every
  // row group gives them and they are not binary.
  readonly min?: ParquetStatValue
  readonly max?: ParquetStatValue
  readonly dictionary: boolean
  readonly pageIndex: boolean
  readonly bloomFilter: boolean
}

export interface ParquetSchemaNode {
  // Field names from the root, joined with '/'; '' is the root.
  readonly path: string
  readonly name: string
  readonly fieldPath: readonly string[]
  readonly element: SchemaElement
  readonly children: readonly ParquetSchemaNode[]
  // Leaf columns only.
  readonly column?: ParquetColumnSummary
}

export interface ParquetRowGroupSummary {
  readonly rowCount: number
  readonly compressedBytes: number
  readonly uncompressedBytes: number
}

export interface ParquetKeyValue {
  readonly key: string
  readonly value: string | null
  // The value parsed, when it is a JSON object or array.
  readonly json?: unknown
}

export interface ParquetStructure {
  readonly ref: ParquetFileRef
  readonly byteLength: number
  // The footer's Thrift metadata, without the 8-byte trailer.
  readonly footerBytes: number
  readonly formatVersion: number
  readonly createdBy: string | null
  readonly rowCount: number
  // The schema root, named after the file.
  readonly root: ParquetSchemaNode
  // Leaf columns, the ones that hold data.
  readonly columnCount: number
  readonly rowGroups: readonly ParquetRowGroupSummary[]
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  readonly keyValueMetadata: readonly ParquetKeyValue[]
  // The footer as hyparquet parsed it, to read rows without reading it again.
  readonly metadata: FileMetaData
}

export interface ReadParquetStructureOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export class ParquetFileNotFoundError extends Error {
  readonly url: string

  constructor(address: string, status: number | null) {
    super(
      status === null
        ? `No file was found at ${address}.`
        : `${address} could not be read (HTTP ${status}).`,
    )
    this.name = 'ParquetFileNotFoundError'
    this.url = address
  }
}

export class NotParquetFileError extends Error {
  readonly url: string

  constructor(address: string, detail: string) {
    super(`${address} is not a Parquet file: ${detail}.`)
    this.name = 'NotParquetFileError'
    this.url = address
  }
}

// Parquet files by name; a dataset written as a folder of parts is not one
// file.
export function isParquetFileName(name: string): boolean {
  return /\.(?:parquet|parq|pq)$/i.test(name)
}

export async function readParquetStructure(
  ref: ParquetFileRef,
  options: ReadParquetStructureOptions = {},
): Promise<ParquetStructure> {
  const file = await openParquetFile(ref, options)
  let metadata: FileMetaData

  // hyparquet reads the footer's last 8 bytes before checking the size.
  if (file.byteLength < MIN_PARQUET_BYTES) {
    throw new NotParquetFileError(
      parquetFileAddress(ref),
      `it is ${file.byteLength.toLocaleString()} bytes, too short for a Parquet file`,
    )
  }

  try {
    // GeoParquet columns are left as the file declares them; the `geo`
    // metadata says which they are.
    metadata = await abortable(
      parquetMetadataAsync(file, { geoparquet: false }),
      options.signal,
    )
  } catch (error) {
    options.signal?.throwIfAborted()

    if (error instanceof Error && NOT_PARQUET_MESSAGE.test(error.message)) {
      throw new NotParquetFileError(parquetFileAddress(ref), error.message)
    }

    throw error
  }

  return parquetStructureFromMetadata(metadata, { ref, byteLength: file.byteLength })
}

// The leading magic, the footer's length and the trailing magic.
const MIN_PARQUET_BYTES = 12

// hyparquet's errors for a file whose last bytes are not a Parquet footer.
const NOT_PARQUET_MESSAGE =
  /^parquet (?:file invalid|file is too short|metadata length \d+ exceeds)/

// The address shown for a file: its own, or its path in the zip.
export function parquetFileAddress(ref: ParquetFileRef): string {
  return ref.zipPath === undefined ? ref.url : `${ref.zipPath} in ${ref.url}`
}

export interface OpenParquetFileOptions extends ReadParquetStructureOptions {
  // Known from an earlier read, so the size probe is skipped.
  readonly byteLength?: number
  // Ranges read in parallel: Chromium runs parallel Range requests to one
  // URL one at a time while they may be cached.
  readonly parallel?: boolean
}

// Byte source for a Parquet file, at its address or in a zipped store.
export async function openParquetFile(
  ref: ParquetFileRef,
  options: OpenParquetFileOptions = {},
): Promise<AsyncBuffer> {
  const { fetcher, signal, byteLength, parallel = false } = options
  const requestInit: RequestInit = {
    ...(signal === undefined ? {} : { signal }),
    ...(parallel ? { cache: 'no-store' as const } : {}),
  }

  if (ref.zipPath !== undefined) {
    const { openZippedZarrStore } = await import('../zarr/zarrZipStore')
    const zip = await abortable(
      openZippedZarrStore(ref.url, fetcher === undefined ? {} : { fetcher }),
      signal,
    )
    const file = zip.file(ref.zipPath)

    if (file === null) {
      throw new ParquetFileNotFoundError(parquetFileAddress(ref), null)
    }

    return file
  }

  try {
    return await abortable(
      asyncBufferFromUrl({
        url: ref.url,
        ...(byteLength === undefined ? {} : { byteLength }),
        ...(fetcher === undefined ? {} : { fetch: fetcher }),
        ...(Object.keys(requestInit).length === 0 ? {} : { requestInit }),
      }),
      signal,
    )
  } catch (error) {
    signal?.throwIfAborted()
    // hyparquet's size probe: "fetch head failed 404", or "fetch with range
    // failed 403" after a HEAD that was refused.
    const status = Number(
      /\bfailed (\d{3})$/.exec(error instanceof Error ? error.message : '')?.[1],
    )

    if (status === 403 || status === 404 || status === 410) {
      throw new ParquetFileNotFoundError(ref.url, status)
    }

    throw error
  }
}

export function parquetStructureFromMetadata(
  metadata: FileMetaData,
  { ref, byteLength }: { readonly ref: ParquetFileRef; readonly byteLength: number },
): ParquetStructure {
  const columns = summarizeColumns(metadata)
  const tree = parquetSchema(metadata)
  const root = schemaNode(tree, columns, fileName(ref))
  let compressedBytes = 0
  let uncompressedBytes = 0

  for (const column of columns.values()) {
    compressedBytes += column.compressedBytes
    uncompressedBytes += column.uncompressedBytes
  }

  return {
    ref,
    byteLength,
    footerBytes: metadata.metadata_length,
    formatVersion: metadata.version,
    createdBy: metadata.created_by ?? null,
    rowCount: Number(metadata.num_rows),
    root,
    columnCount: metadata.schema.filter((element) => element.type !== undefined).length,
    rowGroups: metadata.row_groups.map((group) => {
      let compressed = 0

      for (const chunk of group.columns) {
        compressed += Number(chunk.meta_data?.total_compressed_size ?? 0)
      }

      return {
        rowCount: Number(group.num_rows),
        compressedBytes:
          group.total_compressed_size === undefined
            ? compressed
            : Number(group.total_compressed_size),
        uncompressedBytes: Number(group.total_byte_size),
      }
    }),
    compressedBytes,
    uncompressedBytes,
    keyValueMetadata: (metadata.key_value_metadata ?? []).map(({ key, value }) => {
      const json = value === undefined ? undefined : parseJsonContainer(value)
      return json === undefined
        ? { key, value: value ?? null }
        : { key, value: value ?? null, json }
    }),
    metadata,
  }
}

function fileName(ref: ParquetFileRef): string {
  if (ref.zipPath !== undefined) {
    return ref.zipPath.split('/').pop() ?? ref.zipPath
  }

  try {
    const segments = new URL(ref.url).pathname.split('/').filter(Boolean)
    return decodeURIComponent(segments.at(-1) ?? ref.url)
  } catch {
    return ref.url
  }
}

function schemaNode(
  tree: SchemaTree,
  columns: ReadonlyMap<string, ParquetColumnSummary>,
  rootName: string,
): ParquetSchemaNode {
  const path = tree.path.join('/')
  const column = tree.children.length === 0 ? columns.get(path) : undefined

  return {
    path,
    name: tree.path.length === 0 ? rootName : tree.element.name,
    fieldPath: tree.path,
    element: tree.element,
    children: tree.children.map((child) => schemaNode(child, columns, rootName)),
    ...(column === undefined ? {} : { column }),
  }
}

interface ColumnTotals {
  index: number
  element: SchemaElement | undefined
  codecs: Set<string>
  encodings: Set<string>
  compressedBytes: number
  uncompressedBytes: number
  valueCount: number
  nullCount: number | null
  min: ParquetStatValue | null | undefined
  max: ParquetStatValue | null | undefined
  dictionary: boolean
  pageIndex: boolean
  bloomFilter: boolean
}

// Each leaf column's chunks, summed over the row groups, keyed by path.
function summarizeColumns(metadata: FileMetaData): Map<string, ParquetColumnSummary> {
  const leaves = leafElements(metadata.schema)
  const totals = new Map<string, ColumnTotals>()

  for (const group of metadata.row_groups) {
    group.columns.forEach((chunk, index) => {
      const meta = chunk.meta_data

      if (meta === undefined) {
        return
      }

      const path = meta.path_in_schema.join('/')
      let total = totals.get(path)

      if (total === undefined) {
        total = {
          index,
          element: leaves.get(path),
          codecs: new Set(),
          encodings: new Set(),
          compressedBytes: 0,
          uncompressedBytes: 0,
          valueCount: 0,
          nullCount: 0,
          // undefined: no row group seen yet; null: unknown.
          min: undefined,
          max: undefined,
          dictionary: false,
          pageIndex: false,
          bloomFilter: false,
        }
        totals.set(path, total)
      }

      total.codecs.add(meta.codec)
      for (const encoding of meta.encodings) total.encodings.add(encoding)
      total.compressedBytes += Number(meta.total_compressed_size)
      total.uncompressedBytes += Number(meta.total_uncompressed_size)
      total.valueCount += Number(meta.num_values)
      const nulls = meta.statistics?.null_count
      total.nullCount =
        total.nullCount === null || nulls === undefined
          ? null
          : total.nullCount + Number(nulls)
      const [min, max] = statBounds(meta.statistics, total.element)
      total.min = combineStat(total.min, min, -1)
      total.max = combineStat(total.max, max, 1)
      total.dictionary ||=
        meta.dictionary_page_offset !== undefined ||
        meta.encodings.some((encoding) => encoding.endsWith('_DICTIONARY'))
      total.pageIndex ||=
        chunk.column_index_offset !== undefined || chunk.offset_index_offset !== undefined
      total.bloomFilter ||= meta.bloom_filter_offset !== undefined
    })
  }

  return new Map(
    Array.from(totals, ([path, total]) => [
      path,
      {
        index: total.index,
        codecs: Array.from(total.codecs),
        encodings: Array.from(total.encodings),
        compressedBytes: total.compressedBytes,
        uncompressedBytes: total.uncompressedBytes,
        valueCount: total.valueCount,
        ...(total.nullCount === null ? {} : { nullCount: total.nullCount }),
        ...(total.min === null || total.min === undefined ? {} : { min: total.min }),
        ...(total.max === null || total.max === undefined ? {} : { max: total.max }),
        dictionary: total.dictionary,
        pageIndex: total.pageIndex,
        bloomFilter: total.bloomFilter,
      },
    ]),
  )
}

// Leaf schema elements by path, to read statistics by their column's type.
function leafElements(schema: readonly SchemaElement[]): Map<string, SchemaElement> {
  const leaves = new Map<string, SchemaElement>()
  let index = 1

  const visit = (path: readonly string[], count: number) => {
    for (let child = 0; child < count; child += 1) {
      const element = schema[index]

      if (element === undefined) {
        return
      }

      index += 1
      const childPath = [...path, element.name]

      if (element.num_children === undefined || element.num_children === 0) {
        leaves.set(childPath.join('/'), element)
      } else {
        visit(childPath, element.num_children)
      }
    }
  }

  visit([], schema[0]?.num_children ?? 0)
  return leaves
}

const NUMERIC_TYPES = new Set(['BOOLEAN', 'INT32', 'INT64', 'FLOAT', 'DOUBLE'])

// A chunk's least and greatest values, or null for each that cannot be
// shown. The newer min_value / max_value are preferred; the deprecated
// min / max were written with signed byte order, so they are trusted only
// for numbers.
function statBounds(
  statistics: Statistics | undefined,
  element: SchemaElement | undefined,
): readonly [ParquetStatValue | null, ParquetStatValue | null] {
  if (statistics === undefined || element === undefined) {
    return [null, null]
  }

  const unsigned = isUnsignedColumn(element)
  const decimalScale = integerDecimalScale(element)
  // Unsigned columns sort unsigned, which the legacy fields did not.
  const legacy = NUMERIC_TYPES.has(element.type ?? '') && !unsigned
  const shown = (value: Statistics['min']): ParquetStatValue | null => {
    if (value === undefined || value instanceof Uint8Array) return null
    if (typeof value === 'number' && Number.isNaN(value)) return null
    if (typeof value === 'string' && !isTextColumn(element)) return null

    // hyparquet reads INT32 and INT64 statistics as signed, unscaled
    // integers; rows are converted as below, so the two agree.
    if (
      decimalScale !== undefined &&
      (typeof value === 'number' || typeof value === 'bigint')
    ) {
      return Number(value) * 10 ** -decimalScale
    }

    if (unsigned && typeof value === 'number' && value < 0) return value + 2 ** 32
    if (unsigned && typeof value === 'bigint' && value < 0n) return value + 2n ** 64n
    return value
  }

  return [
    shown(statistics.min_value ?? (legacy ? statistics.min : undefined)),
    shown(statistics.max_value ?? (legacy ? statistics.max : undefined)),
  ]
}

function isUnsignedColumn(element: SchemaElement): boolean {
  const logical = element.logical_type
  return (
    (logical?.type === 'INTEGER' && !logical.isSigned) ||
    (element.converted_type?.startsWith('UINT_') ?? false)
  )
}

// The scale of a DECIMAL stored as INT32 or INT64, whose statistics are the
// unscaled integers.
function integerDecimalScale(element: SchemaElement): number | undefined {
  if (element.type !== 'INT32' && element.type !== 'INT64') {
    return undefined
  }

  const logical = element.logical_type

  if (logical?.type === 'DECIMAL') {
    return logical.scale
  }

  return element.converted_type === 'DECIMAL' ? (element.scale ?? 0) : undefined
}

// BYTE_ARRAY columns marked as text; hyparquet decodes every BYTE_ARRAY
// statistic as UTF-8, which garbles binary such as WKB geometry.
function isTextColumn(element: SchemaElement): boolean {
  const logical = element.logical_type?.type
  return (
    logical === 'STRING' ||
    logical === 'ENUM' ||
    logical === 'JSON' ||
    element.converted_type === 'UTF8' ||
    element.converted_type === 'ENUM' ||
    element.converted_type === 'JSON'
  )
}

// The running least (direction -1) or greatest (1) value; null once any row
// group lacks one or the values cannot be compared.
function combineStat(
  current: ParquetStatValue | null | undefined,
  next: ParquetStatValue | null,
  direction: -1 | 1,
): ParquetStatValue | null {
  if (current === null || next === null) return null
  if (current === undefined) return next
  const order = compareStats(next, current)
  if (order === null) return null
  return order * direction > 0 ? next : current
}

function compareStats(a: ParquetStatValue, b: ParquetStatValue): number | null {
  if (a instanceof Date && b instanceof Date) {
    return Math.sign(a.getTime() - b.getTime())
  }

  const numeric = (value: ParquetStatValue) =>
    typeof value === 'number' || typeof value === 'bigint'

  if (
    (numeric(a) && numeric(b)) ||
    (typeof a === 'string' && typeof b === 'string') ||
    (typeof a === 'boolean' && typeof b === 'boolean')
  ) {
    return a < b ? -1 : a > b ? 1 : 0
  }

  return null
}

function parseJsonContainer(value: string): unknown {
  const text = value.trim()

  if (!text.startsWith('{') && !text.startsWith('[')) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
