import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import type { GridCellDatum } from '../rendering/deckLayers'
import {
  GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN,
  countGridCellsInSpatialIndex,
  createGridCellRenderLods,
  createGridCellSpatialIndex,
  gridCellIntersectsBbox,
  gridCellsInBbox,
  isRenderLodGridCell,
  selectGridCellsForRenderLod,
} from './viewerGridCellIndex'

describe('viewerGridCellIndex', () => {
  it('returns only grid cells intersecting the viewport bbox', () => {
    const cells = [
      gridCell('visible', bbox(0, 10, 0, 10)),
      gridCell('outside', bbox(100, 110, 100, 110)),
      gridCell('edge', bbox(10, 20, 10, 20)),
    ]
    const index = createGridCellSpatialIndex(cells, { bucketSizeMicrometers: 16 })
    const query = bbox(5, 10, 5, 10)

    expect(gridCellsInBbox(index, query).map((cell) => cell.id)).toEqual([
      'visible',
      'edge',
    ])
    expect(countGridCellsInSpatialIndex(index, query)).toBe(2)
  })

  it('uses optional render padding without changing exact counts', () => {
    const cells = [
      gridCell('inside', bbox(0, 10, 0, 10)),
      gridCell('padded', bbox(12, 20, 0, 10)),
    ]
    const index = createGridCellSpatialIndex(cells, { bucketSizeMicrometers: 16 })
    const query = bbox(0, 10, 0, 10)

    expect(countGridCellsInSpatialIndex(index, query)).toBe(1)
    expect(
      gridCellsInBbox(index, query, { paddingMicrometers: 2 }).map((cell) => cell.id),
    ).toEqual(['inside', 'padded'])
  })

  it('can fall back to polygon bounds when cached bounds are absent', () => {
    const cellWithBounds = gridCell('polygon-only', bbox(0, 10, 0, 10))
    const cell: GridCellDatum = {
      id: cellWithBounds.id,
      gridId: cellWithBounds.gridId,
      row: cellWithBounds.row,
      col: cellWithBounds.col,
      binSizeMicrometers: 2,
      polygon: cellWithBounds.polygon,
      fillColor: cellWithBounds.fillColor,
      lineColor: cellWithBounds.lineColor,
    }

    expect(gridCellIntersectsBbox(cell, bbox(9, 20, 9, 20))).toBe(true)
    expect(gridCellIntersectsBbox(cell, bbox(11, 20, 11, 20))).toBe(false)
  })

  it('renders selected 2um cells as 16um LOD until close zoom', () => {
    const cells: GridCellDatum[] = []
    const xOffset = 100
    const yOffset = 200

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        cells.push(
          gridCell(
            `2um-${row}-${col}`,
            bbox(
              xOffset + col * 2,
              xOffset + (col + 1) * 2,
              yOffset + row * 2,
              yOffset + (row + 1) * 2,
            ),
            {
              row,
              col,
              binSizeMicrometers: 2,
            },
          ),
        )
      }
    }

    const lods = createGridCellRenderLods(cells)
    const zoomedOutCells = selectGridCellsForRenderLod(
      lods,
      GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN - 0.1,
    )

    expect(zoomedOutCells).toHaveLength(1)
    expect(zoomedOutCells[0]).toMatchObject({
      id: 'render-lod-16um:0:0',
      row: 0,
      col: 0,
      binSizeMicrometers: 16,
      renderLodSourceBinSizeMicrometers: 2,
      bbox: bbox(100, 116, 200, 216),
    })
    expect(isRenderLodGridCell(zoomedOutCells[0] as GridCellDatum)).toBe(true)
    expect(selectGridCellsForRenderLod(lods, GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN)).toBe(
      cells,
    )
  })

  it('does not coarsen 8um or 16um grid cells for rendering', () => {
    const cells = [
      gridCell('8um', bbox(0, 8, 0, 8), { binSizeMicrometers: 8 }),
      gridCell('8um-next', bbox(8, 16, 0, 8), { binSizeMicrometers: 8 }),
    ]
    const lods = createGridCellRenderLods(cells)

    expect(selectGridCellsForRenderLod(lods, -4)).toBe(cells)
  })
})

function gridCell(
  id: string,
  bounds: BBox,
  values: Partial<GridCellDatum> = {},
): GridCellDatum {
  return {
    id,
    gridId: 'grid-2um',
    row: 0,
    col: 0,
    binSizeMicrometers: 2,
    bbox: bounds,
    polygon: [
      [bounds.minX, -bounds.minY, 0],
      [bounds.maxX, -bounds.minY, 0],
      [bounds.maxX, -bounds.maxY, 0],
      [bounds.minX, -bounds.maxY, 0],
    ],
    fillColor: [34, 120, 108, 28],
    lineColor: [22, 90, 82, 150],
    ...values,
  }
}

function bbox(minX: number, maxX: number, minY: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}
