import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { describe, expect, it } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  bundledDeckVersion,
  boundaryElementsToLayerData,
  createOverviewLayers,
  createOverviewViewState,
  expressionCellsToBoundaryLayerData,
  geneExpressionCellsToLayerData,
  geneExpressionScoreDomainMax,
  overviewCellsToLayerData,
  spatialOverviewView,
  styleCellBoundariesByCells,
  styleGeneExpressionCellsByScale,
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
    expect(layer.props.pickable).toBe(true)
    expect(layer.props.filled).toBe(false)
    expect(layer.props.stroked).toBe(true)
    expect(layer.props.lineWidthUnits).toBe('pixels')
    expect(layer.props.lineWidthMinPixels).toBe(0.25)
    expect(layer.props.radiusMinPixels).toBe(0.12)

    const getLineColor = layer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getLineColor(fixtureCells[0]!)).toEqual([215, 63, 124, 40])
  })

  it('can color overview cell outlines through a lookup without changing cell data', () => {
    const layers = createOverviewLayers(fixtureCells, [], [], [], {
      cellColorLookup: {
        colorByCellId: new Map([['cell-1', [31, 119, 180, 230]]]),
        fallbackColor: [72, 68, 58, 44],
      },
      cellsPickable: false,
    })
    const [layer] = layers

    if (!(layer instanceof ScatterplotLayer)) {
      throw new Error('Expected first overview layer to be a ScatterplotLayer.')
    }

    const getLineColor = layer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(layer.props.pickable).toBe(false)
    expect(fixtureCells[0]?.fillColor).toEqual([215, 63, 124, 220])
    expect(getLineColor(fixtureCells[0]!)).toEqual([31, 119, 180, 41])
  })

  it('adds a non-pickable annotation preview layer for sampled overview colors', () => {
    const layers = createOverviewLayers(fixtureCells, [], [], [], {
      annotationPreviewCells: fixtureCells,
      cellColorLookup: {
        colorByCellId: new Map([['cell-1', [31, 119, 180, 230]]]),
        fallbackColor: [72, 68, 58, 44],
      },
    })

    expect(layers).toHaveLength(2)
    expect(layers[1]).toBeInstanceOf(ScatterplotLayer)

    const previewLayer = layers[1]

    if (!(previewLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected annotation preview layer to be a ScatterplotLayer.')
    }

    expect(previewLayer.id).toBe('annotation-preview-scatter')
    expect(previewLayer.props.pickable).toBe(false)
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

  it('adds a gene expression overlay layer', () => {
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-2',
        position: [12, -24, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 5,
      },
    ]
    const layers = createOverviewLayers(fixtureCells, [], [], expressionCells, {
      geneExpressionOpacity: 0.45,
    })

    expect(layers).toHaveLength(2)
    expect(layers[1]).toBeInstanceOf(ScatterplotLayer)

    const expressionLayer = layers[1]

    if (!(expressionLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected expression layer to be a ScatterplotLayer.')
    }

    expect(expressionLayer.id).toBe('gene-expression-scatter')
    expect(expressionLayer.props.opacity).toBe(0.45)
    expect(expressionLayer.props.pickable).toBe(false)
  })

  it('uses expression-filled hexagons instead of scatter when hex geometry is visible', () => {
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-2',
        position: [12, -24, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 5,
      },
    ]
    const hexBoundaries: readonly CellBoundaryDatum[] = [
      {
        id: 'hex-cell-1',
        polygon: [
          [0, -5, 0],
          [5, 0, 0],
          [0, 5, 0],
        ],
        fillColor: [32, 102, 83, 18],
        lineColor: [246, 242, 232, 112],
      },
    ]
    const expressionHexBoundaries: readonly CellBoundaryDatum[] = [
      {
        id: 'hex-boundary:cell-2',
        polygon: [
          [12, -30, 0],
          [18, -24, 0],
          [12, -18, 0],
        ],
        fillColor: [240, 128, 120, 220],
        lineColor: [255, 253, 247, 210],
      },
    ]
    const layers = createOverviewLayers(
      fixtureCells,
      [],
      hexBoundaries,
      expressionCells,
      {
        geneExpressionOpacity: 0.65,
        expressionHexBoundaries,
      },
    )

    expect(layers).toHaveLength(3)
    expect(
      layers.some(
        (layer) =>
          layer instanceof ScatterplotLayer && layer.id === 'gene-expression-scatter',
      ),
    ).toBe(false)

    const expressionLayer = layers[2]

    if (!(expressionLayer instanceof PolygonLayer)) {
      throw new Error('Expected expression hex layer to be a PolygonLayer.')
    }

    expect(expressionLayer.id).toBe('gene-expression-hexagons')
    expect(expressionLayer.props.opacity).toBe(0.65)
  })

  it('uses expression-filled true boundaries instead of scatter when matching polygons exist', () => {
    const boundaries: readonly CellBoundaryDatum[] = [
      {
        id: 'cell-2',
        polygon: [
          [0, 0, 0],
          [10, 0, 0],
          [10, -10, 0],
        ],
        fillColor: [32, 102, 83, 34],
        lineColor: [246, 242, 232, 210],
      },
    ]
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-2',
        position: [12, -24, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 5,
      },
    ]
    const expressionBoundaryPolygons = expressionCellsToBoundaryLayerData(
      boundaries,
      expressionCells,
    )
    const layers = createOverviewLayers(fixtureCells, boundaries, [], expressionCells, {
      geneExpressionOpacity: 0.5,
      expressionBoundaryPolygons,
    })

    expect(expressionBoundaryPolygons).toMatchObject([
      {
        id: 'cell-2',
        fillColor: [240, 128, 120, 220],
        lineColor: [255, 253, 247, 210],
      },
    ])
    expect(
      layers.some(
        (layer) =>
          layer instanceof ScatterplotLayer && layer.id === 'gene-expression-scatter',
      ),
    ).toBe(false)

    const expressionLayer = layers[2]

    if (!(expressionLayer instanceof PolygonLayer)) {
      throw new Error('Expected expression boundary layer to be a PolygonLayer.')
    }

    expect(expressionLayer.id).toBe('gene-expression-polygons')
    expect(expressionLayer.props.opacity).toBe(0.5)
  })

  it('styles true boundaries from matching visible cell colors', () => {
    const [boundary] = styleCellBoundariesByCells(
      [
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
      ],
      fixtureCells,
    )

    expect(boundary?.fillColor).toEqual([215, 63, 124, 88])
    expect(boundary?.lineColor).toEqual([215, 63, 124, 220])
  })

  it('styles true boundaries from an annotation color lookup', () => {
    const [boundary] = styleCellBoundariesByCells(
      [
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
      ],
      fixtureCells,
      {
        colorByCellId: new Map([['cell-1', [31, 119, 180, 230]]]),
        fallbackColor: [72, 68, 58, 44],
      },
    )

    expect(boundary?.fillColor).toEqual([31, 119, 180, 88])
    expect(boundary?.lineColor).toEqual([31, 119, 180, 230])
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

  it('converts expression cells into deck.gl overlay coordinates', () => {
    const [datum] = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 4,
          transcriptCount: 11,
          cellArea: Math.PI * 9,
        },
      ],
      ['Gad1'],
    )

    expect(datum).toMatchObject({
      position: [10, -20, 0],
      radiusMicrometers: 3,
      expressionCount: 4,
      expressionGenes: ['Gad1'],
      transcriptCount: 11,
    })
  })

  it('scores multi-gene expression by mean count', () => {
    const [datum] = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 6,
        },
      ],
      ['Gad1', 'Actb', 'Slc17a7'],
      'gold',
      'mean',
    )

    expect(datum?.expressionCount).toBe(2)
    expect(datum?.fillColor).toEqual([255, 221, 99, 245])
  })

  it('scores expression signatures as z-scores across visible cells', () => {
    const data = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 2,
        },
        {
          id: intToCellId(1, 2),
          position: { x: micrometers(20), y: micrometers(20) },
          count: 4,
        },
        {
          id: intToCellId(1, 3),
          position: { x: micrometers(30), y: micrometers(20) },
          count: 8,
        },
      ],
      ['Gad1'],
      'gold',
      'z-score',
    )

    expect(data[0]?.expressionCount).toBeLessThan(0)
    expect(data[1]?.expressionCount).toBeLessThan(0)
    expect(data[2]?.expressionCount).toBeCloseTo(1.34, 2)
    expect(data[2]?.fillColor).toEqual([255, 221, 99, 245])
  })

  it('colors expression cells with the selected scale', () => {
    const [goldDatum] = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 4,
        },
      ],
      ['Gad1'],
      'gold',
    )
    const [viridisDatum] = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 4,
        },
      ],
      ['Gad1'],
      'viridis',
    )

    expect(goldDatum?.fillColor).toEqual([255, 221, 99, 245])
    expect(viridisDatum?.fillColor).toEqual([253, 231, 37, 245])
    expect(goldDatum?.fillColor).not.toEqual(viridisDatum?.fillColor)
  })

  it('uses a supplied global expression scale maximum when coloring cells', () => {
    const [datum] = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 4,
        },
      ],
      ['Gad1'],
      'gold',
      'sum',
      { scaleMax: 16 },
    )

    expect(datum?.expressionCount).toBe(4)
    expect(datum?.fillColor).toEqual([221, 127, 75, 196])
    expect(
      geneExpressionScoreDomainMax(
        [
          {
            id: intToCellId(1, 2),
            position: { x: micrometers(0), y: micrometers(0) },
            count: 6,
          },
        ],
        ['Gad1', 'Actb'],
        'mean',
      ),
    ).toBe(3)
  })

  it('restyles existing expression layer data without changing positions', () => {
    const [datum] = geneExpressionCellsToLayerData(
      [
        {
          id: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          count: 4,
        },
      ],
      ['Gad1'],
      'gold',
    )

    if (datum === undefined) {
      throw new Error('Expected expression layer datum.')
    }

    const [restyled] = styleGeneExpressionCellsByScale([datum], 'magma')

    expect(restyled).toMatchObject({
      id: datum.id,
      position: datum.position,
      fillColor: [252, 223, 116, 245],
    })
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
