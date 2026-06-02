import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  aggregateOverviewCells,
  overviewAggregationBinMicrometers,
} from './cellAggregation'
import type { OverviewCellDatum, OverviewViewState } from './deckLayers'

const viewState: OverviewViewState = {
  target: [0, 0, 0],
  zoom: -3,
  minZoom: -10,
  maxZoom: 10,
}

const cells: readonly OverviewCellDatum[] = [
  {
    id: 'cell-1',
    position: [0, 0, 0],
    radiusPixels: 3,
    radiusMicrometers: 4,
    fillColor: [215, 63, 124, 180],
  },
  {
    id: 'cell-2',
    position: [5, -5, 0],
    radiusPixels: 4,
    radiusMicrometers: 6,
    fillColor: [215, 63, 124, 190],
  },
  {
    id: 'cell-3',
    position: [500, -500, 0],
    radiusPixels: 5,
    fillColor: [215, 63, 124, 200],
  },
]

describe('overview cell aggregation', () => {
  it('bins nearby cells at overview zooms', () => {
    const aggregatedCells = aggregateOverviewCells(cells, viewState)

    expect(aggregatedCells).toHaveLength(2)
    expect(aggregatedCells[0]).toMatchObject({
      id: 'cell-bin:0:0',
      position: [2.5, -2.5, 0],
      radiusMicrometers: 6,
      cellCount: 2,
    })
    expect(aggregatedCells[1]).toMatchObject({
      id: 'cell-bin:6:6',
      cellCount: 1,
    })
  })

  it('returns individual cells once bins are smaller than a cell-scale threshold', () => {
    expect(
      aggregateOverviewCells(cells, { ...viewState, zoom: 0 }, { targetPixels: 10 }),
    ).toBe(cells)
  })

  it('filters to the viewport bbox before aggregating', () => {
    const visibleCells = aggregateOverviewCells(cells, viewState, {
      bbox: {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
    })

    expect(visibleCells).toHaveLength(1)
    expect(visibleCells[0]?.cellCount).toBe(2)
  })

  it('preserves expression metadata when binning expression cells', () => {
    const firstCell = cells[0]
    const secondCell = cells[1]

    if (firstCell === undefined || secondCell === undefined) {
      throw new Error('Expected aggregation fixture cells.')
    }

    const aggregatedCells = aggregateOverviewCells(
      [
        {
          ...firstCell,
          expressionCount: 2,
          expressionGenes: ['Actb', 'Gad1'],
        },
        {
          ...secondCell,
          expressionCount: 3,
          expressionGenes: ['Actb', 'Gad1'],
        },
      ],
      viewState,
    )

    expect(aggregatedCells).toHaveLength(1)
    expect(aggregatedCells[0]).toMatchObject({
      expressionCount: 5,
      expressionGenes: ['Actb', 'Gad1'],
      cellCount: 2,
    })
  })

  it('derives bin size from the current orthographic zoom', () => {
    expect(overviewAggregationBinMicrometers(viewState)).toBe(80)
    expect(overviewAggregationBinMicrometers({ ...viewState, zoom: 0 })).toBe(10)
  })
})
