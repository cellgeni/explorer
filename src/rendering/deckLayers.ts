import type { Color, LayersList, Position } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type {
  TranscriptAggregateBin,
  TranscriptAggregateFeatureSummary,
  TranscriptCellAssignment,
  TranscriptPoint,
} from '../data/transcriptOverlay'
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
  readonly nucleusCount?: number
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

export interface TranscriptPointDatum {
  readonly id: string
  readonly transcriptId?: string
  readonly position: Position
  readonly featureName: string
  readonly fovName: string | null
  readonly cellId: string | null
  readonly cellAssignment?: TranscriptCellAssignment
  readonly qv: number
  readonly zLocation?: number
  readonly overlapsNucleus?: boolean
  readonly isGene?: boolean
  readonly nucleusDistance?: number
  readonly fillColor: Color
}

export interface TranscriptAggregateDatum {
  readonly id: string
  readonly position: Position
  readonly source?: 'cell-summary' | 'native-zarr'
  readonly glyphType?: 'density' | 'feature-circle'
  readonly level: number
  readonly binX: number
  readonly binY: number
  readonly count: number
  readonly radiusMicrometers: number
  readonly binSizeMicrometers?: number
  readonly binTotalCount?: number
  readonly selectedGeneCount?: number
  readonly omittedFeatureCount?: number
  readonly omittedTranscriptCount?: number
  readonly topFeatures?: readonly TranscriptAggregateFeatureSummary[]
  readonly featureName?: string
  readonly fovName?: string
  readonly fillColor: Color
}

export interface OverviewLayerOptions {
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly expressionBoundaryPolygons?: readonly CellBoundaryDatum[]
  readonly transcriptAggregateBins?: readonly TranscriptAggregateDatum[]
  readonly transcriptPoints?: readonly TranscriptPointDatum[]
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
}

export type GeneExpressionColorScale =
  | 'gold'
  | 'magma'
  | 'viridis'
  | 'plasma'
  | 'cividis'
  | 'teal'
  | 'rose'
  | 'glasbey'
export type GeneExpressionScoreMode = 'sum' | 'mean' | 'z-score'
export type TranscriptDensityColorScale =
  | 'thermal'
  | 'magma'
  | 'viridis'
  | 'cividis'
  | 'teal'
export type TranscriptPointColorMode = 'feature' | 'quality'

export interface GeneExpressionColorScaleOption {
  readonly id: GeneExpressionColorScale
  readonly label: string
}

export interface TranscriptDensityColorScaleOption {
  readonly id: TranscriptDensityColorScale
  readonly label: string
}

export interface TranscriptPointColorModeOption {
  readonly id: TranscriptPointColorMode
  readonly label: string
}

export interface GeneExpressionScoreModeOption {
  readonly id: GeneExpressionScoreMode
  readonly label: string
}

export interface GeneExpressionLayerDataOptions {
  readonly scaleMax?: number
}

export interface TranscriptAggregateLayerDataOptions {
  readonly scaleMax?: number
}

type ColorStop = readonly [number, number, number, number]

export const DEFAULT_GENE_EXPRESSION_COLOR_SCALE: GeneExpressionColorScale = 'plasma'
export const DEFAULT_GENE_EXPRESSION_SCORE_MODE: GeneExpressionScoreMode = 'sum'
export const DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE: TranscriptDensityColorScale =
  'thermal'
export const DEFAULT_TRANSCRIPT_POINT_COLOR_MODE: TranscriptPointColorMode = 'feature'

