import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { Annotation } from '../../datasets/spatialDataset'
import { slug } from '../../utils/slug'
import type { PlotSetKind, PlotSetOption } from '../plots/plotsPanelModel'
import type {
  CellQueryCategoryOperator,
  CellQueryCondition,
  CellQueryNumberOperator,
} from './cellQuery'

// What the Cell Query window can filter on (plan 23-D2) and how its
// conditions read in a link (23-D9).

// The overview's own columns (23-D2), where the platform fills them.
export type CellQueryCellField =
  | 'transcriptCount'
  | 'cellArea'
  | 'nucleusCount'
  | 'segmentationMethod'

export type CellQueryColumnSource =
  | { readonly kind: 'cell'; readonly field: CellQueryCellField }
  // A set as Plots' Group by lists it: loaded, read from the dataset, or the
  // saved selections.
  | { readonly kind: 'set'; readonly setKind: PlotSetKind; readonly setId: string }
  | { readonly kind: 'track'; readonly trackId: string }

export type CellQueryColumnGroup = 'Cell' | 'Classes' | 'Metadata'

export interface CellQueryColumn {
  readonly id: string
  readonly label: string
  readonly kind: 'number' | 'category'
  readonly group: CellQueryColumnGroup
  readonly source: CellQueryColumnSource
  // Shown after numbers, such as "µm²".
  readonly unit?: string
  // The lowest and highest value, where known before reading.
  readonly range?: CellQueryRange
  // Classes in a set, where known before reading.
  readonly classCount?: number
}

export interface CellQueryRange {
  readonly min: number
  readonly max: number
}

// What the overview holds, from one pass over the cells.
export interface OverviewCellColumns {
  readonly numbers: Partial<
    Record<Exclude<CellQueryCellField, 'segmentationMethod'>, CellQueryRange>
  >
  // Distinct segmentation methods, in the order first seen.
  readonly segmentationMethods: readonly string[]
}

interface OverviewCellLike {
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
}

const CELL_NUMBER_FIELDS = ['transcriptCount', 'cellArea', 'nucleusCount'] as const

const CELL_COLUMN_IDS: Readonly<Record<CellQueryCellField, string>> = {
  transcriptCount: 'cell:transcripts',
  cellArea: 'cell:area',
  nucleusCount: 'cell:nuclei',
  segmentationMethod: 'cell:segmentation',
}

const CELL_COLUMN_LABELS: Readonly<Record<CellQueryCellField, string>> = {
  transcriptCount: 'Transcript count',
  cellArea: 'Cell area',
  nucleusCount: 'Nucleus count',
  segmentationMethod: 'Segmentation',
}

// A number column is offered when some cell has a value other than 0: H5AD
// cells carry a transcript count of 0 that says nothing.
export function overviewCellColumns(
  cells: readonly OverviewCellLike[],
): OverviewCellColumns {
  const ranges: Record<string, { min: number; max: number; filled: boolean }> = {}
  const methods = new Set<string>()

  for (const field of CELL_NUMBER_FIELDS) {
    ranges[field] = { min: Infinity, max: -Infinity, filled: false }
  }

  for (const cell of cells) {
    for (const field of CELL_NUMBER_FIELDS) {
      const value = cell[field]
      const range = ranges[field]
      if (value === undefined || !Number.isFinite(value) || range === undefined) continue
      if (value < range.min) range.min = value
      if (value > range.max) range.max = value
      if (value !== 0) range.filled = true
    }
    if (cell.segmentationMethod !== undefined && cell.segmentationMethod !== '') {
      methods.add(cell.segmentationMethod)
    }
  }

  const numbers: Partial<Record<(typeof CELL_NUMBER_FIELDS)[number], CellQueryRange>> = {}
  for (const field of CELL_NUMBER_FIELDS) {
    const range = ranges[field]
    if (range?.filled === true) numbers[field] = { min: range.min, max: range.max }
  }

  return { numbers, segmentationMethods: [...methods] }
}

// A number field's value for every cell, NaN where a cell has none.
export function overviewNumberColumn(
  cells: readonly OverviewCellLike[],
  field: Exclude<CellQueryCellField, 'segmentationMethod'>,
): Float64Array {
  const values = new Float64Array(cells.length)
  cells.forEach((cell, row) => {
    values[row] = cell[field] ?? Number.NaN
  })
  return values
}

