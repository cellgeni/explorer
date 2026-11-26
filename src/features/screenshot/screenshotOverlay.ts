import type { AxesModel } from '../../components/viewerAxesModel'
import { AXIS_BAND_PIXELS } from '../../components/viewerAxesModel'
import {
  LEGEND_CATEGORY_LIMIT,
  type CategoryLegendSection,
  type ContinuousLegendSection,
  type PythonLegendSection,
  type ViewerLegendSection,
} from '../../components/viewerLegendTypes'
import type { ScaleBarModel } from '../../components/viewerMeasurements'
import type { ViewerSelectionOutline } from '../../components/viewerCoreTypes'
import { roiSelectionToScreenPath } from '../../components/viewerRoiInteraction'
import type { RoiSelection } from '../../data/roiSelection'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import type { ScreenshotSize } from './screenshotPlan'

// The marks over the map (plan 27, task E): the scale bar, the legend, the
// axes and the selections, as one SVG over the frame in CSS pixels. It is
// drawn on the PNG at its scale, so they are as sharp as the rest, and laid
// out as the screen lays them out. It holds no external fonts or images, so
// the canvas it is drawn on can still be read.

export type ScreenshotBackground = 'canvas' | 'white' | 'transparent'

export interface ScreenshotInclude {
  readonly scaleBar: boolean
  readonly legend: boolean
  readonly axes: boolean
  readonly selections: boolean
}

export interface ScreenshotSelectionPath {
  // In the frame's CSS pixels.
  readonly d: string
  // Null takes the selection colour.
  readonly color: string | null
  // A saved selection other than the card's is dashed (15.4-A).
  readonly saved: boolean
}

// The saved selections, dashed, then the card's own (`active`), as the
// screen draws them, in the frame's CSS pixels.
export function screenshotSelectionPaths(
  outlines: readonly ViewerSelectionOutline[],
  active: RoiSelection | null,
  activeColor: string | null,
  viewState: OverviewViewState,
  frame: ScreenshotSize,
): readonly ScreenshotSelectionPath[] {
  const paths: ScreenshotSelectionPath[] = []

  for (const outline of outlines) {
    if (outline.active) continue
    const d = roiSelectionToScreenPath(outline.selection, viewState, frame)
    if (d !== null) paths.push({ d, color: outline.color, saved: true })
  }

  if (active !== null) {
    const d = roiSelectionToScreenPath(active, viewState, frame)
    if (d !== null) paths.push({ d, color: activeColor, saved: false })
  }

  return paths
}

export interface ScreenshotOverlayModels {
  readonly scaleBar: ScaleBarModel | null
  readonly axes: AxesModel | null
  readonly legend: readonly ViewerLegendSection[]
  readonly selections: readonly ScreenshotSelectionPath[]
}

export interface ScreenshotOverlayPaint {
  // The fill under the map; null leaves it transparent.
  readonly background: string | null
  // The scale bar's and the legend's boxes.
  readonly box: string
  readonly border: string
  readonly swatchBorder: string
  readonly text: string
  readonly muted: string
  readonly axisBand: string
  // Under gradients, as the screen's canvas.
  readonly gradientBase: string
  readonly selection: string
  readonly shade: string
  readonly halo: string
  readonly font: string
}

export type MeasureText = (text: string, font: string) => number

const DARK = {
  canvas: '#000',
  box: '#161614',
  axisBand: 'rgb(12 12 11 / 0.78)',
  border: '#3a3934',
  swatchBorder: '#6e6b62',
  text: '#f0ede5',
  muted: '#c9c4b8',
  selection: '#f0c84b',
}

// D8: on White the boxes turn white with dark text.
const LIGHT = {
  box: '#ffffff',
  axisBand: 'rgb(255 255 255 / 0.78)',
  border: '#c9c6bd',
  swatchBorder: '#8a867c',
  text: '#1b1a17',
  muted: '#4c4943',
}

const SHADE = 'rgb(0 0 0 / 0.7)'
const HALO = 'rgb(255 253 247 / 0.55)'
const FALLBACK_FONT = "'Avenir Next', 'DIN Alternate', 'Segoe UI', system-ui, sans-serif"

