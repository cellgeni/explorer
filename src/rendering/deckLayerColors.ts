import type { Color } from '@deck.gl/core'
import { normalizeLayerOpacity } from './layerOpacity'
import type {
  ColorStop,
  GeneExpressionColorScale,
  GeneExpressionColorScaleOption,
  GeneExpressionScoreMode,
  GeneExpressionScoreModeOption,
  TranscriptDensityColorScale,
  TranscriptDensityColorScaleOption,
  TranscriptPointColorMode,
  TranscriptPointColorModeOption,
} from './deckLayerTypes'

export const DEFAULT_GENE_EXPRESSION_COLOR_SCALE: GeneExpressionColorScale = 'plasma'
export const DEFAULT_GENE_EXPRESSION_SCORE_MODE: GeneExpressionScoreMode = 'sum'
export const DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE: TranscriptDensityColorScale =
  'thermal'
export const DEFAULT_TRANSCRIPT_POINT_COLOR_MODE: TranscriptPointColorMode = 'feature'

export const GENE_EXPRESSION_COLOR_SCALE_OPTIONS: readonly GeneExpressionColorScaleOption[] =
  [
    { id: 'gold', label: 'Gold' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
    { id: 'plasma', label: 'Plasma' },
    { id: 'cividis', label: 'Cividis' },
    { id: 'teal', label: 'Teal' },
    { id: 'rose', label: 'Rose' },
    { id: 'glasbey', label: 'Glasbey' },
  ]

export const GENE_EXPRESSION_SCORE_MODE_OPTIONS: readonly GeneExpressionScoreModeOption[] =
  [
    { id: 'sum', label: 'Sum' },
    { id: 'mean', label: 'Mean' },
    { id: 'z-score', label: 'Z-score' },
  ]

export const TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS: readonly TranscriptDensityColorScaleOption[] =
  [
    { id: 'thermal', label: 'Thermal' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
    { id: 'cividis', label: 'Cividis' },
    { id: 'teal', label: 'Teal' },
  ]

export const TRANSCRIPT_POINT_COLOR_MODE_OPTIONS: readonly TranscriptPointColorModeOption[] =
  [
    { id: 'feature', label: 'Feature' },
    { id: 'quality', label: 'QV' },
  ]

export const DEFAULT_OVERVIEW_CELL_FILL_RGB = [72, 68, 58] as const
export const GENE_EXPRESSION_ZERO_FILL_COLOR: Color = [
  ...DEFAULT_OVERVIEW_CELL_FILL_RGB,
  84,
]
export const GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY = 0.5
export const DEFAULT_CELL_BOUNDARY_FILL_COLOR: Color = [32, 102, 83, 34]
export const DEFAULT_CELL_BOUNDARY_LINE_COLOR: Color = [174, 241, 214, 230]
export const CELL_BOUNDARY_LINE_WIDTH_PIXELS = 1.35
export const CELL_BOUNDARY_HIT_AREA_OPACITY = 0.01

const GENE_EXPRESSION_COLOR_STOPS: Record<
  GeneExpressionColorScale,
  readonly [ColorStop, ColorStop, ColorStop]
> = {
  gold: [
    [111, 63, 53, 130],
    [221, 127, 75, 196],
    [255, 221, 99, 245],
  ],
  magma: [
    [45, 15, 71, 130],
    [195, 60, 105, 205],
    [252, 223, 116, 245],
  ],
  viridis: [
    [68, 1, 84, 130],
    [33, 145, 140, 205],
    [253, 231, 37, 245],
  ],
  plasma: [
    [13, 8, 135, 130],
    [203, 71, 119, 205],
    [240, 249, 33, 245],
  ],
  cividis: [
    [0, 32, 76, 130],
    [127, 124, 88, 205],
    [255, 233, 69, 245],
  ],
  teal: [
    [13, 59, 74, 130],
    [31, 151, 139, 205],
    [193, 230, 143, 245],
  ],
  rose: [
    [64, 18, 77, 130],
    [211, 69, 114, 205],
    [255, 188, 121, 245],
  ],
  glasbey: [
    [214, 0, 0, 130],
    [140, 59, 255, 205],
    [1, 135, 0, 245],
  ],
}

const TRANSCRIPT_DENSITY_COLOR_STOPS: Record<
  TranscriptDensityColorScale,
  readonly [ColorStop, ColorStop, ColorStop]
> = {
  thermal: [
    [29, 78, 86, 96],
    [239, 137, 80, 180],
    [255, 223, 91, 246],
  ],
  magma: [
    [0, 0, 4, 96],
    [183, 55, 121, 180],
    [252, 253, 191, 246],
  ],
  viridis: [
    [68, 1, 84, 96],
    [32, 144, 140, 180],
    [253, 231, 37, 246],
  ],
  cividis: [
    [0, 34, 78, 96],
    [125, 124, 82, 180],
    [255, 233, 69, 246],
  ],
  teal: [
    [13, 59, 74, 96],
    [37, 172, 166, 180],
    [198, 255, 221, 246],
  ],
}

export function isGeneExpressionColorScale(
  value: string,
): value is GeneExpressionColorScale {
  return GENE_EXPRESSION_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

export function isGeneExpressionScoreMode(
  value: string,
): value is GeneExpressionScoreMode {
  return GENE_EXPRESSION_SCORE_MODE_OPTIONS.some((option) => option.id === value)
}

export function isTranscriptDensityColorScale(
  value: string,
): value is TranscriptDensityColorScale {
  return TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

export function isTranscriptPointColorMode(
  value: string,
): value is TranscriptPointColorMode {
  return TRANSCRIPT_POINT_COLOR_MODE_OPTIONS.some((option) => option.id === value)
}

export function geneExpressionColor(
  colorScale: GeneExpressionColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = GENE_EXPRESSION_COLOR_STOPS[colorScale]
  return interpolateColorStops(lowStop, middleStop, highStop, intensity)
}

export function transcriptDensityColor(
  colorScale: TranscriptDensityColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = TRANSCRIPT_DENSITY_COLOR_STOPS[colorScale]
  return interpolateColorStops(lowStop, middleStop, highStop, intensity)
}

export function boundaryFillColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(88, Math.max(28, color[3] ?? 64)),
  ]
}

export function boundaryLineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(235, Math.max(160, color[3] ?? 210)),
  ]
}

