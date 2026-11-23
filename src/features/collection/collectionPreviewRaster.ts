import {
  geneExpressionColor,
  geneExpressionIntensity,
} from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import { geneScoreSpread } from '../genes/geneScaleRange'
import type { PreviewCells, PreviewScores } from './collectionPreviewData'

// Beyond this many cells, a preview draws every Nth of them, in grey or in
// its class colour: more do not change a preview of this size. Scored cells
// are all drawn, so none that express a gene is missed, and so are the cells
// of a small class.
export const PREVIEW_MAX_DRAWN_CELLS = 200_000
// A shown class keeps at least this many cells after thinning.
const RARE_CLASS_DRAWN_CELLS = 64

// A collection preview as pixels: every cell in grey, so the tissue shows,
// and over them either the cells that score above zero in the gene colour
// scale, or the cells of the shown classes in their class colours. A pixel
// shared by several cells takes the highest score, so a few expressing cells
// stay visible among many that do not; a cell of a shown class covers the
// grey of hidden ones, which is dimmer, as hidden classes fade in the main
// view. Data y grows downwards, as in the main view.

export type PreviewOverlay =
  | { readonly kind: 'scores'; readonly scores: PreviewScores }
  | {
      readonly kind: 'classes'
      // Each drawn cell's class index, or -1.
      readonly classOf: Int32Array
      // Each class's colour as #rrggbb, or null for a hidden class.
      readonly colors: readonly (string | null)[]
    }

export interface PreviewRasterOptions {
  // In device pixels.
  readonly width: number
  readonly height: number
  readonly pointSize: number
  readonly padding: number
  readonly colorScale: GeneExpressionColorScale
  // The scores drawn at the bottom and top of the scale.
  readonly scaleMin: number
  readonly scaleMax: number
  // When set, the top is instead this percentile of the drawn pixels' scores
  // above 0. A pixel shows the highest of its cells, so a percentile of the
  // cells would leave most pixels above it at this size.
  readonly scalePercentile?: number
}

export interface PreviewRaster {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>
  // The score drawn at the top colour; 0 without scores.
  readonly scaleMax: number
}

// The same grey as unscored cells in the main view, opaque enough to read
// against the canvas at this size.
const TISSUE_RGBA = [92, 88, 76, 200] as const
// Cells in no shown class, a faint outline of the tissue.
const FADED_TISSUE_RGBA = [92, 88, 76, 72] as const