// The theme's colours for a background, read from the CSS tokens where the
// document has them.
export function screenshotOverlayPaint(
  background: ScreenshotBackground,
  root: Element | null = typeof document === 'undefined'
    ? null
    : document.documentElement,
): ScreenshotOverlayPaint {
  const styles = root === null ? null : getComputedStyle(root)
  const token = (name: string, fallback: string) =>
    styles?.getPropertyValue(name).trim() || fallback
  const bodyFont =
    typeof document === 'undefined' ? '' : getComputedStyle(document.body).fontFamily
  const dark = background !== 'white'

  return {
    background:
      background === 'canvas'
        ? token('--canvas', DARK.canvas)
        : background === 'white'
          ? '#ffffff'
          : null,
    box: dark ? token('--surface-1', DARK.box) : LIGHT.box,
    border: dark ? token('--border', DARK.border) : LIGHT.border,
    swatchBorder: dark ? token('--border-strong', DARK.swatchBorder) : LIGHT.swatchBorder,
    text: dark ? token('--text-1', DARK.text) : LIGHT.text,
    muted: dark ? token('--text-2', DARK.muted) : LIGHT.muted,
    axisBand: dark ? DARK.axisBand : LIGHT.axisBand,
    gradientBase: dark ? token('--canvas', DARK.canvas) : LIGHT.box,
    selection: token('--overlay-selection', DARK.selection),
    shade: SHADE,
    halo: HALO,
    font: bodyFont.trim() === '' ? FALLBACK_FONT : bodyFont.trim(),
  }
}

// Text widths from a 2D canvas, made on the first measure, or a rough guess
// where there is none.
export function canvasMeasureText(): MeasureText {
  let context: CanvasRenderingContext2D | null | undefined

  return (text, font) => {
    context ??=
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d')
    if (context === null) return estimateTextWidth(text, font)
    context.font = font
    return context.measureText(text).width
  }
}

export function estimateTextWidth(text: string, font: string): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 11)
  return text.length * size * 0.6
}

// The whole overlay, or null when there is nothing to draw.
export function screenshotOverlaySvg(
  frame: ScreenshotSize,
  models: ScreenshotOverlayModels,
  include: ScreenshotInclude,
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): string | null {
  const parts: string[] = []

  if (include.selections) parts.push(...selectionMarks(models.selections, paint))
  if (include.axes && models.axes !== null)
    parts.push(...axesMarks(frame, models.axes, paint))
  if (include.scaleBar && models.scaleBar !== null) {
    parts.push(...scaleBarMarks(frame, models.scaleBar, paint, measure))
  }
  if (include.legend && models.legend.length > 0) {
    parts.push(...legendMarks(frame, models.legend, paint, measure))
  }

  if (parts.length === 0) return null

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" font-family="${escapeXml(paint.font)}">`,
    ...parts,
    '</svg>',
  ].join('')
}

function selectionMarks(
  selections: readonly ScreenshotSelectionPath[],
  paint: ScreenshotOverlayPaint,
): string[] {
  return selections.map((selection) => {
    const color = escapeXml(selection.color ?? paint.selection)
    const d = escapeXml(selection.d)
    // A dark casing with a light halo under the stroke, as on screen, so the
    // outline shows over bright and dark images (EXP-311).
    const casing =
      `<path d="${d}" fill="none" stroke="${paint.halo}" stroke-width="5.5" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="${paint.shade}" stroke-width="3.5" stroke-linejoin="round"/>`
    const line = selection.saved
      ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 4" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`
    return `<g>${casing}${line}</g>`
  })
}

const CAPTION_FONT_SIZE = 11
const CONTROL_FONT_SIZE = 12

function font(paint: ScreenshotOverlayPaint, size: number, weight: number): string {
  return `${weight.toString()} ${size.toString()}px ${paint.font}`
}

function text(
  x: number,
  y: number,
  value: string,
  attributes: {
    readonly fill: string
    readonly size: number
    readonly weight?: number
    readonly anchor?: 'start' | 'middle' | 'end'
    readonly transform?: string
  },
): string {
  const transform =
    attributes.transform === undefined ? '' : ` transform="${attributes.transform}"`
  return `<text x="${round(x)}" y="${round(y)}" fill="${escapeXml(attributes.fill)}" font-size="${attributes.size.toString()}" font-weight="${(attributes.weight ?? 400).toString()}" text-anchor="${attributes.anchor ?? 'start'}" dominant-baseline="central" style="font-variant-numeric: tabular-nums"${transform}>${escapeXml(value)}</text>`
}

