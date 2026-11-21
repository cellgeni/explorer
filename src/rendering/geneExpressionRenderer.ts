import type { Color, Position } from '@deck.gl/core'
import type { GeneExpressionElement } from '../datasets/spatialDataset'
import { geneScoreSpread, type GeneScoreSpread } from '../features/genes/geneScaleRange'
import {
  boundaryLineColor,
  cellAreaToRadiusMicrometers,
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  geneExpressionColor,
  geneExpressionIntensity,
  GENE_EXPRESSION_ZERO_FILL_COLOR,
} from './deckLayerColors'
import type {
  GeneExpressionBinStyle,
  GeneExpressionElementStyleIndex,
  GeneExpressionElementStyleOptions,
  GeneExpressionColorScale,
  GeneExpressionLayerDataOptions,
  GeneExpressionScoreMode,
  GridCellDatum,
  OverviewCellDatum,
} from './deckLayerTypes'

export function geneExpressionElementsToLayerData(
  elements: readonly GeneExpressionElement[],
  genes: readonly string[],
  colorScale: GeneExpressionColorScale = DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  scoreMode: GeneExpressionScoreMode = DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  options: GeneExpressionLayerDataOptions = {},
): readonly OverviewCellDatum[] {
  if (elements.length === 0) {
    return []
  }

  const scores = geneExpressionScores(elements, genes, scoreMode, options.cellCount)
  const scaleMin = options.scaleMin ?? 0
  const scaleMax = expressionScoreScaleMax(scores, options.scaleMax)

  const layerData = elements.map((element, index): OverviewCellDatum => {
    const score = scores[index] ?? 0
    const intensity = geneExpressionIntensity(score, scaleMin, scaleMax)
    const radiusMicrometers = cellAreaToRadiusMicrometers(element.cellArea)

    return {
      id: element.id,
      position: [element.position.x, -element.position.y, 0],
      radiusPixels: 4 + intensity * 6,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: geneExpressionColor(colorScale, intensity),
      expressionCount: score,
      expressionGenes: genes,
      ...(element.transcriptCount === undefined
        ? {}
        : { transcriptCount: element.transcriptCount }),
      ...(element.cellArea === undefined ? {} : { cellArea: element.cellArea }),
      ...(element.binSizeMicrometers === undefined
        ? {}
        : { binSizeMicrometers: element.binSizeMicrometers }),
      ...(element.nucleusCount === undefined
        ? {}
        : { nucleusCount: element.nucleusCount }),
      ...(element.segmentationMethod === undefined
        ? {}
        : { segmentationMethod: element.segmentationMethod }),
    }
  })

  return styleGeneExpressionElementsByScale(layerData, colorScale, options)
}

export function styleGeneExpressionElementsByScale(
  elements: readonly OverviewCellDatum[],
  colorScale: GeneExpressionColorScale,
  options: GeneExpressionLayerDataOptions = {},
): readonly OverviewCellDatum[] {
  if (elements.length === 0) {
    return elements
  }

  const scaleMin = options.scaleMin ?? 0
  const scaleMax = expressionScoreScaleMax(
    elements.map((element) => element.expressionCount ?? 0),
    options.scaleMax,
  )

  return elements.map((element) => {
    const intensity = geneExpressionIntensity(
      element.expressionCount ?? 0,
      scaleMin,
      scaleMax,
    )

    return {
      ...element,
      fillColor: geneExpressionColor(colorScale, intensity),
    }
  })
}

// Elements scoring above zero, lowest first, so the highest draw on top where
// they overlap.
export function expressingElementsByScore(
  elements: readonly OverviewCellDatum[],
): readonly OverviewCellDatum[] {
  return elements
    .filter(
      (element) =>
        Number.isFinite(element.expressionCount) && (element.expressionCount ?? 0) > 0,
    )
    .sort((first, second) => (first.expressionCount ?? 0) - (second.expressionCount ?? 0))
}

