import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import {
  projectVisiumHdExpressionToBoundaryCells,
  visiumHdExpressionBinIds,
  type VisiumHdExpressionCellAssignment,
} from './visiumHdExpressionProjection'

describe('Visium HD expression projection', () => {
  it('splits binned expression across mapped visible boundary cells', () => {
    const batch: GeneExpressionBatch = {
      cells: [
        {
          id: 's_016um_000001_000001-1',
          position: { x: micrometers(8), y: micrometers(8) },
          count: 12,
        },
        {
          id: 's_016um_000002_000001-1',
          position: { x: micrometers(24), y: micrometers(8) },
          count: 6,
        },
      ],
      genes: ['Actb'],
      maxCount: 12,
    }
    const boundaries: readonly CellBoundaryDatum[] = [
      boundary('cell-a', 0, 0, 10, 10),
      boundary('cell-b', 12, 0, 10, 10),
      boundary('cell-c', 24, 0, 10, 10),
    ]
    const assignments: readonly VisiumHdExpressionCellAssignment[] = [
      assignment('s_016um_000001_000001-1', 'cell-a'),
      assignment('s_016um_000001_000001-1', 'cell-a'),
      assignment('s_016um_000001_000001-1', 'cell-b'),
      assignment('s_016um_000002_000001-1', 'cell-b'),
      assignment('s_016um_000002_000001-1', 'offscreen-cell'),
      {
        ...assignment('s_016um_000001_000001-1', 'cell-c'),
        inCell: false,
        inNucleus: false,
      },
    ]

    const result = projectVisiumHdExpressionToBoundaryCells(
      batch,
      assignments,
      boundaries,
    )

    expect(result.mappedBinCount).toBe(2)
    expect(result.mappedCellCount).toBe(2)
    expect(result.batch.maxCount).toBe(8)
    expect(result.batch.cells).toEqual([
      {
        id: 'cell-a',
        position: { x: micrometers(5), y: micrometers(5) },
        count: 8,
        cellArea: 100,
      },
      {
        id: 'cell-b',
        position: { x: micrometers(17), y: micrometers(5) },
        count: 7,
        cellArea: 100,
      },
      {
        id: 'cell-c',
        position: { x: micrometers(29), y: micrometers(5) },
        count: 0,
        cellArea: 100,
      },
    ])
  })

  it('deduplicates expression bin ids before requesting barcode mappings', () => {
    expect(
      visiumHdExpressionBinIds({
        cells: [
          {
            id: 'bin-1',
            position: { x: micrometers(0), y: micrometers(0) },
            count: 1,
          },
          {
            id: 'bin-1',
            position: { x: micrometers(0), y: micrometers(0) },
            count: 2,
          },
          {
            id: 'bin-2',
            position: { x: micrometers(10), y: micrometers(0) },
            count: 3,
          },
        ],
        genes: ['Actb'],
        maxCount: 3,
      }),
    ).toEqual(['bin-1', 'bin-2'])
  })
})

function boundary(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): CellBoundaryDatum {
  return {
    id,
    polygon: [
      [x, -y, 0],
      [x + width, -y, 0],
      [x + width, -(y + height), 0],
      [x, -(y + height), 0],
      [x, -y, 0],
    ],
    fillColor: [32, 102, 83, 34],
    lineColor: [32, 102, 83, 190],
  }
}

function assignment(binId: string, cellId: string): VisiumHdExpressionCellAssignment {
  return {
    binId,
    cellId,
    inCell: true,
    inNucleus: false,
  }
}
