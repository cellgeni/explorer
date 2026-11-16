import {
  flatten,
  parquetReadObjects,
  type AsyncBuffer,
  type FileMetaData,
} from 'hyparquet'
import { readColumn } from 'hyparquet/src/column.js'
import { DEFAULT_PARSERS } from 'hyparquet/src/convert.js'
import { getSchemaPath, isFlatColumn } from 'hyparquet/src/schema.js'
import { deserializeTCompactProtocol } from 'hyparquet/src/thrift.js'
import { abortable } from '../utils/abortable'
import { openParquetFile, type ParquetStructure } from './parquetStructure'

// The first rows of a Parquet file, for the structure drawer's preview.
//
// hyparquet reads whole column chunks unless the file has an offset index,
// which pyarrow and fastparquet do not write by default, so 20 rows of a
// row group of a million would cost the whole row group. Flat columns are
// read here from the start of their chunk, page by page, until the pages
// hold enough values; only those pages are fetched and decoded. Nested
// columns (lists, structs, maps) need hyparquet to assemble them, so they
// go through its row reader, which uses an offset index when there is one.

export const PARQUET_PREVIEW_ROWS = 20

export interface ParquetPreviewColumn {
  // A top-level field.
  readonly name: string
  // One per row: numbers, bigints, strings, booleans, Dates, Uint8Arrays for
  // binary, arrays and objects for nested fields, and null or undefined.
  readonly values: readonly unknown[]
}

export interface ParquetRowPreview {
  readonly columns: readonly ParquetPreviewColumn[]
  readonly rowCount: number
  // The row group the rows come from, or null when the file has no rows.
  readonly rowGroup: number | null
  readonly bytesRead: number
}

