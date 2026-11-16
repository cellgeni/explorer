import { formatCsv } from '../../utils/csv'
import { slug } from '../../utils/slug'
import type { DotPlotGene, PlotPaint } from './dotPlot'
import { plotGroupMean, plotGroupPercentExpressing } from './plotStats'
import type { PlotGroup } from './plotsPanelModel'

// Export SVG and Export CSV (plan 22-D10, 22-H). The SVG is written from
// the plot's model with its colours and font written out, so the file looks
// the same outside the app. The CSV holds the numbers behind every plot.

// The panel's theme, read from the CSS tokens once per export.
export function documentPlotPaint(root: Element = document.documentElement): PlotPaint {
  const styles = getComputedStyle(root)
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback
  const font = getComputedStyle(document.body).fontFamily.trim()

  return exportPlotPaint({
    text: token('--text-1', '#f0ede5'),
    muted: token('--text-3', '#a39e91'),
    rule: token('--border-strong', '#6e6b62'),
    background: token('--surface-1', '#161614'),
    font: font === '' ? 'system-ui, sans-serif' : font,
  })
}

export function exportPlotPaint(colours: {
  readonly text: string
  readonly muted: string
  readonly rule: string
  readonly background: string
  readonly font: string
}): PlotPaint {
  return {
    root: { 'font-family': colours.font },
    text: { fill: colours.text },
    muted: { fill: colours.muted },
    rule: { stroke: colours.rule, 'stroke-dasharray': '3 3' },
    background: colours.background,
  }
}

// One row per group and gene. Means are over every cell of the group, with
// zeros counted; mean_log1p is empty where a value is -1 or less.
export function plotStatsCsv({
  setLabel,
  groups,
  genes,
}: {
  readonly setLabel: string | null
  readonly groups: readonly Pick<PlotGroup, 'label' | 'kind'>[]
  readonly genes: readonly DotPlotGene[]
}): string {
  const rows: string[][] = [
    [
      'set',
      'group',
      'group_kind',
      'gene',
      'cells',
      'cells_expressing',
      'percent_expressing',
      'mean',
      'mean_log1p',
    ],
  ]

  for (const { gene, stats } of genes) {
    if (stats === null) continue

    groups.forEach((group, index) => {
      const groupStats = stats.groups[index]
      if (groupStats === undefined) return
      const percent = plotGroupPercentExpressing(groupStats)
      const mean = plotGroupMean(groupStats, 'stored')
      const meanLog1p = stats.negative ? null : plotGroupMean(groupStats, 'log1p')
      rows.push([
        group.kind === 'selection' ? '' : (setLabel ?? ''),
        group.label,
        group.kind,
        gene,
        String(groupStats.cells),
        String(groupStats.expressing),
        percent === null ? '' : csvNumber(percent),
        mean === null ? '' : csvNumber(mean),
        meanLog1p === null ? '' : csvNumber(meanLog1p),
      ])
    })
  }

  return `${formatCsv(rows)}\n`
}

function csvNumber(value: number): string {
  return String(Number(value.toPrecision(6)))
}

// `{dataset}-{plot}-{set}.{ext}`, each part slugged.
export function plotFileName(
  datasetUrl: string,
  plot: string,
  setLabel: string | null,
  extension: string,
): string {
  const parts = [datasetStem(datasetUrl), plot, ...(setLabel === null ? [] : [setLabel])]
  return `${parts.map(slug).join('-')}.${extension}`
}

// The URL's last path segment without its extension.
function datasetStem(url: string): string {
  const segment = urlLastSegment(url)
  const stem = segment.replace(/(\.[a-z0-9]+)+$/i, '')
  return stem === '' ? 'dataset' : stem
}

function urlLastSegment(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.host
  } catch {
    return url.split('/').filter(Boolean).at(-1) ?? url
  }
}
