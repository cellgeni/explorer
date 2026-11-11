import type { ViewerSelectionHighlight } from '../../components/viewerSelectionModel'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from '../../rendering/deckLayers'

// What to mark for the current selection: a boundary or bin outline when there
// is one, otherwise a ring around the point or spot. A cell picked as a point
// is outlined when its boundary is drawn (boundaries are keyed by cell ID).
export function viewerSelectionHighlight({
  selectedCell,
  selectedBoundaryCell,
  selectedGridCell,
  drawnBoundaries,
}: {
  readonly selectedCell: OverviewCellDatum | null
  readonly selectedBoundaryCell: CellBoundaryDatum | null
  readonly selectedGridCell: GridCellDatum | null
  readonly drawnBoundaries?: ReadonlyMap<string, CellBoundaryDatum> | undefined
}): ViewerSelectionHighlight | null {
  if (selectedBoundaryCell !== null) {
    return {
      kind: 'polygon',
      id: selectedBoundaryCell.id,
      polygon: selectedBoundaryCell.polygon,
    }
  }

  if (selectedGridCell !== null) {
    return { kind: 'polygon', id: selectedGridCell.id, polygon: selectedGridCell.polygon }
  }

  const selectedCellBoundary =
    selectedCell === null ? undefined : drawnBoundaries?.get(selectedCell.id)

  if (selectedCellBoundary !== undefined) {
    return {
      kind: 'polygon',
      id: selectedCellBoundary.id,
      polygon: selectedCellBoundary.polygon,
    }
  }

  if (selectedCell !== null) {
    return {
      kind: 'point',
      id: selectedCell.id,
      position: selectedCell.position,
      radius: selectedCell.radiusMicrometers ?? 0,
    }
  }

  return null
}
