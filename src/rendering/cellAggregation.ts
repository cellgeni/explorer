import { scaleFromZoom } from '../data/coords'
import type { BBox } from '../data/coords'
import type { OverviewCellDatum, OverviewViewState } from './deckLayers'

export const OVERVIEW_AGGREGATION_TARGET_PIXELS = 10
export const OVERVIEW_AGGREGATION_INDIVIDUAL_MICROMETERS = 12
export const EXPRESSION_AGGREGATION_BIN_MICROMETERS = 220
export const EXPRESSION_AGGREGATION_EXACT_ZOOM = -0.25
export const EXPRESSION_AGGREGATION_EXACT_CELL_LIMIT = 800

export interface OverviewAggregationOptions {
  readonly bbox?: BBox
  readonly targetPixels?: number
  readonly individualMicrometers?: number
}

interface CellBin {
  readonly key: string
  count: number
  sumX: number
  sumY: number
  maxRadiusPixels: number
  maxRadiusMicrometers: number | undefined
  maxAlpha: number
  sumRed: number
  sumGreen: number
  sumBlue: number
  maxTranscriptCount: number | undefined
  maxCellArea: number | undefined
  sumExpressionCount: number
  hasExpressionCount: boolean
  expressionGenes: readonly string[] | undefined
}

interface ExpressionBin {
  readonly key: string
  readonly binX: number
  readonly binY: number
  count: number
  maxRadiusPixels: number
  maxRadiusMicrometers: number | undefined
  maxAlpha: number
  sumRed: number
  sumGreen: number
  sumBlue: number
  sumExpressionCount: number
  expressionGenes: readonly string[] | undefined
  maxTranscriptCount: number | undefined
  maxCellArea: number | undefined
}

export function aggregateOverviewCells(
  cells: readonly OverviewCellDatum[],
  viewState: OverviewViewState,
  options: OverviewAggregationOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  const candidates =
    options.bbox === undefined ? cells : overviewCellsInBbox(cells, options.bbox)

  if (candidates.length === 0) {
    return []
  }

  const binSize = overviewAggregationBinMicrometers(viewState, options)
  const individualThreshold =
    options.individualMicrometers ?? OVERVIEW_AGGREGATION_INDIVIDUAL_MICROMETERS

  if (binSize <= individualThreshold) {
    return candidates
  }

  return aggregateCellsIntoBins(candidates, binSize)
}

export function aggregateExpressionCells(
  cells: readonly OverviewCellDatum[],
  viewState: OverviewViewState,
  options: {
    readonly bbox?: BBox
    readonly binMicrometers?: number
    readonly exactZoom?: number
    readonly exactCellLimit?: number
  } = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  const candidates =
    options.bbox === undefined ? cells : overviewCellsInBbox(cells, options.bbox)

  if (candidates.length === 0) {
    return []
  }

  const exactZoom = options.exactZoom ?? EXPRESSION_AGGREGATION_EXACT_ZOOM
  const exactCellLimit = options.exactCellLimit ?? EXPRESSION_AGGREGATION_EXACT_CELL_LIMIT

  if (viewState.zoom >= exactZoom || candidates.length <= exactCellLimit) {
    return candidates
  }

  return aggregateExpressionCellsIntoBins(
    candidates,
    options.binMicrometers ?? EXPRESSION_AGGREGATION_BIN_MICROMETERS,
  )
}

export function overviewAggregationBinMicrometers(
  viewState: OverviewViewState,
  options: OverviewAggregationOptions = {},
): number {
  const targetPixels = Math.max(
    1,
    options.targetPixels ?? OVERVIEW_AGGREGATION_TARGET_PIXELS,
  )

  return targetPixels / scaleFromZoom(viewState.zoom)
}

export function overviewCellsInBbox(
  cells: readonly OverviewCellDatum[],
  bbox: BBox,
): readonly OverviewCellDatum[] {
  const visibleCells: OverviewCellDatum[] = []

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY

    if (x >= bbox.minX && x <= bbox.maxX && rawY >= bbox.minY && rawY <= bbox.maxY) {
      visibleCells.push(cell)
    }
  }

  return visibleCells
}

