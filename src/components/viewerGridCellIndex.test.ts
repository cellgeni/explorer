import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { gridCellAt, gridCellColumnsBbox } from '../rendering/gridCellColumns'
import { gridCellColumnsFixture, squareGridBasis } from '../test/gridCellColumnsFixture'
import {
  GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN,
  coarsenGridCellColumns,
  createGridCellRenderLods,
  isRenderLodGridCell,
  selectGridCellsForRenderLod,
} from './viewerGridCellIndex'

describe('viewerGridCellIndex', () => {
  it('renders selected 2um cells as 16um LOD until close zoom', () => {
    const bins = []

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        bins.push({ id: `2um-${row}-${col}`, row, col })
      }
    }

    const cells = gridCellColumnsFixture(bins, {
      binSizeMicrometers: 2,
      basis: squareGridBasis(2, { x: 100, y: 200 }),
    })
    const lods = createGridCellRenderLods(cells)
    const zoomedOutCells = selectGridCellsForRenderLod(
      lods,
      GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN - 0.1,
    )
    const coarse = gridCellAt(zoomedOutCells, 0)

    expect(zoomedOutCells).toHaveLength(1)
    expect(coarse).toMatchObject({
      id: 'render-lod-16um:0:0',
      row: 0,
      col: 0,
      binSizeMicrometers: 16,
      renderLodSourceBinSizeMicrometers: 2,
      bbox: bbox(100, 116, 200, 216),
    })
    expect(isRenderLodGridCell(coarse)).toBe(true)
    expect(selectGridCellsForRenderLod(lods, GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN)).toBe(
      cells,
    )
  })

  it('does not coarsen 8um or 16um grid cells for rendering', () => {
    const cells = gridCellColumnsFixture(
      [
        { id: '8um', row: 0, col: 0 },
        { id: '8um-next', row: 0, col: 1 },
      ],
      { binSizeMicrometers: 8 },
    )
    const lods = createGridCellRenderLods(cells)

    expect(lods.coarse16um).toBeNull()
    expect(selectGridCellsForRenderLod(lods, -4)).toBe(cells)
  })

  it('keeps one coarse square per occupied slot, in tissue when any bin is', () => {
    const cells = gridCellColumnsFixture(
      [
        { id: 'a', row: 9, col: 17, inTissue: false },
        { id: 'b', row: 0, col: 0, inTissue: false },
        { id: 'c', row: 15, col: 23, inTissue: true },
        { id: 'd', row: -1, col: 0, inTissue: false },
      ],
      { binSizeMicrometers: 2 },
    )
    const coarse = coarsenGridCellColumns(cells, 16)

    expect(coarse.ids).toEqual([
      'render-lod-16um:-1:0',
      'render-lod-16um:0:0',
      'render-lod-16um:1:2',
    ])
    expect(Array.from(coarse.inTissue ?? [])).toEqual([0, 0, 1])
    // Each coarse square covers its 8 × 8 bins.
    expect(gridCellColumnsBbox(coarse)).toEqual(bbox(0, 48, -16, 32))
  })

  it('coarsens bins scattered over a huge grid', () => {
    const cells = gridCellColumnsFixture(
      [
        { id: 'far', row: 8_000_000, col: 8_000_000 },
        { id: 'near', row: 1, col: 1 },
      ],
      { binSizeMicrometers: 2 },
    )

    expect(coarsenGridCellColumns(cells, 16).ids).toEqual([
      'render-lod-16um:0:0',
      'render-lod-16um:1000000:1000000',
    ])
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