export function cellPointOutlineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(245, Math.max(160, color[3] ?? 210)),
  ]
}

export function colorWithOpacity(color: Color, opacity: number): Color {
  const normalizedOpacity = normalizeLayerOpacity(opacity)

  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.round((color[3] ?? 255) * normalizedOpacity),
  ]
}

export function colorWithFillOpacity(color: Color, opacity: number): Color {
  const normalizedOpacity = normalizeLayerOpacity(opacity)

  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.round(255 * normalizedOpacity),
  ]
}

export function cellAreaToRadiusMicrometers(
  cellArea: number | undefined,
): number | undefined {
  if (cellArea === undefined || !Number.isFinite(cellArea) || cellArea <= 0) {
    return undefined
  }

  return Math.sqrt(cellArea / Math.PI)
}

function interpolateColorStops(
  lowStop: ColorStop,
  middleStop: ColorStop,
  highStop: ColorStop,
  intensity: number,
): Color {
  const normalizedIntensity = Math.min(1, Math.max(0, intensity))
  const startStop = normalizedIntensity <= 0.5 ? lowStop : middleStop
  const endStop = normalizedIntensity <= 0.5 ? middleStop : highStop
  const t =
    normalizedIntensity <= 0.5 ? normalizedIntensity * 2 : (normalizedIntensity - 0.5) * 2

  return [
    interpolateColorChannel(startStop[0], endStop[0], t),
    interpolateColorChannel(startStop[1], endStop[1], t),
    interpolateColorChannel(startStop[2], endStop[2], t),
    interpolateColorChannel(startStop[3], endStop[3], t),
  ]
}

function interpolateColorChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t)
}
