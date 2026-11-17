import { formatCsv } from '../../utils/csv'
import { slug } from '../../utils/slug'
import type { PlotGene, PlotPaint } from './plotModel'
import {
  plotGroupMean,
  plotGroupPercentExpressing,
  type PlotDistribution,
  type PlotScale,
} from './plotStats'
import type { PlotGroup } from './plotsPanelModel'

// Export SVG, PNG and CSV (plan 22-D10, 22-H). The SVG is written from the
// plot's model with its colours and font written out, so the file looks the
// same outside the app, and the PNG is that SVG drawn at twice its size. The
// CSV holds the numbers behind every plot.

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
    axis: { stroke: colours.muted },
    mark: { fill: colours.text, stroke: colours.text },
    surface: { fill: colours.background, stroke: colours.background },
    background: colours.background,
  }
}

// One row per group and gene, on the plot's scale (`values`). The mean,
// median and quartiles count every cell of the group, zeros included; the
// `_expressing` columns count the cells above 0, as the violin does with
// Include zeros off.
export function plotStatsCsv({
  setLabel,
  groups,
  genes,
  scale,
  valueLabel,
}: {
  readonly setLabel: string | null
  readonly groups: readonly Pick<PlotGroup, 'label' | 'kind'>[]
  readonly genes: readonly PlotGene[]
  readonly scale: PlotScale
  readonly valueLabel: string
}): string {
  const rows: string[][] = [
    [
      'set',
      'group',
      'group_kind',
      'gene',
      'values',
      'cells',
      'cells_expressing',
      'percent_expressing',
      'mean',
      'median',
      'q1',
      'q3',
      'min',
      'max',
      'median_expressing',
      'q1_expressing',
      'q3_expressing',
    ],
  ]
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : csvNumber(value)

  for (const { gene, stats } of genes) {
    if (stats === null) continue
    const distributions = stats.distributions[scale]

    groups.forEach((group, index) => {
      const groupStats = stats.groups[index]
      if (groupStats === undefined) return
      const every: PlotDistribution | null = distributions?.all[index] ?? null
      const expressing: PlotDistribution | null = distributions?.expressing[index] ?? null
      rows.push([
        group.kind === 'selection' ? '' : (setLabel ?? ''),
        group.label,
        group.kind,
        gene,
        valueLabel,
        String(groupStats.cells),
        String(groupStats.expressing),
        number(plotGroupPercentExpressing(groupStats)),
        number(plotGroupMean(groupStats, scale)),
        number(every?.median),
        number(every?.q1),
        number(every?.q3),
        number(every?.min),
        number(every?.max),
        number(expressing?.median),
        number(expressing?.q1),
        number(expressing?.q3),
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

// The SVG drawn on a canvas at `scale` times its size, as a PNG. The SVG
// holds no external images or fonts, so the canvas can be read.
export async function svgPngBlob(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.width = width
    image.height = height
    image.src = url
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('This browser cannot draw the plot as a PNG.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('The PNG could not be written.'))
        else resolve(blob)
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