// The top of the Gene scale for these cells, at `percentile` of their scores
// above 0, and the highest score among them. `cellCount` is as for
// geneExpressionScores.
export function geneExpressionScoreSpread(
  elements: readonly GeneExpressionElement[],
  genes: readonly string[],
  scoreMode: GeneExpressionScoreMode,
  percentile?: number,
  cellCount?: number,
): GeneScoreSpread {
  return geneScoreSpread(
    geneExpressionScores(elements, genes, scoreMode, cellCount),
    percentile,
  )
}

export function styleCellsByGeneExpression(
  cells: readonly OverviewCellDatum[],
  expressionSource: readonly OverviewCellDatum[] | GeneExpressionElementStyleIndex,
  options: GeneExpressionElementStyleOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const styleIndex = isOverviewCellDatumArray(expressionSource)
    ? createGeneExpressionElementStyleIndex(expressionSource, options)
    : expressionSource
  const styleUnmatchedCells = options.styleUnmatchedCells ?? false

  if (
    styleIndex.expressionByElementId.size === 0 &&
    (styleIndex.expressionByBinKey?.size ?? 0) === 0 &&
    !styleUnmatchedCells
  ) {
    return cells
  }

  let hasExpressionStyle = false
  const styledCells = cells.map((cell) => {
    const expressionElement = geneExpressionElementForCell(styleIndex, cell)

    if (expressionElement === undefined) {
      if (!styleUnmatchedCells) {
        return cell
      }

      hasExpressionStyle = true

      return {
        ...cell,
        fillColor: GENE_EXPRESSION_ZERO_FILL_COLOR,
        expressionCount: 0,
      }
    }

    hasExpressionStyle = true
    return {
      ...cell,
      fillColor: expressionElement.fillColor,
      ...(expressionElement.expressionCount === undefined
        ? {}
        : { expressionCount: expressionElement.expressionCount }),
      ...(expressionElement.expressionGenes === undefined
        ? {}
        : { expressionGenes: expressionElement.expressionGenes }),
    }
  })

  return hasExpressionStyle ? styledCells : cells
}

// The expression element that styles a cell: its own, or its bin's when the
// index is binned.
export function geneExpressionElementForCell(
  styleIndex: GeneExpressionElementStyleIndex,
  cell: OverviewCellDatum,
): OverviewCellDatum | undefined {
  return (
    styleIndex.expressionByElementId.get(cell.id) ??
    (styleIndex.expressionByBinKey === undefined ||
    styleIndex.binMicrometers === undefined
      ? undefined
      : styleIndex.expressionByBinKey.get(
          positionBinKey(cell.position, styleIndex.binMicrometers),
        ))
  )
}

export function hasGeneExpressionElementStyles(
  styleIndex: GeneExpressionElementStyleIndex,
): boolean {
  return (
    styleIndex.expressionByElementId.size > 0 ||
    (styleIndex.expressionByBinKey?.size ?? 0) > 0
  )
}

// One bin coloured and scored as the map shows it: by its own expression, or
// that of the coarser bin it falls in. Unmatched bins are left as they are,
// or scored 0 with `styleUnmatchedCells`.
export function styleGridCellByGeneExpression(
  cell: GridCellDatum,
  styleIndex: GeneExpressionElementStyleIndex,
  styleUnmatchedCells: boolean,
): GridCellDatum {
  const [x = 0, deckY = 0] = gridCellCenterPosition(cell)
  const style = gridCellExpressionStyle(
    styleIndex,
    cell.id,
    x,
    -deckY,
    styleUnmatchedCells,
  )

  return style === null ? cell : { ...cell, ...style }
}

