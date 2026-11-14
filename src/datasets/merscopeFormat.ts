// Vizgen MERSCOPE region output, as the instrument or the Vizgen
// Postprocessing Tool (vpt) writes it: file names, and the parsers that turn
// `cell_by_gene.csv` and `cell_metadata.csv` into the columns of an
// in-memory AnnData table. Both files are dense CSVs read whole.
//
// Cell IDs (`EntityID`, `cell`) are 19-digit int64 values, above 2^53, and
// 38-digit values in the 2022 release, so they stay strings throughout.

import type { AnnDataMemoryColumn } from './h5adDataset'

// Files a manifest can relocate, with the name the instrument writes. vpt
// re-segmentation writes `<method>_cell_by_gene.csv`,
// `<method>_cell_metadata.csv`, and `<method>_micron_space.parquet` instead,
// and GEO prefixes and gzips every file, so those need a manifest.
export const MERSCOPE_FILE_DEFAULTS = {
  cellByGene: 'cell_by_gene.csv',
  cellMetadata: 'cell_metadata.csv',
  cellBoundaries: 'cell_boundaries.parquet',
} as const

export type MerscopeFileRole = keyof typeof MERSCOPE_FILE_DEFAULTS

// Each CSV is read whole into memory; the same limit as the Visium matrix.
export const MERSCOPE_CSV_MAX_BYTES = 300 * 1024 * 1024

// Boundaries hold one row per cell per z plane in a single row group, so the
// whole file is read to draw any of them. Larger files start with cell
// boundaries off and are read when they are turned on.
export const MERSCOPE_BOUNDARIES_AUTOLOAD_MAX_BYTES = 100 * 1024 * 1024

// Boundary columns: the cell ID, and the z plane of each row.
export const MERSCOPE_BOUNDARY_ID_COLUMN = 'EntityID'
export const MERSCOPE_BOUNDARY_PLANE_COLUMN = 'ZIndex'

// Blank barcodes are control probes, not genes.
const BLANK_COLUMN_PATTERN = /^blank-/i

// cell_metadata.csv columns that place the cell; the centre becomes
// `obsm/spatial` and none of them become colour tracks.
const POSITION_COLUMNS = new Set([
  'center_x',
  'center_y',
  'min_x',
  'min_y',
  'max_x',
  'max_y',
])
// Columns read as categories even though their values are numbers.
const CATEGORICAL_COLUMNS = new Set(['fov'])

export const MERSCOPE_TOTAL_COUNTS_COLUMN = 'total_counts'
export const MERSCOPE_BLANK_COUNT_COLUMN = 'blank_count'
export const MERSCOPE_TRANSCRIPT_COUNT_COLUMN = 'transcript_count'

export class MerscopeFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MerscopeFormatError'
  }
}

// cell_by_gene.csv as a sparse matrix: one row per cell, one column per gene
// in header order. Blank columns are summed per cell instead.
export interface MerscopeCellByGene {
  readonly ids: readonly string[]
  readonly genes: readonly string[]
  readonly blankColumnCount: number
  readonly data: Float32Array
  readonly indices: Int32Array
  readonly indptr: Float64Array
  // Per cell: the sum of its gene counts, and of its Blank counts (null
  // without Blank columns).
  readonly totalCounts: Float64Array
  readonly blankCounts: Float64Array | null
}

export type MerscopeMetadataColumn =
  // NaN where a cell has no value.
  | { readonly name: string; readonly kind: 'numeric'; readonly values: Float64Array }
  | { readonly name: string; readonly kind: 'text'; readonly values: readonly string[] }

export interface MerscopeCellMetadata {
  readonly ids: readonly string[]
  // Every column after the ID, in file order.
  readonly columns: readonly MerscopeMetadataColumn[]
}

