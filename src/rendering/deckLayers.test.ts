import {
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
} from '@deck.gl/layers'
import { describe, expect, it } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  bundledDeckVersion,
  boundaryElementsToLayerData,
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayerStyle,
  createGeneExpressionCellStyleIndex,
  createOverviewLayers,
  createOverviewViewState,
  geneExpressionCellsToLayerData,
  geneExpressionScoreDomainMax,
  gridCellBatchesToLayerData,
  overviewCellsToLayerData,
  spatialOverviewView,
  styleCellBoundariesByCells,
  styleCellBoundariesByGeneExpression,
  styleCellsByGeneExpression,
  styleGridCellsByGeneExpression,
  styleGeneExpressionCellsByScale,
  transcriptAggregateBinsToLayerData,
  transcriptPointsToLayerData,
} from './deckLayers'
import type { CellBoundaryDatum, OverviewCellDatum } from './deckLayers'
import type { GridCellBatch, SpatialGrid } from '../datasets/spatialDataset'

const fixtureCells: readonly OverviewCellDatum[] = [
  {
    id: 'cell-1',
    position: [10, -20],
    radiusPixels: 4,
    fillColor: [215, 63, 124, 220],
  },
]

interface BoundaryPathLayerData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPath: {
      readonly value: Float32Array
      readonly size: number
    }
    readonly getColor: {
      readonly value: Uint8Array
      readonly size: number
    }
  }
}

interface BoundaryFillLayerData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPolygon: {
      readonly value: Float32Array
      readonly size: number
    }
    readonly getFillColor: {
      readonly value: Uint8Array
      readonly size: number
    }
  }
}

function getBoundaryPathData(layer: PathLayer): BoundaryPathLayerData {
  return layer.props.data as unknown as BoundaryPathLayerData
}

