import type { DotPlotInput } from '../features/plots/dotPlot'
import { exportPlotPaint } from '../features/plots/plotExport'
import {
  PlotStatsStore,
  type PlotGeneStats,
  type PlotGroupsInput,
} from '../features/plots/plotStats'

// Plot statistics for tests, made by the plot worker's store from a gene's
// stored values, so they hold quartiles and densities as the panel's do.
export function plotGeneStatsFor(
  gene: string,
  rowIds: readonly string[],
  groups: PlotGroupsInput,
  entries: readonly (readonly [row: number, value: number])[],
): PlotGeneStats {
  const store = new PlotStatsStore()
  store.setRows(rowIds)
  store.setGroups(groups)
  store.addGene({
    gene,
    rows: new Uint32Array(entries.map(([row]) => row)),
    values: new Float32Array(entries.map(([, value]) => value)),
  })

  const stats = store.stats([gene]).stats[0]
  if (stats === undefined) throw new Error(`No statistics for ${gene}.`)
  return stats
}

// Rows 0–3 are the selection, ROI 1; rows 4–13 class A; class B is empty.
const ROW_IDS = Array.from({ length: 14 }, (_, row) => `cell-${row}`)
const GROUPS = {
  selection: ROW_IDS.slice(0, 4),
  classes: [ROW_IDS.slice(4), []],
}

export const plotTestInput: DotPlotInput = {
  groups: [
    { id: 'selection', label: 'ROI 1', color: '#f0c84b', kind: 'selection' },
    { id: 'analysis:cluster:a', label: 'A', color: '#1f77b4', kind: 'class' },
    { id: 'analysis:cluster:b', label: 'B & <C>', color: '#ff7f0e', kind: 'class' },
  ],
  genes: [
    {
      gene: 'Actb',
      // ROI 1: 4, 4, 0, 0; A: 2 in five cells, 0 in five.
      stats: plotGeneStatsFor('Actb', ROW_IDS, GROUPS, [
        [0, 4],
        [1, 4],
        [4, 2],
        [5, 2],
        [6, 2],
        [7, 2],
        [8, 2],
      ]),
    },
    { gene: 'Gad1', stats: plotGeneStatsFor('Gad1', ROW_IDS, GROUPS, [[4, 1]]) },
    { gene: 'Gapdh', stats: null },
  ],
  scale: 'stored',
  colour: 'shared',
  colorScale: 'viridis',
  valueLabel: 'counts',
  setLabel: 'cluster',
}

export const testExportPaint = exportPlotPaint({
  text: '#111111',
  muted: '#555555',
  rule: '#999999',
  background: '#ffffff',
  font: 'Avenir Next, sans-serif',
})