// Each cell's segmentation method as an index into `labels`, or -1.
export function overviewSegmentationColumn(
  cells: readonly OverviewCellLike[],
  labels: readonly string[],
): Int32Array {
  const indexByLabel = new Map(labels.map((label, index) => [label, index]))
  const codes = new Int32Array(cells.length).fill(-1)
  cells.forEach((cell, row) => {
    const method = cell.segmentationMethod
    if (method !== undefined) codes[row] = indexByLabel.get(method) ?? -1
  })
  return codes
}

export function setColumnId(setId: string): string {
  return `set:${setId}`
}

export function trackColumnId(trackId: string): string {
  return `track:${trackId}`
}

// Every column, grouped as the Add menus list them: the cell's own, then
// classes, then metadata.
export function cellQueryColumns({
  cellColumns,
  setOptions,
  tracks,
}: {
  readonly cellColumns: OverviewCellColumns
  readonly setOptions: readonly PlotSetOption[]
  readonly tracks: readonly ContinuousCellMetadataTrack[]
}): readonly CellQueryColumn[] {
  const columns: CellQueryColumn[] = []

  for (const field of CELL_NUMBER_FIELDS) {
    const range = cellColumns.numbers[field]
    if (range === undefined) continue
    columns.push({
      id: CELL_COLUMN_IDS[field],
      label: CELL_COLUMN_LABELS[field],
      kind: 'number',
      group: 'Cell',
      source: { kind: 'cell', field },
      range,
      ...(field === 'cellArea' ? { unit: 'µm²' } : {}),
    })
  }

  if (cellColumns.segmentationMethods.length > 0) {
    columns.push({
      id: CELL_COLUMN_IDS.segmentationMethod,
      label: CELL_COLUMN_LABELS.segmentationMethod,
      kind: 'category',
      group: 'Cell',
      source: { kind: 'cell', field: 'segmentationMethod' },
      classCount: cellColumns.segmentationMethods.length,
    })
  }

  for (const option of setOptions) {
    columns.push({
      id: setColumnId(option.id),
      label: option.label,
      kind: 'category',
      group: 'Classes',
      source: { kind: 'set', setKind: option.kind, setId: option.id },
      classCount: option.classCount,
    })
  }

  for (const track of tracks) {
    columns.push({
      id: trackColumnId(track.id),
      label: track.label,
      kind: 'number',
      group: 'Metadata',
      source: { kind: 'track', trackId: track.id },
      ...(Number.isFinite(track.min) && Number.isFinite(track.max)
        ? { range: { min: track.min, max: track.max } }
        : {}),
    })
  }

  return columns
}

// A new condition on a column: every class to choose from, or the column's
// whole range, which matches every cell with a value.
export function defaultCellQueryCondition(column: CellQueryColumn): CellQueryCondition {
  if (column.kind === 'category') {
    return { kind: 'category', columnId: column.id, operator: 'in', classIds: [] }
  }

  return {
    kind: 'number',
    columnId: column.id,
    operator: 'between',
    min: column.range?.min ?? 0,
    max: column.range?.max ?? 0,
  }
}

// A condition with no class chosen matches every cell, so it is left out
// of the query until a class is.
export function isConditionComplete(condition: CellQueryCondition): boolean {
  if (condition.kind === 'category') return condition.classIds.length > 0

  switch (condition.operator) {
    case 'between':
      return Number.isFinite(condition.min) && Number.isFinite(condition.max)
    case 'at-least':
      return Number.isFinite(condition.min)
    case 'at-most':
      return Number.isFinite(condition.max)
  }
}

// Another operator keeps the bounds it shares with the last; a bound the
// last did not use starts at the column's range.
export function withNumberOperator(
  condition: Extract<CellQueryCondition, { kind: 'number' }>,
  operator: CellQueryNumberOperator,
  range: CellQueryRange | undefined,
): CellQueryCondition {
  const min = Number.isFinite(condition.min) ? condition.min : (range?.min ?? 0)
  const max = Number.isFinite(condition.max) ? condition.max : (range?.max ?? 0)
  return { ...condition, operator, min, max }
}

export const NUMBER_OPERATOR_LABELS: Readonly<Record<CellQueryNumberOperator, string>> = {
  between: 'Between',
  'at-least': 'At least',
  'at-most': 'At most',
}