function getBoundaryFillData(layer: SolidPolygonLayer): BoundaryFillLayerData {
  return layer.props.data as unknown as BoundaryFillLayerData
}

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
    expect(layer.props.radiusMaxPixels).toBe(24)
    expect(layer.props.opacity).toBe(1)
    expect(layer.props.updateTriggers).toMatchObject({
      getFillColor: [0.5],
      getLineColor: [1],
    })

    const getFillColor = layer.props.getFillColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]
    const getLineColor = layer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getFillColor(fixtureCells[0]!)).toEqual([215, 63, 124, 128])
    expect(getLineColor(fixtureCells[0]!)).toEqual([215, 63, 124, 220])
  })

  it('fills fallback overview cell proxies when boundary fill is enabled without boundary data', () => {
    const layers = createOverviewLayers(fixtureCells, [], {
      cellFillOpacity: 0.5,
      cellBoundaryFillEnabled: true,
    })
    const [layer] = layers

    if (!(layer instanceof ScatterplotLayer)) {
      throw new Error('Expected first overview layer to be a ScatterplotLayer.')
    }

    expect(layer.props.filled).toBe(true)

    const getFillColor = layer.props.getFillColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getFillColor(fixtureCells[0]!)).toEqual([215, 63, 124, 128])
  })

  it('renders cell fills as fully opaque when cell fill opacity is 100%', () => {
    const layers = createOverviewLayers(fixtureCells, [], {
      cellFillOpacity: 1,
      cellBoundaryFillEnabled: true,
    })
    const [layer] = layers

    if (!(layer instanceof ScatterplotLayer)) {
      throw new Error('Expected first overview layer to be a ScatterplotLayer.')
    }

    const getFillColor = layer.props.getFillColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getFillColor(fixtureCells[0]!)).toEqual([215, 63, 124, 255])
  })

  it('adds a binary path layer when boundary data is available', () => {
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
    expect(layers[0]).toBeInstanceOf(PathLayer)
    expect(layers[1]).toBeInstanceOf(ScatterplotLayer)

    const [boundaryLayer, pointLayer] = layers

    if (!(boundaryLayer instanceof PathLayer)) {
      throw new Error('Expected first overview layer to be a PathLayer.')
    }

    if (!(pointLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected second overview layer to be a ScatterplotLayer.')
    }

    expect(boundaryLayer.id).toBe('cell-boundary-paths')
    expect(boundaryLayer.props.pickable).toBe(false)
    expect(boundaryLayer.props._pathType).toBe('loop')
    expect(boundaryLayer.props.widthUnits).toBe('pixels')
    expect(boundaryLayer.props.widthMinPixels).toBe(1)

    const boundaryData = getBoundaryPathData(boundaryLayer)

    expect(boundaryData.length).toBe(1)
    expect(Array.from(boundaryData.startIndices)).toEqual([0, 3])
    expect(boundaryData.attributes.getPath.size).toBe(3)
    expect(Array.from(boundaryData.attributes.getPath.value)).toEqual([
      0, 0, 0, 10, 0, 0, 10, -10, 0,
    ])
    expect(boundaryData.attributes.getColor.size).toBe(4)
    expect(Array.from(boundaryData.attributes.getColor.value)).toEqual([
      246, 242, 232, 210, 246, 242, 232, 210, 246, 242, 232, 210,
    ])
    expect(pointLayer.props.data).toEqual([])
  })

  it('adds pickable boundary hit polygons when boundary picking is enabled', () => {
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
    const layers = createOverviewLayers(fixtureCells, boundaries, {
      cellBoundaryPickable: true,
    })

    expect(layers).toHaveLength(3)
    expect(layers[0]).toBeInstanceOf(PathLayer)
    expect(layers[1]).toBeInstanceOf(PolygonLayer)
    expect(layers[2]).toBeInstanceOf(ScatterplotLayer)

    const hitLayer = layers[1]

    if (!(hitLayer instanceof PolygonLayer)) {
      throw new Error('Expected second overview layer to be a PolygonLayer.')
    }

    expect(hitLayer.id).toBe('cell-boundary-hit-areas')
    expect(hitLayer.props.pickable).toBe(true)
    expect(hitLayer.props.stroked).toBe(false)
    expect(hitLayer.props.filled).toBe(true)
    expect(hitLayer.props.opacity).toBe(0.01)
    expect(hitLayer.props.data).toEqual(boundaries)

    const getPolygon = hitLayer.props.getPolygon as (
      boundary: CellBoundaryDatum,
    ) => readonly (readonly number[])[]

    expect(getPolygon(boundaries[0]!)).toEqual(boundaries[0]!.polygon)
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
    const layers = createOverviewLayers(fixtureCells, boundaries, {
      cellFillOpacity: 0.35,
      cellBoundaryOpacity: 0.6,
      cellBoundaryFillEnabled: true,
    })
    const [fillLayer, boundaryLayer, pointLayer] = layers

    if (!(fillLayer instanceof SolidPolygonLayer)) {
      throw new Error('Expected first overview layer to be a SolidPolygonLayer.')
    }

    if (!(boundaryLayer instanceof PathLayer)) {
      throw new Error('Expected second overview layer to be a PathLayer.')
    }

    if (!(pointLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected third overview layer to be a ScatterplotLayer.')
    }

    expect(fillLayer.id).toBe('cell-boundary-fills')
    expect(fillLayer.props.pickable).toBe(false)
    expect(fillLayer.props._normalize).toBe(false)
    expect(fillLayer.props.updateTriggers?.getFillColor).toEqual([
      0.35,
      expect.any(Object),
    ])
    expect(boundaryLayer.props.opacity).toBe(1)
    expect(pointLayer.props.opacity).toBe(1)
    expect(boundaryLayer.props.updateTriggers?.getColor).toEqual([
      0.6,
      expect.any(Object),
    ])
    expect(pointLayer.props.updateTriggers).toMatchObject({
      getFillColor: [0.35],
      getLineColor: [0.6],
    })
    expect(pointLayer.props.filled).toBe(true)
    expect(pointLayer.props.data).toEqual([])

    const fillData = getBoundaryFillData(fillLayer)
    const boundaryData = getBoundaryPathData(boundaryLayer)
    const getPointFillColor = pointLayer.props.getFillColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]
    const getPointLineColor = pointLayer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(fillData.length).toBe(1)
    expect(Array.from(fillData.startIndices)).toEqual([0, 4])
    expect(fillData.attributes.getPolygon.size).toBe(3)
    expect(Array.from(fillData.attributes.getPolygon.value)).toEqual([
      0, 0, 0, 10, 0, 0, 10, -10, 0, 0, 0, 0,
    ])
    expect(Array.from(fillData.attributes.getFillColor.value.slice(0, 4))).toEqual([
      32, 102, 83, 89,
    ])
    expect(Array.from(boundaryData.attributes.getColor.value.slice(0, 4))).toEqual([
      246, 242, 232, 126,
    ])
    expect(getPointFillColor(fixtureCells[0]!)).toEqual([215, 63, 124, 89])
    expect(getPointLineColor(fixtureCells[0]!)).toEqual([215, 63, 124, 132])
  })

  it('keeps boundary path outlines visible when cell fill opacity is zero', () => {
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
    const layers = createOverviewLayers(fixtureCells, boundaries, {
      cellFillOpacity: 0,
      cellBoundaryOpacity: 0.5,
    })
    const [boundaryLayer] = layers

    if (!(boundaryLayer instanceof PathLayer)) {
      throw new Error('Expected first overview layer to be a PathLayer.')
    }

    const boundaryData = getBoundaryPathData(boundaryLayer)

    expect(boundaryLayer.props.pickable).toBe(false)
    expect(Array.from(boundaryData.attributes.getColor.value.slice(0, 4))).toEqual([
      246, 242, 232, 105,
    ])
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

  it('merges gene expression color into the existing point layer', () => {
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [10, -20, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 5,
        expressionGenes: ['A2ML1'],
      },
    ]
    const expressionStyledCells = styleCellsByGeneExpression(
      fixtureCells,
      expressionCells,
    )
    const layers = createOverviewLayers(expressionStyledCells, [], {
      cellFillOpacity: 0.45,
      cellBoundaryOpacity: 0.4,
      cellBoundaryFillEnabled: true,
    })

    expect(layers).toHaveLength(1)
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer)

    const cellLayer = layers[0]

    if (!(cellLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected overview cell layer to be a ScatterplotLayer.')
    }

    expect(expressionStyledCells[0]).toMatchObject({
      fillColor: [240, 128, 120, 220],
      expressionCount: 5,
      expressionGenes: ['A2ML1'],
    })
    expect(cellLayer.id).toBe('cells-overview-scatter')
    expect(cellLayer.props.pickable).toBe(true)
    expect(cellLayer.props.filled).toBe(true)
    expect(cellLayer.props.lineWidthMinPixels).toBe(1)
    expect(cellLayer.props.updateTriggers).toMatchObject({
      getFillColor: [0.5],
      getLineColor: [0.4],
    })

    const getFillColor = cellLayer.props.getFillColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]
    const getLineColor = cellLayer.props.getLineColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(getFillColor(expressionStyledCells[0]!)).toEqual([240, 128, 120, 128])
    expect(getLineColor(expressionStyledCells[0]!)).toEqual([240, 128, 120, 88])
  })

  it('styles unmatched visible cells as expression-zero cells while expression is active', () => {
    const cells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-without-expression',
        position: [10, -20, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
    ]
    const expressionStyledCells = styleCellsByGeneExpression(cells, [], {
      styleUnmatchedCells: true,
    })
    const layers = createOverviewLayers(expressionStyledCells, [], {
      cellFillOpacity: 0.45,
      cellBoundaryOpacity: 0.4,
      geneExpressionActive: true,
    })

    expect(expressionStyledCells[0]).toMatchObject({
      id: 'cell-without-expression',
      fillColor: [72, 68, 58, 84],
      expressionCount: 0,
    })

    const cellLayer = layers[0]

    if (!(cellLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected overview cell layer to be a ScatterplotLayer.')
    }

    const getFillColor = cellLayer.props.getFillColor as (
      cell: OverviewCellDatum,
    ) => readonly number[]

    expect(cellLayer.props.filled).toBe(true)
    expect(getFillColor(expressionStyledCells[0]!)).toEqual([72, 68, 58, 128])
  })

  it('adds a non-pickable gene expression overlay when expression cells need direct drawing', () => {
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'expression-cell-1',
        position: [120, -140, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 5,
        expressionGenes: ['A2ML1'],
      },
    ]
    const layers = createOverviewLayers(fixtureCells, [], {
      cellFillOpacity: 0.45,
      cellBoundaryOpacity: 0.4,
      geneExpressionOverlayCells: expressionCells,
    })

    expect(layers).toHaveLength(2)
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer)
    expect(layers[1]).toBeInstanceOf(ScatterplotLayer)

    const expressionLayer = layers[1]

    if (!(expressionLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected expression overlay to be a ScatterplotLayer.')
    }

    expect(expressionLayer.id).toBe('gene-expression-scatter')
    expect(expressionLayer.props.data).toBe(expressionCells)
    expect(expressionLayer.props.pickable).toBe(false)
    expect(expressionLayer.props.filled).toBe(true)
    expect(expressionLayer.props.radiusMinPixels).toBe(1.5)
    expect(expressionLayer.props.updateTriggers).toMatchObject({
      getFillColor: [0.5],
      getLineColor: [0.4],
    })
  })

  it('paints expression-matched boundary polygons instead of overlaying points', () => {
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
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [10, -20, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 5,
      },
      {
        id: 'expression-cell-2',
        position: [120, -140, 0],
        radiusPixels: 6,
        fillColor: [63, 165, 91, 220],
        expressionCount: 3,
      },
    ]
    const geometry = createCellBoundaryLayerGeometry(boundaries, {
      includeFill: true,
    })
    const style = createCellBoundaryLayerStyle(geometry, [], expressionCells)
    const layers = createOverviewLayers(fixtureCells, boundaries, {
      cellFillOpacity: 0.45,
      cellBoundaryOpacity: 0.4,
      cellBoundaryGeometry: geometry,
      cellBoundaryStyle: style,
      geneExpressionActive: true,
      geneExpressionOverlayCells: expressionCells,
    })
    const fillLayer = layers.find((layer) => {
      return layer instanceof SolidPolygonLayer && layer.id === 'cell-boundary-fills'
    })
    const expressionLayer = layers.find((layer) => {
      return layer instanceof ScatterplotLayer && layer.id === 'gene-expression-scatter'
    })

    if (!(fillLayer instanceof SolidPolygonLayer)) {
      throw new Error('Expected expression boundary fill layer.')
    }

    if (!(expressionLayer instanceof ScatterplotLayer)) {
      throw new Error('Expected remaining expression overlay layer.')
    }

    const fillData = getBoundaryFillData(fillLayer)

    expect(Array.from(fillData.attributes.getFillColor.value.slice(0, 4))).toEqual([
      240, 128, 120, 115,
    ])
    expect(expressionLayer.props.data).toEqual([expressionCells[1]])
  })

  it('merges gene expression color into sampled overview points by spatial bin', () => {
    const cells: readonly OverviewCellDatum[] = [
      {
        id: 'sampled-cell-1',
        position: [65, -70, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
      {
        id: 'sampled-cell-2',
        position: [230, -230, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
    ]
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-42',
        position: [40, -45, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 7,
        expressionGenes: ['A2ML1'],
      },
    ]

    const expressionStyleIndex = createGeneExpressionCellStyleIndex(expressionCells, {
      binMicrometers: 100,
    })
    const expressionStyledCells = styleCellsByGeneExpression(cells, expressionStyleIndex)

    expect(expressionStyledCells[0]).toMatchObject({
      id: 'sampled-cell-1',
      fillColor: [240, 128, 120, 222],
      expressionCount: 7,
      expressionGenes: ['A2ML1'],
    })
    expect(expressionStyledCells[1]).toBe(cells[1])
  })

  it('prefers exact gene expression matches over spatial-bin fallback colors', () => {
    const cells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [65, -70, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
    ]
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [65, -70, 0],
        radiusPixels: 6,
        fillColor: [240, 128, 120, 220],
        expressionCount: 7,
      },
      {
        id: 'cell-2',
        position: [40, -45, 0],
        radiusPixels: 6,
        fillColor: [30, 180, 150, 220],
        expressionCount: 3,
      },
    ]

    const expressionStyledCells = styleCellsByGeneExpression(cells, expressionCells, {
      binMicrometers: 100,
    })

    expect(expressionStyledCells[0]).toMatchObject({
      fillColor: [240, 128, 120, 220],
      expressionCount: 7,
    })
  })

  it('merges gene expression color into the existing boundary layer', () => {
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
    const expressionStyledBoundaries = styleCellBoundariesByGeneExpression(
      boundaries,
      expressionCells,
    )
    const layers = createOverviewLayers(fixtureCells, expressionStyledBoundaries, {
      cellFillOpacity: 0.5,
      cellBoundaryOpacity: 0.25,
    })

    expect(expressionStyledBoundaries).toMatchObject([
      {
        id: 'cell-2',
        fillColor: [240, 128, 120, 220],
        lineColor: [240, 128, 120, 220],
      },
    ])
    expect(
      layers.some(
        (layer) =>
          layer instanceof ScatterplotLayer && layer.id === 'gene-expression-scatter',
      ),
    ).toBe(false)
    expect(
      layers.some(
        (layer) => layer instanceof PathLayer && layer.id === 'gene-expression-paths',
      ),
    ).toBe(false)

    const boundaryLayer = layers[0]

    if (!(boundaryLayer instanceof PathLayer)) {
      throw new Error('Expected boundary layer to be a PathLayer.')
    }

    expect(boundaryLayer.id).toBe('cell-boundary-paths')
    expect(boundaryLayer.props.opacity).toBe(1)
    expect(boundaryLayer.props.pickable).toBe(false)
    expect(boundaryLayer.props.updateTriggers?.getColor).toEqual([
      0.25,
      expect.any(Object),
    ])

    const boundaryData = getBoundaryPathData(boundaryLayer)

    expect(Array.from(boundaryData.attributes.getColor.value.slice(0, 4))).toEqual([
      240, 128, 120, 55,
    ])
  })

  it('keeps expression-styled boundary outlines visible when cell fill opacity is zero', () => {
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
    const expressionStyledBoundaries = styleCellBoundariesByGeneExpression(
      boundaries,
      expressionCells,
    )
    const layers = createOverviewLayers(fixtureCells, expressionStyledBoundaries, {
      cellFillOpacity: 0,
      cellBoundaryOpacity: 0.5,
    })
    const boundaryLayer = layers[0]

    if (!(boundaryLayer instanceof PathLayer)) {
      throw new Error('Expected boundary layer to be a PathLayer.')
    }

    const boundaryData = getBoundaryPathData(boundaryLayer)

    expect(boundaryLayer.props.pickable).toBe(false)
    expect(boundaryLayer.props._pathType).toBe('loop')
    expect(Array.from(boundaryData.attributes.getColor.value.slice(0, 4))).toEqual([
      240, 128, 120, 110,
    ])
  })

  it('reuses boundary geometry buffers when expression boundary style changes', () => {
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
    const geometry = createCellBoundaryLayerGeometry(boundaries, {
      includeFill: true,
    })
    const styleA = createCellBoundaryLayerStyle(
      geometry,
      [],
      [
        {
          id: 'cell-1',
          position: [10, -20, 0],
          radiusPixels: 6,
          fillColor: [240, 128, 120, 220],
        },
      ],
    )
    const styleB = createCellBoundaryLayerStyle(
      geometry,
      [],
      [
        {
          id: 'cell-1',
          position: [10, -20, 0],
          radiusPixels: 6,
          fillColor: [63, 165, 91, 220],
        },
      ],
    )
    const layersA = createOverviewLayers(fixtureCells, boundaries, {
      cellBoundaryGeometry: geometry,
      cellBoundaryStyle: styleA,
      cellBoundaryFillEnabled: true,
      cellFillOpacity: 0.5,
      cellBoundaryOpacity: 0.75,
    })
    const layersARepeat = createOverviewLayers(fixtureCells, boundaries, {
      cellBoundaryGeometry: geometry,
      cellBoundaryStyle: styleA,
      cellBoundaryFillEnabled: true,
      cellFillOpacity: 0.5,
      cellBoundaryOpacity: 0.75,
    })
    const layersB = createOverviewLayers(fixtureCells, boundaries, {
      cellBoundaryGeometry: geometry,
      cellBoundaryStyle: styleB,
      cellBoundaryFillEnabled: true,
      cellFillOpacity: 0.5,
      cellBoundaryOpacity: 0.75,
    })
    const [fillLayerA, pathLayerA] = layersA
    const [fillLayerARepeat, pathLayerARepeat] = layersARepeat
    const [fillLayerB, pathLayerB] = layersB

    if (
      !(fillLayerA instanceof SolidPolygonLayer) ||
      !(fillLayerARepeat instanceof SolidPolygonLayer) ||
      !(fillLayerB instanceof SolidPolygonLayer)
    ) {
      throw new Error('Expected boundary fill layers.')
    }

    if (
      !(pathLayerA instanceof PathLayer) ||
      !(pathLayerARepeat instanceof PathLayer) ||
      !(pathLayerB instanceof PathLayer)
    ) {
      throw new Error('Expected boundary path layers.')
    }

    const fillDataA = getBoundaryFillData(fillLayerA)
    const fillDataARepeat = getBoundaryFillData(fillLayerARepeat)
    const fillDataB = getBoundaryFillData(fillLayerB)
    const pathDataA = getBoundaryPathData(pathLayerA)
    const pathDataARepeat = getBoundaryPathData(pathLayerARepeat)
    const pathDataB = getBoundaryPathData(pathLayerB)
    const fillDataComparator = fillLayerA.props.dataComparator as (
      data: unknown,
      oldData?: unknown,
    ) => boolean
    const pathDataComparator = pathLayerA.props.dataComparator as (
      data: unknown,
      oldData?: unknown,
    ) => boolean

    expect(fillDataARepeat).toBe(fillDataA)
    expect(pathDataARepeat).toBe(pathDataA)
    expect(fillDataA.startIndices).toBe(fillDataB.startIndices)
    expect(fillDataA.attributes.getPolygon.value).toBe(
      fillDataB.attributes.getPolygon.value,
    )
    expect(pathDataA.startIndices).toBe(pathDataB.startIndices)
    expect(pathDataA.attributes.getPath.value).toBe(pathDataB.attributes.getPath.value)
    expect(fillDataA.attributes.getFillColor.value).not.toBe(
      fillDataB.attributes.getFillColor.value,
    )
    expect(pathDataA.attributes.getColor.value).not.toBe(
      pathDataB.attributes.getColor.value,
    )
    expect(Array.from(fillDataA.attributes.getFillColor.value.slice(0, 4))).toEqual([
      240, 128, 120, 128,
    ])
    expect(Array.from(fillDataB.attributes.getFillColor.value.slice(0, 4))).toEqual([
      63, 165, 91, 128,
    ])
    expect(Array.from(pathDataA.attributes.getColor.value.slice(0, 4))).toEqual([
      240, 128, 120, 165,
    ])
    expect(Array.from(pathDataB.attributes.getColor.value.slice(0, 4))).toEqual([
      63, 165, 91, 165,
    ])
    expect(fillDataComparator(fillDataB, fillDataA)).toBe(true)
    expect(pathDataComparator(pathDataB, pathDataA)).toBe(true)
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
        nucleusCount: 2,
        segmentationMethod: 'nucleus_expansion',
      },
    ])

    if (datum === undefined) {
      throw new Error('Expected overview layer datum.')
    }

    expect(datum.position).toEqual([10, -20, 0])
    expect(datum.radiusPixels).toBe(5)
    expect(datum.radiusMicrometers).toBe(4)
    expect(datum.fillColor).toEqual([72, 68, 58, 240])
    expect(datum.nucleusCount).toBe(2)
    expect(datum.segmentationMethod).toBe('nucleus_expansion')
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
          nucleusCount: 1,
          segmentationMethod: 'cellpose',
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
      nucleusCount: 1,
      segmentationMethod: 'cellpose',
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
    const layers = createOverviewLayers(fixtureCells, [], {
      transcriptAggregateBins: bins,
      transcriptOpacity: 0.5,
    })
    const aggregateLayer = layers.find(
      (layer) => layer instanceof PolygonLayer && layer.id === 'transcript-density-bins',
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

  it('renders affine grid cells as pickable polygons', () => {
    const gridCells = gridCellBatchesToLayerData([fixtureGrid], [fixtureGridCellBatch])
    const layers = createOverviewLayers([], [], {
      gridCells,
      gridCellOpacity: 0.5,
    })
    const gridLayer = layers.find(
      (layer) => layer instanceof PolygonLayer && layer.id === 'spatial-grid-cells',
    )

    expect(gridLayer).toBeInstanceOf(PolygonLayer)

    if (!(gridLayer instanceof PolygonLayer)) {
      throw new Error('Expected grid cells to render as PolygonLayer.')
    }

    expect(gridLayer.props.pickable).toBe(true)
    expect(gridLayer.props.data).toEqual(gridCells)

    const getPolygon = gridLayer.props.getPolygon as (
      cell: (typeof gridCells)[number],
    ) => readonly (readonly number[])[]
    const getFillColor = gridLayer.props.getFillColor as (
      cell: (typeof gridCells)[number],
    ) => readonly number[]
    const getLineColor = gridLayer.props.getLineColor as (
      cell: (typeof gridCells)[number],
    ) => readonly number[]

    expect(getPolygon(gridCells[0]!)).toEqual([
      [4, -15, 0],
      [16, -15, 0],
      [16, -25, 0],
      [4, -25, 0],
    ])
    expect(getFillColor(gridCells[0]!)).toEqual([34, 120, 108, 14])
    expect(getLineColor(gridCells[0]!)).toEqual([22, 90, 82, 75])
  })

  it('merges gene expression color into affine grid cells', () => {
    const gridCells = gridCellBatchesToLayerData([fixtureGrid], [fixtureGridCellBatch])
    const expressionStyledGridCells = styleGridCellsByGeneExpression(
      gridCells,
      [
        {
          id: 'BC-1',
          position: [10, -20, 0],
          radiusPixels: 6,
          fillColor: [240, 128, 120, 220],
          expressionCount: 7,
          expressionGenes: ['Actb'],
        },
      ],
      { styleUnmatchedCells: true },
    )

    expect(expressionStyledGridCells[0]).toMatchObject({
      id: 'BC-1',
      fillColor: [240, 128, 120, 220],
      lineColor: [240, 128, 120, 220],
      expressionCount: 7,
      expressionGenes: ['Actb'],
    })
    expect(expressionStyledGridCells[1]).toMatchObject({
      id: 'BC-2',
      fillColor: [72, 68, 58, 84],
      expressionCount: 0,
    })

    const layers = createOverviewLayers([], [], {
      gridCells: expressionStyledGridCells,
      gridCellOpacity: 0.5,
    })
    const gridLayer = layers.find(
      (layer) => layer instanceof PolygonLayer && layer.id === 'spatial-grid-cells',
    )

    if (!(gridLayer instanceof PolygonLayer)) {
      throw new Error('Expected grid cells to render as PolygonLayer.')
    }

    const getFillColor = gridLayer.props.getFillColor as (
      cell: (typeof expressionStyledGridCells)[number],
    ) => readonly number[]

    expect(getFillColor(expressionStyledGridCells[0]!)).toEqual([240, 128, 120, 110])
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
    const thermalBins = transcriptAggregateBinsToLayerData([featureCircle], 'thermal')
    const viridisBins = transcriptAggregateBinsToLayerData([featureCircle], 'viridis')

    expect(thermalBins[0]).toMatchObject({
      glyphType: 'feature-circle',
      featureName: 'CD74',
      binTotalCount: 19,
      omittedFeatureCount: 1,
    })
    expect(thermalBins[0]?.fillColor).toEqual(viridisBins[0]?.fillColor)
  })

  it('can color exact transcript points by QV instead of feature', () => {
    const transcript = {
      id: 'tx-1',
      cellId: null,
      featureName: 'Actb',
      fovName: 'FOV-1',
      position: { x: micrometers(10), y: micrometers(20) },
      qv: 10,
    }
    const [featureDatum] = transcriptPointsToLayerData([transcript], 'feature')
    const [qualityDatum] = transcriptPointsToLayerData([transcript], 'quality')

    expect(qualityDatum?.fillColor).toEqual([221, 127, 75, 215])
    expect(qualityDatum?.fillColor).not.toEqual(featureDatum?.fillColor)
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
    const layers = createOverviewLayers(fixtureCells, [], {
      transcriptAggregateBins: bins,
      transcriptOpacity: 0.5,
    })
    const featureCircleLayer = layers.find(
      (layer) =>
        layer instanceof ScatterplotLayer && layer.id === 'transcript-feature-circles',
    )

    expect(featureCircleLayer).toBeInstanceOf(ScatterplotLayer)

    if (!(featureCircleLayer instanceof ScatterplotLayer)) {
      throw new Error(
        'Expected transcript feature circles to render as ScatterplotLayer.',
      )
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
        fillColor: [32, 102, 83, 34],
        lineColor: [32, 102, 83, 190],
        polygon: [
          [1, -2, 0],
          [3, -4, 0],
          [5, -6, 0],
        ],
      },
    ])
  })

  it('converts columnar affine grid batches into deck.gl polygons', () => {
    expect(gridCellBatchesToLayerData([fixtureGrid], [fixtureGridCellBatch])).toEqual([
      {
        id: 'BC-1',
        gridId: 'grid-16um',
        row: 1,
        col: 0,
        fillColor: [34, 120, 108, 28],
        lineColor: [22, 90, 82, 150],
        polygon: [
          [4, -15, 0],
          [16, -15, 0],
          [16, -25, 0],
          [4, -25, 0],
        ],
      },
      {
        id: 'BC-2',
        gridId: 'grid-16um',
        row: 0,
        col: 1,
        fillColor: [34, 120, 108, 28],
        lineColor: [22, 90, 82, 150],
        polygon: [
          [16, -5, 0],
          [28, -5, 0],
          [28, -15, 0],
          [16, -15, 0],
        ],
      },
    ])
  })

  it('copies Visium HD grid-cell metadata into deck.gl polygon data', () => {
    expect(
      gridCellBatchesToLayerData([fixtureGrid], [fixtureGridCellBatch], {
        metadata: [
          {
            binSizeMicrometers: 16,
            inTissue: new Uint8Array([1, 0]),
            fullresRows: new Float64Array([128, 144]),
            fullresCols: new Float64Array([256, 272]),
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'BC-1',
        binSizeMicrometers: 16,
        inTissue: true,
        fullresRow: 128,
        fullresCol: 256,
      }),
      expect.objectContaining({
        id: 'BC-2',
        binSizeMicrometers: 16,
        inTissue: false,
        fullresRow: 144,
        fullresCol: 272,
      }),
    ])
  })
})

const fixtureGrid: SpatialGrid = {
  id: 'grid-16um',
  binSizeMicrometers: micrometers(16),
  basis: {
    origin: { x: micrometers(10), y: micrometers(10) },
    rowStep: { x: micrometers(0), y: micrometers(10) },
    colStep: { x: micrometers(12), y: micrometers(0) },
  },
}

const fixtureGridCellBatch: GridCellBatch = {
  kind: 'grid-cells',
  gridId: 'grid-16um',
  ids: ['BC-1', 'BC-2'],
  rows: new Int32Array([1, 0]),
  cols: new Int32Array([0, 1]),
}
