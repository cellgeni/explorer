import type { Color, LayersList, Position } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'

export interface OverviewCellDatum {
  readonly id: string
  readonly position: Position
  readonly radiusPixels: number
  readonly fillColor: Color
}

export interface OverviewViewState {
  readonly target: [number, number, number]
  readonly zoom: number
  readonly minZoom: number
  readonly maxZoom: number
}

const DEFAULT_OVERVIEW_VIEW_STATE: OverviewViewState = {
  target: [0, 0, 0],
  zoom: -4,
  minZoom: -10,
  maxZoom: 10,
}

export const spatialOverviewView = new OrthographicView({
  id: 'spatial-overview',
  flipY: false,
})

export const bundledDeckVersion = deckVersion

export function createOverviewLayers(cells: readonly OverviewCellDatum[]): LayersList {
  return [
    new ScatterplotLayer<OverviewCellDatum>({
      id: 'cells-overview-scatter',
      data: cells,
      pickable: true,
      radiusUnits: 'pixels',
      radiusMinPixels: 2,
      getPosition: (cell) => cell.position,
      getRadius: (cell) => cell.radiusPixels,
      getFillColor: (cell) => cell.fillColor,
    }),
  ]
}

export function overviewCellsToLayerData(
  cells: readonly CellOverviewPoint[],
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  const maxTranscriptCount = Math.max(
    ...cells.map((cell) => Math.max(cell.transcriptCount, 0)),
    1,
  )

  return cells.map((cell) => {
    const intensity = Math.sqrt(Math.max(cell.transcriptCount, 0) / maxTranscriptCount)

    return {
      id: cell.cellId,
      position: [cell.position.x, -cell.position.y, 0],
      radiusPixels: 2 + intensity * 3,
      fillColor: [215, 63, 124, 150 + Math.round(intensity * 90)],
    }
  })
}

export function createOverviewViewState(
  cells: readonly OverviewCellDatum[],
): OverviewViewState {
  if (cells.length === 0) {
    return DEFAULT_OVERVIEW_VIEW_STATE
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const cell of cells) {
    const [x = 0, y = 0] = cell.position
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  const span = Math.max(maxX - minX, maxY - minY, 1)
  const zoom = Math.max(-10, Math.min(4, Math.log2(720 / span)))

  return {
    ...DEFAULT_OVERVIEW_VIEW_STATE,
    target: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
    zoom,
  }
}
