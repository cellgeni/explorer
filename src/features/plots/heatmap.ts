import { meansGridSvg, type MeansPlotModel } from './dotPlot'
import { plotMeans, plotSummary, type PlotMeansInput, type PlotPaint } from './plotModel'
import { DOT_PLOT_MAX_CLASSES } from './plotsPanelModel'
import type { SvgNode } from './svgMarkup'

// The group-mean heatmap (plan 22-G): groups down, genes across, each tile
// coloured by the group's mean on the Gene scale palette, shared across
// genes or per gene. The panel draws it on a canvas, which suits hundreds
// of classes; its file is the dot plot's grid with tiles for dots (22-D10).

export type HeatmapModel = MeansPlotModel

export function heatmapModel(input: PlotMeansInput): HeatmapModel {
  return {
    ...input,
    ...plotMeans(input),
    summary: plotSummary('Heatmap', input),
    description: `Colour is the mean ${input.valueLabel} over all the group's cells${input.colour === 'per-gene' ? ', scaled from each gene’s lowest to highest mean' : ''}. Groups with no cells are left blank.`,
  }
}

export const HEATMAP_COLUMN_WIDTH = 22

// Tiles as tall as the dot plot's rows, or shorter past the dot plot's
// classes, so hundreds of classes fit.
export function heatmapRowHeight(groupCount: number): number {
  return groupCount > DOT_PLOT_MAX_CLASSES + 1 ? 12 : 22
}

export function heatmapSvg(
  model: HeatmapModel,
  paint: PlotPaint,
  idPrefix: string,
): SvgNode {
  return meansGridSvg(model, paint, idPrefix, {
    mark: 'tile',
    columnWidth: HEATMAP_COLUMN_WIDTH,
    rowHeight: heatmapRowHeight(model.groups.length),
  })
}