export interface ReadParquetRowsOptions {
  readonly rows?: number
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

// The row group a preview reads from: the first that holds rows, with the
// file's row index of its first row.
export function previewRowGroup(
  metadata: FileMetaData,
): { readonly index: number; readonly rowStart: number; readonly rows: number } | null {
  let rowStart = 0

  for (const [index, group] of metadata.row_groups.entries()) {
    const rows = Number(group.num_rows)
    if (rows > 0) return { index, rowStart, rows }
    rowStart += rows
  }

  return null
}

export async function readParquetRows(
  structure: ParquetStructure,
  options: ReadParquetRowsOptions = {},
): Promise<ParquetRowPreview> {
  const { metadata } = structure
  const names = structure.root.children.map((child) => child.name)
  const group = previewRowGroup(metadata)

  if (group === null) {
    return {
      columns: names.map((name) => ({ name, values: [] })),
      rowCount: 0,
      rowGroup: null,
      bytesRead: 0,
    }
  }

  const rows = Math.min(options.rows ?? PARQUET_PREVIEW_ROWS, group.rows)
  const { signal } = options
  let bytesRead = 0
  const opened = await openParquetFile(structure.ref, {
    byteLength: structure.byteLength,
    parallel: true,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(signal === undefined ? {} : { signal }),
  })
  const file: AsyncBuffer = {
    byteLength: opened.byteLength,
    slice: async (start, end) => {
      signal?.throwIfAborted()
      const bytes = await opened.slice(start, end)
      bytesRead += bytes.byteLength
      return bytes
    },
  }
  const { compressors } = await import('hyparquet-compressors')
  const rowGroup = metadata.row_groups[group.index]
  const flat = names.filter((name) =>
    isFlatColumn(getSchemaPath(metadata.schema, [name])),
  )
  const nested = names.filter((name) => !flat.includes(name))

  const [flatValues, nestedRows] = await abortable(
    Promise.all([
      Promise.all(
        flat.map(async (name) => {
          const meta = rowGroup?.columns.find(
            (chunk) =>
              chunk.meta_data?.path_in_schema.length === 1 &&
              chunk.meta_data.path_in_schema[0] === name,
          )?.meta_data

          if (meta === undefined) {
            return [name, []] as const
          }

          const pages = await firstPages(file, meta, rows, group.rows)
          const schemaPath = getSchemaPath(metadata.schema, meta.path_in_schema)
          const element = schemaPath.at(-1)?.element ?? { name }
          const { data } = readColumn(
            {
              view: new DataView(pages.buffer, pages.byteOffset, pages.byteLength),
              offset: 0,
            },
            { groupStart: 0, groupRows: group.rows, selectStart: 0, selectEnd: rows },
            {
              pathInSchema: meta.path_in_schema,
              type: meta.type,
              element,
              schemaPath,
              codec: meta.codec,
              parsers: DEFAULT_PARSERS,
              compressors,
              // Binary that is not marked as text, such as WKB, stays bytes.
              utf8: false,
            },
          )

          return [
            name,
            Array.from(flatten(data) as ArrayLike<unknown>).slice(0, rows),
          ] as const
        }),
      ),
      nested.length === 0
        ? Promise.resolve([])
        : parquetReadObjects({
            file,
            metadata,
            columns: nested,
            rowStart: group.rowStart,
            rowEnd: group.rowStart + rows,
            useOffsetIndex: true,
            compressors,
            utf8: false,
          }),
    ]),
    signal,
  )
  const values = new Map<string, readonly unknown[]>(flatValues)

  for (const name of nested) {
    values.set(
      name,
      nestedRows.map((row) => (row as Record<string, unknown>)[name]),
    )
  }

  return {
    columns: names.map((name) => ({ name, values: values.get(name) ?? [] })),
    rowCount: rows,
    rowGroup: group.index,
    bytesRead,
  }
}

type ColumnMetaData = NonNullable<
  FileMetaData['row_groups'][number]['columns'][number]['meta_data']
>

// A page header's size is not known until it is parsed; this much more is
// read when the bytes so far end inside one.
const HEADER_READ_BYTES = 16 * 1024
// The first read takes the rows' share of the chunk twice over, plus this,
// which holds a dictionary or first page header in most files.
const FIRST_READ_SLACK_BYTES = 8 * 1024

// The start of a column chunk, up to the end of the first data page that
// brings its values to `rows`: the dictionary page, if any, and the data
// pages before it. Read in steps, so a chunk of many pages costs a few of
// them; a chunk written as one page costs all of it.
async function firstPages(
  file: AsyncBuffer,
  meta: ColumnMetaData,
  rows: number,
  groupRows: number,
): Promise<Uint8Array> {
  // As hyparquet does: some writers give a dictionary offset of 0.
  const start = Number(meta.dictionary_page_offset || meta.data_page_offset)
  const size = Number(meta.total_compressed_size)
  const end = start + size
  const firstRead = Math.ceil((size * rows * 2) / groupRows) + FIRST_READ_SLACK_BYTES
  let bytes = new Uint8Array(await file.slice(start, Math.min(end, start + firstRead)))

  for (;;) {
    const walk = walkPages(bytes, rows)

    if (walk.end !== null) {
      return bytes.subarray(0, walk.end)
    }

    if (start + bytes.byteLength >= end) {
      return bytes
    }

    const next = Math.min(end, start + Math.max(walk.needed, bytes.byteLength * 2))
    const more = new Uint8Array(await file.slice(start + bytes.byteLength, next))
    const joined = new Uint8Array(bytes.byteLength + more.byteLength)
    joined.set(bytes)
    joined.set(more, bytes.byteLength)
    bytes = joined
  }
}

const DATA_PAGE = 0
const DATA_PAGE_V2 = 3

// Walks the page headers in `bytes`. `end` is where the page that brings the
// values to `rows` ends, or null when `bytes` ends first; then `needed` is
// how many bytes from the start would get further.
function walkPages(
  bytes: Uint8Array,
  rows: number,
): { readonly end: number | null; readonly needed: number } {
  const reader = {
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    offset: 0,
  }
  let values = 0

  while (reader.offset < bytes.byteLength) {
    const headerStart = reader.offset
    let header: ReturnType<typeof deserializeTCompactProtocol>

    try {
      header = deserializeTCompactProtocol(reader)
    } catch {
      // The header runs past the bytes read so far.
      return { end: null, needed: headerStart + HEADER_READ_BYTES }
    }

    const bodyEnd = reader.offset + Number(header.field_3)

    if (bodyEnd > bytes.byteLength) {
      return { end: null, needed: bodyEnd + HEADER_READ_BYTES }
    }

    reader.offset = bodyEnd

    // Flat columns hold one value, or null, per row.
    if (header.field_1 === DATA_PAGE) {
      values += Number(header.field_5?.field_1 ?? 0)
    } else if (header.field_1 === DATA_PAGE_V2) {
      values += Number(header.field_8?.field_3 ?? header.field_8?.field_1 ?? 0)
    }

    if (values >= rows) {
      return { end: bodyEnd, needed: bodyEnd }
    }
  }

  return { end: null, needed: bytes.byteLength + HEADER_READ_BYTES }
}
