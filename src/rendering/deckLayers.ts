import type { Color, LayersList, Position } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { GeneExpressionCell } from '../datasets/xeniumDataset'
import type { SpatialElement } from '../datasets/spatialDataset'
import { DEFAULT_LAYER_OPACITY, normalizeLayerOpacity } from './layerOpacity'

export interface OverviewCellDatum {
  readonly id: string
  readonly position: Position
  readonly radiusPixels: number
  readonly radiusMicrometers?: number
  readonly fillColor: Color
  readonly cellCount?: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface OverviewViewState {
  readonly target: [number, number, number]
  readonly zoom: number
  readonly minZoom: number
  readonly maxZoom: number
}

export interface CellBoundaryDatum {
  readonly id: string
  readonly polygon: readonly Position[]
  readonly fillColor: Color
  readonly lineColor: Color
}

export interface CellColorLookup {
  readonly colorByCellId: ReadonlyMap<string, Color>
  readonly fallbackColor: Color
}

export interface OverviewLayerOptions {
  readonly geneExpressionOpacity?: number
  readonly expressionBoundaryPolygons?: readonly CellBoundaryDatum[]
  readonly expressionHexBoundaries?: readonly CellBoundaryDatum[]
  readonly cellColorLookup?: CellColorLookup | null
  readonly cellsPickable?: boolean
  readonly annotationPreviewCells?: readonly OverviewCellDatum[]
}

export type GeneExpressionColorScale = 'gold' | 'magma' | 'viridis'
export type GeneExpressionScoreMode = 'sum' | 'mean' | 'z-score'

export interface GeneExpressionColorScaleOption {
  readonly id: GeneExpressionColorScale
  readonly label: string
}

export interface GeneExpressionScoreModeOption {
  readonly id: GeneExpressionScoreMode
  readonly label: string
}

export interface GeneExpressionLayerDataOptions {
  readonly scaleMax?: number
}

type ColorStop = readonly [number, number, number, number]

export const DEFAULT_GENE_EXPRESSION_COLOR_SCALE: GeneExpressionColorScale = 'gold'
export const DEFAULT_GENE_EXPRESSION_SCORE_MODE: GeneExpressionScoreMode = 'sum'

export const GENE_EXPRESSION_COLOR_SCALE_OPTIONS: readonly GeneExpressionColorScaleOption[] =
  [
    { id: 'gold', label: 'Gold' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
  ]

export const GENE_EXPRESSION_SCORE_MODE_OPTIONS: readonly GeneExpressionScoreModeOption[] =
  [
    { id: 'sum', label: 'Sum' },
    { id: 'mean', label: 'Mean' },
    { id: 'z-score', label: 'Z-score' },
  ]

const GENE_EXPRESSION_COLOR_STOPS: Record<
  GeneExpressionColorScale,
  readonly [ColorStop, ColorStop, ColorStop]
> = {
  gold: [
    [111, 63, 53, 130],
    [221, 127, 75, 196],
    [255, 221, 99, 245],
  ],
  magma: [
    [45, 15, 71, 130],
    [195, 60, 105, 205],
    [252, 223, 116, 245],
  ],
  viridis: [
    [68, 1, 84, 130],
    [33, 145, 140, 205],
    [253, 231, 37, 245],
  ],
}

const DEFAULT_OVERVIEW_VIEW_STATE: OverviewViewState = {
  target: [0, 0, 0],
  zoom: -4,
  minZoom: -10,
  maxZoom: 10,
}

const OVERVIEW_CELL_LINE_WIDTH = 0.35

export const spatialOverviewView = new OrthographicView({
  id: 'spatial-overview',
  flipY: false,
})

export const bundledDeckVersion = deckVersion

export function createOverviewLayers(
  cells: readonly OverviewCellDatum[],
  boundaries: readonly CellBoundaryDatum[] = [],
  hexBoundaries: readonly CellBoundaryDatum[] = [],
  expressionCells: readonly OverviewCellDatum[] = [],
  options: OverviewLayerOptions = {},
): LayersList {
  const geneExpressionOpacity = normalizeLayerOpacity(
    options.geneExpressionOpacity ?? DEFAULT_LAYER_OPACITY,
  )
  const expressionBoundaryPolygons = options.expressionBoundaryPolygons ?? []
  const expressionHexBoundaries = options.expressionHexBoundaries ?? []
  const cellColorLookup = options.cellColorLookup ?? null
  const cellsPickable = options.cellsPickable ?? true
  const annotationPreviewCells = options.annotationPreviewCells ?? []
  const hasExpressionPolygons =
    expressionBoundaryPolygons.length > 0 || expressionHexBoundaries.length > 0
  const layers: LayersList = [
    new ScatterplotLayer<OverviewCellDatum>({
      id: 'cells-overview-scatter',
      data: cells,
      pickable: cellsPickable,
      radiusUnits: 'common',
      radiusMinPixels: 0.12,
      radiusMaxPixels: 6,
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 0.25,
      getPosition: getOverviewCellPosition,
      getRadius: getOverviewCellRadius,
      getLineColor:
        cellColorLookup === null
          ? getOverviewCellBaseOutlineColor
          : (cell) => overviewCellOutlineColor(overviewCellColor(cell, cellColorLookup)),
      getLineWidth: getOverviewCellLineWidth,
    }),
  ]

  if (annotationPreviewCells.length > 0 && cellColorLookup !== null) {
    layers.push(
      new ScatterplotLayer<OverviewCellDatum>({
        id: 'annotation-preview-scatter',
        data: annotationPreviewCells,
        pickable: false,
        radiusUnits: 'common',
        radiusMinPixels: 0.35,
        radiusMaxPixels: 7,
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.5,
        getPosition: getOverviewCellPosition,
        getRadius: getOverviewCellRadius,
        getLineColor: (cell) =>
          overviewCellOutlineColor(overviewCellColor(cell, cellColorLookup)),
        getLineWidth: 0.75,
      }),
    )
  }

  if (expressionCells.length > 0 && !hasExpressionPolygons) {
    layers.push(
      new ScatterplotLayer<OverviewCellDatum>({
        id: 'gene-expression-scatter',
        data: expressionCells,
        pickable: false,
        radiusUnits: 'common',
        radiusMinPixels: 3,
        radiusMaxPixels: 18,
        stroked: true,
        lineWidthMinPixels: 1,
        opacity: geneExpressionOpacity,
        getPosition: (cell) => cell.position,
        getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: [255, 253, 247, 230],
        getLineWidth: 1,
      }),
    )
  }

  if (hexBoundaries.length > 0 && boundaries.length === 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'cell-boundary-hexagons',
        data: hexBoundaries,
        pickable: false,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: (cell) => cell.lineColor,
        getLineWidth: 1,
      }),
    )
  }

  if (boundaries.length > 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'cell-boundary-polygons',
        data: boundaries,
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: (cell) => cell.lineColor,
        getLineWidth: 1,
      }),
    )
  }

  if (expressionHexBoundaries.length > 0 && boundaries.length === 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'gene-expression-hexagons',
        data: expressionHexBoundaries,
        pickable: false,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        opacity: geneExpressionOpacity,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: (cell) => cell.lineColor,
        getLineWidth: 1,
      }),
    )
  }

  if (expressionBoundaryPolygons.length > 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'gene-expression-polygons',
        data: expressionBoundaryPolygons,
        pickable: false,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        opacity: geneExpressionOpacity,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: (cell) => cell.lineColor,
        getLineWidth: 1,
      }),
    )
  }

  return layers
}

