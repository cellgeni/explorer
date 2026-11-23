import { asAnyCellId } from './cellid'
import type { CellId } from './cellid'
import { withoutCsvFormulaGuard } from '../utils/csv'
import type { Annotation } from './annotation'

export interface ContinuousCellMetadataValue {
  readonly cellId: CellId
  readonly value: number
}

export interface ContinuousCellMetadataTrack {
  readonly id: string
  readonly label: string
  /** `null` for a dataset track whose values have not been read yet. */
  readonly values: readonly ContinuousCellMetadataValue[] | null
  readonly cellCount: number
  readonly min: number
  readonly max: number
}

export interface CustomAnnotationImport {
  readonly annotations: readonly Annotation[]
  readonly metadataTracks: readonly ContinuousCellMetadataTrack[]
  // Columns of a table left out because they name cells rather than group
  // them, with how many classes they would have made.
  readonly skippedColumns?: readonly SkippedAnnotationColumn[]
}

export interface SkippedAnnotationColumn {
  readonly name: string
  readonly classCount: number
}

// More classes than this, and a column of a table labels cells rather than
// grouping them (a barcode, a cell name), as the dataset's own sets are
// judged (annotationModel.ts). Each class would be a row in Clusters.
export const IMPORTED_COLUMN_CLASS_LIMIT = 500

// A column is a metadata track when at least this share of its values are
// numbers; the rest (a spreadsheet error, a stray word) have no value.
const CONTINUOUS_COLUMN_NUMERIC_SHARE = 0.95

// The import with only the cells `onMap` holds. Classes and tracks lose the
// other cells, a track's count and range are over the cells kept, and
// classes and tracks left with no cell are dropped. An imported file can
// cover other samples than the open one.
export function customAnnotationImportOnMap(
  imported: CustomAnnotationImport,
  onMap: { has(cellId: string): boolean },
): CustomAnnotationImport {
  const annotations = imported.annotations.flatMap((annotation) => {
    const cellIds = annotation.cellIds.filter((cellId) => onMap.has(cellId))
    return cellIds.length === 0 ? [] : [{ ...annotation, cellIds }]
  })
  const metadataTracks = imported.metadataTracks.flatMap((track) => {
    const values = track.values?.filter((value) => onMap.has(value.cellId)) ?? []

    if (values.length === 0) {
      return []
    }

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY

    for (const { value } of values) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }

    return [{ ...track, values, cellCount: values.length, min, max }]
  })

  return { ...imported, annotations, metadataTracks }
}

// A file the importer cannot read as labels: its format or columns, not the
// address it came from.
export class AnnotationFileFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AnnotationFileFormatError'
  }
}

export function parseCustomAnnotations(
  text: string,
  fileName = 'annotations',
): readonly Annotation[] {
  return parseCustomAnnotationImport(text, fileName).annotations
}

// Cell IDs are any non-empty text, as each platform names cells its own way
// (src/data/cellid.ts, asAnyCellId); the caller checks them against the
// loaded dataset.
export function parseCustomAnnotationImport(
  text: string,
  fileName = 'annotations',
): CustomAnnotationImport {
  const trimmedText = text.trim()

  if (trimmedText.length === 0) {
    return { annotations: [], metadataTracks: [] }
  }

  return fileName.toLowerCase().endsWith('.json') || startsJson(trimmedText)
    ? parseJsonAnnotations(trimmedText, fileName)
    : parseCsvAnnotations(trimmedText, fileName)
}

interface CustomAnnotationEntry {
  readonly label: string
  readonly cellIds: readonly CellId[]
  readonly setName?: string
}

function parseJsonAnnotations(text: string, fileName: string): CustomAnnotationImport {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new AnnotationFileFormatError(`${fileName} is not valid JSON.`, { cause })
  }

  if (Array.isArray(value)) {
    return {
      annotations: annotationsFromJsonRows(value, fileName),
      metadataTracks: [],
    }
  }

  if (isRecord(value)) {
    return {
      annotations: annotationsFromJsonRecord(value, fileName),
      metadataTracks: [],
    }
  }

  throw new AnnotationFileFormatError('JSON annotations must be an array or an object.')
}