// The joined table, in cell_by_gene.csv row order.
export interface MerscopeTable {
  readonly ids: readonly string[]
  readonly genes: readonly string[]
  readonly data: Float32Array
  readonly indices: Int32Array
  readonly indptr: Float64Array
  // `center_x`, `center_y` per cell, in µm.
  readonly spatial: Float64Array
  readonly obs: readonly AnnDataMemoryColumn[]
  readonly blankColumnCount: number
  // Cells in one file but not the other, left out.
  readonly countsOnlyCells: number
  readonly metadataOnlyCells: number
  // Metadata columns without a value in any cell (vpt's `fov`), left out.
  readonly emptyColumns: readonly string[]
}

// Parses cell_by_gene.csv. The first column is the cell ID, whatever its
// header (`cell`, or empty in the 2022 release); counts may be written as
// `0.0`.
export function parseMerscopeCellByGene(
  text: string,
  label: string = MERSCOPE_FILE_DEFAULTS.cellByGene,
): MerscopeCellByGene {
  const headerEnd = lineEnd(text, 0)
  const header = splitHeader(text.slice(0, headerEnd))

  if (header.length < 2) {
    throw new MerscopeFormatError(`${label} has no gene columns.`)
  }

  // Per column after the ID: the gene index, or -1 for a Blank column.
  const geneByColumn = new Int32Array(header.length)
  const genes: string[] = []
  let blankColumnCount = 0

  header.forEach((name, column) => {
    if (column === 0) {
      return
    }

    if (BLANK_COLUMN_PATTERN.test(name)) {
      geneByColumn[column] = -1
      blankColumnCount += 1
      return
    }

    geneByColumn[column] = genes.length
    genes.push(name)
  })

  if (genes.length === 0) {
    throw new MerscopeFormatError(`${label} has only Blank columns.`)
  }

  const ids: string[] = []
  const data = new GrowableArray(Float32Array)
  const indices = new GrowableArray(Int32Array)
  const indptr = new GrowableArray(Float64Array)
  const totals = new GrowableArray(Float64Array)
  const blanks = new GrowableArray(Float64Array)
  indptr.push(0)

  forEachRow(text, headerEnd, header.length, label, (fields) => {
    ids.push(fields.text(0))
    let total = 0
    let blank = 0

    for (let column = 1; column < header.length; column += 1) {
      const value = fields.number(column)

      if (value === 0) {
        continue
      }

      const gene = geneByColumn[column] ?? -1

      if (gene < 0) {
        blank += value
        continue
      }

      data.push(value)
      indices.push(gene)
      total += value
    }

    indptr.push(data.length)
    totals.push(total)
    blanks.push(blank)
  })

  return {
    ids,
    genes,
    blankColumnCount,
    data: data.toArray(),
    indices: indices.toArray(),
    indptr: indptr.toArray(),
    totalCounts: totals.toArray(),
    blankCounts: blankColumnCount === 0 ? null : blanks.toArray(),
  }
}

// Parses cell_metadata.csv. The first column is the cell ID (`EntityID`, or
// empty in the 2022 release). Columns are numbers unless a value is not.
export function parseMerscopeCellMetadata(
  text: string,
  label: string = MERSCOPE_FILE_DEFAULTS.cellMetadata,
): MerscopeCellMetadata {
  const headerEnd = lineEnd(text, 0)
  const header = splitHeader(text.slice(0, headerEnd))
  const ids: string[] = []
  const numbers = header.map(() => new GrowableArray(Float64Array))
  // Columns with a value that is not a number, as text from that row on.
  const texts: (string[] | null)[] = header.map(() => null)

  forEachRow(text, headerEnd, header.length, label, (fields) => {
    ids.push(fields.text(0))

    for (let column = 1; column < header.length; column += 1) {
      const columnTexts = texts[column]

      if (columnTexts !== null && columnTexts !== undefined) {
        columnTexts.push(fields.text(column))
        continue
      }

      const value = fields.optionalNumber(column)

      if (value !== null) {
        numbers[column]?.push(value)
        continue
      }

      // The first value that is not a number: earlier rows become text.
      const previous = numbers[column]?.toArray() ?? new Float64Array(0)
      const converted = Array.from(previous, numberText)
      converted.push(fields.text(column))
      texts[column] = converted
    }
  })

  const columns: MerscopeMetadataColumn[] = []

  header.forEach((name, column) => {
    if (column === 0) {
      return
    }

    const columnTexts = texts[column]
    columns.push(
      columnTexts === null || columnTexts === undefined
        ? {
            name,
            kind: 'numeric',
            values: numbers[column]?.toArray() ?? new Float64Array(0),
          }
        : { name, kind: 'text', values: columnTexts },
    )
  })

  return { ids, columns }
}