export const GENE_EXPRESSION_COLOR_SCALE_OPTIONS: readonly GeneExpressionColorScaleOption[] =
  [
    { id: 'gold', label: 'Gold' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
    { id: 'plasma', label: 'Plasma' },
    { id: 'cividis', label: 'Cividis' },
    { id: 'teal', label: 'Teal' },
    { id: 'rose', label: 'Rose' },
    { id: 'glasbey', label: 'Glasbey' },
  ]

export const GENE_EXPRESSION_SCORE_MODE_OPTIONS: readonly GeneExpressionScoreModeOption[] =
  [
    { id: 'sum', label: 'Sum' },
    { id: 'mean', label: 'Mean' },
    { id: 'z-score', label: 'Z-score' },
  ]

export const TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS: readonly TranscriptDensityColorScaleOption[] =
  [
    { id: 'thermal', label: 'Thermal' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
    { id: 'cividis', label: 'Cividis' },
    { id: 'teal', label: 'Teal' },
  ]

export const TRANSCRIPT_POINT_COLOR_MODE_OPTIONS: readonly TranscriptPointColorModeOption[] =
  [
    { id: 'feature', label: 'Feature' },
    { id: 'quality', label: 'QV' },
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
  plasma: [
    [13, 8, 135, 130],
    [203, 71, 119, 205],
    [240, 249, 33, 245],
  ],
  cividis: [
    [0, 32, 76, 130],
    [127, 124, 88, 205],
    [255, 233, 69, 245],
  ],
  teal: [
    [13, 59, 74, 130],
    [31, 151, 139, 205],
    [193, 230, 143, 245],
  ],
  rose: [
    [64, 18, 77, 130],
    [211, 69, 114, 205],
    [255, 188, 121, 245],
  ],
  glasbey: [
    [214, 0, 0, 130],
    [140, 59, 255, 205],
    [1, 135, 0, 245],
  ],
}

const TRANSCRIPT_DENSITY_COLOR_STOPS: Record<
  TranscriptDensityColorScale,
  readonly [ColorStop, ColorStop, ColorStop]
> = {
  thermal: [
    [29, 78, 86, 96],
    [239, 137, 80, 180],
    [255, 223, 91, 246],
  ],
  magma: [
    [0, 0, 4, 96],
    [183, 55, 121, 180],
    [252, 253, 191, 246],
  ],
  viridis: [
    [68, 1, 84, 96],
    [32, 144, 140, 180],
    [253, 231, 37, 246],
  ],
  cividis: [
    [0, 34, 78, 96],
    [125, 124, 82, 180],
    [255, 233, 69, 246],
  ],
  teal: [
    [13, 59, 74, 96],
    [37, 172, 166, 180],
    [198, 255, 221, 246],
  ],
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

export function createOverviewLayers(
  cells: readonly OverviewCellDatum[],
  boundaries: readonly CellBoundaryDatum[] = [],
  expressionCells: readonly OverviewCellDatum[] = [],
  options: OverviewLayerOptions = {},
): LayersList {
  const cellFillOpacity = normalizeLayerOpacity(
    options.cellFillOpacity ?? DEFAULT_LAYER_OPACITY,
  )
  const cellBoundaryOpacity = normalizeLayerOpacity(
    options.cellBoundaryOpacity ?? DEFAULT_LAYER_OPACITY,
  )
  const expressionBoundaryPolygons = options.expressionBoundaryPolygons ?? []
  const transcriptAggregateBins = options.transcriptAggregateBins ?? []
  const transcriptDensityBins = transcriptAggregateBins.filter(
    (bin) => bin.glyphType !== 'feature-circle',
  )
  const transcriptFeatureCircleBins = transcriptAggregateBins.filter(
    (bin) => bin.glyphType === 'feature-circle',
  )
  const transcriptPoints = options.transcriptPoints ?? []
  const hasExpressionPolygons = expressionBoundaryPolygons.length > 0
  const pointCells = cellsWithoutVisibleBoundaries(cells, boundaries)
  const cellPointLayer = new ScatterplotLayer<OverviewCellDatum>({
    id: 'cells-overview-scatter',
    data: pointCells,
    pickable: true,
    radiusUnits: 'common',
    radiusMinPixels: 0.12,
    radiusMaxPixels: 6,
    stroked: true,
    filled: false,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getPosition: (cell) => cell.position,
    getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
    getLineColor: (cell) =>
      colorWithOpacity(cellPointOutlineColor(cell.fillColor), cellBoundaryOpacity),
    getLineWidth: 1,
    updateTriggers: {
      getLineColor: [cellBoundaryOpacity],
    },
  })
  const layers: LayersList = []

  if (boundaries.length > 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'cell-boundary-polygons',
        data: boundaries,
        pickable: true,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => colorWithOpacity(cell.fillColor, cellFillOpacity),
        getLineColor: (cell) => colorWithOpacity(cell.lineColor, cellBoundaryOpacity),
        getLineWidth: 1,
        updateTriggers: {
          getFillColor: [cellFillOpacity],
          getLineColor: [cellBoundaryOpacity],
        },
      }),
    )
  }

  layers.push(cellPointLayer)

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
        filled: false,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1.5,
        opacity: 1,
        getPosition: (cell) => cell.position,
        getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
        getLineColor: (cell) =>
          colorWithOpacity(cellPointOutlineColor(cell.fillColor), cellBoundaryOpacity),
        getLineWidth: 1.5,
        updateTriggers: {
          getLineColor: [cellBoundaryOpacity],
        },
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
        opacity: 1,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => colorWithOpacity(cell.fillColor, cellFillOpacity),
        getLineColor: (cell) => colorWithOpacity(cell.lineColor, cellBoundaryOpacity),
        getLineWidth: 1,
        updateTriggers: {
          getFillColor: [cellFillOpacity],
          getLineColor: [cellBoundaryOpacity],
        },
      }),
    )
  }

  if (transcriptDensityBins.length > 0) {
    const transcriptOpacity = normalizeLayerOpacity(
      options.transcriptOpacity ?? DEFAULT_LAYER_OPACITY,
    )

    layers.push(
      new PolygonLayer<TranscriptAggregateDatum>({
        id: 'transcript-density-bins',
        data: transcriptDensityBins,
        pickable: true,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.25,
        getPolygon: transcriptDensitySquarePolygon,
        getFillColor: (bin) => colorWithOpacity(bin.fillColor, transcriptOpacity),
        getLineColor: () => colorWithOpacity([255, 253, 247, 120], transcriptOpacity),
        getLineWidth: 0.25,
        updateTriggers: {
          getFillColor: [transcriptOpacity],
          getLineColor: [transcriptOpacity],
        },
      }),
    )
  }

  if (transcriptFeatureCircleBins.length > 0) {
    const transcriptOpacity = normalizeLayerOpacity(
      options.transcriptOpacity ?? DEFAULT_LAYER_OPACITY,
    )

    layers.push(
      new ScatterplotLayer<TranscriptAggregateDatum>({
        id: 'transcript-feature-circles',
        data: transcriptFeatureCircleBins,
        pickable: true,
        radiusUnits: 'common',
        radiusMinPixels: 2,
        radiusMaxPixels: 18,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.75,
        getPosition: (bin) => bin.position,
        getRadius: (bin) => bin.radiusMicrometers,
        getFillColor: (bin) => colorWithOpacity(bin.fillColor, transcriptOpacity),
        getLineColor: () => colorWithOpacity([12, 12, 10, 160], transcriptOpacity),
        getLineWidth: 0.75,
        updateTriggers: {
          getFillColor: [transcriptOpacity],
          getLineColor: [transcriptOpacity],
        },
      }),
    )
  }

  if (transcriptPoints.length > 0) {
    const transcriptOpacity = normalizeLayerOpacity(
      options.transcriptOpacity ?? DEFAULT_LAYER_OPACITY,
    )
    const transcriptPointSize = Math.max(1, options.transcriptPointSize ?? 2)

    layers.push(
      new ScatterplotLayer<TranscriptPointDatum>({
        id: 'transcript-exact-points',
        data: transcriptPoints,
        pickable: true,
        radiusUnits: 'pixels',
        radiusMinPixels: 1,
        radiusMaxPixels: 8,
        stroked: false,
        filled: true,
        opacity: 1,
        getPosition: (transcript) => transcript.position,
        getRadius: transcriptPointSize,
        getFillColor: (transcript) =>
          colorWithOpacity(transcript.fillColor, transcriptOpacity),
        updateTriggers: {
          getFillColor: [transcriptOpacity],
          getRadius: [transcriptPointSize],
        },
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
      ...(cell.nucleusCount === undefined ? {} : { nucleusCount: cell.nucleusCount }),
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
      ...(cell.nucleusCount === undefined ? {} : { nucleusCount: cell.nucleusCount }),
    }
  })

  return styleGeneExpressionCellsByScale(layerData, colorScale, options)
}