export const CATEGORY_OPERATOR_LABELS: Readonly<
  Record<CellQueryCategoryOperator, string>
> = {
  in: 'Is one of',
  'not-in': 'Is not one of',
}

// `query=` (23-D9): conditions joined by `;`, each `column|operator|values`.
// Class IDs are joined by `,`; numbers are the bounds the operator uses.
// `%`, `;`, `|` and `,` inside a part are written as `%25`, `%3B`, `%7C`
// and `%2C`.
export function formatCellQueryLink(
  conditions: readonly CellQueryCondition[],
): string | undefined {
  if (conditions.length === 0) return undefined

  return conditions
    .map((condition) => {
      const values =
        condition.kind === 'category'
          ? condition.classIds.map(escapeLinkPart).join(',')
          : condition.operator === 'between'
            ? `${linkNumber(condition.min)},${linkNumber(condition.max)}`
            : linkNumber(
                condition.operator === 'at-least' ? condition.min : condition.max,
              )
      return [escapeLinkPart(condition.columnId), condition.operator, values].join('|')
    })
    .join(';')
}

// Conditions a link names; parts that do not parse are dropped.
export function parseCellQueryLink(
  value: string | undefined,
): readonly CellQueryCondition[] {
  if (value === undefined || value === '') return []

  return value.split(';').flatMap((part): CellQueryCondition[] => {
    const [rawColumn, operator, rawValues = ''] = part.split('|')
    const columnId = unescapeLinkPart(rawColumn ?? '')
    if (columnId === '') return []

    if (operator === 'in' || operator === 'not-in') {
      const classIds = rawValues === '' ? [] : rawValues.split(',').map(unescapeLinkPart)
      return [{ kind: 'category', columnId, operator, classIds }]
    }

    const numbers = rawValues.split(',').map(Number)
    const [first = Number.NaN, second = Number.NaN] = numbers

    switch (operator) {
      case 'between':
        return Number.isFinite(first) && Number.isFinite(second)
          ? [{ kind: 'number', columnId, operator, min: first, max: second }]
          : []
      case 'at-least':
        return Number.isFinite(first)
          ? [{ kind: 'number', columnId, operator, min: first, max: Infinity }]
          : []
      case 'at-most':
        return Number.isFinite(first)
          ? [{ kind: 'number', columnId, operator, min: -Infinity, max: first }]
          : []
      default:
        return []
    }
  })
}

// The shortest text that reads back as the same number, so a bound at a
// column's lowest value keeps that cell.
function linkNumber(value: number): string {
  return String(value)
}

function escapeLinkPart(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll(';', '%3B')
    .replaceAll('|', '%7C')
    .replaceAll(',', '%2C')
}

function unescapeLinkPart(value: string): string {
  return value.replace(/%(25|3B|7C|2C)/gi, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16)),
  )
}

// Whole numbers as they are; others to four significant digits, and very
// small ones in exponent form, so 3.9e-14 does not read as 0.
export function formatCellQueryNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return value.toLocaleString()
  if (Math.abs(value) < 1e-3) return value.toExponential(2)
  return Number(value.toPrecision(4)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })
}

// "1,234 of 56,789 cells match".
export function cellQueryCountCopy(matches: number, total: number, noun: string): string {
  return `${matches.toLocaleString()} of ${total.toLocaleString()} ${noun} match`
}

const QUERY_CLASS_PREFIX = 'query:'

// Save as class (23-D7): `query:<n>:<name>`, numbered after the highest kept.
export function queryClassId(
  annotations: readonly Annotation<string>[],
  name: string,
): {
  readonly id: string
  readonly number: number
} {
  let highest = 0
  for (const annotation of annotations) {
    if (!annotation.id.startsWith(QUERY_CLASS_PREFIX)) continue
    const number = Number.parseInt(annotation.id.slice(QUERY_CLASS_PREFIX.length), 10)
    if (Number.isFinite(number)) highest = Math.max(highest, number)
  }
  const number = highest + 1
  return { id: `${QUERY_CLASS_PREFIX}${number}:${slug(name)}`, number }
}

export function defaultQueryClassName(
  annotations: readonly Annotation<string>[],
): string {
  return `Query ${queryClassId(annotations, '').number}`
}
