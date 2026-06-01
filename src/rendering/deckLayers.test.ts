import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { describe, expect, it } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  bundledDeckVersion,
  boundaryElementsToLayerData,
  createOverviewLayers,
  createOverviewViewState,
  overviewCellsToLayerData,
  spatialOverviewView,
} from './deckLayers'
import type { CellBoundaryDatum, OverviewCellDatum } from './deckLayers'

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

  it('adds a polygon layer when boundary data is available', () => {
    const boundaries: readonly CellBoundaryDatum[] = [
      {
        id: 'cell-1',
        polygon: [
          [0, 0, 0],
          [10, 0, 0],
          [10, -10, 0],
        ],
        fillColor: [32, 102, 83, 34],
        lineColor: [246, 242, 232, 210],
      },
    ]
    const layers = createOverviewLayers(fixtureCells, boundaries)

    expect(layers).toHaveLength(2)
    expect(layers[1]).toBeInstanceOf(PolygonLayer)
  })

  it('adds hexagon boundaries only when true boundary data is absent', () => {
    const hexBoundaries: readonly CellBoundaryDatum[] = [
      {
        id: 'hex-cell-1',
        polygon: [
          [0, -5, 0],
          [5, 0, 0],
          [0, 5, 0],
          [-5, 0, 0],
        ],
        fillColor: [32, 102, 83, 18],
        lineColor: [246, 242, 232, 112],
      },
    ]

    const hexLayers = createOverviewLayers(fixtureCells, [], hexBoundaries)
    const trueLayers = createOverviewLayers(fixtureCells, hexBoundaries, hexBoundaries)

    expect(hexLayers).toHaveLength(2)
    expect(hexLayers[1]).toBeInstanceOf(PolygonLayer)
    expect(trueLayers).toHaveLength(2)
    expect(trueLayers[1]).toBeInstanceOf(PolygonLayer)

    const [, trueBoundaryLayer] = trueLayers

    if (!(trueBoundaryLayer instanceof PolygonLayer)) {
      throw new Error('Expected true boundary layer to be a PolygonLayer.')
    }

    expect(trueBoundaryLayer.id).toBe('cell-boundary-polygons')
  })

  it('converts Xenium overview cells into deck.gl coordinates', () => {
    const [datum] = overviewCellsToLayerData([
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 25,
        cellArea: Math.PI * 16,
      },
    ])

    if (datum === undefined) {
      throw new Error('Expected overview layer datum.')
    }

    expect(datum.position).toEqual([10, -20, 0])
    expect(datum.radiusPixels).toBe(5)
    expect(datum.radiusMicrometers).toBe(4)
    expect(createOverviewViewState([datum]).target).toEqual([10, -20, 0])
  })

  it('converts polygon elements into deck.gl boundary coordinates', () => {
    expect(
      boundaryElementsToLayerData([
        {
          id: 'cell-1',
          geometry: {
            kind: 'polygon',
            rings: [
              [
                { x: micrometers(1), y: micrometers(2) },
                { x: micrometers(3), y: micrometers(4) },
                { x: micrometers(5), y: micrometers(6) },
              ],
            ],
          },
        },
      ]),
    ).toMatchObject([
      {
        id: 'cell-1',
        polygon: [
          [1, -2, 0],
          [3, -4, 0],
          [5, -6, 0],
        ],
      },
    ])
  })
})
