import { ScatterplotLayer } from '@deck.gl/layers'
import { describe, expect, it } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  bundledDeckVersion,
  createOverviewLayers,
  createOverviewViewState,
  overviewCellsToLayerData,
  spatialOverviewView,
} from './deckLayers'
import type { OverviewCellDatum } from './deckLayers'

const fixtureCells: readonly OverviewCellDatum[] = [
  {
    id: 'cell-1',
    position: [10, -20],
    radiusPixels: 4,
    fillColor: [215, 63, 124, 220],
  },
]

describe('deck layer factory', () => {
  it('creates the scaffolded cell overview layer', () => {
    const layers = createOverviewLayers(fixtureCells)

    expect(spatialOverviewView.id).toBe('spatial-overview')
    expect(bundledDeckVersion).toMatch(/^9\./)
    expect(layers).toHaveLength(1)

    const [layer] = layers

    expect(layer).toBeInstanceOf(ScatterplotLayer)

    if (!(layer instanceof ScatterplotLayer)) {
      throw new Error('Expected first overview layer to be a ScatterplotLayer.')
    }

    expect(layer.id).toBe('cells-overview-scatter')
  })

  it('converts Xenium overview cells into deck.gl coordinates', () => {
    const [datum] = overviewCellsToLayerData([
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 25,
      },
    ])

    if (datum === undefined) {
      throw new Error('Expected overview layer datum.')
    }

    expect(datum.position).toEqual([10, -20, 0])
    expect(datum.radiusPixels).toBe(5)
    expect(createOverviewViewState([datum]).target).toEqual([10, -20, 0])
  })
})
