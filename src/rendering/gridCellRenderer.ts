import { PolygonLayer } from '@deck.gl/layers'
import { gridCellCorners } from '../datasets/spatialGrid'
import type { GridCellBatch, SpatialGrid } from '../datasets/spatialDataset'
import {
  colorWithOpacity,
  GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY,
} from './deckLayerColors'
import type { GridCellDatum, GridCellLayerDataOptions } from './deckLayerTypes'
import { DEFAULT_LAYER_OPACITY, normalizeLayerOpacity } from './layerOpacity'

export function createGridCellLayer(
  gridCells: readonly GridCellDatum[],
  options: {
    readonly opacity?: number
    readonly geneExpressionActive: boolean
  },
): PolygonLayer<GridCellDatum> | null {
  if (gridCells.length === 0) {
    return null
  }

  const gridCellOpacity = normalizeLayerOpacity(options.opacity ?? DEFAULT_LAYER_OPACITY)
  const effectiveGridCellOpacity = options.geneExpressionActive
    ? Math.max(gridCellOpacity, GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY)
    : gridCellOpacity

  return new PolygonLayer<GridCellDatum>({
    id: 'spatial-grid-cells',
    data: gridCells,
    pickable: true,
    stroked: true,
    filled: true,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 0.25,
    getPolygon: (cell) => cell.polygon,
    getFillColor: (cell) => colorWithOpacity(cell.fillColor, effectiveGridCellOpacity),
    getLineColor: (cell) => colorWithOpacity(cell.lineColor, effectiveGridCellOpacity),
    getLineWidth: 0.25,
    updateTriggers: {
      getFillColor: [effectiveGridCellOpacity],
      getLineColor: [effectiveGridCellOpacity],
    },
  })
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
        polygon: gridCellCorners(grid, row, col).map((point) => [point.x, -point.y, 0]),
        fillColor: [34, 120, 108, 28],
        lineColor: [22, 90, 82, 150],
      })
    }
  }

  return cells
}
