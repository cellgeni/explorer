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
}

export function createCellPointLayer(
  cells: readonly OverviewCellDatum[],
  options: CellPointLayerOptions,
): ScatterplotLayer<OverviewCellDatum> {
  return new ScatterplotLayer<OverviewCellDatum>({
    id: 'cells-overview-scatter',
    data: cells,
    pickable: true,
    radiusUnits: 'common',
    radiusMinPixels: 0.12,
    radiusMaxPixels: 24,
    stroked: true,
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
    radiusMaxPixels: 28,
    stroked: true,
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

export function hasGeneExpressionStyle(cell: OverviewCellDatum): boolean {
  return cell.expressionCount !== undefined || cell.expressionGenes !== undefined
}
