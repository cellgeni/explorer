import {
  scaleFromZoom,
  unplaceFrameBbox,
  type BBox,
  type TileIndex,
} from '../../data/coords'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { morphologyViewportBbox } from '../../rendering/morphologyCanvas'
import type { CssViewportSize } from '../../rendering/morphologyCanvas'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'

// The screenshot's plan (plan 27, task B): its size, the grid of tiles it is
// drawn in, and the image tiles each channel reads. Everything here is pure.

export const SCREENSHOT_SCALES = [1, 2, 4, 8] as const
export type ScreenshotScale = (typeof SCREENSHOT_SCALES)[number]
export const DEFAULT_SCREENSHOT_SCALE: ScreenshotScale = 2
export const DEFAULT_SCREENSHOT_DPI = 300

// D10: Chromium draws 2D canvases up to 16,384 px a side, and encoding holds
// the RGBA pixels (512 MiB at 128 megapixels) beside the canvas.
export const SCREENSHOT_MAX_SIDE_PIXELS = 16_384
export const SCREENSHOT_MAX_PIXELS = 128 * 1024 ** 2
// D9: WebGL silently shrinks a drawing buffer past its limit, so deck.gl
// draws the screenshot in tiles of at most this many pixels a side.
export const SCREENSHOT_TILE_MAX_PIXELS = 4_096
// D4: a larger image read asks first, as Cell Query does (26-D7).
export const SCREENSHOT_ASK_BYTES = 512 * 1024 ** 2
// Image requests in flight where the viewer is given no limit, as
// MorphologyCanvas's default.
export const SCREENSHOT_DEFAULT_TILE_REQUESTS = 4

