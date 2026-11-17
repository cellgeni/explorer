import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { gridCellColumnsFixture, squareGridBasis } from '../test/gridCellColumnsFixture'
import {
  countGridCellsInBbox,
  gridCellAt,
  gridCellById,
  gridCellColumnsBbox,
  gridCellColumnsFromBatch,
  gridCellIndexAtPoint,
  gridCellIndicesInBbox,
  gridCellTileIndex,
} from './gridCellColumns'

describe('gridCellColumns', () => {
  it('shares the batch arrays and builds one bin as an object', () => {
    const rows = Int32Array.from([3])
    const cols = Int32Array.from([4])
    const columns = gridCellColumnsFromBatch(
      {
        id: 'visium-hd-square-016um',
        binSizeMicrometers: micrometers(16),
        basis: squareGridBasis(16, { x: 100, y: 200 }),
      },
      { kind: 'grid-cells', gridId: 'visium-hd-square-016um', ids: ['bin'], rows, cols },
      {
        binSizeMicrometers: 16,
        inTissue: Uint8Array.from([0]),
        fullresRows: Float64Array.from([12.5]),
        fullresCols: Float64Array.from([7.5]),
      },
    )

    expect(columns.rows).toBe(rows)
    expect(columns.cols).toBe(cols)
    expect(gridCellAt(columns, 0)).toEqual({
      id: 'bin',
      gridId: 'visium-hd-square-016um',
      row: 3,
      col: 4,
      binSizeMicrometers: 16,
      inTissue: false,
      fullresRow: 12.5,
      fullresCol: 7.5,
      bbox: bbox(164, 180, 248, 264),
      polygon: [
        [164, -248, 0],
        [180, -248, 0],
        [180, -264, 0],
        [164, -264, 0],
      ],
      fillColor: [34, 120, 108, 28],
      lineColor: [22, 90, 82, 150],
    })
    expect(gridCellById(columns, 'bin')?.row).toBe(3)
    expect(gridCellById(columns, 'missing')).toBeUndefined()
  })

  it('keeps the per-bin arrays out of for...in, which React walks in development', () => {
    const columns = gridCellColumnsFixture([{ id: 'a', row: 0, col: 0, inTissue: true }])
    const enumerated: string[] = []

    for (const key in columns) enumerated.push(key)

    expect(enumerated.sort()).toEqual([
      'basis',
      'binSizeMicrometers',
      'gridId',
      'length',
      'renderLodSourceBinSizeMicrometers',
    ])
    expect(columns.ids).toEqual(['a'])
    expect(Array.from(columns.inTissue ?? [])).toEqual([1])
  })

  it('bounds every bin, rotated or not', () => {
    const columns = gridCellColumnsFixture(
      [
        { id: 'a', row: 0, col: 0 },
        { id: 'b', row: 2, col: 5 },
      ],
      { binSizeMicrometers: 2 },
    )

    expect(gridCellColumnsBbox(columns)).toEqual(bbox(0, 12, 0, 6))
    expect(gridCellColumnsBbox(gridCellColumnsFixture([]))).toBeNull()

    // A grid turned 90°: rows run along x and columns down y.
    const turned = gridCellColumnsFixture([{ id: 'a', row: 1, col: 0 }], {
      basis: {
        origin: { x: micrometers(1), y: micrometers(1) },
        rowStep: { x: micrometers(2), y: micrometers(0) },
        colStep: { x: micrometers(0), y: micrometers(2) },
      },
    })

    expect(gridCellColumnsBbox(turned)).toEqual(bbox(2, 4, 0, 2))
  })

  it('finds the bins meeting a box, in column order', () => {
    const columns = gridCellColumnsFixture(
      [
        { id: 'far', row: 50, col: 50 },
        { id: 'visible', row: 0, col: 0 },
        { id: 'edge', row: 1, col: 1 },
        { id: 'next-tile', row: 0, col: 40 },
      ],
      { binSizeMicrometers: 10 },
    )
    const index = gridCellTileIndex(columns)
    const query = bbox(5, 10, 5, 10)

    expect(Array.from(gridCellIndicesInBbox(index, query) ?? [])).toEqual([1, 2])
    expect(countGridCellsInBbox(index, query)).toBe(2)
    // Across two tiles, still in column order.
    expect(Array.from(gridCellIndicesInBbox(index, bbox(0, 400, 0, 10)) ?? [])).toEqual([
      1, 2, 3,
    ])
    // Every bin: no index list.
    expect(gridCellIndicesInBbox(index, bbox(-1, 1000, -1, 1000))).toBeNull()
    expect(countGridCellsInBbox(index, bbox(-1, 1000, -1, 1000))).toBe(4)
    expect(countGridCellsInBbox(index, bbox(200, 300, 200, 300))).toBe(0)
  })

  it('counts a whole tile without testing its bins, and a cut one bin by bin', () => {
    const bins = []

    for (let row = 0; row < 64; row += 1) {
      for (let col = 0; col < 64; col += 1) {
        bins.push({ id: `${row}:${col}`, row, col })
      }
    }

    const index = gridCellTileIndex(
      gridCellColumnsFixture(bins, { binSizeMicrometers: 2 }),
    )

    expect(index.tileCount).toBe(4)
    // The first tile whole, and the bins of the next ones whose edges touch
    // the box: bins meeting a box count, as before.
    expect(countGridCellsInBbox(index, bbox(0, 64, 0, 64))).toBe(33 * 33)
    expect(countGridCellsInBbox(index, bbox(0.5, 63.5, 0.5, 63.5))).toBe(32 * 32)
    expect(countGridCellsInBbox(index, bbox(-10, 200, -10, 200))).toBe(64 * 64)
    expect(countGridCellsInBbox(index, bbox(1, 3, 1, 3))).toBe(4)
    expect(countGridCellsInBbox(index, bbox(63, 65, 0, 1))).toBe(2)
  })

  it('finds the last bin holding a point', () => {
    const columns = gridCellColumnsFixture(
      [
        { id: 'a', row: 0, col: 0 },
        { id: 'b', row: 0, col: 1 },
      ],
      { binSizeMicrometers: 10 },
    )
    const index = gridCellTileIndex(columns)

    expect(gridCellIndexAtPoint(index, 5, 5)).toBe(0)
    // On the shared edge: the later bin, as the topmost drawn.
    expect(gridCellIndexAtPoint(index, 10, 5)).toBe(1)
    expect(gridCellIndexAtPoint(index, 50, 50)).toBe(-1)
  })

  it('keeps tiles near the bin count for far-apart bins', () => {
    const index = gridCellTileIndex(
      gridCellColumnsFixture([
        { id: 'a', row: 0, col: 0 },
        { id: 'b', row: 1_000_000, col: 1_000_000 },
      ]),
    )

    expect(index.tileCount).toBeLessThanOrEqual(4096)
    expect(countGridCellsInBbox(index, bbox(0, 1, 0, 1))).toBe(1)
  })
})

function bbox(minX: number, maxX: number, minY: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}