// The rulers along the top and left edges (15.4-E), as ViewerAxes draws them.
function axesMarks(
  frame: ScreenshotSize,
  axes: AxesModel,
  paint: ScreenshotOverlayPaint,
): string[] {
  const band = AXIS_BAND_PIXELS
  const labelCentre = band - 6 - CAPTION_FONT_SIZE / 2
  const marks = [
    `<rect x="0" y="0" width="${frame.width}" height="${band}" fill="${paint.axisBand}"/>`,
    `<rect x="0" y="${band}" width="${band}" height="${frame.height - band}" fill="${paint.axisBand}"/>`,
    `<path d="M0 ${band - 0.5}H${frame.width}M${band - 0.5} 0V${frame.height}" stroke="${paint.border}" stroke-width="1" fill="none"/>`,
  ]

  for (const tick of axes.x) {
    marks.push(
      `<rect x="${round(tick.position)}" y="${band - 5}" width="1" height="5" fill="${paint.muted}"/>`,
      text(tick.position, labelCentre, tick.label, {
        fill: paint.muted,
        size: CAPTION_FONT_SIZE,
        anchor: 'middle',
      }),
    )
  }

  for (const tick of axes.y) {
    marks.push(
      `<rect x="${band - 5}" y="${round(tick.position)}" width="5" height="1" fill="${paint.muted}"/>`,
      // Read bottom to top, as on a plot's y axis.
      text(0, 0, tick.label, {
        fill: paint.muted,
        size: CAPTION_FONT_SIZE,
        anchor: 'middle',
        transform: `translate(${round(labelCentre)} ${round(tick.position)}) rotate(-90)`,
      }),
    )
  }

  marks.push(
    `<rect x="0" y="0" width="${band}" height="${band}" fill="${paint.box}"/>`,
    `<path d="M0 ${band - 0.5}H${band - 0.5}V0" stroke="${paint.border}" stroke-width="1" fill="none"/>`,
    text(frame.width - 8, 4 + CAPTION_FONT_SIZE / 2, axes.unitLabel, {
      fill: paint.muted,
      size: CAPTION_FONT_SIZE,
      weight: 700,
      anchor: 'end',
    }),
  )

  return marks
}

// The scale bar in the bottom-right corner, as ViewerCore's ScaleBar.
function scaleBarMarks(
  frame: ScreenshotSize,
  model: ScaleBarModel,
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): string[] {
  const labelFont = font(paint, CAPTION_FONT_SIZE, 800)
  const contentWidth = Math.max(measure(model.label, labelFont), model.widthPixels)
  const width = Math.max(70, Math.ceil(contentWidth) + 16)
  const height = 1 + 5 + CAPTION_FONT_SIZE + 4 + 7 + 6 + 1
  const right = frame.width - 12
  const left = right - width
  const top = frame.height - 12 - height
  const trackTop = top + 1 + 5 + CAPTION_FONT_SIZE + 4
  const trackRight = right - 8
  const trackLeft = trackRight - model.widthPixels

  return [
    `<rect x="${round(left + 0.5)}" y="${round(top + 0.5)}" width="${width - 1}" height="${height - 1}" rx="6" fill="${paint.box}" stroke="${paint.border}" stroke-width="1"/>`,
    text(trackRight, top + 1 + 5 + CAPTION_FONT_SIZE / 2, model.label, {
      fill: paint.text,
      size: CAPTION_FONT_SIZE,
      weight: 800,
      anchor: 'end',
    }),
    `<path d="M${round(trackLeft + 1)} ${round(trackTop)}V${round(trackTop + 6)}H${round(trackRight - 1)}V${round(trackTop)}" fill="none" stroke="${paint.text}" stroke-width="2"/>`,
  ]
}

const LEGEND_PADDING = 8
const LEGEND_SECTION_GAP = 12
const LEGEND_ROW_GAP = 4
const LEGEND_TITLE_HEIGHT = 16
const LEGEND_CAPTION_HEIGHT = 14
const LEGEND_CATEGORY_HEIGHT = 20
const LEGEND_GRADIENT_HEIGHT = 10