export interface ScreenshotRect {
  // In the frame's CSS pixels.
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ScreenshotSize {
  readonly width: number
  readonly height: number
}

// The frame in whole CSS pixels: the canvas can measure a fraction of one.
export function screenshotFrame(viewport: CssViewportSize): ScreenshotSize {
  return {
    width: Math.max(1, Math.round(viewport.width)),
    height: Math.max(1, Math.round(viewport.height)),
  }
}

export function screenshotPixelSize(
  frame: ScreenshotSize,
  scale: ScreenshotScale,
): ScreenshotSize {
  return { width: frame.width * scale, height: frame.height * scale }
}

// Why a size cannot be drawn, or null when it can.
export function screenshotSizeLimitReason(size: ScreenshotSize): string | null {
  if (Math.max(size.width, size.height) > SCREENSHOT_MAX_SIDE_PIXELS) {
    return `Over ${SCREENSHOT_MAX_SIDE_PIXELS.toLocaleString()} px on a side`
  }

  if (size.width * size.height > SCREENSHOT_MAX_PIXELS) {
    return `Over ${(SCREENSHOT_MAX_PIXELS / 1024 ** 2).toLocaleString()} megapixels`
  }

  return null
}

export interface ScreenshotGrid {
  // Every tile has this size, in CSS pixels; those at the right and bottom
  // edges are drawn at it and cut to the frame.
  readonly tileWidth: number
  readonly tileHeight: number
  // Row by row, each cut to the frame.
  readonly tiles: readonly ScreenshotRect[]
}

// D9: tiles of whole CSS pixels, and so of whole device pixels at a whole
// scale, at most SCREENSHOT_TILE_MAX_PIXELS device pixels a side.
export function screenshotGrid(
  frame: ScreenshotSize,
  scale: ScreenshotScale,
  maxTilePixels = SCREENSHOT_TILE_MAX_PIXELS,
): ScreenshotGrid {
  const maxTileCss = Math.max(1, Math.floor(maxTilePixels / scale))
  const tileWidth = Math.min(frame.width, maxTileCss)
  const tileHeight = Math.min(frame.height, maxTileCss)
  const tiles: ScreenshotRect[] = []

  for (let y = 0; y < frame.height; y += tileHeight) {
    for (let x = 0; x < frame.width; x += tileWidth) {
      tiles.push({
        x,
        y,
        width: Math.min(tileWidth, frame.width - x),
        height: Math.min(tileHeight, frame.height - y),
      })
    }
  }

  return { tileWidth, tileHeight, tiles }
}

// The view of one tile of the frame: the same zoom, centred on the tile.
export function screenshotTileViewState(
  viewState: OverviewViewState,
  frame: ScreenshotSize,
  rect: ScreenshotRect,
): OverviewViewState {
  const scale = scaleFromZoom(viewState.zoom)

  return {
    ...viewState,
    target: [
      viewState.target[0] + (rect.x + rect.width / 2 - frame.width / 2) / scale,
      viewState.target[1] + (frame.height / 2 - rect.y - rect.height / 2) / scale,
      viewState.target[2] ?? 0,
    ],
  }
}

// The same view drawn `scale` times larger: a CSS pixel of the view becomes
// `scale` pixels, so a 2D canvas can draw it with one pixel per pixel.
export function scaledViewState(
  viewState: OverviewViewState,
  scale: ScreenshotScale,
): OverviewViewState {
  return { ...viewState, zoom: viewState.zoom + Math.log2(scale) }
}

// D4: the level a view `scale` times larger reads.
export function screenshotImageLevel(
  loader: Pick<ImagePyramidLoader, 'bestLevel'>,
  zoom: number,
  scale: ScreenshotScale,
): number {
  return loader.bestLevel(scaleFromZoom(zoom) * scale)
}

// The image tiles under a rect of the frame, in the loader's frame.
export function screenshotImageTiles(
  loader: Pick<ImagePyramidLoader, 'placement' | 'tilesForBbox'>,
  level: number,
  viewState: OverviewViewState,
  frame: ScreenshotSize,
  rect: ScreenshotRect,
): readonly TileIndex[] {
  const bbox = morphologyViewportBbox(screenshotTileViewState(viewState, frame, rect), {
    width: rect.width,
    height: rect.height,
  })

  return loader.tilesForBbox(level, loaderFrameBbox(loader, bbox))
}

function loaderFrameBbox(
  loader: Pick<ImagePyramidLoader, 'placement'>,
  bbox: BBox,
): BBox {
  return loader.placement === undefined ? bbox : unplaceFrameBbox(loader.placement, bbox)
}

export interface ScreenshotChannelRead {
  readonly level: number
  // The tiles of the whole frame, each once, for the byte estimate.
  readonly frameTiles: readonly TileIndex[]
  // The reads of every grid tile; a tile under two grid tiles is read twice.
  readonly reads: number
}

export function screenshotChannelRead(
  loader: Pick<ImagePyramidLoader, 'bestLevel' | 'placement' | 'tilesForBbox'>,
  viewState: OverviewViewState,
  frame: ScreenshotSize,
  grid: ScreenshotGrid,
  scale: ScreenshotScale,
): ScreenshotChannelRead {
  const level = screenshotImageLevel(loader, viewState.zoom, scale)
  const whole = { x: 0, y: 0, width: frame.width, height: frame.height }

  return {
    level,
    frameTiles: screenshotImageTiles(loader, level, viewState, frame, whole),
    reads: grid.tiles.reduce(
      (count, rect) =>
        count + screenshotImageTiles(loader, level, viewState, frame, rect).length,
      0,
    ),
  }
}

// µm (or the dataset's unit) per pixel of the PNG.
export function screenshotUnitsPerPixel(zoom: number, scale: ScreenshotScale): number {
  return 1 / (scaleFromZoom(zoom) * scale)
}

// "254 × 152 mm at 300 dpi".
export function screenshotPrintSize(size: ScreenshotSize, dpi: number): string {
  const mm = (pixels: number) => Math.round((pixels / dpi) * 25.4).toLocaleString()
  return `${mm(size.width)} × ${mm(size.height)} mm at ${dpi.toLocaleString()} dpi`
}

// "0.85", "12.5", "0.0213": three significant digits.
export function formatUnitsPerPixel(value: number): string {
  return Number(value.toPrecision(3)).toLocaleString(undefined, {
    maximumSignificantDigits: 3,
  })
}

export interface ScreenshotCellCounts {
  // Cells in the frame.
  readonly inView: number
  // About how many of them the screen draws, after the render cap.
  readonly onScreen: number
}

// D5 and D7: what the PNG shows that the screen does not, or that is a
// sample. Each note says what would change it.
export function screenshotNotes({
  cells,
  expressionSampled,
  transcriptsAsDensity,
  loadingLabels,
}: {
  readonly cells: ScreenshotCellCounts | null
  readonly expressionSampled: boolean
  readonly transcriptsAsDensity: boolean
  readonly loadingLabels: readonly string[]
}): readonly string[] {
  const notes: string[] = []

  if (cells !== null && cells.onScreen < cells.inView) {
    notes.push(
      `Draws all ${cells.inView.toLocaleString()} cells in view; the screen shows about ${cells.onScreen.toLocaleString()}.`,
    )
  }

  if (expressionSampled) {
    notes.push(
      'Expression is a sample at this zoom. Set Expression detail to All cells to colour every cell.',
    )
  }

  if (transcriptsAsDensity) {
    notes.push(
      'Transcripts are density squares at this zoom. Set Detail to Exact, or zoom in, for points.',
    )
  }

  if (loadingLabels.length > 0) {
    notes.push(
      `Still loading: ${loadingLabels.join(', ')}. The screenshot shows what has loaded.`,
    )
  }

  return notes
}
