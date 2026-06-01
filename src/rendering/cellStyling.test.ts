import { describe, expect, it } from 'vitest'
import { styleOverviewCellsByObservation } from './cellStyling'
import type { OverviewCellDatum } from './deckLayers'

const cells: readonly OverviewCellDatum[] = [
  {
    id: 'cell-1',
    position: [0, 0, 0],
    radiusPixels: 3,
    fillColor: [215, 63, 124, 180],
    transcriptCount: 1,
    cellArea: 10,
  },
  {
    id: 'cell-2',
    position: [10, 0, 0],
    radiusPixels: 3,
    fillColor: [215, 63, 124, 180],
    transcriptCount: 16,
    cellArea: 40,
  },
]

describe('cell observation styling', () => {
  it('colors overview cells by transcript count', () => {
    const styled = styleOverviewCellsByObservation(cells, 'transcript-count')

    expect(styled[0]?.fillColor).not.toEqual(styled[1]?.fillColor)
    expect(styled[1]?.fillColor[3]).toBeGreaterThan(styled[0]?.fillColor[3] ?? 0)
  })

  it('colors overview cells by cell area', () => {
    const styled = styleOverviewCellsByObservation(cells, 'cell-area')

    expect(styled[0]?.fillColor).not.toEqual(styled[1]?.fillColor)
  })
})
