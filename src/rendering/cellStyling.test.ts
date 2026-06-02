import { describe, expect, it } from 'vitest'
import { intToCellId } from '../data/cellid'
import { styleOverviewCellsByObservation } from './cellStyling'
import type { OverviewCellDatum } from './deckLayers'

const cellA = intToCellId(1, 1)
const cellB = intToCellId(1, 2)
const cells: readonly OverviewCellDatum[] = [
  {
    id: cellA,
    position: [0, 0, 0],
    radiusPixels: 3,
    fillColor: [215, 63, 124, 180],
    transcriptCount: 1,
    cellArea: 10,
  },
  {
    id: cellB,
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

  it('colors matching cells by loaded annotations', () => {
    const styled = styleOverviewCellsByObservation(cells, 'annotations', {
      annotations: [
        {
          id: 'annotation-1',
          cellIds: [cellB],
          color: '#1f77b4',
        },
      ],
    })

    expect(styled[0]?.fillColor).toEqual([72, 68, 58, 44])
    expect(styled[1]?.fillColor).toEqual([31, 119, 180, 230])
  })
})
