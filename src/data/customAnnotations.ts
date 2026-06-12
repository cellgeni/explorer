import { asCellId } from './cellid'
import type { CellId } from './cellid'
import type { Annotation } from '../datasets/spatialDataset'

export function parseCustomAnnotations(
  text: string,
  fileName = 'annotations',
): readonly Annotation[] {
  const trimmedText = text.trim()

  if (trimmedText.length === 0) {
    return []
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

function parseJsonAnnotations(text: string, fileName: string): readonly Annotation[] {
  const value: unknown = JSON.parse(text)

  if (Array.isArray(value)) {
    return annotationsFromJsonRows(value, fileName)
  }

  if (isRecord(value)) {
    return annotationsFromJsonRecord(value, fileName)
  }

  throw new Error('JSON annotations must be an array or an object.')
}

function annotationsFromJsonRows(
  rows: readonly unknown[],
  fileName: string,
): readonly Annotation[] {
  const grouped = new Map<string, CellId[]>()
  const directAnnotations: CustomAnnotationEntry[] = []

  for (const row of rows) {
    if (!isRecord(row)) {
      throw new Error('JSON annotation rows must be objects.')
    }

    const label = readStringField(row, ['label', 'annotation', 'group', 'cluster'])
    const cellIds = readCellIdArrayField(row, ['cellIds', 'cell_ids', 'cells'])

    if (label !== undefined && cellIds !== undefined) {
      directAnnotations.push({ label, cellIds })
      continue
    }

    const cellId = readStringField(row, ['cell_id', 'cellId', 'cell'])

    if (label === undefined || cellId === undefined) {
      throw new Error(
        'JSON annotation rows need label plus cell_id, or label plus cellIds.',
      )
    }

    appendGroupedCell(grouped, label, asCellId(cellId))
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
      throw new Error('JSON annotation object values must be cell-id arrays.')
    }

    annotations.push({
      label,
      cellIds: value.map((cellId) => {
        if (typeof cellId !== 'string') {
          throw new Error('JSON annotation cell ids must be strings.')
        }

        return asCellId(cellId)
      }),
    })
  }

  return createCustomAnnotations(fileName, annotations)
}

function parseCsvAnnotations(text: string, fileName: string): readonly Annotation[] {
  const rows = parseCsvRows(text)
  const header = rows[0]

  if (header === undefined) {
    return []
  }

  const cellIdIndex = header.findIndex((column) =>
    ['cell_id', 'cellid', 'cell'].includes(column.trim().toLowerCase()),
  )
  const labelIndex = header.findIndex((column) =>
    ['label', 'annotation', 'group', 'cluster'].includes(column.trim().toLowerCase()),
  )

  if (cellIdIndex < 0) {
    throw new Error('CSV annotations need a cell_id column.')
  }

  if (labelIndex >= 0) {
    return parseCsvSingleLabelAnnotations(rows, cellIdIndex, labelIndex, fileName)
  }

  return parseCsvWideAnnotations(rows, header, cellIdIndex, fileName)
}

function parseCsvSingleLabelAnnotations(
  rows: readonly (readonly string[])[],
  cellIdIndex: number,
  labelIndex: number,
  fileName: string,
): readonly Annotation[] {
  const grouped = new Map<string, CellId[]>()

  for (const row of rows.slice(1)) {
    const cellId = row[cellIdIndex]?.trim()
    const label = row[labelIndex]?.trim()

    if (cellId === undefined || cellId.length === 0 || label === undefined) {
      continue
    }

    appendGroupedCell(grouped, label, asCellId(cellId))
  }

  return createCustomAnnotations(fileName, annotationEntriesFromGroupedCells(grouped))
}

function parseCsvWideAnnotations(
  rows: readonly (readonly string[])[],
  header: readonly string[],
  cellIdIndex: number,
  fileName: string,
): readonly Annotation[] {
  const annotationColumns = header
    .map((column, index) => ({ index, name: column.trim() }))
    .filter(({ index, name }) => index !== cellIdIndex && name.length > 0)

  if (annotationColumns.length === 0) {
    throw new Error('CSV annotations need cell_id plus label or annotation columns.')
  }

  const annotations: CustomAnnotationEntry[] = []

  for (const { index, name } of annotationColumns) {
    const grouped = new Map<string, CellId[]>()

    for (const row of rows.slice(1)) {
      const cellId = row[cellIdIndex]?.trim()
      const label = row[index]?.trim()

      if (
        cellId === undefined ||
        cellId.length === 0 ||
        label === undefined ||
        label.length === 0
      ) {
        continue
      }

      appendGroupedCell(grouped, label, asCellId(cellId))
    }

    annotations.push(
      ...annotationEntriesFromGroupedCells(grouped).map((entry) => ({
        ...entry,
        setName: name,
      })),
    )
  }

  return createCustomAnnotations(fileName, annotations)
}

function parseCsvRows(text: string): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }

      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  row.push(field)
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

function readStringField(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string') {
      return value
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
      throw new Error(`${key} must be an array of cell-id strings.`)
    }

    return value.map((cellId) => asCellId(cellId))
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
