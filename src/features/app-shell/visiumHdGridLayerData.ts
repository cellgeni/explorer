import type { VisiumHdBinnedOverview } from '../../datasets/visiumHdDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  gridCellBatchesToLayerData,
  type GridCellDatum,
} from '../../rendering/deckLayers'

export function visiumHdOverviewToGridCellLayerData(
  overview: VisiumHdBinnedOverview,
  selectedBinSize: VisiumHdBinSizeMicrometers = overview.binSizeMicrometers,
): readonly GridCellDatum[] {
  const cells = gridCellBatchesToLayerData([overview.grid], [overview.gridCells], {
    metadata: [
      {
        binSizeMicrometers: overview.binSizeMicrometers,
        inTissue: overview.inTissue,
        fullresRows: overview.fullresRows,
        fullresCols: overview.fullresCols,
      },
    ],
  })

  if (overview.binSizeMicrometers === selectedBinSize) {
    return cells
  }

  return cells.map((cell) => ({
    ...cell,
    renderLodSourceBinSizeMicrometers: selectedBinSize,
  }))
}

export function gridCellLayerBinSize(
  cells: readonly GridCellDatum[],
): VisiumHdBinSizeMicrometers | null {
  let binSizeMicrometers: VisiumHdBinSizeMicrometers | null = null

  for (const cell of cells) {
    if (!isVisiumHdBinSizeMicrometers(cell.binSizeMicrometers)) {
      return null
    }

    if (binSizeMicrometers === null) {
      binSizeMicrometers = cell.binSizeMicrometers
      continue
    }

    if (cell.binSizeMicrometers !== binSizeMicrometers) {
      return null
    }
  }

  return binSizeMicrometers
}

function isVisiumHdBinSizeMicrometers(
  binSizeMicrometers: number | undefined,
): binSizeMicrometers is VisiumHdBinSizeMicrometers {
  return binSizeMicrometers === 2 || binSizeMicrometers === 8 || binSizeMicrometers === 16
}
