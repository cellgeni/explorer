import type { LayersList } from '@deck.gl/core'
import type { CssViewportSize } from '../../rendering/morphologyCanvas'
import { morphologyViewportBbox } from '../../rendering/morphologyCanvas'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import { throwIfAborted } from '../../utils/abort'
import { insertPngChunks, pngPhysChunk, pngTextChunk, type PngChunk } from './pngChunks'
import {
  ScreenshotDeckRenderer,
  unpickableLayers,
  type CreateScreenshotDeck,
} from './screenshotDeck'
import {
  ScreenshotImageComposer,
  type FlatImageElement,
  type ScreenshotImageSource,
} from './screenshotImage'
import {
  canvasMeasureText,
  screenshotOverlayPaint,
  screenshotOverlaySvg,
  type MeasureText,
  type ScreenshotBackground,
  type ScreenshotInclude,
  type ScreenshotOverlayModels,
  type ScreenshotOverlayPaint,
} from './screenshotOverlay'
import {
  screenshotFrame,
  screenshotGrid,
  screenshotPixelSize,
  screenshotSizeLimitReason,
  screenshotTileViewState,
  screenshotUnitsPerPixel,
  type ScreenshotCellCounts,
  type ScreenshotScale,
  type ScreenshotSize,
} from './screenshotPlan'

// What the view holds when `Save PNG` is pressed (plan 27, step 1). Pans,
// zooms and loads after it do not change the screenshot. It stays out of
// React props, in the runner, as its layers' data can be large typed arrays.
export interface ScreenshotSnapshot {
  readonly viewState: OverviewViewState
  readonly viewport: CssViewportSize
  readonly image: ScreenshotImageSource
  // New layers with every loaded cell; null where the view draws no layers.
  readonly layers: (() => LayersList) | null
  readonly overlays: ScreenshotOverlayModels
  readonly cells: ScreenshotCellCounts | null
  // The data's unit: µm, or "units" without a known physical size.
  readonly unitLabel: string
  readonly maxConcurrentTileRequests: number
  // When the view last moved (performance.now() ms).
  readonly viewChangedAt: number
}

export interface ScreenshotOptions {
  readonly scale: ScreenshotScale
  readonly dpi: number
  readonly include: ScreenshotInclude
  readonly background: ScreenshotBackground
}

// Where the PNG came from, for its text chunks (27-D11).
export interface ScreenshotFileInfo {
  readonly fileName: string
  readonly software: string
  // The dataset URL without a presigned URL's signature.
  readonly source: string | null
  // The z-stack plane shown, counted from 1; null for a single plane.
  readonly zPlane: number | null
}

export type ScreenshotStage = 'image' | 'cells' | 'writing'

export interface ScreenshotProgress {
  readonly stage: ScreenshotStage
  readonly done: number
  readonly total: number
}

export interface DrawScreenshotOptions {
  readonly signal: AbortSignal
  readonly onProgress?: (progress: ScreenshotProgress) => void
  readonly createCanvas?: (width: number, height: number) => HTMLCanvasElement
  readonly paint?: ScreenshotOverlayPaint
  readonly measure?: MeasureText
  readonly createDeck?: CreateScreenshotDeck
  readonly loadFlatImage?: (url: string) => Promise<FlatImageElement>
  readonly now?: () => Date
}