function annotationsFromJsonRows(
  rows: readonly unknown[],
  fileName: string,
): readonly Annotation[] {
  const grouped = new Map<string, CellId[]>()
  const directAnnotations: CustomAnnotationEntry[] = []

  for (const row of rows) {
    if (!isRecord(row)) {
      throw new AnnotationFileFormatError('JSON annotation rows must be objects.')
    }

    const label = readStringField(row, ['label', 'annotation', 'group', 'cluster'])
    const cellIds = readCellIdArrayField(row, ['cellIds', 'cell_ids', 'cells'])

    if (label !== undefined && cellIds !== undefined) {
      directAnnotations.push({ label, cellIds })
      continue
    }

    const cellId = readStringField(row, ['cell_id', 'cellId', 'cell'])

    if (label === undefined || cellId === undefined) {
      throw new AnnotationFileFormatError(
        'JSON annotation rows need label plus cell_id, or label plus cellIds.',
      )
    }

    appendGroupedCell(grouped, label, asAnyCellId(cellId))
  }

  return createCustomAnnotations(fileName, [
    ...directAnnotations,
    ...annotationEntriesFromGroupedCells(grouped),
  ])
}

function annotationsFromJsonRecord(
  record: Readonly<Record<string, unknown>>,
  fileName: string,
): readonly Annotation[] {
  const annotations: CustomAnnotationEntry[] = []

  for (const [label, value] of Object.entries(record)) {
    if (!Array.isArray(value)) {
      throw new AnnotationFileFormatError(
        'JSON annotation object values must be cell-id arrays.',
      )
    }

    annotations.push({
      label,
      cellIds: value.map((cellId) => {
        if (typeof cellId !== 'string') {
          throw new AnnotationFileFormatError('JSON annotation cell ids must be strings.')
        }

        return asAnyCellId(cellId)
      }),
    })
  }

  return createCustomAnnotations(fileName, annotations)
}

function parseCsvAnnotations(text: string, fileName: string): CustomAnnotationImport {
  const rows = parseCsvRows(text, csvDelimiter(text))
  const header = rows[0]

  if (header === undefined) {
    return { annotations: [], metadataTracks: [] }
  }

  const cellIdIndex = header.findIndex(isCellIdColumn)
  const labelIndex = header.findIndex((column) =>
    ['label', 'annotation', 'group', 'cluster'].includes(column.trim().toLowerCase()),
  )

  if (cellIdIndex < 0) {
    throw new AnnotationFileFormatError(
      `CSV annotations need a cell_id, cellid or cell column; ${fileName} has ${header
        .slice(0, 8)
        .map((column) => `"${column.trim()}"`)
        .join(', ')}${header.length > 8 ? ', …' : ''}.`,
    )
  }

  return parseCsvWideAnnotations(
    rows,
    header,
    cellIdIndex,
    fileName,
    labelIndex < 0 ? undefined : labelIndex,
  )
}

// The label column's classes, as one set of labels.
function csvLabelColumnEntries(
  rows: readonly (readonly string[])[],
  cellIdIndex: number,
  labelIndex: number,
): readonly CustomAnnotationEntry[] {
  const grouped = new Map<string, CellId[]>()

  for (const row of rows.slice(1)) {
    const cellId = row[cellIdIndex]?.trim()
    const label = row[labelIndex]?.trim()

    if (
      cellId === undefined ||
      cellId.length === 0 ||
      label === undefined ||
      isMissingCsvValue(label)
    ) {
      continue
    }

    appendGroupedCell(grouped, label, asAnyCellId(cellId))
  }

  return annotationEntriesFromGroupedCells(grouped)
}

