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
  transcriptAggregateBinsToLayerData,
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
    expect(layer.props.filled).toBe(false)
    expect(layer.props.stroked).toBe(true)
    expect(layer.props.lineWidthUnits).toBe('pixels')
    expect(layer.props.lineWidthMinPixels).toBe(1)
    expect(layer.props.radiusMinPixels).toBe(0.12)
    expect(layer.props.opacity).toBe(1)
    expect(layer.props.updateTriggers).toMatchObject({
      getLineColor: [1],
    })

    const getLineColor = layer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getLineColor(fixtureCells[0]!)).toEqual([215, 63, 124, 220])
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
    expect(layers[0]).toBeInstanceOf(PolygonLayer)
    expect(layers[1]).toBeInstanceOf(ScatterplotLayer)

    const [, pointLayer] = layers

    if (!(pointLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected second overview layer to be a ScatterplotLayer.')
    }

    expect(pointLayer.props.data).toEqual([])
  })

  it('applies separate cell fill and boundary opacity to points and boundaries', () => {
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
    const layers = createOverviewLayers(fixtureCells, boundaries, [], {
      cellFillOpacity: 0.35,
      cellBoundaryOpacity: 0.6,
    })
    const [boundaryLayer, pointLayer] = layers

    if (!(boundaryLayer instanceof PolygonLayer)) {
      throw new Error('Expected first overview layer to be a PolygonLayer.')
    }

    if (!(pointLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected second overview layer to be a ScatterplotLayer.')
    }

    expect(boundaryLayer.props.opacity).toBe(1)
    expect(pointLayer.props.opacity).toBe(1)
    expect(boundaryLayer.props.updateTriggers).toMatchObject({
      getFillColor: [0.35],
      getLineColor: [0.6],
    })
    expect(pointLayer.props.updateTriggers).toMatchObject({
      getLineColor: [0.6],
    })

    const getBoundaryFillColor = boundaryLayer.props.getFillColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]
    const getBoundaryLineColor = boundaryLayer.props.getLineColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]
    const getPointLineColor = pointLayer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getBoundaryFillColor(boundaries[0]!)).toEqual([32, 102, 83, 12])
    expect(getBoundaryLineColor(boundaries[0]!)).toEqual([246, 242, 232, 126])
    expect(getPointLineColor(fixtureCells[0]!)).toEqual([215, 63, 124, 132])
  })

  it('keeps transparent polygon fills pickable when cell fill opacity is zero', () => {
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
    const layers = createOverviewLayers(fixtureCells, boundaries, [], {
      cellFillOpacity: 0,
      cellBoundaryOpacity: 0.5,
    })
    const [boundaryLayer] = layers

    if (!(boundaryLayer instanceof PolygonLayer)) {
      throw new Error('Expected first overview layer to be a PolygonLayer.')
    }

    const getFillColor = boundaryLayer.props.getFillColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]
    const getLineColor = boundaryLayer.props.getLineColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]

    expect(boundaryLayer.props.filled).toBe(true)
    expect(boundaryLayer.props.stroked).toBe(true)
    expect(getFillColor(boundaries[0]!)).toEqual([32, 102, 83, 0])
    expect(getLineColor(boundaries[0]!)).toEqual([246, 242, 232, 105])
  })

  it('keeps overview points for cells without visible boundaries', () => {
    const cells: readonly OverviewCellDatum[] = [
      ...fixtureCells,
      {
        id: 'cell-2',
        position: [20, -30],
        radiusPixels: 5,
        fillColor: [44, 132, 168, 210],
      },
    ]
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
    const layers = createOverviewLayers(cells, boundaries)
    const [, pointLayer] = layers

    if (!(pointLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected second overview layer to be a ScatterplotLayer.')
    }

    expect(pointLayer.props.data).toEqual([cells[1]])
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
    const layers = createOverviewLayers(fixtureCells, [], expressionCells, {
      cellFillOpacity: 0.45,
      cellBoundaryOpacity: 0.4,
    })

    expect(layers).toHaveLength(2)
    expect(layers[1]).toBeInstanceOf(ScatterplotLayer)

    const expressionLayer = layers[1]

    if (!(expressionLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected expression layer to be a ScatterplotLayer.')
    }

    expect(expressionLayer.id).toBe('gene-expression-scatter')
    expect(expressionLayer.props.opacity).toBe(1)
    expect(expressionLayer.props.pickable).toBe(false)
    expect(expressionLayer.props.filled).toBe(false)
    expect(expressionLayer.props.stroked).toBe(true)
    expect(expressionLayer.props.lineWidthUnits).toBe('pixels')
    expect(expressionLayer.props.lineWidthMinPixels).toBe(1.5)
    expect(expressionLayer.props.updateTriggers).toMatchObject({
      getLineColor: [0.4],
    })

    const getLineColor = expressionLayer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getLineColor(expressionCells[0]!)).toEqual([240, 128, 120, 88])
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
    const layers = createOverviewLayers(fixtureCells, boundaries, expressionCells, {
      cellFillOpacity: 0.5,
      cellBoundaryOpacity: 0.25,
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
    expect(expressionLayer.props.opacity).toBe(1)
    expect(expressionLayer.props.updateTriggers).toMatchObject({
      getFillColor: [0.5],
      getLineColor: [0.25],
    })

    const getFillColor = expressionLayer.props.getFillColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]
    const getLineColor = expressionLayer.props.getLineColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]

    expect(getFillColor(expressionBoundaryPolygons[0]!)).toEqual([240, 128, 120, 110])
    expect(getLineColor(expressionBoundaryPolygons[0]!)).toEqual([255, 253, 247, 53])
  })

  it('keeps expression polygon fills transparent when cell fill opacity is zero', () => {
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
    const layers = createOverviewLayers(fixtureCells, boundaries, expressionCells, {
      cellFillOpacity: 0,
      cellBoundaryOpacity: 0.5,
      expressionBoundaryPolygons,
    })
    const expressionLayer = layers[2]

    if (!(expressionLayer instanceof PolygonLayer)) {
      throw new Error('Expected expression boundary layer to be a PolygonLayer.')
    }

    const getFillColor = expressionLayer.props.getFillColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]
    const getLineColor = expressionLayer.props.getLineColor as (
      cell: CellBoundaryDatum,
    ) => readonly number[]

    expect(expressionLayer.props.filled).toBe(true)
    expect(expressionLayer.props.stroked).toBe(true)
    expect(getFillColor(expressionBoundaryPolygons[0]!)).toEqual([240, 128, 120, 0])
    expect(getLineColor(expressionBoundaryPolygons[0]!)).toEqual([255, 253, 247, 105])
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

  it('renders transcript aggregate bins as pickable density squares', () => {
    const bins = transcriptAggregateBinsToLayerData([
      {
        id: 'bin-1',
        level: 2,
        binX: 3,
        binY: 4,
        position: { x: micrometers(10), y: micrometers(20) },
        radiusMicrometers: 12,
        binSizeMicrometers: 20,
        count: 25,
      },
    ])
    const layers = createOverviewLayers(fixtureCells, [], [], {
      transcriptAggregateBins: bins,
      transcriptOpacity: 0.5,
    })
    const aggregateLayer = layers.find(
      (layer) =>
        layer instanceof PolygonLayer && layer.id === 'transcript-density-bins',
    )

    expect(aggregateLayer).toBeInstanceOf(PolygonLayer)

    if (!(aggregateLayer instanceof PolygonLayer)) {
      throw new Error('Expected transcript aggregate bins to render as PolygonLayer.')
    }

    expect(aggregateLayer.props.pickable).toBe(true)

    const getPolygon = aggregateLayer.props.getPolygon as (
      bin: (typeof bins)[number],
    ) => readonly (readonly number[])[]

    expect(getPolygon(bins[0]!)).toEqual([
      [0, -10, 0],
      [20, -10, 0],
      [20, -30, 0],
      [0, -30, 0],
    ])
  })

  it('colors transcript aggregate bins with the selected density scale', () => {
    const thermalBins = transcriptAggregateBinsToLayerData(
      [
        {
          id: 'bin-1',
          level: 2,
          binX: 3,
          binY: 4,
          position: { x: micrometers(10), y: micrometers(20) },
          radiusMicrometers: 12,
          count: 25,
        },
      ],
      'thermal',
    )
    const viridisBins = transcriptAggregateBinsToLayerData(
      [
        {
          id: 'bin-1',
          level: 2,
          binX: 3,
          binY: 4,
          position: { x: micrometers(10), y: micrometers(20) },
          radiusMicrometers: 12,
          count: 25,
        },
      ],
      'viridis',
    )

    expect(thermalBins[0]?.fillColor).toEqual([255, 223, 91, 246])
    expect(viridisBins[0]?.fillColor).toEqual([253, 231, 37, 246])
  })

  it('keeps transcript density colors on a provided global scale', () => {
    const [viewportBin] = transcriptAggregateBinsToLayerData(
      [
        {
          id: 'bin-1',
          glyphType: 'density',
          level: 2,
          binX: 3,
          binY: 4,
          position: { x: micrometers(10), y: micrometers(20) },
          radiusMicrometers: 12,
          count: 25,
        },
      ],
      'thermal',
      { scaleMax: 100 },
    )
    const [globalBin] = transcriptAggregateBinsToLayerData(
      [
        {
          id: 'bin-2',
          glyphType: 'density',
          level: 2,
          binX: 3,
          binY: 4,
          position: { x: micrometers(10), y: micrometers(20) },
          radiusMicrometers: 12,
          count: 100,
        },
      ],
      'thermal',
      { scaleMax: 100 },
    )

    expect(viewportBin?.fillColor).not.toEqual([255, 223, 91, 246])
    expect(globalBin?.fillColor).toEqual([255, 223, 91, 246])
  })

  it('colors selected-gene feature circles by gene instead of density scale', () => {
    const featureCircle = {
      id: 'circle-1',
      glyphType: 'feature-circle' as const,
      level: 0,
      binX: 3,
      binY: 4,
      position: { x: micrometers(10), y: micrometers(20) },
      radiusMicrometers: 4,
      count: 7,
      binTotalCount: 19,
      omittedFeatureCount: 1,
      featureName: 'CD74',
    }
    const thermalBins = transcriptAggregateBinsToLayerData(
      [featureCircle],
      'thermal',
    )
    const viridisBins = transcriptAggregateBinsToLayerData(
      [featureCircle],
      'viridis',
    )

    expect(thermalBins[0]).toMatchObject({
      glyphType: 'feature-circle',
      featureName: 'CD74',
      binTotalCount: 19,
      omittedFeatureCount: 1,
    })
    expect(thermalBins[0]?.fillColor).toEqual(viridisBins[0]?.fillColor)
  })

  it('renders selected-gene feature circles as a separate pickable circle layer', () => {
    const bins = transcriptAggregateBinsToLayerData([
      {
        id: 'circle-1',
        glyphType: 'feature-circle',
        level: 0,
        binX: 3,
        binY: 4,
        position: { x: micrometers(10), y: micrometers(20) },
        radiusMicrometers: 4,
        count: 7,
        featureName: 'CD74',
      },
    ])
    const layers = createOverviewLayers(fixtureCells, [], [], {
      transcriptAggregateBins: bins,
      transcriptOpacity: 0.5,
    })
    const featureCircleLayer = layers.find(
      (layer) =>
        layer instanceof ScatterplotLayer && layer.id === 'transcript-feature-circles',
    )

    expect(featureCircleLayer).toBeInstanceOf(ScatterplotLayer)

    if (!(featureCircleLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected transcript feature circles to render as ScatterplotLayer.')
    }

    expect(featureCircleLayer.props.pickable).toBe(true)
    expect(featureCircleLayer.props.radiusUnits).toBe('common')

    const getRadius = featureCircleLayer.props.getRadius as (
      bin: (typeof bins)[number],
    ) => number

    expect(getRadius(bins[0]!)).toBe(4)
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