export function transcriptPointsToLayerData(
  transcripts: readonly TranscriptPoint[],
  colorMode: TranscriptPointColorMode = DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
): readonly TranscriptPointDatum[] {
  return transcripts.map((transcript) => ({
    id: transcript.id,
    ...(transcript.transcriptId === undefined
      ? {}
      : { transcriptId: transcript.transcriptId }),
    position: [transcript.position.x, -transcript.position.y, 0],
    featureName: transcript.featureName,
    fovName: transcript.fovName,
    cellId: transcript.cellId,
    ...(transcript.cellAssignment === undefined
      ? {}
      : { cellAssignment: transcript.cellAssignment }),
    qv: transcript.qv,
    ...(transcript.zLocation === undefined ? {} : { zLocation: transcript.zLocation }),
    ...(transcript.overlapsNucleus === undefined
      ? {}
      : { overlapsNucleus: transcript.overlapsNucleus }),
    ...(transcript.isGene === undefined ? {} : { isGene: transcript.isGene }),
    ...(transcript.nucleusDistance === undefined
      ? {}
      : { nucleusDistance: transcript.nucleusDistance }),
    fillColor:
      colorMode === 'quality'
        ? transcriptQualityColor(transcript.qv)
        : transcriptFeatureColor(transcript.featureName),
  }))
}

