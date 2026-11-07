import type { Position } from '@deck.gl/core'
import { micrometers, type BBox } from '../data/coords'
import { gridCellCorners } from '../datasets/spatialGrid'
import type { GridCellBatch, SpatialGrid } from '../datasets/spatialDataset'
import {
  colorWithOpacity,
  GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY,
} from './deckLayerColors'
import type { GridCellDatum, GridCellLayerDataOptions } from './deckLayerTypes'
import { GridBinLayer } from './gridBinLayer'
import {
  DEFAULT_CELL_FILL_OPACITY,
  DEFAULT_LAYER_OPACITY,
  normalizeLayerOpacity,
} from './layerOpacity'

export function createGridCellLayer(
  gridCells: readonly GridCellDatum[],
  options: {
    readonly opacity?: number
    readonly fillOpacity?: number
    readonly lineOpacity?: number
    readonly geneExpressionActive: boolean
  },
): GridBinLayer<GridCellDatum> | null {
  if (gridCells.length === 0) {
    return null
  }

  const gridCellFillOpacity = normalizeLayerOpacity(
    options.fillOpacity ?? options.opacity ?? DEFAULT_CELL_FILL_OPACITY,
  )
  const gridCellLineOpacity = normalizeLayerOpacity(
    options.lineOpacity ?? options.opacity ?? DEFAULT_LAYER_OPACITY,
  )
  const effectiveGridCellFillOpacity = options.geneExpressionActive
    ? Math.max(gridCellFillOpacity, GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY)
    : gridCellFillOpacity

  return new GridBinLayer<GridCellDatum>({
    id: 'spatial-grid-cells',
    data: gridCells,
    pickable: true,
    stroked: true,
    filled: true,
    opacity: 1,
    lineWidthPixels: GRID_CELL_LINE_WIDTH_PIXELS,
    getCenter: gridCellCenter,
    getColumnVector: (cell) => gridCellEdge(cell, 1),
    getRowVector: (cell) => gridCellEdge(cell, 3),
    getFillColor: (cell) =>
      colorWithOpacity(cell.fillColor, effectiveGridCellFillOpacity),
    getLineColor: (cell) => colorWithOpacity(cell.lineColor, gridCellLineOpacity),
    updateTriggers: {
      getFillColor: [effectiveGridCellFillOpacity],
      getLineColor: [gridCellLineOpacity],
    },
  })
}

const GRID_CELL_LINE_WIDTH_PIXELS = 0.25

// Grid cell polygons list their corners as (row, col), (row, col + 1),
// (row + 1, col + 1), (row + 1, col), so opposite corners give the centre and
// corners 1 and 3 the column and row edges.
function gridCellCenter(cell: GridCellDatum): Position {
  const [x0 = 0, y0 = 0] = cell.polygon[0] ?? []
  const [x2 = x0, y2 = y0] = cell.polygon[2] ?? []
  return [(x0 + x2) / 2, (y0 + y2) / 2, 0]
}

function gridCellEdge(cell: GridCellDatum, corner: 1 | 3): [number, number] {
  const [x0 = 0, y0 = 0] = cell.polygon[0] ?? []
  const [x = x0, y = y0] = cell.polygon[corner] ?? []
  return [x - x0, y - y0]
}

export function gridCellBatchesToLayerData(
  grids: readonly SpatialGrid[],
  batches: readonly GridCellBatch[],
  options: GridCellLayerDataOptions = {},
): readonly GridCellDatum[] {
  if (grids.length === 0 || batches.length === 0) {
    return []
  }

  const gridById = new Map(grids.map((grid) => [grid.id, grid]))
  const cells: GridCellDatum[] = []

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex]

    if (batch === undefined) {
      continue
    }

    const grid = gridById.get(batch.gridId)
    const metadata = options.metadata?.[batchIndex]

    if (grid === undefined) {
      continue
    }

    for (let index = 0; index < batch.rows.length; index += 1) {
      const id = batch.ids[index]

      if (id === undefined) {
        continue
      }

      const row = batch.rows[index] ?? 0
      const col = batch.cols[index] ?? 0
      const polygon = gridCellCorners(grid, row, col).map(
        (point): [number, number, number] => [point.x, -point.y, 0],
      )

      cells.push({
        id,
        gridId: grid.id,
        row,
        col,
        ...(metadata?.binSizeMicrometers === undefined
          ? {}
          : { binSizeMicrometers: metadata.binSizeMicrometers }),
        ...(metadata?.inTissue?.[index] === undefined
          ? {}
          : { inTissue: metadata.inTissue[index] === 1 }),
        ...(metadata?.fullresRows?.[index] === undefined
          ? {}
          : { fullresRow: metadata.fullresRows[index] }),
        ...(metadata?.fullresCols?.[index] === undefined
          ? {}
          : { fullresCol: metadata.fullresCols[index] }),
        bbox: gridCellPolygonBbox(polygon),
        polygon,
        fillColor: [34, 120, 108, 28],
        lineColor: [22, 90, 82, 150],
      })
    }
  }

  return cells
}

function gridCellPolygonBbox(polygon: GridCellDatum['polygon']): BBox {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x = 0, deckY = 0] of polygon) {
    const rawY = -deckY
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}