// Each column other than the cell ID is a set of classes or a metadata track.
// With a label column, that column's classes come first, and the other
// columns are read the same way; an export's `annotation_id` is left out.
function parseCsvWideAnnotations(
  rows: readonly (readonly string[])[],
  header: readonly string[],
  cellIdIndex: number,
  fileName: string,
  labelIndex?: number,
): CustomAnnotationImport {
  const annotationColumns = header
    .map((column, index) => ({ index, name: column.trim() }))
    .filter(
      ({ index, name }) =>
        index !== cellIdIndex &&
        index !== labelIndex &&
        name.length > 0 &&
        !(labelIndex !== undefined && name.toLowerCase() === 'annotation_id'),
    )

  if (annotationColumns.length === 0 && labelIndex === undefined) {
    throw new AnnotationFileFormatError(
      'CSV annotations need cell_id plus label or annotation columns.',
    )
  }

  const annotations: CustomAnnotationEntry[] =
    labelIndex === undefined
      ? []
      : [...csvLabelColumnEntries(rows, cellIdIndex, labelIndex)]
  const metadataTracks: ContinuousCellMetadataTrack[] = []
  const skippedColumns: SkippedAnnotationColumn[] = []
  const usedMetadataTrackIds = new Set<string>()

  for (const { index, name } of annotationColumns) {
    const columnValues = rows
      .slice(1)
      .map((row) => row[index]?.trim() ?? '')
      .filter((value) => !isMissingCsvValue(value))

    if (isContinuousCsvColumn(columnValues)) {
      const metadataTrack = createContinuousMetadataTrack(
        rows,
        cellIdIndex,
        index,
        fileName,
        name,
      )

      if (metadataTrack !== null) {
        metadataTracks.push(
          uniqueContinuousMetadataTrack(metadataTrack, usedMetadataTrackIds),
        )
      }

      continue
    }

    const grouped = new Map<string, CellId[]>()

    for (const row of rows.slice(1)) {
      const cellId = row[cellIdIndex]?.trim()
      const label = row[index]?.trim()

      if (
        cellId === undefined ||
        cellId.length === 0 ||
        label === undefined ||
        isMissingCsvValue(label)
      ) {
        continue
      }

      appendGroupedCell(grouped, label, asAnyCellId(cellId))
    }

    if (grouped.size > IMPORTED_COLUMN_CLASS_LIMIT) {
      skippedColumns.push({ name, classCount: grouped.size })
      continue
    }

    annotations.push(
      ...annotationEntriesFromGroupedCells(grouped).map((entry) => ({
        ...entry,
        setName: name,
      })),
    )
  }

  if (
    annotations.length === 0 &&
    metadataTracks.length === 0 &&
    skippedColumns.length > 0
  ) {
    throw new AnnotationFileFormatError(
      `No column groups the cells: ${skippedColumnsText(skippedColumns)} would each have more than ${IMPORTED_COLUMN_CLASS_LIMIT.toLocaleString()} classes.`,
    )
  }

  return {
    annotations: createCustomAnnotations(fileName, annotations),
    metadataTracks,
    ...(skippedColumns.length === 0 ? {} : { skippedColumns }),
  }
}

// "barcode (20,000 classes) and name (19,998 classes)".
export function skippedColumnsText(columns: readonly SkippedAnnotationColumn[]): string {
  const parts = columns.map(
    ({ name, classCount }) => `${name} (${classCount.toLocaleString()} classes)`,
  )
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
}

function createContinuousMetadataTrack(
  rows: readonly (readonly string[])[],
  cellIdIndex: number,
  valueIndex: number,
  fileName: string,
  label: string,
): ContinuousCellMetadataTrack | null {
  const values: ContinuousCellMetadataValue[] = []
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const row of rows.slice(1)) {
    const cellId = row[cellIdIndex]?.trim()
    const rawValue = row[valueIndex]?.trim()

    if (
      cellId === undefined ||
      cellId.length === 0 ||
      rawValue === undefined ||
      isMissingCsvValue(rawValue) ||
      isNoNumberText(rawValue)
    ) {
      continue
    }

    const value = parseContinuousValue(rawValue)

    if (value === null) {
      continue
    }

    values.push({ cellId: asAnyCellId(cellId), value })
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  if (values.length === 0) {
    return null
  }

  return {
    id: `${customCellMetadataFilePrefix(fileName)}${slug(label)}`,
    label,
    values,
    cellCount: values.length,
    min,
    max,
  }
}

function uniqueContinuousMetadataTrack(
  track: ContinuousCellMetadataTrack,
  usedIds: Set<string>,
): ContinuousCellMetadataTrack {
  const id = uniqueAnnotationId(track.id, usedIds)
  usedIds.add(id)

  return id === track.id ? track : { ...track, id }
}

function isContinuousCsvColumn(values: readonly string[]): boolean {
  const finiteValues = values.filter((value) => !isNoNumberText(value))

  if (finiteValues.length === 0) {
    return false
  }

  const numericValues: number[] = []

  for (const value of finiteValues) {
    const parsedValue = parseContinuousValue(value)

    if (parsedValue !== null) {
      numericValues.push(parsedValue)
    }
  }

  if (numericValues.length < finiteValues.length * CONTINUOUS_COLUMN_NUMERIC_SHARE) {
    return false
  }

  const uniqueValues = new Set(numericValues)
  const hasFractionalValue = numericValues.some((value) => !Number.isInteger(value))

  return hasFractionalValue || uniqueValues.size > 12
}

