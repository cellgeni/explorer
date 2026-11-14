import { geneExpressionColor } from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import type { PreviewCells, PreviewScores } from './collectionPreviewData'

// A collection preview as pixels: every cell in grey, so the tissue shows,
// and the cells that score above zero in the gene colour scale over them. A
// pixel shared by several cells takes the highest score, so a few expressing
// cells stay visible among many that do not. Data y grows downwards, as in
// the main view.

export interface PreviewRasterOptions {
  // In device pixels.
  readonly width: number
  readonly height: number
  readonly pointSize: number
  readonly padding: number
  readonly colorScale: GeneExpressionColorScale
  // The score drawn at full colour; scores share it across previews.
  readonly scaleMax: number
}

// The same grey as unscored cells in the main view, opaque enough to read
// against the canvas at this size.
const TISSUE_RGBA = [92, 88, 76, 200] as const

export function rasterizePreview(
  cells: PreviewCells,
  scores: PreviewScores | null,
  options: PreviewRasterOptions,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, padding } = options
  const pointSize = Math.max(1, Math.round(options.pointSize))
  const pixels = new Uint8ClampedArray(width * height * 4)
  const { bounds } = cells

  if (width <= 0 || height <= 0) return pixels

  const spanX = Math.max(bounds.maxX - bounds.minX, Number.EPSILON)
  const spanY = Math.max(bounds.maxY - bounds.minY, Number.EPSILON)
  const scale = Math.min(
    (width - 2 * padding - pointSize) / spanX,
    (height - 2 * padding - pointSize) / spanY,
  )
  const offsetX = (width - spanX * scale - pointSize) / 2 - bounds.minX * scale
  const offsetY = (height - spanY * scale - pointSize) / 2 - bounds.minY * scale
  const forEachPixel = (
    positions: Float32Array,
    visit: (pixel: number, index: number) => void,
  ) => {
    for (let index = 0; index * 2 < positions.length; index += 1) {
      const left = Math.floor((positions[index * 2] ?? 0) * scale + offsetX)
      const top = Math.floor((positions[index * 2 + 1] ?? 0) * scale + offsetY)

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

  forEachPixel(cells.positions, (pixel) => {
    pixels.set(TISSUE_RGBA, pixel * 4)
  })

  if (scores === null || options.scaleMax <= 0) return pixels

  const best = new Float32Array(width * height)

  forEachPixel(scores.positions, (pixel, index) => {
    const score = scores.scores[index] ?? 0
    if (score > (best[pixel] ?? 0)) best[pixel] = score
  })

  for (let pixel = 0; pixel < best.length; pixel += 1) {
    const score = best[pixel] ?? 0
    if (score <= 0) continue

    const intensity = Math.sqrt(Math.min(score / options.scaleMax, 1))
    const color = geneExpressionColor(options.colorScale, intensity)
    pixels[pixel * 4] = color[0] ?? 0
    pixels[pixel * 4 + 1] = color[1] ?? 0
    pixels[pixel * 4 + 2] = color[2] ?? 0
    pixels[pixel * 4 + 3] = Math.max(color[3] ?? 255, 200)
  }

  return pixels
}
