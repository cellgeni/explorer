import { createOverviewLayers } from '../rendering/deckLayers'
import type { OverviewCellDatum } from '../rendering/deckLayers'

const scaffoldOverviewCells: readonly OverviewCellDatum[] = [
  {
    id: 'scaffold-cell-a',
    position: [0, 0],
    radiusPixels: 4,
    fillColor: [215, 63, 124, 220],
  },
]

export const scaffoldDeckLayerCount = createOverviewLayers(scaffoldOverviewCells).length