// Joins the two tables by cell ID. Cells keep cell_by_gene.csv order; cells
// in only one file are left out and counted.
export function merscopeTable(
  counts: MerscopeCellByGene,
  metadata: MerscopeCellMetadata,
): MerscopeTable {
  const centerX = metadata.columns.find((column) => column.name === 'center_x')
  const centerY = metadata.columns.find((column) => column.name === 'center_y')

  if (centerX?.kind !== 'numeric' || centerY?.kind !== 'numeric') {
    throw new MerscopeFormatError(
      `${MERSCOPE_FILE_DEFAULTS.cellMetadata} has no numeric center_x and center_y columns.`,
    )
  }

  const metadataRows = joinRows(counts.ids, metadata.ids)
  let keptRows = 0

  for (const row of metadataRows) {
    if (row >= 0) {
      keptRows += 1
    }
  }

  if (keptRows === 0) {
    throw new MerscopeFormatError(
      `None of the ${MERSCOPE_FILE_DEFAULTS.cellByGene} cell IDs are in ${MERSCOPE_FILE_DEFAULTS.cellMetadata}.`,
    )
  }

  // Count rows of cells in both files.
  const kept = new Int32Array(keptRows)
  let keptNonZeros = 0
  let next = 0

  metadataRows.forEach((metadataRow, row) => {
    if (metadataRow >= 0) {
      kept[next] = row
      next += 1
      keptNonZeros += (counts.indptr[row + 1] ?? 0) - (counts.indptr[row] ?? 0)
    }
  })

  const allKept = keptRows === counts.ids.length
  const data = allKept ? counts.data : new Float32Array(keptNonZeros)
  const indices = allKept ? counts.indices : new Int32Array(keptNonZeros)
  const indptr = allKept ? counts.indptr : new Float64Array(keptRows + 1)
  const ids: string[] = new Array<string>(keptRows)
  const spatial = new Float64Array(keptRows * 2)
  const metadataRowByCell = new Int32Array(keptRows)
  let offset = 0

  kept.forEach((row, cell) => {
    const metadataRow = metadataRows[row] ?? -1
    ids[cell] = counts.ids[row] ?? ''
    metadataRowByCell[cell] = metadataRow
    spatial[cell * 2] = centerX.values[metadataRow] ?? Number.NaN
    spatial[cell * 2 + 1] = centerY.values[metadataRow] ?? Number.NaN

    if (!allKept) {
      const start = counts.indptr[row] ?? 0
      const end = counts.indptr[row + 1] ?? start
      data.set(counts.data.subarray(start, end), offset)
      indices.set(counts.indices.subarray(start, end), offset)
      offset += end - start
      indptr[cell + 1] = offset
    }
  })

  const obs: AnnDataMemoryColumn[] = []
  const emptyColumns: string[] = []
  const names = new Set<string>()

  for (const column of metadata.columns) {
    if (POSITION_COLUMNS.has(column.name)) {
      continue
    }

    const obsColumn = metadataObsColumn(column, metadataRowByCell)

    if (obsColumn === null) {
      emptyColumns.push(column.name)
      continue
    }

    obs.push(obsColumn)
    names.add(column.name)
  }

  const countColumn = (name: string, values: Float64Array): void => {
    if (!names.has(name)) {
      obs.push({ name, kind: 'numeric', values: pickRows(values, kept) })
    }
  }

  countColumn(MERSCOPE_TOTAL_COUNTS_COLUMN, counts.totalCounts)

  if (counts.blankCounts !== null) {
    countColumn(MERSCOPE_BLANK_COUNT_COLUMN, counts.blankCounts)
  }

  return {
    ids,
    genes: counts.genes,
    data,
    indices,
    indptr,
    spatial,
    obs,
    blankColumnCount: counts.blankColumnCount,
    countsOnlyCells: counts.ids.length - keptRows,
    metadataOnlyCells: metadata.ids.length - keptRows,
    emptyColumns,
  }
}

