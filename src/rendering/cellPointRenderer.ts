import { ScatterplotLayer } from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import {
  cellAreaToRadiusMicrometers,
  cellPointOutlineColor,
  colorWithFillOpacity,
  colorWithOpacity,
  DEFAULT_OVERVIEW_CELL_FILL_RGB,
} from './deckLayerColors'
import type { OverviewCellDatum } from './deckLayerTypes'

export interface CellPointLayerOptions {
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly filled: boolean
  readonly pickable?: boolean
  readonly radiusMaxPixels?: number
}

const DEFAULT_CELL_RADIUS_MAX_PIXELS = 24
const DEFAULT_GENE_EXPRESSION_RADIUS_MAX_PIXELS = 28
const OVERVIEW_FULL_VIEW_RADIUS_MAX_PIXELS = 10
const GENE_EXPRESSION_FULL_VIEW_RADIUS_MAX_PIXELS = 12
const POINT_SIZE_ZOOM_EASE_START = 1
const POINT_SIZE_ZOOM_EASE_MID = 8
const POINT_SIZE_ZOOM_EASE_END = 10
const POINT_SIZE_ZOOM_MID_CLOSE_SCALE = 0.7

export function createCellPointLayer(
  cells: readonly OverviewCellDatum[],
  options: CellPointLayerOptions,
): ScatterplotLayer<OverviewCellDatum> {
  return new ScatterplotLayer<OverviewCellDatum>({
    id: 'cells-overview-scatter',
    data: cells,
    pickable: options.pickable ?? true,
    radiusUnits: 'common',
    radiusMinPixels: 0.12,
    radiusMaxPixels: options.radiusMaxPixels ?? DEFAULT_CELL_RADIUS_MAX_PIXELS,
    stroked: options.cellBoundaryOpacity > 0,
    filled: options.filled,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getPosition: (cell) => cell.position,
    getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
    getFillColor: (cell) => colorWithFillOpacity(cell.fillColor, options.cellFillOpacity),
    getLineColor: (cell) =>
      colorWithOpacity(
        cellPointOutlineColor(cell.fillColor),
        options.cellBoundaryOpacity,
      ),
    getLineWidth: 1,
    updateTriggers: {
      getFillColor: [options.cellFillOpacity],
      getLineColor: [options.cellBoundaryOpacity],
    },
  })
}

export function createGeneExpressionScatterLayer(
  cells: readonly OverviewCellDatum[],
  options: CellPointLayerOptions,
): ScatterplotLayer<OverviewCellDatum> | null {
  if (cells.length === 0) {
    return null
  }

  return new ScatterplotLayer<OverviewCellDatum>({
    id: 'gene-expression-scatter',
    data: cells,
    pickable: false,
    radiusUnits: 'common',
    radiusMinPixels: 1.5,
    radiusMaxPixels: options.radiusMaxPixels ?? DEFAULT_GENE_EXPRESSION_RADIUS_MAX_PIXELS,
    stroked: options.cellBoundaryOpacity > 0,
    filled: true,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getPosition: (cell) => cell.position,
    getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
    getFillColor: (cell) => colorWithFillOpacity(cell.fillColor, options.cellFillOpacity),
    getLineColor: (cell) =>
      colorWithOpacity(
        cellPointOutlineColor(cell.fillColor),
        options.cellBoundaryOpacity,
      ),
    getLineWidth: 1,
    updateTriggers: {
      getFillColor: [options.cellFillOpacity],
      getLineColor: [options.cellBoundaryOpacity],
    },
  })
}

export function overviewCellRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewScale = 1,
): number {
  return zoomResponsiveRadiusMaxPixels(
    zoomDelta,
    OVERVIEW_FULL_VIEW_RADIUS_MAX_PIXELS * normalizedFullViewScale(fullViewScale),
    DEFAULT_CELL_RADIUS_MAX_PIXELS,
  )
}

export function geneExpressionRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewScale = 1,
): number {
  return zoomResponsiveRadiusMaxPixels(
    zoomDelta,
    GENE_EXPRESSION_FULL_VIEW_RADIUS_MAX_PIXELS * normalizedFullViewScale(fullViewScale),
    DEFAULT_GENE_EXPRESSION_RADIUS_MAX_PIXELS,
  )
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
      fillColor: [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 150 + Math.round(intensity * 90)],
      transcriptCount: cell.transcriptCount,
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
      ...(cell.nucleusCount === undefined ? {} : { nucleusCount: cell.nucleusCount }),
      ...(cell.segmentationMethod === undefined
        ? {}
        : { segmentationMethod: cell.segmentationMethod }),
      ...(cell.metadata === undefined ? {} : { metadata: cell.metadata }),
    }
  })
}

export function cellsWithoutVisibleBoundaryIds(
  cells: readonly OverviewCellDatum[],
  boundaryCellIds: ReadonlySet<string>,
): readonly OverviewCellDatum[] {
  if (cells.length === 0 || boundaryCellIds.size === 0) {
    return cells
  }

  return cells.filter((cell) => !boundaryCellIds.has(cell.id))
}

function zoomResponsiveRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewPixels: number,
  closeViewPixels: number,
): number {
  if (zoomDelta === undefined || !Number.isFinite(zoomDelta)) {
    return closeViewPixels
  }

  const midViewPixels = Math.max(
    fullViewPixels,
    closeViewPixels * POINT_SIZE_ZOOM_MID_CLOSE_SCALE,
  )

  if (zoomDelta <= POINT_SIZE_ZOOM_EASE_MID) {
    const progress = smoothstep(
      clamp01(
        (zoomDelta - POINT_SIZE_ZOOM_EASE_START) /
          (POINT_SIZE_ZOOM_EASE_MID - POINT_SIZE_ZOOM_EASE_START),
      ),
    )

    return roundToTenth(fullViewPixels + (midViewPixels - fullViewPixels) * progress)
  }

  const progress = smoothstep(
    clamp01(
      (zoomDelta - POINT_SIZE_ZOOM_EASE_MID) /
        (POINT_SIZE_ZOOM_EASE_END - POINT_SIZE_ZOOM_EASE_MID),
    ),
  )

  return roundToTenth(midViewPixels + (closeViewPixels - midViewPixels) * progress)
}

function normalizedFullViewScale(scale: number): number {
  return Number.isFinite(scale) ? Math.max(0.1, scale) : 1
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

export function hasGeneExpressionStyle(cell: OverviewCellDatum): boolean {
  return cell.expressionCount !== undefined || cell.expressionGenes !== undefined
}