function parseContinuousValue(value: string): number | null {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

function isMissingCsvValue(value: string): boolean {
  return ['', 'na', 'n/a', 'nan', 'null', 'none'].includes(value.trim().toLowerCase())
}

// Values with no place on a numeric scale: Excel's `#N/A` and `-`, and
// infinities (pandas `inf`, R `Inf`). In a column of classes they are labels.
function isNoNumberText(value: string): boolean {
  return (
    ['#n/a', '-'].includes(value.trim().toLowerCase()) ||
    /^[+-]?inf(?:inity)?$/i.test(value.trim())
  )
}

function isCellIdColumn(column: string): boolean {
  return ['cell_id', 'cellid', 'cell'].includes(column.trim().toLowerCase())
}

// Comma, else a tab or semicolon when the header splits on one into a cell ID
// column (tab-separated files, and spreadsheets saved where `,` is the
// decimal mark).
function csvDelimiter(text: string): string {
  const header = text.slice(0, text.search(/\r|\n|$/))

  return (
    [',', '\t', ';'].find((delimiter) =>
      header
        .split(delimiter)
        .some((column) => isCellIdColumn(column.replace(/^"|"$/g, ''))),
    ) ?? ','
  )
}

// RFC 4180: a `"` opens a quoted field only at its start, so `5" slide` is
// read as written. Drops the `'` our CSV exports put before a field a
// spreadsheet would run as a formula (`formatCsv`), so an exported file
// imports as it was.
function parseCsvRows(text: string, delimiter = ','): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      continue
    }

    if (char === delimiter) {
      row.push(withoutCsvFormulaGuard(field))
      field = ''
      continue
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }

      row.push(withoutCsvFormulaGuard(field))
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  row.push(withoutCsvFormulaGuard(field))
  rows.push(row)

  return rows.filter((candidate) => candidate.some((value) => value.trim().length > 0))
}

function annotationEntriesFromGroupedCells(
  grouped: ReadonlyMap<string, readonly CellId[]>,
): readonly CustomAnnotationEntry[] {
  return [...grouped.entries()].map(([label, cellIds]) => ({ label, cellIds }))
}

function createCustomAnnotations(
  fileName: string,
  entries: readonly CustomAnnotationEntry[],
): readonly Annotation[] {
  const usedIds = new Set<string>()

  return entries.map(({ label, cellIds, setName }) => {
    const displayLabel = setName === undefined ? label : `${setName}: ${label}`
    const baseId =
      setName === undefined
        ? `custom:${slug(fileName)}:${slug(label)}`
        : `custom:${slug(fileName)}:${slug(setName)}:${slug(label)}`
    const id = uniqueAnnotationId(baseId, usedIds)
    usedIds.add(id)

    return {
      id,
      label: displayLabel,
      cellIds,
    }
  })
}

export function customCellMetadataFilePrefix(fileName: string): string {
  return `metadata:${slug(fileName)}:`
}

function uniqueAnnotationId(baseId: string, usedIds: ReadonlySet<string>): string {
  if (!usedIds.has(baseId)) {
    return baseId
  }

  let suffix = 2

  while (usedIds.has(`${baseId}-${suffix}`)) {
    suffix += 1
  }

  return `${baseId}-${suffix}`
}

function appendGroupedCell(
  grouped: Map<string, CellId[]>,
  label: string,
  cellId: CellId,
): void {
  const existing = grouped.get(label) ?? []
  existing.push(cellId)
  grouped.set(label, existing)
}

// Text, or a number written as text (cluster 3, instance ID 17).
function readStringField(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string') {
      return value
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return undefined
}

function readCellIdArrayField(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): readonly CellId[] | undefined {
  for (const key of keys) {
    const value = record[key]

    if (value === undefined) {
      continue
    }

    if (!Array.isArray(value) || !value.every((cellId) => typeof cellId === 'string')) {
      throw new AnnotationFileFormatError(`${key} must be an array of cell-id strings.`)
    }

    return value.map((cellId) => asAnyCellId(cellId))
  }

  return undefined
}

function startsJson(text: string): boolean {
  return text.startsWith('{') || text.startsWith('[')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function slug(value: string): string {
  const slugged = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slugged.length === 0 ? 'annotation' : slugged
}