// The transferable buffers of a table, for a worker to hand it over.
export function merscopeTableTransferables(table: MerscopeTable): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (array: unknown) => {
    if (ArrayBuffer.isView(array) && array.buffer instanceof ArrayBuffer) {
      buffers.add(array.buffer)
    }
  }

  add(table.data)
  add(table.indices)
  add(table.indptr)
  add(table.spatial)

  for (const column of table.obs) {
    if (column.kind === 'numeric') {
      add(column.values)
    } else if (column.kind === 'categorical') {
      add(column.codes)
    }
  }

  return Array.from(buffers)
}

// For each cell_by_gene row, its cell_metadata row or -1. Both files usually
// list cells in the same order, so the IDs are compared in place first and a
// map is built only when they differ.
function joinRows(
  countIds: readonly string[],
  metadataIds: readonly string[],
): Int32Array {
  const rows = new Int32Array(countIds.length)
  let sameOrder = countIds.length === metadataIds.length

  for (let row = 0; row < countIds.length && sameOrder; row += 1) {
    sameOrder = countIds[row] === metadataIds[row]
    rows[row] = row
  }

  if (sameOrder) {
    return rows
  }

  const metadataRowById = new Map<string, number>()

  metadataIds.forEach((id, row) => {
    if (!metadataRowById.has(id)) {
      metadataRowById.set(id, row)
    }
  })
  countIds.forEach((id, row) => {
    rows[row] = metadataRowById.get(id) ?? -1
  })

  return rows
}

// One metadata column for the kept cells: numbers, or categories for `fov`
// and text columns. Null when no cell has a value.
function metadataObsColumn(
  column: MerscopeMetadataColumn,
  metadataRowByCell: Int32Array,
): AnnDataMemoryColumn | null {
  if (column.kind === 'numeric' && !CATEGORICAL_COLUMNS.has(column.name)) {
    const values = new Float64Array(metadataRowByCell.length)
    let finite = false

    metadataRowByCell.forEach((row, cell) => {
      const value = column.values[row] ?? Number.NaN
      values[cell] = value
      finite ||= Number.isFinite(value)
    })

    return finite ? { name: column.name, kind: 'numeric', values } : null
  }

  const labels = Array.from(metadataRowByCell, (row) =>
    column.kind === 'numeric'
      ? numberText(column.values[row] ?? Number.NaN)
      : (column.values[row] ?? ''),
  )
  const categories = Array.from(new Set(labels))
    .filter((label) => label.length > 0)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

  if (categories.length === 0) {
    return null
  }

  const codeByCategory = new Map(categories.map((category, code) => [category, code]))
  const codes = Int32Array.from(labels, (label) => codeByCategory.get(label) ?? -1)

  return { name: column.name, kind: 'categorical', codes, categories }
}

function pickRows(values: Float64Array, rows: Int32Array): Float64Array {
  return rows.length === values.length
    ? values
    : Float64Array.from(rows, (row) => values[row] ?? Number.NaN)
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }

  return Number.isInteger(value) ? value.toFixed(0) : String(value)
}

interface RowFields {
  // The field as written, without surrounding quotes.
  text(column: number): string
  // The field as a number; empty fields are 0.
  number(column: number): number
  // The field as a number, NaN when empty, or null when it is not a number.
  optionalNumber(column: number): number | null
}