export function transcriptAggregateBinsToLayerData(
  bins: readonly TranscriptAggregateBin[],
  colorScale: TranscriptDensityColorScale = DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  options: TranscriptAggregateLayerDataOptions = {},
): readonly TranscriptAggregateDatum[] {
  if (bins.length === 0) {
    return []
  }

  let localDensityMax = 1
  let localFeatureCircleMax = 1

  for (const bin of bins) {
    if (bin.glyphType === 'feature-circle') {
      localFeatureCircleMax = Math.max(localFeatureCircleMax, bin.count)
    } else {
      localDensityMax = Math.max(localDensityMax, bin.count)
    }
  }

  const densityScaleMax =
    options.scaleMax === undefined || options.scaleMax <= 0
      ? localDensityMax
      : options.scaleMax

  return bins.map((bin) => {
    const denominator =
      bin.glyphType === 'feature-circle' ? localFeatureCircleMax : densityScaleMax
    const intensity = Math.sqrt(Math.max(bin.count, 0) / Math.max(1, denominator))

    return {
      id: bin.id,
      position: [bin.position.x, -bin.position.y, 0],
      ...(bin.source === undefined ? {} : { source: bin.source }),
      ...(bin.glyphType === undefined ? {} : { glyphType: bin.glyphType }),
      level: bin.level,
      binX: bin.binX,
      binY: bin.binY,
      count: bin.count,
      radiusMicrometers: Math.max(4, bin.radiusMicrometers * (0.35 + intensity * 0.65)),
      ...(bin.binSizeMicrometers === undefined
        ? {}
        : { binSizeMicrometers: bin.binSizeMicrometers }),
      ...(bin.binTotalCount === undefined ? {} : { binTotalCount: bin.binTotalCount }),
      ...(bin.selectedGeneCount === undefined
        ? {}
        : { selectedGeneCount: bin.selectedGeneCount }),
      ...(bin.omittedFeatureCount === undefined
        ? {}
        : { omittedFeatureCount: bin.omittedFeatureCount }),
      ...(bin.omittedTranscriptCount === undefined
        ? {}
        : { omittedTranscriptCount: bin.omittedTranscriptCount }),
      ...(bin.topFeatures === undefined ? {} : { topFeatures: bin.topFeatures }),
      ...(bin.featureName === undefined ? {} : { featureName: bin.featureName }),
      ...(bin.fovName === undefined ? {} : { fovName: bin.fovName }),
      fillColor:
        bin.glyphType === 'feature-circle' && bin.featureName !== undefined
          ? transcriptFeatureColor(bin.featureName)
          : transcriptDensityColor(colorScale, intensity),
    }
  })
}