// Draws the snapshot as a PNG, with its dpi and text chunks.
export async function drawScreenshot(
  snapshot: ScreenshotSnapshot,
  options: ScreenshotOptions,
  file: ScreenshotFileInfo,
  run: DrawScreenshotOptions,
): Promise<Blob> {
  const { scale } = options
  const { signal } = run
  const frame = screenshotFrame(snapshot.viewport)
  const size = screenshotPixelSize(frame, scale)
  const limit = screenshotSizeLimitReason(size)
  if (limit !== null) throw new Error(`The PNG would be too large: ${limit}.`)

  const createCanvas = run.createCanvas ?? createCanvasElement
  const paint = run.paint ?? screenshotOverlayPaint(options.background)
  const grid = screenshotGrid(frame, scale)
  let imageDone = 0
  let cellsDone = 0
  let total = 1
  const report = (stage: ScreenshotStage) => {
    run.onProgress?.({ stage, done: imageDone + cellsDone, total })
  }
  const composer = new ScreenshotImageComposer(snapshot.image, {
    viewState: snapshot.viewState,
    frame,
    scale,
    maxConcurrentRequests: snapshot.maxConcurrentTileRequests,
    signal,
    onTileDrawn: () => {
      imageDone += 1
      report('image')
    },
    ...(run.loadFlatImage === undefined ? {} : { loadFlatImage: run.loadFlatImage }),
  })
  const imageTotal =
    snapshot.image.channels.length > 0
      ? grid.tiles.reduce((count, rect) => count + composer.tileCount(rect), 0)
      : snapshot.image.flatImage === null
        ? 0
        : grid.tiles.length
  total = imageTotal + (snapshot.layers === null ? 0 : grid.tiles.length) + 1

  const canvas = createCanvas(size.width, size.height)
  const scratch = composer.hasImage
    ? createCanvas(grid.tileWidth * scale, grid.tileHeight * scale)
    : null
  let deck: ScreenshotDeckRenderer | null = null

  try {
    const context = canvas.getContext('2d')
    const scratchContext = scratch?.getContext('2d') ?? null
    if (context === null || (scratch !== null && scratchContext === null)) {
      throw new Error('This browser cannot draw a canvas this large.')
    }

    if (paint.background !== null) {
      context.fillStyle = paint.background
      context.fillRect(0, 0, size.width, size.height)
    }
    report('image')

    if (snapshot.layers !== null) {
      deck = await ScreenshotDeckRenderer.create({
        layers: unpickableLayers(snapshot.layers()),
        tileWidth: grid.tileWidth,
        tileHeight: grid.tileHeight,
        scale,
        viewState: snapshot.viewState,
        signal,
        ...(run.createDeck === undefined ? {} : { createDeck: run.createDeck }),
      })
    }

    for (const rect of grid.tiles) {
      if (scratch !== null && scratchContext !== null) {
        await composer.drawTile(scratchContext, rect)
        context.globalAlpha = Math.max(0, Math.min(1, snapshot.image.opacity))
        context.drawImage(
          scratch,
          0,
          0,
          rect.width * scale,
          rect.height * scale,
          rect.x * scale,
          rect.y * scale,
          rect.width * scale,
          rect.height * scale,
        )
        context.globalAlpha = 1
      }

      throwIfAborted(signal)

      if (deck !== null) {
        // Every tile is drawn at the grid's size, centred on its own middle;
        // tiles at the right and bottom edges are cut to the frame.
        const tileView = screenshotTileViewState(snapshot.viewState, frame, {
          x: rect.x,
          y: rect.y,
          width: grid.tileWidth,
          height: grid.tileHeight,
        })
        deck.drawTile(context, tileView, rect, { x: rect.x * scale, y: rect.y * scale })
        cellsDone += 1
        report('cells')
        // Lets the page take input between tiles.
        await nextTask()
        throwIfAborted(signal)
      }
    }

    deck?.destroy()
    deck = null

    const svg = screenshotOverlaySvg(
      frame,
      snapshot.overlays,
      options.include,
      paint,
      run.measure ?? canvasMeasureText(),
    )
    if (svg !== null) {
      await drawSvg(context, svg, frame, size)
      throwIfAborted(signal)
    }

    report('writing')
    const png = await canvasPng(canvas)
    throwIfAborted(signal)

    return new Blob(
      [
        insertPngChunks(
          png,
          screenshotChunks(
            snapshot,
            frame,
            options,
            file,
            (run.now ?? (() => new Date()))(),
          ),
        ) as Uint8Array<ArrayBuffer>,
      ],
      { type: 'image/png' },
    )
  } finally {
    deck?.destroy()
    composer.dispose()
    canvas.width = 0
    canvas.height = 0
    if (scratch !== null) {
      scratch.width = 0
      scratch.height = 0
    }
  }
}

// 27-D11: pHYs from the dpi, and text chunks with the PNG specification's
// keywords.
export function screenshotChunks(
  snapshot: Pick<ScreenshotSnapshot, 'viewState' | 'unitLabel'>,
  frame: ScreenshotSize,
  options: Pick<ScreenshotOptions, 'scale' | 'dpi'>,
  file: Omit<ScreenshotFileInfo, 'fileName'>,
  createdAt: Date,
): readonly PngChunk[] {
  return [
    pngPhysChunk(options.dpi),
    pngTextChunk('Software', file.software),
    ...(file.source === null ? [] : [pngTextChunk('Source', file.source)]),
    pngTextChunk(
      'Description',
      screenshotDescription(snapshot, frame, options, file.zPlane),
    ),
    pngTextChunk('Creation Time', createdAt.toISOString()),
  ]
}

// "x 1200 to 3400 µm, y 800 to 2100 µm; 0.085 µm per pixel; 2× scale", in
// Latin-1 so it fits a tEXt chunk.
export function screenshotDescription(
  snapshot: Pick<ScreenshotSnapshot, 'viewState' | 'unitLabel'>,
  frame: ScreenshotSize,
  options: Pick<ScreenshotOptions, 'scale'>,
  zPlane: number | null,
): string {
  const bbox = morphologyViewportBbox(snapshot.viewState, frame)
  const unit = snapshot.unitLabel
  const value = (number: number) =>
    number.toLocaleString('en', { maximumFractionDigits: 1, useGrouping: false })
  const parts = [
    `x ${value(bbox.minX)} to ${value(bbox.maxX)} ${unit}, y ${value(bbox.minY)} to ${value(bbox.maxY)} ${unit}`,
    `${String(Number(screenshotUnitsPerPixel(snapshot.viewState.zoom, options.scale).toPrecision(3)))} ${unit} per pixel`,
    `${options.scale.toString()}× scale`,
  ]
  if (zPlane !== null) parts.push(`z plane ${zPlane.toString()}`)
  return parts.join('; ')
}

function createCanvasElement(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

// The SVG drawn over the whole PNG through an image, as svgPngBlob does.
async function drawSvg(
  context: CanvasRenderingContext2D,
  svg: string,
  frame: ScreenshotSize,
  size: ScreenshotSize,
): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.width = frame.width
    image.height = frame.height
    image.src = url
    await image.decode()
    context.drawImage(image, 0, 0, size.width, size.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result === null) reject(new Error('The PNG could not be written.'))
      else resolve(result)
    }, 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
