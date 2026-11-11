import type { Color } from '@deck.gl/core'
import type { CellId } from '../data/cellid'
import { colorsGradient } from './deckLayerColors'
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
// value among `cells`; annotations take the first annotation listing the cell.
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

function annotationColorizer(
  annotations: readonly AnnotationColorStyle[],
): ((cell: OverviewCellDatum) => Color) | null {
  if (annotations.length === 0) {
    return null
  }

  const colorByCellId = new Map<string, Color>()

  for (const annotation of annotations) {
    const color = hexToRgba(annotation.color, 230)

    for (const cellId of annotation.cellIds) {
      if (!colorByCellId.has(cellId)) {
        colorByCellId.set(cellId, color)
      }
    }
  }

  return (cell) => colorByCellId.get(cell.id) ?? UNSTYLED_OBSERVATION_COLOR
}

function metadataColorizer(
  metadataTrack: CellMetadataColorStyle | null,
): ((cell: OverviewCellDatum) => Color) | null {
  if (metadataTrack === null || metadataTrack.values.length === 0) {
    return null
  }

  const valueByCellId = new Map<string, number>()

  for (const value of metadataTrack.values) {
    valueByCellId.set(value.cellId, value.value)
  }

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
