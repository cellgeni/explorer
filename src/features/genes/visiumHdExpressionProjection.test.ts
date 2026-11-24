import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { GeneExpressionBatch } from '../../datasets/spatialDataset'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import {
  projectedBoundaryCellCount,
  projectVisiumHdExpressionToBoundaryCells,
  visiumHdBinBarcodeShares,
  visiumHdExpressionBinIds,
  type VisiumHdExpressionCellAssignment,
} from './visiumHdExpressionProjection'

describe('Visium HD expression projection', () => {
  it('splits binned expression across mapped visible boundary cells', () => {
    const batch: GeneExpressionBatch = {
      elements: [
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
      population: 'all',
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

    // Each bin's count is shared by its cells' part of its barcodes: the
    // first bin's 4 barcodes give cell-a 12 × 2/4 = 6 and cell-b 12 × 1/4 = 3
    // (the barcode outside every cell keeps its part); the second bin's 2
    // give cell-b 6 × 1/2 = 3, the off-screen cell's part drawn nowhere.
    expect(result.mappedBinCount).toBe(2)
    expect(result.mappedCellCount).toBe(2)
    expect(result.batch.maxCount).toBe(6)
    expect(result.batch.elements).toEqual([
      {
        id: 'cell-a',
        position: { x: micrometers(5), y: micrometers(5) },
        count: 6,
        cellArea: 100,
      },
      {
        id: 'cell-b',
        position: { x: micrometers(17), y: micrometers(5) },
        count: 6,
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

  it("counts each bin's barcodes and its cells' part of them", () => {
    const shares = visiumHdBinBarcodeShares([
      assignment('bin-1', 'cell-a'),
      assignment('bin-1', 'cell-a'),
      { ...assignment('bin-1', 'cell-b'), inCell: false, inNucleus: true },
      { ...assignment('bin-1', 'cell-c'), inCell: false, inNucleus: false },
      { ...assignment('bin-1', 'cell-a'), cellId: null },
      assignment('bin-2', 'cell-b'),
    ])

    expect(shares.get('bin-1')).toEqual({
      barcodeCount: 5,
      cells: new Map([
        ['cell-a', 2],
        ['cell-b', 1],
      ]),
    })
    expect(shares.get('bin-2')).toEqual({
      barcodeCount: 1,
      cells: new Map([['cell-b', 1]]),
    })
  })

  // A MultiPolygon cell's later parts are `<cell_id>#2`, …; the mappings
  // name the cell, so the batch gives its count to the first part.
  it("finds a cell's projected count by its own ID or its cell's", () => {
    const batch: GeneExpressionBatch = {
      elements: [
        { id: 'cell-a', position: { x: micrometers(0), y: micrometers(0) }, count: 4 },
        { id: 'cell-b', position: { x: micrometers(0), y: micrometers(0) }, count: 0 },
      ],
      genes: ['Actb'],
      population: 'all',
      maxCount: 4,
    }

    expect(projectedBoundaryCellCount(batch, 'cell-a')).toBe(4)
    expect(projectedBoundaryCellCount(batch, 'cell-a#2')).toBe(4)
    expect(projectedBoundaryCellCount(batch, 'cell-b')).toBe(0)
    expect(projectedBoundaryCellCount(batch, 'cell-z')).toBeUndefined()
  })

  it('deduplicates expression bin ids before requesting barcode mappings', () => {
    expect(
      visiumHdExpressionBinIds({
        elements: [
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
        population: 'all',
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
