import type { Color } from '@deck.gl/core'
import type { CellId } from '../data/cellid'
import type { OverviewCellDatum } from './deckLayers'

export type ObservationColorMode = 'transcript-count' | 'cell-area' | 'annotations'

export interface AnnotationColorStyle {
  readonly id: string
  readonly cellIds: readonly CellId[]
  readonly color: string
}

export interface ObservationStyleOptions {
  readonly annotations?: readonly AnnotationColorStyle[]
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

  for (const annotation of annotations) {
    const color = hexToRgba(annotation.color, 230)

    for (const cellId of annotation.cellIds) {
      if (!colorByCellId.has(cellId)) {
        colorByCellId.set(cellId, color)
      }
    }
  }

  return cells.map((cell) => ({
    ...cell,
    fillColor: colorByCellId.get(cell.id) ?? [72, 68, 58, 44],
  }))
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