export function rasterizePreview(
  cells: PreviewCells,
  overlay: PreviewOverlay | null,
  options: PreviewRasterOptions,
): PreviewRaster {
  const { width, height, padding } = options
  const pointSize = Math.max(1, Math.round(options.pointSize))
  const pixels = new Uint8ClampedArray(width * height * 4)
  const { bounds } = cells

  if (width <= 0 || height <= 0) return { pixels, scaleMax: 0 }

  // A section of one cell, or of cells at one point, has no span: it is drawn
  // centred, as a span of 1 µm. A tiny span made the scale so large that
  // positions lost their offset and the cell went to a corner.
  const spanX = bounds.maxX > bounds.minX ? bounds.maxX - bounds.minX : 1
  const spanY = bounds.maxY > bounds.minY ? bounds.maxY - bounds.minY : 1
  const scale = Math.min(
    (width - 2 * padding - pointSize) / spanX,
    (height - 2 * padding - pointSize) / spanY,
  )
  // The extent's centre at the preview's centre.
  const offsetX = (width - pointSize) / 2 - ((bounds.minX + bounds.maxX) / 2) * scale
  const offsetY = (height - pointSize) / 2 - ((bounds.minY + bounds.maxY) / 2) * scale
  const forEachPixel = (
    positions: Float32Array,
    visit: (pixel: number, index: number) => void,
    drawn: (index: number) => boolean = () => true,
  ) => {
    for (let index = 0; index * 2 < positions.length; index += 1) {
      if (!drawn(index)) continue

      const left = Math.floor((positions[index * 2] ?? 0) * scale + offsetX)
      const top = Math.floor((positions[index * 2 + 1] ?? 0) * scale + offsetY)
      // A cell without a position (NaN) is not drawn.
      if (!Number.isFinite(left) || !Number.isFinite(top)) continue

      for (let dy = 0; dy < pointSize; dy += 1) {
        const row = top + dy
        if (row < 0 || row >= height) continue

        for (let dx = 0; dx < pointSize; dx += 1) {
          const column = left + dx
          if (column < 0 || column >= width) continue
          visit(row * width + column, index)
        }
      }
    }
  }

  const tissue = overlay?.kind === 'classes' ? FADED_TISSUE_RGBA : TISSUE_RGBA
  const cellStride = Math.max(
    1,
    Math.ceil(cells.positions.length / 2 / PREVIEW_MAX_DRAWN_CELLS),
  )

  const everyStrideth = (index: number) => index % cellStride === 0

  forEachPixel(
    cells.positions,
    (pixel) => {
      pixels.set(tissue, pixel * 4)
    },
    everyStrideth,
  )

  if (overlay?.kind === 'classes') {
    const colors = overlay.colors.map(hexRgb)
    // Thinning keeps one cell in cellStride, so a class of fewer than
    // RARE_CLASS_DRAWN_CELLS after it is drawn whole: a rare cell type is
    // what hiding the others is for.
    const classSizes = new Uint32Array(colors.length)
    for (const classIndex of overlay.classOf) {
      if (classIndex >= 0 && classIndex < classSizes.length) {
        classSizes[classIndex] = (classSizes[classIndex] ?? 0) + 1
      }
    }
    const drawnWhole = Array.from(
      classSizes,
      (size) => size < RARE_CLASS_DRAWN_CELLS * cellStride,
    )

    forEachPixel(
      cells.positions,
      (pixel, index) => {
        const color = colors[overlay.classOf[index] ?? -1]
        if (color === undefined || color === null) return
        pixels[pixel * 4] = color[0]
        pixels[pixel * 4 + 1] = color[1]
        pixels[pixel * 4 + 2] = color[2]
        pixels[pixel * 4 + 3] = 255
      },
      (index) =>
        everyStrideth(index) || drawnWhole[overlay.classOf[index] ?? -1] === true,
    )

    return { pixels, scaleMax: 0 }
  }

  if (overlay === null) return { pixels, scaleMax: 0 }

  const { scores } = overlay

  const best = new Float32Array(width * height)

  forEachPixel(scores.positions, (pixel, index) => {
    const score = scores.scores[index] ?? 0
    // A stored NaN or infinity is no score, as in the main view.
    if (Number.isFinite(score) && score > (best[pixel] ?? 0)) best[pixel] = score
  })

  const scaleMax =
    options.scalePercentile === undefined
      ? options.scaleMax
      : geneScoreSpread(best, options.scalePercentile).top

  if (scaleMax <= 0) return { pixels, scaleMax: 0 }

  for (let pixel = 0; pixel < best.length; pixel += 1) {
    const score = best[pixel] ?? 0
    if (score <= 0) continue

    const intensity = geneExpressionIntensity(score, options.scaleMin, scaleMax)
    const color = geneExpressionColor(options.colorScale, intensity)
    pixels[pixel * 4] = color[0] ?? 0
    pixels[pixel * 4 + 1] = color[1] ?? 0
    pixels[pixel * 4 + 2] = color[2] ?? 0
    pixels[pixel * 4 + 3] = Math.max(color[3] ?? 255, 200)
  }

  return { pixels, scaleMax }
}

// A class colour as RGB, or null for a hidden class or one without a colour.
export function hexRgb(color: string | null): readonly [number, number, number] | null {
  if (color === null || !/^#[0-9a-f]{6}$/i.test(color)) return null

  const value = Number.parseInt(color.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