function aggregateCellsIntoBins(
  cells: readonly OverviewCellDatum[],
  binSize: number,
): readonly OverviewCellDatum[] {
  const bins = new Map<string, CellBin>()

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY
    const key = `${Math.floor(x / binSize)}:${Math.floor(rawY / binSize)}`
    const bin = bins.get(key)
    const alpha = readColorAlpha(cell)
    const red = readColorChannel(cell, 0)
    const green = readColorChannel(cell, 1)
    const blue = readColorChannel(cell, 2)

    if (bin === undefined) {
      bins.set(key, {
        key,
        count: 1,
        sumX: x,
        sumY: deckY,
        maxRadiusPixels: cell.radiusPixels,
        maxRadiusMicrometers: cell.radiusMicrometers,
        maxAlpha: alpha,
        sumRed: red,
        sumGreen: green,
        sumBlue: blue,
        maxTranscriptCount: cell.transcriptCount,
        maxCellArea: cell.cellArea,
        sumExpressionCount: cell.expressionCount ?? 0,
        hasExpressionCount: cell.expressionCount !== undefined,
        expressionGenes: cell.expressionGenes,
      })
      continue
    }

    bin.count += 1
    bin.sumX += x
    bin.sumY += deckY
    bin.maxRadiusPixels = Math.max(bin.maxRadiusPixels, cell.radiusPixels)
    bin.maxRadiusMicrometers = maxOptionalNumber(
      bin.maxRadiusMicrometers,
      cell.radiusMicrometers,
    )
    bin.maxAlpha = Math.max(bin.maxAlpha, alpha)
    bin.sumRed += red
    bin.sumGreen += green
    bin.sumBlue += blue
    bin.maxTranscriptCount = maxOptionalNumber(
      bin.maxTranscriptCount,
      cell.transcriptCount,
    )
    bin.maxCellArea = maxOptionalNumber(bin.maxCellArea, cell.cellArea)
    bin.sumExpressionCount += cell.expressionCount ?? 0
    bin.hasExpressionCount = bin.hasExpressionCount || cell.expressionCount !== undefined
    bin.expressionGenes ??= cell.expressionGenes
  }

  const aggregatedCells: OverviewCellDatum[] = []

  for (const bin of bins.values()) {
    const countScale = Math.sqrt(bin.count)
    aggregatedCells.push({
      id: `cell-bin:${bin.key}`,
      position: [bin.sumX / bin.count, bin.sumY / bin.count, 0],
      radiusPixels: Math.min(10, Math.max(bin.maxRadiusPixels, 2 + countScale)),
      ...(bin.maxRadiusMicrometers === undefined
        ? {}
        : { radiusMicrometers: bin.maxRadiusMicrometers }),
      fillColor: [
        Math.round(bin.sumRed / bin.count),
        Math.round(bin.sumGreen / bin.count),
        Math.round(bin.sumBlue / bin.count),
        Math.min(235, bin.maxAlpha + bin.count * 2),
      ],
      cellCount: bin.count,
      ...(bin.maxTranscriptCount === undefined
        ? {}
        : { transcriptCount: bin.maxTranscriptCount }),
      ...(bin.maxCellArea === undefined ? {} : { cellArea: bin.maxCellArea }),
      ...(bin.hasExpressionCount ? { expressionCount: bin.sumExpressionCount } : {}),
      ...(bin.expressionGenes === undefined
        ? {}
        : { expressionGenes: bin.expressionGenes }),
    })
  }

  return aggregatedCells
}

function aggregateExpressionCellsIntoBins(
  cells: readonly OverviewCellDatum[],
  binSize: number,
): readonly OverviewCellDatum[] {
  const bins = new Map<string, ExpressionBin>()

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY
    const binX = Math.floor(x / binSize)
    const binY = Math.floor(rawY / binSize)
    const key = `${binX}:${binY}`
    const expressionCount = cell.expressionCount ?? 0
    const bin = bins.get(key)
    const alpha = readColorAlpha(cell)
    const red = readColorChannel(cell, 0)
    const green = readColorChannel(cell, 1)
    const blue = readColorChannel(cell, 2)

    if (bin === undefined) {
      bins.set(key, {
        key,
        binX,
        binY,
        count: 1,
        maxRadiusPixels: cell.radiusPixels,
        maxRadiusMicrometers: cell.radiusMicrometers,
        maxAlpha: alpha,
        sumRed: red,
        sumGreen: green,
        sumBlue: blue,
        sumExpressionCount: expressionCount,
        expressionGenes: cell.expressionGenes,
        maxTranscriptCount: cell.transcriptCount,
        maxCellArea: cell.cellArea,
      })
      continue
    }

    bin.count += 1
    bin.maxRadiusPixels = Math.max(bin.maxRadiusPixels, cell.radiusPixels)
    bin.maxRadiusMicrometers = maxOptionalNumber(
      bin.maxRadiusMicrometers,
      cell.radiusMicrometers,
    )
    bin.maxAlpha = Math.max(bin.maxAlpha, alpha)
    bin.sumRed += red
    bin.sumGreen += green
    bin.sumBlue += blue
    bin.sumExpressionCount += expressionCount
    bin.expressionGenes ??= cell.expressionGenes
    bin.maxTranscriptCount = maxOptionalNumber(
      bin.maxTranscriptCount,
      cell.transcriptCount,
    )
    bin.maxCellArea = maxOptionalNumber(bin.maxCellArea, cell.cellArea)
  }

  const aggregatedCells: OverviewCellDatum[] = []

  for (const bin of bins.values()) {
    const countScale = Math.sqrt(bin.count)
    const positionX = (bin.binX + 0.5) * binSize
    const positionY = -(bin.binY + 0.5) * binSize

    aggregatedCells.push({
      id: `expression-bin:${bin.key}`,
      position: [positionX, positionY, 0],
      radiusPixels: Math.min(18, Math.max(bin.maxRadiusPixels, 4 + countScale * 1.7)),
      ...(bin.maxRadiusMicrometers === undefined
        ? {}
        : { radiusMicrometers: bin.maxRadiusMicrometers }),
      fillColor: [
        Math.round(bin.sumRed / bin.count),
        Math.round(bin.sumGreen / bin.count),
        Math.round(bin.sumBlue / bin.count),
        Math.min(245, bin.maxAlpha + bin.count * 2),
      ],
      cellCount: bin.count,
      expressionCount: bin.sumExpressionCount,
      ...(bin.expressionGenes === undefined
        ? {}
        : { expressionGenes: bin.expressionGenes }),
      ...(bin.maxTranscriptCount === undefined
        ? {}
        : { transcriptCount: bin.maxTranscriptCount }),
      ...(bin.maxCellArea === undefined ? {} : { cellArea: bin.maxCellArea }),
    })
  }

  return aggregatedCells
}

function readColorChannel(cell: OverviewCellDatum, channel: 0 | 1 | 2): number {
  const value = cell.fillColor[channel]

  return typeof value === 'number' ? value : 0
}

function readColorAlpha(cell: OverviewCellDatum): number {
  const alpha = cell.fillColor[3]

  return typeof alpha === 'number' ? alpha : 220
}

function maxOptionalNumber(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined) {
    return second
  }

  if (second === undefined) {
    return first
  }

  return Math.max(first, second)
}