export function overviewCellsToLayerData(
  cells: readonly CellOverviewPoint[],
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  let maxTranscriptCount = 1

  for (const cell of cells) {
    maxTranscriptCount = Math.max(maxTranscriptCount, cell.transcriptCount)
  }

  return cells.map((cell, index) => {
    const intensity = Math.sqrt(Math.max(cell.transcriptCount, 0) / maxTranscriptCount)
    const radiusMicrometers = cellAreaToRadiusMicrometers(cell.cellArea)

    return {
      id: cell.cellId ?? `overview-cell-${index}`,
      position: [cell.position.x, -cell.position.y, 0],
      radiusPixels: 2 + intensity * 3,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: [215, 63, 124, 150 + Math.round(intensity * 90)],
      transcriptCount: cell.transcriptCount,
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
    }
  })
}

export function geneExpressionCellsToLayerData(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  colorScale: GeneExpressionColorScale = DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  scoreMode: GeneExpressionScoreMode = DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  options: GeneExpressionLayerDataOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  const scores = scoreExpressionCells(cells, genes, scoreMode)
  const scoreDenominator = expressionScoreDenominator(scores, options.scaleMax)

  const layerData = cells.map((cell, index): OverviewCellDatum => {
    const score = scores[index] ?? 0
    const intensity = Math.sqrt(Math.max(score, 0) / scoreDenominator)
    const radiusMicrometers = cellAreaToRadiusMicrometers(cell.cellArea)

    return {
      id: cell.id,
      position: [cell.position.x, -cell.position.y, 0],
      radiusPixels: 4 + intensity * 6,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: geneExpressionColor(colorScale, intensity),
      expressionCount: score,
      expressionGenes: genes,
      ...(cell.transcriptCount === undefined
        ? {}
        : { transcriptCount: cell.transcriptCount }),
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
    }
  })

  return styleGeneExpressionCellsByScale(layerData, colorScale, options)
}

