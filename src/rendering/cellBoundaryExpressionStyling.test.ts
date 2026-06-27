import { describe, expect, it } from 'vitest'
import {
  styleCellBoundariesByGeneExpression,
  type CellBoundaryDatum,
  type OverviewCellDatum,
} from './deckLayers'

describe('cell boundary expression styling', () => {
  it('copies selected-gene expression metadata onto matching boundaries', () => {
    const boundaries: readonly CellBoundaryDatum[] = [
      boundary('cell-a'),
      boundary('cell-b'),
    ]
    const expressionElements: readonly OverviewCellDatum[] = [
      {
        id: 'cell-a',
        position: [5, -5, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
        expressionCount: 6,
        expressionGenes: ['Actb'],
      },
    ]

    const styledBoundaries = styleCellBoundariesByGeneExpression(
      boundaries,
      expressionElements,
    )

    expect(styledBoundaries[0]).toEqual(
      expect.objectContaining({
        id: 'cell-a',
        fillColor: [215, 63, 124, 220],
        expressionCount: 6,
        expressionGenes: ['Actb'],
      }),
    )
    expect(styledBoundaries[1]).toBe(boundaries[1])
  })
})

function boundary(id: string): CellBoundaryDatum {
  return {
    id,
    polygon: [
      [0, 0, 0],
      [10, 0, 0],
      [10, -10, 0],
      [0, -10, 0],
    ],
    fillColor: [32, 102, 83, 34],
    lineColor: [32, 102, 83, 190],
  }
}