export interface GridCellExpressionStyle {
  readonly fillColor: Color
  readonly lineColor: Color
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

// The colour and score of the bin `id` centred at (x, y) (data µm, y down):
// its own expression, or that of the coarser bin it falls in; zero for an
// unmatched bin with `styleUnmatchedCells`, otherwise null.
export function gridCellExpressionStyle(
  styleIndex: GeneExpressionElementStyleIndex,
  id: string,
  x: number,
  y: number,
  styleUnmatchedCells: boolean,
): GridCellExpressionStyle | null {
  const expressionElement =
    styleIndex.expressionByElementId.get(id) ??
    (styleIndex.expressionByBinKey === undefined ||
    styleIndex.binMicrometers === undefined
      ? undefined
      : styleIndex.expressionByBinKey.get(pointBinKey(x, y, styleIndex.binMicrometers)))

  if (expressionElement === undefined) {
    return styleUnmatchedCells ? ZERO_GRID_CELL_EXPRESSION_STYLE : null
  }

  return {
    fillColor: expressionElement.fillColor,
    lineColor: boundaryLineColor(expressionElement.fillColor),
    ...(expressionElement.expressionCount === undefined
      ? {}
      : { expressionCount: expressionElement.expressionCount }),
    ...(expressionElement.expressionGenes === undefined
      ? {}
      : { expressionGenes: expressionElement.expressionGenes }),
  }
}

const ZERO_GRID_CELL_EXPRESSION_STYLE: GridCellExpressionStyle = {
  fillColor: GENE_EXPRESSION_ZERO_FILL_COLOR,
  lineColor: boundaryLineColor(GENE_EXPRESSION_ZERO_FILL_COLOR),
  expressionCount: 0,
}

// A bin without the expression score it was styled with.
export function unscoredGridCell(cell: GridCellDatum): GridCellDatum {
  if (cell.expressionCount === undefined && cell.expressionGenes === undefined) {
    return cell
  }

  const { expressionCount: _count, expressionGenes: _genes, ...unscored } = cell
  void _count
  void _genes
  return unscored
}

export function createGeneExpressionElementStyleIndex(
  expressionElements: readonly OverviewCellDatum[],
  options: GeneExpressionElementStyleOptions = {},
): GeneExpressionElementStyleIndex {
  const expressionByElementId = new Map<string, OverviewCellDatum>()
  const binMicrometers = normalizeGeneExpressionBinMicrometers(
    expressionElementsBinMicrometers(expressionElements) ?? options.binMicrometers,
  )

  for (const cell of expressionElements) {
    expressionByElementId.set(cell.id, cell)
  }

  if (binMicrometers === undefined) {
    return { expressionByElementId }
  }

  return {
    expressionByElementId,
    expressionByBinKey: expressionBinStylesByKey(expressionElements, binMicrometers),
    binMicrometers,
  }
}

// Each element's score for the genes, as the map colours it: the sum of their
// counts, the mean, or the mean's z-score across the cells read. Those cells
// are `cellCount` (GeneExpressionBatch.cellCount), so the cells left out of
// `elements` count as 0, whichever platform left them out. A non-finite count
// (a stored NaN or infinity) keeps its value and is left out of the z-score's
// mean and SD, so the other cells still get a score.
export function geneExpressionScores(
  elements: readonly GeneExpressionElement[],
  genes: readonly string[],
  scoreMode: GeneExpressionScoreMode,
  cellCount = elements.length,
): readonly number[] {
  const geneCount = Math.max(genes.length, 1)

  if (scoreMode === 'sum') {
    return elements.map((element) => element.count)
  }

  const meanScores = elements.map((element) => element.count / geneCount)

  if (scoreMode === 'mean') {
    return meanScores
  }

  const zeroCellsLeftOut = Math.max(0, cellCount - meanScores.length)
  let counted = zeroCellsLeftOut
  let total = 0

  for (const score of meanScores) {
    if (!Number.isFinite(score)) continue
    counted += 1
    total += score
  }

  const mean = counted > 0 ? total / counted : 0
  let squaredDistanceTotal = zeroCellsLeftOut * mean ** 2

  for (const score of meanScores) {
    if (Number.isFinite(score)) squaredDistanceTotal += (score - mean) ** 2
  }

  const standardDeviation = counted > 0 ? Math.sqrt(squaredDistanceTotal / counted) : 0

  return meanScores.map((score) =>
    !Number.isFinite(score)
      ? score
      : standardDeviation === 0
        ? 0
        : (score - mean) / standardDeviation,
  )
}

// How many of these scores are a stored NaN or infinity, which the map draws
// as no expression and leaves out of the scale.
export function nonFiniteScoreCount(scores: Iterable<number | undefined>): number {
  let count = 0

  for (const score of scores) {
    if (score !== undefined && !Number.isFinite(score)) count += 1
  }

  return count
}

// The score at the top of the scale: the given one, or the highest score.
function expressionScoreScaleMax(
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
    if (Number.isFinite(score)) maxScore = Math.max(maxScore, score)
  }