export function styleGeneExpressionCellsByScale(
  cells: readonly OverviewCellDatum[],
  colorScale: GeneExpressionColorScale,
  options: GeneExpressionLayerDataOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const scoreDenominator = expressionScoreDenominator(
    cells.map((cell) => cell.expressionCount ?? 0),
    options.scaleMax,
  )

  return cells.map((cell) => {
    const intensity = Math.sqrt(Math.max(cell.expressionCount ?? 0, 0) / scoreDenominator)

    return {
      ...cell,
      fillColor: geneExpressionColor(colorScale, intensity),
    }
  })
}

export function geneExpressionScoreDomainMax(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  scoreMode: GeneExpressionScoreMode,
): number {
  return maxExpressionScore(scoreExpressionCells(cells, genes, scoreMode))
}

export function isGeneExpressionColorScale(
  value: string,
): value is GeneExpressionColorScale {
  return GENE_EXPRESSION_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

export function isGeneExpressionScoreMode(
  value: string,
): value is GeneExpressionScoreMode {
  return GENE_EXPRESSION_SCORE_MODE_OPTIONS.some((option) => option.id === value)
}

function scoreExpressionCells(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  scoreMode: GeneExpressionScoreMode,
): readonly number[] {
  const geneCount = Math.max(genes.length, 1)

  if (scoreMode === 'sum') {
    return cells.map((cell) => cell.count)
  }

  const meanScores = cells.map((cell) => cell.count / geneCount)

  if (scoreMode === 'mean') {
    return meanScores
  }

  let total = 0

  for (const score of meanScores) {
    total += score
  }

  const mean = total / meanScores.length
  let squaredDistanceTotal = 0

  for (const score of meanScores) {
    squaredDistanceTotal += (score - mean) ** 2
  }

  const standardDeviation = Math.sqrt(squaredDistanceTotal / meanScores.length)

  if (standardDeviation === 0) {
    return meanScores.map(() => 0)
  }

  return meanScores.map((score) => (score - mean) / standardDeviation)
}

function expressionScoreDenominator(
  scores: readonly number[],
  scaleMax: number | undefined,
): number {
  const maxScore =
    scaleMax === undefined || scaleMax <= 0 ? maxExpressionScore(scores) : scaleMax

  return maxScore > 0 ? maxScore : 1
}

function maxExpressionScore(scores: readonly number[]): number {
  let maxScore = 0

  for (const score of scores) {
    maxScore = Math.max(maxScore, score)
  }

  return maxScore
}

function geneExpressionColor(
  colorScale: GeneExpressionColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = GENE_EXPRESSION_COLOR_STOPS[colorScale]
  const normalizedIntensity = Math.min(1, Math.max(0, intensity))
  const startStop = normalizedIntensity <= 0.5 ? lowStop : middleStop
  const endStop = normalizedIntensity <= 0.5 ? middleStop : highStop
  const t =
    normalizedIntensity <= 0.5 ? normalizedIntensity * 2 : (normalizedIntensity - 0.5) * 2

  return [
    interpolateColorChannel(startStop[0], endStop[0], t),
    interpolateColorChannel(startStop[1], endStop[1], t),
    interpolateColorChannel(startStop[2], endStop[2], t),
    interpolateColorChannel(startStop[3], endStop[3], t),
  ]
}

function interpolateColorChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t)
}

