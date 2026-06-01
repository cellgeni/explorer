import type { Color } from '@deck.gl/core'
import type { OverviewCellDatum } from './deckLayers'

export type ObservationColorMode = 'transcript-count' | 'cell-area'

export function styleOverviewCellsByObservation(
  cells: readonly OverviewCellDatum[],
  mode: ObservationColorMode,
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
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
