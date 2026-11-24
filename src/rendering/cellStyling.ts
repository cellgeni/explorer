import type { Color } from '@deck.gl/core'
import type { CellId } from '../data/cellid'
import {
  colorsGradient,
  DEFAULT_OVERVIEW_CELL_FILL_RGB,
  FADED_CELL_ALPHA,
} from './deckLayerColors'
import type { OverviewCellDatum } from './deckLayers'

export type ObservationColorMode =
  | 'transcript-count'
  | 'cell-area'
  | 'annotations'
  | 'metadata'
  // Colours come from the selected genes' expression, applied by the gene
  // expression styling rather than here.
  | 'gene-expression'

export interface AnnotationColorStyle {
  readonly id: string
  readonly label?: string
  readonly cellIds: readonly CellId[]
  readonly color: string
}

export interface CellMetadataColorStyle {
  readonly id: string
  readonly values: readonly {
    readonly cellId: CellId
    readonly value: number
  }[]
  readonly min: number
  readonly max: number
}

export interface ObservationStyleOptions {
  readonly annotations?: readonly AnnotationColorStyle[]
  readonly metadataTrack?: CellMetadataColorStyle | null
}

const UNSTYLED_OBSERVATION_COLOR: Color = [72, 68, 58, 44]
// Coloured by class, a cell in no shown class fades back.
const UNCLASSED_CELL_COLOR: Color = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, FADED_CELL_ALPHA]

export function styleOverviewCellsByObservation(
  cells: readonly OverviewCellDatum[],
  mode: ObservationColorMode,
  options: ObservationStyleOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const colorize = createObservationColorizer(cells, mode, options)

  return colorize === null
    ? cells
    : cells.map((cell) => ({ ...cell, fillColor: colorize(cell) }))
}

// A cell's colour under the observation mode, or null when the mode leaves
// cells unchanged. Transcript-count and cell-area colours scale to the largest
// value among `cells`; annotations take the first annotation listing the cell,
// and cells in none, such as those of hidden classes, fade.
export function createObservationColorizer(
  cells: readonly OverviewCellDatum[],
  mode: ObservationColorMode,
  options: ObservationStyleOptions = {},
): ((cell: OverviewCellDatum) => Color) | null {
  if (mode === 'gene-expression') {
    return null
  }

  if (mode === 'annotations') {
    return annotationColorizer(options.annotations ?? [])
  }

  if (mode === 'metadata') {
    return metadataColorizer(options.metadataTrack ?? null)
  }

  let maxValue = 1

  for (const cell of cells) {
    const value = readObservationValue(cell, mode)

    if (Number.isFinite(value)) {
      maxValue = Math.max(maxValue, value)
    }
  }

  return (cell) => observationColor(readObservationValue(cell, mode), maxValue, mode)
}

// The colour of an element known only by its id, such as a Visium HD bin,
// under the annotation or metadata mode; null under any other mode, whose
// values only cells have.
export function createElementObservationColorizer(
  mode: ObservationColorMode,
  options: ObservationStyleOptions = {},
): ((element: { readonly id: string }) => Color) | null {
  if (mode === 'annotations') {
    return (options.annotations ?? []).length === 0
      ? null
      : annotationColorizer(options.annotations ?? [])
  }

  return mode === 'metadata' ? metadataColorizer(options.metadataTrack ?? null) : null
}

// Which shown classes list each cell. The cells' colours, the bins' colours
// and the hover's class names all read it, so one walk over the classes'
// cells serves the three, kept for as long as the class list is (EXP-326). It
// is made at the first lookup, so a list only hovered costs nothing until then.
export interface AnnotationMembership {
  // The class listing the cell first, which colours it.
  readonly firstClassOf: (id: string) => number | undefined
  // The names of the classes listing the cell, in class order.
  readonly labelsOf: (id: string) => readonly string[] | undefined
}

const annotationMemberships = new WeakMap<
  readonly AnnotationColorStyle[],
  AnnotationMembership
>()

export function annotationMembership(
  annotations: readonly AnnotationColorStyle[],
): AnnotationMembership {
  const cached = annotationMemberships.get(annotations)
  if (cached !== undefined) return cached

  let lists: ReturnType<typeof classListsOf> | null = null
  const read = () => (lists ??= classListsOf(annotations))
  const labels = annotations.map((annotation) => annotation.label ?? annotation.id)
  const singleLabels = labels.map((label) => [label])
  const membership: AnnotationMembership = {
    firstClassOf: (id) => read().firstClass.get(id),
    labelsOf: (id) => {
      const { firstClass, laterClasses } = read()
      const first = firstClass.get(id)
      if (first === undefined) return undefined
      const later = laterClasses.get(id)
      return later === undefined
        ? singleLabels[first]
        : [first, ...later].map((index) => labels[index] ?? '')
    },
  }
  annotationMemberships.set(annotations, membership)
  return membership
}

