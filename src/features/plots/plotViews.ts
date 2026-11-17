import { dotPlotSvg, meansPlotTable, type DotPlotModel } from './dotPlot'
import { heatmapSvg, type HeatmapModel } from './heatmap'
import type { PlotPaint, PlotTable } from './plotModel'
import type { SvgNode } from './svgMarkup'
import { violinPlotSvg, violinPlotTable, type ViolinPlotModel } from './violinPlot'

// The plot the panel shows (plan 22-D8), with what each kind draws and
// writes: its SVG, for the panel or a file, and the table of its numbers.

export type PlotView =
  | { readonly kind: 'dot'; readonly model: DotPlotModel }
  | { readonly kind: 'violin'; readonly model: ViolinPlotModel }
  | { readonly kind: 'heatmap'; readonly model: HeatmapModel }

export function plotViewSvg(view: PlotView, paint: PlotPaint, idPrefix: string): SvgNode {
  switch (view.kind) {
    case 'dot':
      return dotPlotSvg(view.model, paint, idPrefix)
    case 'violin':
      return violinPlotSvg(view.model, paint, idPrefix)
    case 'heatmap':
      return heatmapSvg(view.model, paint, idPrefix)
  }
}

export function plotViewTable(view: PlotView): PlotTable {
  return view.kind === 'violin' ? violinPlotTable(view.model) : meansPlotTable(view.model)
}

// The size an SVG tree gives itself.
export function svgSize(node: SvgNode): {
  readonly width: number
  readonly height: number
} {
  return {
    width: Number(node.attrs?.width ?? 0),
    height: Number(node.attrs?.height ?? 0),
  }
}
