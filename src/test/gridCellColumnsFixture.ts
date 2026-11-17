import { micrometers } from '../data/coords'
import type { SpatialGridBasis } from '../datasets/spatialDataset'
import { GridCellColumns } from '../rendering/gridCellColumns'

export interface GridCellFixtureBin {
  readonly id: string
  readonly row: number
  readonly col: number
  readonly inTissue?: boolean
  readonly fullresRow?: number
  readonly fullresCol?: number
}

// An axis-aligned grid of `size` µm squares: bin (row, col) covers x from
// col * size to (col + 1) * size and y from row * size to (row + 1) * size,
// offset by `origin`.
export function squareGridBasis(
  size: number,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): SpatialGridBasis {
  return {
    origin: { x: micrometers(origin.x + size / 2), y: micrometers(origin.y + size / 2) },
    rowStep: { x: micrometers(0), y: micrometers(size) },
    colStep: { x: micrometers(size), y: micrometers(0) },
  }
}

export function gridCellColumnsFixture(
  bins: readonly GridCellFixtureBin[],
  options: {
    readonly gridId?: string
    readonly binSizeMicrometers?: number
    readonly basis?: SpatialGridBasis
    readonly renderLodSourceBinSizeMicrometers?: number
  } = {},
): GridCellColumns {
  const binSizeMicrometers = options.binSizeMicrometers ?? 16
  const hasTissue = bins.some((bin) => bin.inTissue !== undefined)
  const hasFullres = bins.some(
    (bin) => bin.fullresRow !== undefined || bin.fullresCol !== undefined,
  )

  return new GridCellColumns({
    gridId: options.gridId ?? `visium-hd-square-${binSizeMicrometers}um`,
    basis: options.basis ?? squareGridBasis(binSizeMicrometers),
    length: bins.length,
    ids: bins.map((bin) => bin.id),
    rows: Int32Array.from(bins, (bin) => bin.row),
    cols: Int32Array.from(bins, (bin) => bin.col),
    binSizeMicrometers,
    ...(hasTissue
      ? { inTissue: Uint8Array.from(bins, (bin) => (bin.inTissue === false ? 0 : 1)) }
      : {}),
    ...(hasFullres
      ? {
          fullresRows: Float64Array.from(bins, (bin) => bin.fullresRow ?? 0),
          fullresCols: Float64Array.from(bins, (bin) => bin.fullresCol ?? 0),
        }
      : {}),
    ...(options.renderLodSourceBinSizeMicrometers === undefined
      ? {}
      : { renderLodSourceBinSizeMicrometers: options.renderLodSourceBinSizeMicrometers }),
  })
}