function transcriptDensitySquarePolygon(
  bin: TranscriptAggregateDatum,
): readonly Position[] {
  const [x = 0, y = 0, z = 0] = bin.position
  const halfSize = Math.max(1, (bin.binSizeMicrometers ?? bin.radiusMicrometers * 2) / 2)

  return [
    [x - halfSize, y + halfSize, z],
    [x + halfSize, y + halfSize, z],
    [x + halfSize, y - halfSize, z],
    [x - halfSize, y - halfSize, z],
  ]
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

export function isTranscriptDensityColorScale(
  value: string,
): value is TranscriptDensityColorScale {
  return TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

export function isTranscriptPointColorMode(
  value: string,
): value is TranscriptPointColorMode {
  return TRANSCRIPT_POINT_COLOR_MODE_OPTIONS.some((option) => option.id === value)
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
  return interpolateColorStops(lowStop, middleStop, highStop, intensity)
}

function transcriptDensityColor(
  colorScale: TranscriptDensityColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = TRANSCRIPT_DENSITY_COLOR_STOPS[colorScale]
  return interpolateColorStops(lowStop, middleStop, highStop, intensity)
}

function interpolateColorStops(
  lowStop: ColorStop,
  middleStop: ColorStop,
  highStop: ColorStop,
  intensity: number,
): Color {
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

    return {
      ...boundary,
      fillColor: boundaryFillColor(cell.fillColor),
      lineColor: boundaryLineColor(cell.fillColor),
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

function cellPointOutlineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(245, Math.max(160, color[3] ?? 210)),
  ]
}

function transcriptFeatureColor(featureName: string): Color {
  const palette: readonly Color[] = [
    [76, 211, 194, 235],
    [248, 197, 80, 235],
    [231, 97, 126, 235],
    [147, 197, 253, 235],
    [167, 139, 250, 235],
    [132, 204, 22, 235],
    [251, 146, 60, 235],
    [244, 114, 182, 235],
  ]
  let hash = 0

  for (let index = 0; index < featureName.length; index += 1) {
    hash = (hash * 31 + featureName.charCodeAt(index)) >>> 0
  }

  return palette[hash % palette.length] ?? [76, 211, 194, 235]
}

function transcriptQualityColor(qv: number): Color {
  const t = Math.max(0, Math.min(1, qv / 40))
  return interpolateColorStops(
    [127, 77, 35, 170],
    [221, 127, 75, 215],
    [58, 176, 145, 245],
    Math.sqrt(t),
  )
}

function colorWithOpacity(color: Color, opacity: number): Color {
  const normalizedOpacity = normalizeLayerOpacity(opacity)

  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.round((color[3] ?? 255) * normalizedOpacity),
  ]
}

function cellsWithoutVisibleBoundaries(
  cells: readonly OverviewCellDatum[],
  boundaries: readonly CellBoundaryDatum[],
): readonly OverviewCellDatum[] {
  if (cells.length === 0 || boundaries.length === 0) {
    return cells
  }

  const boundaryCellIds = new Set<string>()

  for (const boundary of boundaries) {
    boundaryCellIds.add(boundary.id)
  }

  if (boundaryCellIds.size === 0) {
    return cells
  }

  return cells.filter((cell) => !boundaryCellIds.has(cell.id))
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