// Each cell's first class, and the later ones of the few cells in more than
// one; a cell listed twice by one class counts once.
function classListsOf(annotations: readonly AnnotationColorStyle[]): {
  readonly firstClass: ReadonlyMap<string, number>
  readonly laterClasses: ReadonlyMap<string, readonly number[]>
} {
  const firstClass = new Map<string, number>()
  const laterClasses = new Map<string, number[]>()

  annotations.forEach((annotation, classIndex) => {
    for (const cellId of annotation.cellIds) {
      const first = firstClass.get(cellId)

      if (first === undefined) {
        firstClass.set(cellId, classIndex)
        continue
      }

      if (first === classIndex) continue
      const later = laterClasses.get(cellId)

      if (later === undefined) {
        laterClasses.set(cellId, [classIndex])
      } else if (later[later.length - 1] !== classIndex) {
        later.push(classIndex)
      }
    }
  })

  return { firstClass, laterClasses }
}

function annotationColorizer(
  annotations: readonly AnnotationColorStyle[],
): (cell: { readonly id: string }) => Color {
  const membership = annotationMembership(annotations)
  const colors = annotations.map((annotation) => hexToRgba(annotation.color, 230))

  return (cell) => {
    const classIndex = membership.firstClassOf(cell.id)

    return classIndex === undefined
      ? UNCLASSED_CELL_COLOR
      : (colors[classIndex] ?? UNCLASSED_CELL_COLOR)
  }
}

// The values by cell, read once per track for the cells and the bins.
const metadataValues = new WeakMap<CellMetadataColorStyle, ReadonlyMap<string, number>>()

function metadataValuesOf(
  metadataTrack: CellMetadataColorStyle,
): ReadonlyMap<string, number> {
  const cached = metadataValues.get(metadataTrack)
  if (cached !== undefined) return cached

  const valueByCellId = new Map<string, number>()

  // A missing value (NaN, as AnnData stores one) or an infinite one is drawn
  // as no value, like a cell the track does not list (EXP-046).
  for (const value of metadataTrack.values) {
    if (Number.isFinite(value.value)) {
      valueByCellId.set(value.cellId, value.value)
    }
  }

  metadataValues.set(metadataTrack, valueByCellId)
  return valueByCellId
}

function metadataColorizer(
  metadataTrack: CellMetadataColorStyle | null,
): ((cell: { readonly id: string }) => Color) | null {
  if (metadataTrack === null || metadataTrack.values.length === 0) {
    return null
  }

  const valueByCellId = metadataValuesOf(metadataTrack)

  return (cell) => {
    const value = valueByCellId.get(cell.id)

    return value === undefined
      ? UNSTYLED_OBSERVATION_COLOR
      : metadataColor(value, metadataTrack.min, metadataTrack.max)
  }
}

function readObservationValue(
  cell: OverviewCellDatum,
  mode: ObservationColorMode,
): number {
  if (mode === 'cell-area') {
    return cell.cellArea ?? 0
  }

  return cell.transcriptCount ?? 0
}

function observationColor(
  value: number,
  maxValue: number,
  mode: ObservationColorMode,
): Color {
  const intensity = Math.sqrt(Math.max(value, 0) / maxValue)

  if (mode === 'cell-area') {
    return [
      Math.round(32 + intensity * 72),
      Math.round(102 + intensity * 90),
      Math.round(83 + intensity * 34),
      145 + Math.round(intensity * 95),
    ]
  }

  return [
    Math.round(166 + intensity * 74),
    Math.round(82 + intensity * 118),
    Math.round(105 - intensity * 30),
    145 + Math.round(intensity * 95),
  ]
}

function metadataColor(value: number, min: number, max: number): Color {
  const intensity =
    max <= min ? 0.5 : Math.min(1, Math.max(0, (value - min) / (max - min)))
  const low: Color = [68, 1, 84, 160]
  const mid: Color = [33, 145, 140, 220]
  const high: Color = [253, 231, 37, 245]

  return intensity <= 0.5
    ? interpolateColor(low, mid, intensity * 2)
    : interpolateColor(mid, high, (intensity - 0.5) * 2)
}

function interpolateColor(start: Color, end: Color, fraction: number): Color {
  const startAlpha = start[3] ?? 255
  const endAlpha = end[3] ?? 255

  return [
    Math.round(start[0] + (end[0] - start[0]) * fraction),
    Math.round(start[1] + (end[1] - start[1]) * fraction),
    Math.round(start[2] + (end[2] - start[2]) * fraction),
    Math.round(startAlpha + (endAlpha - startAlpha) * fraction),
  ]
}

function hexToRgba(hexColor: string, alpha: number): Color {
  const normalized = hexColor.trim().replace(/^#/, '')

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return [215, 63, 124, alpha]
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  ]
}

const LEGEND_STEPS = [0, 0.25, 0.5, 0.75, 1]

// Legend gradients for the continuous colour modes, low on the left. Cell
// area scales by the square root of area / the largest area, so the gradient
// runs in that intensity.
export function cellAreaScaleGradient(): string {
  return colorsGradient(
    LEGEND_STEPS.map((intensity) =>
      observationColor(intensity * intensity, 1, 'cell-area'),
    ),
  )
}

export function metadataScaleGradient(): string {
  return colorsGradient(LEGEND_STEPS.map((intensity) => metadataColor(intensity, 0, 1)))
}
