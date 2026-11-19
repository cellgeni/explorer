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
  // An image channel measured under each cell (plan 25).
  | { readonly kind: 'image'; readonly spec: CellQueryImageColumnSpec }

export type CellQueryColumnGroup = 'Cell' | 'Classes' | 'Metadata' | 'Image'

// What an image column measures (plan 25-D1, D9): the mean of each cell's
// pixels in a channel, or the share of them at or above a threshold.
export type CellQueryImageStat = 'mean' | 'above'

export interface CellQueryImageColumnSpec {
  readonly stat: CellQueryImageStat
  // The pyramid level read (25-D5).
  readonly level: number
  // The z plane of a z-stack (25-D10).
  readonly z?: number
  // `% above`'s threshold, in the image's units (25-D6).
  readonly threshold?: number
  // The disc's radius in micrometres, where cells have no area (25-D4).
  readonly radius?: number
  readonly channelId: string
}

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
  // Listed but not to be chosen now, and why.
  readonly disabled?: string
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

const IMAGE_COLUMN_PREFIX = 'image:'

// `image:{stat}:{level}:[z{n}:][t{threshold}:][r{radius}:]{channel}`, the
// channel last as it may hold colons (`Channel:0`, `{layer}:Channel:0`).
export function imageColumnId(spec: CellQueryImageColumnSpec): string {
  return [
    'image',
    spec.stat,
    spec.level.toString(),
    ...(spec.z === undefined ? [] : [`z${spec.z.toString()}`]),
    ...(spec.stat === 'above' && spec.threshold !== undefined
      ? [`t${String(spec.threshold)}`]
      : []),
    ...(spec.radius === undefined ? [] : [`r${String(spec.radius)}`]),
    spec.channelId,
  ].join(':')
}

const LINK_NUMBER = String.raw`-?\d+(?:\.\d+)?(?:e[-+]?\d+)?`
const IMAGE_COLUMN_PARTS: readonly (readonly [keyof CellQueryImageColumnSpec, RegExp])[] =
  [
    ['z', /^z(\d+)$/],
    ['threshold', new RegExp(`^t(${LINK_NUMBER})$`, 'i')],
    ['radius', new RegExp(`^r(${LINK_NUMBER})$`, 'i')],
  ]

export function isImageColumnId(columnId: string): boolean {
  return columnId.startsWith(IMAGE_COLUMN_PREFIX)
}

export function parseImageColumnId(columnId: string): CellQueryImageColumnSpec | null {
  if (!isImageColumnId(columnId)) return null
  const parts = columnId.split(':')
  const [, stat, levelText = ''] = parts
  const level = Number(levelText)
  if ((stat !== 'mean' && stat !== 'above') || !/^\d+$/.test(levelText)) return null

  const spec: { -readonly [Key in keyof CellQueryImageColumnSpec]?: unknown } = {
    stat,
    level,
  }
  let at = 3
  for (const [key, pattern] of IMAGE_COLUMN_PARTS) {
    const match = pattern.exec(parts[at] ?? '')
    if (match === null) continue
    const value = Number(match[1])
    if (!Number.isFinite(value) || (key === 'radius' && value <= 0)) return null
    spec[key] = value
    at += 1
  }
  if (stat === 'mean') delete spec.threshold

  const channelId = parts.slice(at).join(':')
  return channelId === '' ? null : ({ ...spec, channelId } as CellQueryImageColumnSpec)
}

// "DAPI mean (0.85 µm/px)", "DAPI % above 2,176 (z 3, 0.85 µm/px, radius
// 5 µm)": the level, plane and radius change the values, so the label and
// the CSV header say them (25-D5).
export function imageColumnLabel(
  channelName: string,
  spec: CellQueryImageColumnSpec,
  micrometersPerPixel: number | undefined,
): string {
  const stat =
    spec.stat === 'mean'
      ? 'mean'
      : spec.threshold === undefined
        ? '% above'
        : `% above ${formatCellQueryNumber(spec.threshold)}`
  const details = [
    ...(spec.z === undefined ? [] : [`z ${spec.z.toString()}`]),
    micrometersPerPixel === undefined
      ? `level ${spec.level.toString()}`
      : `${formatMicrometersPerPixel(micrometersPerPixel)} µm/px`,
    ...(spec.radius === undefined
      ? []
      : [`radius ${formatCellQueryNumber(spec.radius)} µm`]),
  ]
  return `${channelName} ${stat} (${details.join(', ')})`
}