  return maxScore
}

function isOverviewCellDatumArray(
  value: readonly OverviewCellDatum[] | GeneExpressionElementStyleIndex,
): value is readonly OverviewCellDatum[] {
  return Array.isArray(value)
}

function expressionBinStylesByKey(
  expressionElements: readonly OverviewCellDatum[],
  binMicrometers: number,
): ReadonlyMap<string, OverviewCellDatum> {
  const bins = new Map<string, GeneExpressionBinStyle>()

  for (const cell of expressionElements) {
    const key = positionBinKey(cell.position, binMicrometers)
    const bin = bins.get(key)
    const alpha = cell.fillColor[3] ?? 220
    const red = cell.fillColor[0] ?? 0
    const green = cell.fillColor[1] ?? 0
    const blue = cell.fillColor[2] ?? 0
    const expressionCount = cell.expressionCount ?? 0

    if (bin === undefined) {
      bins.set(key, {
        count: 1,
        maxAlpha: alpha,
        sumRed: red,
        sumGreen: green,
        sumBlue: blue,
        sumExpressionCount: expressionCount,
        hasExpressionCount: cell.expressionCount !== undefined,
        expressionGenes: cell.expressionGenes,
      })
      continue
    }

    bin.count += 1
    bin.maxAlpha = Math.max(bin.maxAlpha, alpha)
    bin.sumRed += red
    bin.sumGreen += green
    bin.sumBlue += blue
    bin.sumExpressionCount += expressionCount
    bin.hasExpressionCount = bin.hasExpressionCount || cell.expressionCount !== undefined
    bin.expressionGenes ??= cell.expressionGenes
  }

  const styles = new Map<string, OverviewCellDatum>()

  for (const [key, bin] of bins) {
    styles.set(key, {
      id: `expression-style-bin:${key}`,
      position: [0, 0, 0],
      radiusPixels: 0,
      fillColor: [
        Math.round(bin.sumRed / bin.count),
        Math.round(bin.sumGreen / bin.count),
        Math.round(bin.sumBlue / bin.count),
        Math.min(245, bin.maxAlpha + bin.count * 2),
      ],
      ...(bin.hasExpressionCount ? { expressionCount: bin.sumExpressionCount } : {}),
      ...(bin.expressionGenes === undefined
        ? {}
        : { expressionGenes: bin.expressionGenes }),
    })
  }

  return styles
}

function positionBinKey(position: Position, binMicrometers: number): string {
  const [x = 0, deckY = 0] = position

  return pointBinKey(x, -deckY, binMicrometers)
}

function pointBinKey(x: number, y: number, binMicrometers: number): string {
  return `${Math.floor(x / binMicrometers)}:${Math.floor(y / binMicrometers)}`
}

function gridCellCenterPosition(cell: GridCellDatum): Position {
  if (cell.polygon.length === 0) {
    return [0, 0, 0]
  }

  let xTotal = 0
  let yTotal = 0
  let zTotal = 0

  for (const position of cell.polygon) {
    xTotal += position[0] ?? 0
    yTotal += position[1] ?? 0
    zTotal += position[2] ?? 0
  }

  const count = cell.polygon.length

  return [xTotal / count, yTotal / count, zTotal / count]
}

function expressionElementsBinMicrometers(
  expressionElements: readonly OverviewCellDatum[],
): number | undefined {
  let binMicrometers: number | undefined

  for (const element of expressionElements) {
    const nextBinMicrometers = normalizeGeneExpressionBinMicrometers(
      element.binSizeMicrometers,
    )

    if (nextBinMicrometers === undefined) {
      continue
    }

    if (binMicrometers === undefined) {
      binMicrometers = nextBinMicrometers
      continue
    }

    if (binMicrometers !== nextBinMicrometers) {
      return undefined
    }
  }

  return binMicrometers
}

function normalizeGeneExpressionBinMicrometers(
  binMicrometers: number | undefined,
): number | undefined {
  if (binMicrometers === undefined || !Number.isFinite(binMicrometers)) {
    return undefined
  }

  return binMicrometers > 0 ? binMicrometers : undefined
}