// Calls `onRow` for each data row after the header. Rows must have as many
// fields as the header; blank lines are skipped.
function forEachRow(
  text: string,
  headerEnd: number,
  columnCount: number,
  label: string,
  onRow: (fields: RowFields) => void,
): void {
  const starts = new Int32Array(columnCount)
  const ends = new Int32Array(columnCount)
  let row = 0
  const field = (column: number): string => {
    let start = starts[column] ?? 0
    let end = ends[column] ?? start

    if (end - start >= 2 && text.charCodeAt(start) === QUOTE) {
      start += 1
      end -= text.charCodeAt(end - 1) === QUOTE ? 1 : 0
    }

    return text.slice(start, end)
  }
  const fields: RowFields = {
    text: field,
    number(column) {
      const start = starts[column] ?? 0
      const end = ends[column] ?? start

      // Most fields of a dense count matrix are a single `0`.
      if (end === start || (end - start === 1 && text.charCodeAt(start) === ZERO)) {
        return 0
      }

      const value = Number(field(column))

      if (!Number.isFinite(value)) {
        throw new MerscopeFormatError(
          `${label} row ${(row + 1).toLocaleString()} has a count that is not a number (${JSON.stringify(field(column))}).`,
        )
      }

      return value
    },
    optionalNumber(column) {
      const value = field(column).trim()

      if (value.length === 0) {
        return Number.NaN
      }

      const number = Number(value)
      return Number.isNaN(number) ? null : number
    },
  }
  let position = nextLineStart(text, headerEnd)

  while (position < text.length) {
    const end = lineEnd(text, position)

    if (end === position) {
      position = nextLineStart(text, end)
      continue
    }

    let column = 0
    let fieldStart = position

    for (let index = position; index <= end; index += 1) {
      if (index < end && text.charCodeAt(index) !== COMMA) {
        continue
      }

      if (column < columnCount) {
        starts[column] = fieldStart
        ends[column] = index
      }

      column += 1
      fieldStart = index + 1
    }

    if (column !== columnCount) {
      throw new MerscopeFormatError(
        `${label} row ${(row + 1).toLocaleString()} has ${column.toLocaleString()} fields; the header has ${columnCount.toLocaleString()}.`,
      )
    }

    onRow(fields)
    row += 1
    position = nextLineStart(text, end)
  }
}

const COMMA = 0x2c
const QUOTE = 0x22
const ZERO = 0x30
const CARRIAGE_RETURN = 0x0d
const LINE_FEED = 0x0a

// The index of the line's `\r` or `\n`, or the end of the text.
function lineEnd(text: string, start: number): number {
  const newline = text.indexOf('\n', start)
  const end = newline < 0 ? text.length : newline

  return end > start && text.charCodeAt(end - 1) === CARRIAGE_RETURN ? end - 1 : end
}

function nextLineStart(text: string, end: number): number {
  let position = end

  if (text.charCodeAt(position) === CARRIAGE_RETURN) {
    position += 1
  }

  return text.charCodeAt(position) === LINE_FEED ? position + 1 : position
}

function splitHeader(line: string): string[] {
  return line
    .replace(/^\uFEFF/, '')
    .split(',')
    .map((name) => name.trim().replace(/^"(.*)"$/, '$1'))
}

type TypedArrayConstructor<T> = {
  new (length: number): T
}

// A typed array that doubles as it fills.
class GrowableArray<T extends Float32Array | Float64Array | Int32Array> {
  private buffer: T
  private size = 0

  constructor(private readonly ArrayType: TypedArrayConstructor<T>) {
    this.buffer = new ArrayType(1024)
  }

  get length(): number {
    return this.size
  }

  push(value: number): void {
    if (this.size === this.buffer.length) {
      const next = new this.ArrayType(this.buffer.length * 2)
      next.set(this.buffer)
      this.buffer = next
    }

    this.buffer[this.size] = value
    this.size += 1
  }

  toArray(): T {
    return this.buffer.slice(0, this.size) as T
  }
}