export function formatMicrometersPerPixel(value: number): string {
  return Number(value.toPrecision(2)).toLocaleString()
}

// A channel as the Image group lists it.
export interface CellQueryImageChannelOption {
  readonly id: string
  readonly name: string
  // Micrometres per pixel of each level, finest first.
  readonly levels: readonly number[]
  readonly defaultLevel: number
  // Otsu's threshold (25-D6); 'finding' while it is read.
  readonly threshold: number | 'finding' | undefined
}

// Each channel's mean and `% above` at its default level, in the Image
// group. Channels past the three in use are listed but cannot be chosen
// (25-D2).
export function cellQueryImageColumns({
  channels,
  z,
  radius,
  channelsInUse,
}: {
  readonly channels: readonly CellQueryImageChannelOption[]
  readonly z: number | undefined
  // For cells without an area.
  readonly radius: number | undefined
  readonly channelsInUse: readonly string[]
}): readonly CellQueryColumn[] {
  const full = channelsInUse.length >= IMAGE_CHANNEL_LIMIT
  const inUseNames = channelsInUse.map(
    (id) => channels.find((channel) => channel.id === id)?.name ?? id,
  )

  return channels.flatMap((channel) => {
    const base = {
      level: channel.defaultLevel,
      ...(z === undefined ? {} : { z }),
      ...(radius === undefined ? {} : { radius }),
      channelId: channel.id,
    }
    const limit =
      full && !channelsInUse.includes(channel.id)
        ? { disabled: imageChannelLimitCopy(inUseNames) }
        : {}
    const threshold =
      typeof channel.threshold === 'number' ? channel.threshold : undefined
    const specs: readonly CellQueryImageColumnSpec[] = [
      { stat: 'mean', ...base },
      { stat: 'above', ...base, ...(threshold === undefined ? {} : { threshold }) },
    ]
    return specs.map((spec): CellQueryColumn => {
      const waiting =
        spec.stat === 'above' && threshold === undefined
          ? {
              disabled:
                channel.threshold === 'finding'
                  ? 'Finding a threshold…'
                  : 'The channel has no threshold.',
            }
          : {}
      return {
        ...imageColumn(spec, channel),
        ...waiting,
        ...limit,
      }
    })
  })
}

export function imageColumn(
  spec: CellQueryImageColumnSpec,
  channel: Pick<CellQueryImageChannelOption, 'name' | 'levels'>,
  range?: CellQueryRange,
): CellQueryColumn {
  return {
    id: imageColumnId(spec),
    label: imageColumnLabel(channel.name, spec, channel.levels[spec.level]),
    kind: 'number',
    group: 'Image',
    source: { kind: 'image', spec },
    ...(range === undefined ? {} : { range }),
  }
}

// Channels measured at a time (25-D2).
export const IMAGE_CHANNEL_LIMIT = 3

export function imageChannelLimitCopy(inUse: readonly string[]): string {
  return `Up to ${IMAGE_CHANNEL_LIMIT.toString()} channels are measured at a time: ${listPhrase(inUse)} are in use.`
}

function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
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
// whole range, which matches every cell with a value. An image column is
// not measured yet: half its pixels above the threshold, or a mean at
// least the threshold.
export function defaultCellQueryCondition(
  column: CellQueryColumn,
  imageThreshold?: number,
): CellQueryCondition {
  if (column.kind === 'category') {
    return { kind: 'category', columnId: column.id, operator: 'in', classIds: [] }
  }

  if (column.source.kind === 'image' && column.range === undefined) {
    return {
      kind: 'number',
      columnId: column.id,
      operator: 'at-least',
      min: column.source.spec.stat === 'above' ? 50 : (imageThreshold ?? 0),
      max: Infinity,
    }
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
