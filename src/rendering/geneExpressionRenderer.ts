import type { Position } from '@deck.gl/core'
import type { GeneExpressionCell } from '../datasets/xeniumDataset'
import {
  boundaryLineColor,
  cellAreaToRadiusMicrometers,
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  geneExpressionColor,
  GENE_EXPRESSION_ZERO_FILL_COLOR,
} from './deckLayerColors'
import type {
  GeneExpressionBinStyle,
  GeneExpressionCellStyleIndex,
  GeneExpressionCellStyleOptions,
  GeneExpressionColorScale,
  GeneExpressionLayerDataOptions,
  GeneExpressionScoreMode,
  GridCellDatum,
  OverviewCellDatum,
} from './deckLayerTypes'

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
      ...(cell.segmentationMethod === undefined
        ? {}
        : { segmentationMethod: cell.segmentationMethod }),
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

export function styleCellsByGeneExpression(
  cells: readonly OverviewCellDatum[],
  expressionSource: readonly OverviewCellDatum[] | GeneExpressionCellStyleIndex,
  options: GeneExpressionCellStyleOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const styleIndex = isOverviewCellDatumArray(expressionSource)
    ? createGeneExpressionCellStyleIndex(expressionSource, options)
    : expressionSource
  const styleUnmatchedCells = options.styleUnmatchedCells ?? false

  if (
    styleIndex.expressionByCellId.size === 0 &&
    (styleIndex.expressionByBinKey?.size ?? 0) === 0 &&
    !styleUnmatchedCells
  ) {
    return cells
  }

  let hasExpressionStyle = false
  const styledCells = cells.map((cell) => {
    const expressionCell =
      styleIndex.expressionByCellId.get(cell.id) ??
      (styleIndex.expressionByBinKey === undefined ||
      styleIndex.binMicrometers === undefined
        ? undefined
        : styleIndex.expressionByBinKey.get(
            positionBinKey(cell.position, styleIndex.binMicrometers),
          ))

    if (expressionCell === undefined) {
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
      fillColor: expressionCell.fillColor,
      ...(expressionCell.expressionCount === undefined
        ? {}
        : { expressionCount: expressionCell.expressionCount }),
      ...(expressionCell.expressionGenes === undefined
        ? {}
        : { expressionGenes: expressionCell.expressionGenes }),
    }
  })

  return hasExpressionStyle ? styledCells : cells
}

export function styleGridCellsByGeneExpression(
  cells: readonly GridCellDatum[],
  expressionSource: readonly OverviewCellDatum[] | GeneExpressionCellStyleIndex,
  options: GeneExpressionCellStyleOptions = {},
): readonly GridCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const styleIndex = isOverviewCellDatumArray(expressionSource)
    ? createGeneExpressionCellStyleIndex(expressionSource, options)
    : expressionSource
  const styleUnmatchedCells = options.styleUnmatchedCells ?? false

  if (styleIndex.expressionByCellId.size === 0 && !styleUnmatchedCells) {
    return cells
  }

  let hasExpressionStyle = false
  const styledCells = cells.map((cell) => {
    const expressionCell = styleIndex.expressionByCellId.get(cell.id)

    if (expressionCell === undefined) {
      if (!styleUnmatchedCells) {
        return cell
      }

      hasExpressionStyle = true

      return {
        ...cell,
        fillColor: GENE_EXPRESSION_ZERO_FILL_COLOR,
        lineColor: boundaryLineColor(GENE_EXPRESSION_ZERO_FILL_COLOR),
        expressionCount: 0,
      }
    }

    hasExpressionStyle = true
    return {
      ...cell,
      fillColor: expressionCell.fillColor,
      lineColor: boundaryLineColor(expressionCell.fillColor),
      ...(expressionCell.expressionCount === undefined
        ? {}
        : { expressionCount: expressionCell.expressionCount }),
      ...(expressionCell.expressionGenes === undefined
        ? {}
        : { expressionGenes: expressionCell.expressionGenes }),
    }
  })

  return hasExpressionStyle ? styledCells : cells
}

export function createGeneExpressionCellStyleIndex(
  expressionCells: readonly OverviewCellDatum[],
  options: GeneExpressionCellStyleOptions = {},
): GeneExpressionCellStyleIndex {
  const expressionByCellId = new Map<string, OverviewCellDatum>()
  const binMicrometers = normalizeGeneExpressionBinMicrometers(options.binMicrometers)

  for (const cell of expressionCells) {
    expressionByCellId.set(cell.id, cell)
  }

  if (binMicrometers === undefined) {
    return { expressionByCellId }
  }

  return {
    expressionByCellId,
    expressionByBinKey: expressionBinStylesByKey(expressionCells, binMicrometers),
    binMicrometers,
  }
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

function isOverviewCellDatumArray(
  value: readonly OverviewCellDatum[] | GeneExpressionCellStyleIndex,
): value is readonly OverviewCellDatum[] {
  return Array.isArray(value)
}

function expressionBinStylesByKey(
  expressionCells: readonly OverviewCellDatum[],
  binMicrometers: number,
): ReadonlyMap<string, OverviewCellDatum> {
  const bins = new Map<string, GeneExpressionBinStyle>()

  for (const cell of expressionCells) {
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
  const rawY = -deckY

  return `${Math.floor(x / binMicrometers)}:${Math.floor(rawY / binMicrometers)}`
}

function normalizeGeneExpressionBinMicrometers(
  binMicrometers: number | undefined,
): number | undefined {
  if (binMicrometers === undefined || !Number.isFinite(binMicrometers)) {
    return undefined
  }

  return binMicrometers > 0 ? binMicrometers : undefined
}