function cellAreaToRadiusMicrometers(cellArea: number | undefined): number | undefined {
  if (cellArea === undefined || !Number.isFinite(cellArea) || cellArea <= 0) {
    return undefined
  }

  return Math.sqrt(cellArea / Math.PI)
}

export function boundaryElementsToLayerData(
  elements: readonly SpatialElement[],
): readonly CellBoundaryDatum[] {
  const cells: CellBoundaryDatum[] = []

  for (const element of elements) {
    if (element.geometry.kind !== 'polygon') {
      continue
    }

    const ring = element.geometry.rings[0]

    if (ring === undefined || ring.length < 3) {
      continue
    }

    cells.push({
      id: element.id,
      polygon: ring.map((point) => [point.x, -point.y, 0]),
      fillColor: [32, 102, 83, 34],
      lineColor: [246, 242, 232, 210],
    })
  }

  return cells
}

export function styleCellBoundariesByCells(
  boundaries: readonly CellBoundaryDatum[],
  cells: readonly OverviewCellDatum[],
  colorLookup: CellColorLookup | null = null,
): readonly CellBoundaryDatum[] {
  if (boundaries.length === 0 || cells.length === 0) {
    return boundaries
  }

  const cellById = new Map<string, OverviewCellDatum>()

  for (const cell of cells) {
    cellById.set(cell.id, cell)
  }

  return boundaries.map((boundary) => {
    const cell = cellById.get(boundary.id)

    if (cell === undefined) {
      return boundary
    }

    const color = overviewCellColor(cell, colorLookup)

    return {
      ...boundary,
      fillColor: boundaryFillColor(color),
      lineColor: boundaryLineColor(color),
    }
  })
}

export function expressionCellsToBoundaryLayerData(
  boundaries: readonly CellBoundaryDatum[],
  expressionCells: readonly OverviewCellDatum[],
): readonly CellBoundaryDatum[] {
  if (boundaries.length === 0 || expressionCells.length === 0) {
    return []
  }

  const expressionByCellId = new Map<string, OverviewCellDatum>()

  for (const cell of expressionCells) {
    expressionByCellId.set(cell.id, cell)
  }

  const expressionBoundaries: CellBoundaryDatum[] = []

  for (const boundary of boundaries) {
    const expressionCell = expressionByCellId.get(boundary.id)

    if (expressionCell === undefined) {
      continue
    }

    expressionBoundaries.push({
      ...boundary,
      fillColor: expressionCell.fillColor,
      lineColor: [255, 253, 247, 210],
    })
  }

  return expressionBoundaries
}

function boundaryFillColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(88, Math.max(28, color[3] ?? 64)),
  ]
}

function boundaryLineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(235, Math.max(160, color[3] ?? 210)),
  ]
}

export function overviewCellColor(
  cell: OverviewCellDatum,
  lookup: CellColorLookup | null = null,
): Color {
  if (lookup === null) {
    return cell.fillColor
  }

  return lookup.colorByCellId.get(cell.id) ?? lookup.fallbackColor
}

function getOverviewCellPosition(cell: OverviewCellDatum): Position {
  return cell.position
}

function getOverviewCellRadius(cell: OverviewCellDatum): number {
  return cell.radiusMicrometers ?? cell.radiusPixels
}

function getOverviewCellBaseOutlineColor(cell: OverviewCellDatum): Color {
  return overviewCellOutlineColor(cell.fillColor)
}

function getOverviewCellLineWidth(): number {
  return OVERVIEW_CELL_LINE_WIDTH
}

function overviewCellOutlineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(42, Math.max(10, Math.round((color[3] ?? 210) * 0.18))),
  ]
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
