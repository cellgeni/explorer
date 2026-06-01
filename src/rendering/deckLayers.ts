import type { Color, LayersList, Position } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'

export interface OverviewCellDatum {
  readonly id: string
  readonly position: Position
  readonly radiusPixels: number
  readonly fillColor: Color
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