// The legend in the bottom-left corner, as the screen's stack places it. It
// leaves out its controls, and the classes hidden on the map.
function legendMarks(
  frame: ScreenshotSize,
  sections: readonly ViewerLegendSection[],
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): string[] {
  const width = Math.max(120, Math.min(260, frame.width - 36))
  const inner = width - LEGEND_PADDING * 2
  const blocks = sections
    .flatMap(printedLegendSections)
    .map((section, index) =>
      section.kind === 'continuous'
        ? continuousLegend(
            section,
            `legend-gradient-${index.toString()}`,
            inner,
            paint,
            measure,
          )
        : categoryLegend(section, inner, paint, measure),
    )
  const height =
    LEGEND_PADDING * 2 +
    blocks.reduce((total, block) => total + block.height, 0) +
    LEGEND_SECTION_GAP * Math.max(0, blocks.length - 1)
  const left = 12
  const top = frame.height - 12 - height
  const marks = [
    `<rect x="${left + 0.5}" y="${round(top + 0.5)}" width="${width - 1}" height="${height - 1}" rx="6" fill="${paint.box}" stroke="${paint.border}" stroke-width="1"/>`,
  ]
  let y = top + LEGEND_PADDING

  blocks.forEach((block, index) => {
    marks.push(
      `<g transform="translate(${left + LEGEND_PADDING} ${round(y)})">${block.svg}</g>`,
    )
    y += block.height + (index < blocks.length - 1 ? LEGEND_SECTION_GAP : 0)
  })

  return marks
}

// A Python section prints as the legend's own blocks: its colours and rings
// as a list, each ramp as a scale.
function printedLegendSections(
  section: ViewerLegendSection,
): (ContinuousLegendSection | CategoryLegendSection)[] {
  if (section.kind !== 'python') return [section]
  return pythonPrintedSections(section)
}

function pythonPrintedSections(
  section: PythonLegendSection,
): (ContinuousLegendSection | CategoryLegendSection)[] {
  const items: CategoryLegendSection['items'][number][] = []
  const ramps: ContinuousLegendSection[] = []

  for (const item of section.items) {
    const { swatch } = item
    if (swatch.kind === 'ramp') {
      ramps.push({
        kind: 'continuous',
        id: `${section.id}:${item.id}`,
        title: `${section.title}: ${item.label}`,
        detail: `${item.count.toLocaleString()} ${item.count === 1 ? section.noun.singular : section.noun.plural}`,
        gradient: swatch.gradient,
        min: swatch.min,
        max: swatch.max,
      })
    } else {
      items.push({
        id: item.id,
        label: item.label,
        color: swatch.kind === 'shown' ? 'transparent' : swatch.color,
        count: item.count,
        visible: true,
      })
    }
  }

  const list: CategoryLegendSection[] =
    items.length === 0
      ? []
      : [
          {
            kind: 'categories',
            id: section.id,
            title: section.title,
            items,
            noun: section.noun,
          },
        ]
  return [...list, ...ramps]
}

interface LegendBlock {
  readonly svg: string
  readonly height: number
}

function continuousLegend(
  section: ContinuousLegendSection,
  id: string,
  width: number,
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): LegendBlock {
  const parts: string[] = []
  let y = 0

  parts.push(legendTitle(section.title, width, y, paint, measure))
  y += LEGEND_TITLE_HEIGHT + LEGEND_ROW_GAP

  if (section.detail !== undefined) {
    parts.push(legendCaption(section.detail, 0, y, width, paint, measure))
    y += LEGEND_CAPTION_HEIGHT + LEGEND_ROW_GAP
  }

  const stops = cssGradientStops(section.gradient)
  parts.push(
    `<defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${stops
      .map(
        (stop) =>
          `<stop offset="${round(stop.offset)}" stop-color="${escapeXml(stop.color)}"/>`,
      )
      .join('')}</linearGradient></defs>`,
    `<rect x="0.5" y="${y + 0.5}" width="${width - 1}" height="${LEGEND_GRADIENT_HEIGHT - 1}" rx="4" fill="${paint.gradientBase}"/>`,
    `<rect x="0.5" y="${y + 0.5}" width="${width - 1}" height="${LEGEND_GRADIENT_HEIGHT - 1}" rx="4" fill="url(#${id})" stroke="${paint.border}" stroke-width="1"/>`,
  )
  y += LEGEND_GRADIENT_HEIGHT + LEGEND_ROW_GAP

  const rangeY = y + LEGEND_CAPTION_HEIGHT / 2
  parts.push(
    text(0, rangeY, section.min, { fill: paint.muted, size: CAPTION_FONT_SIZE }),
    text(width, rangeY, section.max, {
      fill: paint.muted,
      size: CAPTION_FONT_SIZE,
      anchor: 'end',
    }),
  )
  y += LEGEND_CAPTION_HEIGHT

  return { svg: parts.join(''), height: y }
}

