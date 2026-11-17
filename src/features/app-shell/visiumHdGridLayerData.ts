import type { VisiumHdBinnedOverview } from '../../datasets/visiumHdDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  gridCellColumnsFromBatch,
  type GridCellColumns,
} from '../../rendering/gridCellColumns'

// The overview's bins as columns, sharing its arrays. A tier drawn in place of
// the selected size is marked as such, so its bins are not picked.
export function visiumHdOverviewToGridCellColumns(
  overview: VisiumHdBinnedOverview,
  selectedBinSize: VisiumHdBinSizeMicrometers = overview.binSizeMicrometers,
): GridCellColumns {
  return gridCellColumnsFromBatch(overview.grid, overview.gridCells, {
    binSizeMicrometers: overview.binSizeMicrometers,
    inTissue: overview.inTissue,
    fullresRows: overview.fullresRows,
    fullresCols: overview.fullresCols,
    ...(overview.binSizeMicrometers === selectedBinSize
      ? {}
      : { renderLodSourceBinSizeMicrometers: selectedBinSize }),
  })
}

export function gridCellLayerBinSize(
  cells: GridCellColumns,
): VisiumHdBinSizeMicrometers | null {
  return cells.length > 0 && isVisiumHdBinSizeMicrometers(cells.binSizeMicrometers)
    ? cells.binSizeMicrometers
    : null
}

function isVisiumHdBinSizeMicrometers(
  binSizeMicrometers: number | undefined,
): binSizeMicrometers is VisiumHdBinSizeMicrometers {
  return binSizeMicrometers === 2 || binSizeMicrometers === 8 || binSizeMicrometers === 16
}
