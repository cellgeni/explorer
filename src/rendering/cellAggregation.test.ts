import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  aggregateExpressionElements,
  aggregateOverviewCells,
  estimateOverviewCellCountInBbox,
  overviewAggregationBinMicrometers,
  overviewCellsExtentBbox,
  sampleOverviewCellsForRendering,
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

  it('uses fixed data-space bin centers for sampled expression cells across overview zooms', () => {
    const expressionElements: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [0, 0, 0],
        radiusPixels: 3,
        fillColor: [215, 63, 124, 180],
        expressionCount: 1,
      },
      {
        id: 'cell-2',
        position: [20, -20, 0],
        radiusPixels: 4,
        fillColor: [240, 128, 120, 220],
        expressionCount: 9,
      },
    ]

    const firstZoom = aggregateExpressionElements(expressionElements, viewState, {
      binMicrometers: 100,
      exactElementLimit: 0,
      exactZoom: 0,
    })
    const secondZoom = aggregateExpressionElements(
      expressionElements,
      { ...viewState, zoom: -1.25 },
      {
        binMicrometers: 100,
        exactElementLimit: 0,
        exactZoom: 0,
      },
    )

    expect(firstZoom).toHaveLength(1)
    expect(secondZoom).toHaveLength(1)
    expect(firstZoom[0]?.id).toBe('expression-bin:0:0')
    expect(firstZoom[0]?.position).toEqual(secondZoom[0]?.position)
    expect(firstZoom[0]).toMatchObject({
      position: [50, -50, 0],
      expressionCount: 10,
      cellCount: 2,
    })
  })

  it('returns exact expression cells when the viewport is small enough', () => {
    expect(
      aggregateExpressionElements(cells, viewState, {
        exactElementLimit: cells.length,
      }),
    ).toBe(cells)
  })

  it('derives bin size from the current orthographic zoom', () => {
    expect(overviewAggregationBinMicrometers(viewState)).toBe(80)
    expect(overviewAggregationBinMicrometers({ ...viewState, zoom: 0 })).toBe(10)
  })

  it('estimates viewport cell counts from slide coverage at overview zooms', () => {
    const estimateCells = Array.from(
      { length: 100 },
      (_value, index): OverviewCellDatum => ({
        id: `cell-${index}`,
        position: [index % 10, -Math.floor(index / 10), 0],
        radiusPixels: 3,
        fillColor: [215, 63, 124, 180],
      }),
    )
    const extentBbox = overviewCellsExtentBbox(estimateCells)

    expect(
      estimateOverviewCellCountInBbox(
        estimateCells,
        {
          minX: micrometers(0),
          maxX: micrometers(9),
          minY: micrometers(0),
          maxY: micrometers(9),
        },
        { extentBbox },
      ),
    ).toBe(100)
    expect(
      estimateOverviewCellCountInBbox(
        estimateCells,
        {
          minX: micrometers(0),
          maxX: micrometers(4.5),
          minY: micrometers(0),
          maxY: micrometers(9),
        },
        { extentBbox },
      ),
    ).toBe(50)
    expect(
      estimateOverviewCellCountInBbox(
        estimateCells,
        {
          minX: micrometers(20),
          maxX: micrometers(30),
          minY: micrometers(20),
          maxY: micrometers(30),
        },
        { extentBbox },
      ),
    ).toBe(0)
  })

  it('subsamples overview cells for responsive rendering when above the limit', () => {
    const sampleCells = Array.from(
      { length: 10 },
      (_value, index): OverviewCellDatum => ({
        id: `cell-${index}`,
        position: [index, -index, 0],
        radiusPixels: 3,
        fillColor: [215, 63, 124, 180],
      }),
    )

    expect(sampleOverviewCellsForRendering(sampleCells, { maxCells: 10 })).toBe(
      sampleCells,
    )
    expect(
      sampleOverviewCellsForRendering(sampleCells, { maxCells: 4 }).map(
        (cell) => cell.id,
      ),
    ).toEqual(['cell-1', 'cell-3', 'cell-6', 'cell-8'])
  })
})