function categoryLegend(
  section: CategoryLegendSection,
  width: number,
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): LegendBlock {
  const visible = section.items.filter((item) => item.visible)
  const shown = visible.slice(0, LEGEND_CATEGORY_LIMIT)
  const moreCount = visible.length - shown.length + (section.moreCount ?? 0)
  const captionFont = font(paint, CAPTION_FONT_SIZE, 400)
  const parts: string[] = [legendTitle(section.title, width, 0, paint, measure)]
  let y = LEGEND_TITLE_HEIGHT + LEGEND_ROW_GAP

  for (const item of shown) {
    const count = item.count.toLocaleString()
    const countWidth = measure(count, captionFont)
    const middle = y + LEGEND_CATEGORY_HEIGHT / 2
    parts.push(
      `<rect x="0.5" y="${round(middle - 5.5)}" width="11" height="11" rx="3" fill="${escapeXml(item.color)}" stroke="${paint.swatchBorder}" stroke-width="1"/>`,
      text(
        18,
        middle,
        fitText(item.label, width - 18 - countWidth - 6, captionFont, measure),
        {
          fill: paint.text,
          size: CAPTION_FONT_SIZE,
        },
      ),
      text(width, middle, count, {
        fill: paint.muted,
        size: CAPTION_FONT_SIZE,
        anchor: 'end',
      }),
    )
    y += LEGEND_CATEGORY_HEIGHT
  }

  if (moreCount > 0) {
    parts.push(
      legendCaption(
        `+${moreCount.toLocaleString()} more`,
        0,
        y + 2,
        width,
        paint,
        measure,
      ),
    )
    y += 2 + LEGEND_CAPTION_HEIGHT
  }

  return { svg: parts.join(''), height: y }
}

function legendTitle(
  title: string,
  width: number,
  y: number,
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): string {
  return text(
    0,
    y + LEGEND_TITLE_HEIGHT / 2,
    fitText(title, width, font(paint, CONTROL_FONT_SIZE, 650), measure),
    { fill: paint.text, size: CONTROL_FONT_SIZE, weight: 650 },
  )
}

function legendCaption(
  caption: string,
  x: number,
  y: number,
  width: number,
  paint: ScreenshotOverlayPaint,
  measure: MeasureText,
): string {
  return text(
    x,
    y + LEGEND_CAPTION_HEIGHT / 2,
    fitText(caption, width, font(paint, CAPTION_FONT_SIZE, 400), measure),
    { fill: paint.muted, size: CAPTION_FONT_SIZE },
  )
}

// The text cut with an ellipsis to fit, as the screen's labels are.
export function fitText(
  value: string,
  maxWidth: number,
  textFont: string,
  measure: MeasureText,
): string {
  if (measure(value, textFont) <= maxWidth) return value

  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(`${value.slice(0, middle)}…`, textFont) <= maxWidth) low = middle
    else high = middle - 1
  }

  return `${value.slice(0, low).trimEnd()}…`
}

export interface GradientStop {
  readonly offset: number
  readonly color: string
}

// The stops of a left-to-right CSS gradient, as `colorsGradient` writes it:
// `linear-gradient(90deg, rgba(…) 0%, …)`. A stop without a position is
// spaced evenly.
export function cssGradientStops(gradient: string): readonly GradientStop[] {
  const body = /linear-gradient\((.*)\)\s*$/s.exec(gradient.trim())?.[1] ?? ''
  const parts = splitTopLevel(body)
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^(?:-?[\d.]+deg|to\s)/.test(part))
  const last = Math.max(1, parts.length - 1)

  return parts.map((part, index) => {
    const match = /^(.*?)(?:\s+(-?[\d.]+)%)?$/s.exec(part)
    const color = match?.[1]?.trim() ?? part
    const percent = match?.[2]

    return {
      offset: percent === undefined ? index / last : Number(percent) / 100,
      color,
    }
  })
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }

  parts.push(value.slice(start))
  return parts
}

function round(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
