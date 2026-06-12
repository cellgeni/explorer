import type { Color } from '@deck.gl/core'
import type { CellId } from '../data/cellid'
import type { OverviewCellDatum } from './deckLayers'

export type ObservationColorMode =
  | 'transcript-count'
  | 'cell-area'
  | 'annotations'
  | 'metadata'

export interface AnnotationColorStyle {
  readonly id: string
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

export function styleOverviewCellsByObservation(
  cells: readonly OverviewCellDatum[],
  mode: ObservationColorMode,
  options: ObservationStyleOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  if (mode === 'annotations') {
    return styleOverviewCellsByAnnotations(cells, options.annotations ?? [])
  }

  if (mode === 'metadata') {
    return styleOverviewCellsByMetadata(cells, options.metadataTrack ?? null)
  }

  let maxValue = 1

  for (const cell of cells) {
    const value = readObservationValue(cell, mode)

    if (Number.isFinite(value)) {
      maxValue = Math.max(maxValue, value)
    }
  }

  return cells.map((cell) => ({
    ...cell,
    fillColor: observationColor(readObservationValue(cell, mode), maxValue, mode),
  }))
}

function styleOverviewCellsByAnnotations(
  cells: readonly OverviewCellDatum[],
  annotations: readonly AnnotationColorStyle[],
): readonly OverviewCellDatum[] {
  if (annotations.length === 0) {
    return cells
  }

  const colorByCellId = new Map<string, Color>()
  const unstyledCellIds = new Set<string>()

  for (const cell of cells) {
    unstyledCellIds.add(cell.id)
  }

  for (const annotation of annotations) {
    const color = hexToRgba(annotation.color, 230)

    for (const cellId of annotation.cellIds) {
      if (unstyledCellIds.has(cellId)) {
        colorByCellId.set(cellId, color)
        unstyledCellIds.delete(cellId)
      }

      if (unstyledCellIds.size === 0) {
        break
      }
    }

    if (unstyledCellIds.size === 0) {
      break
    }
  }

  return cells.map((cell) => ({
    ...cell,
    fillColor: colorByCellId.get(cell.id) ?? [72, 68, 58, 44],
  }))
}

function styleOverviewCellsByMetadata(
  cells: readonly OverviewCellDatum[],
  metadataTrack: CellMetadataColorStyle | null,
): readonly OverviewCellDatum[] {
  if (metadataTrack === null || metadataTrack.values.length === 0) {
    return cells
  }

  const valueByCellId = new Map<string, number>()

  for (const value of metadataTrack.values) {
    valueByCellId.set(value.cellId, value.value)
  }

  return cells.map((cell) => {
    const value = valueByCellId.get(cell.id)

    return {
      ...cell,
      fillColor:
        value === undefined
          ? [72, 68, 58, 44]
          : metadataColor(value, metadataTrack.min, metadataTrack.max),
    }
  })
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
