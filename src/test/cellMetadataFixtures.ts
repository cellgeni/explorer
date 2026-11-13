import { overviewCellMetadata } from '../data/cellMetadata'
import type { CellOverviewPoint } from '../data/hyparquetCells'

// Overview points with their metadata built, as the Cell card reads it, so
// tests can compare them with plain records.
export function withCellMetadata(points: readonly CellOverviewPoint[]) {
  return points.map(({ readMetadata, ...point }) => {
    const metadata = overviewCellMetadata({
      ...point,
      ...(readMetadata === undefined ? {} : { readMetadata }),
    })
    return metadata === undefined ? point : { ...point, metadata }
  })
}
