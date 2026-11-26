import type { TileIndex } from '../../data/coords'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type {
  FlatMorphologyCanvasImage,
  MorphologyCanvasChannel,
} from '../../components/MorphologyCanvas'
import { normalizeLayerOpacity } from '../../rendering/layerOpacity'
import {
  addMorphologyTileChannels,
  drawFlatImage,
  type MorphologyChannelTileBatch,
} from '../../rendering/morphologyCanvas'
import { MorphologyTileStore } from '../../rendering/morphologyTileStore'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import {
  TileCache,
  TILE_RETRY_DELAYS_MS,
  type TileReadyEntry,
} from '../../tiff/tileCache'
import type { TileBitmapDecoder } from '../../workers/tileDecodePool'
import { abortError, isAbortError, throwIfAborted } from '../../utils/abort'
import {
  scaledViewState,
  screenshotImageLevel,
  screenshotImageTiles,
  screenshotTileViewState,
  type ScreenshotRect,
  type ScreenshotScale,
  type ScreenshotSize,
} from './screenshotPlan'

// The image under a screenshot (plan 27, task C): every channel's tiles at the
// level the screenshot's pixel size needs, drawn tile by tile of the frame.
//
// The screenshot keeps its own tile caches (27-D4), so a read of hundreds of
// tiles at another level does not push the canvas's tiles out of its cache,
// and `Retry` reads again a tile whose retries were spent. Tiles are drawn as
// they arrive and the caches hold few of them, so memory stays small however
// large the screenshot. Reads leave the byte-range cache as it is
// (`persist: false`).

export interface ScreenshotImageSource {
  // The channels the canvas draws, in its colours and contrast.
  readonly channels: readonly MorphologyCanvasChannel[]
  readonly flatImage: FlatMorphologyCanvasImage | null
  // The image layer's opacity, as the canvas's CSS opacity.
  readonly opacity: number
}

export interface FlatImageElement {
  readonly image: CanvasImageSource
  readonly naturalSize: readonly [number, number] | null
}

export interface ScreenshotImageOptions {
  readonly viewState: OverviewViewState
  readonly frame: ScreenshotSize
  readonly scale: ScreenshotScale
  // Requests in flight over every channel: the budget's limit.
  readonly maxConcurrentRequests: number
  readonly signal: AbortSignal
  // After each tile is drawn.
  readonly onTileDrawn?: () => void
  readonly decodeTile?: TileBitmapDecoder
  readonly loadFlatImage?: (url: string) => Promise<FlatImageElement>
  // Waits for a time in Date.now() ms; tests pass one that does not wait.
  readonly waitUntil?: (time: number, signal: AbortSignal) => Promise<void>
}

// A tile that could not be read once its retries were spent. The screenshot
// fails rather than saving with a hole in it.
export class ScreenshotImageError extends Error {
  readonly channelName: string

  constructor(channelName: string, cause: Error) {
    super(`A tile of ${channelName} could not be read: ${cause.message}`, { cause })
    this.name = 'ScreenshotImageError'
    this.channelName = channelName
  }
}

// Tiles named as coming next to each read, which a TIFF loader reads in the
// same request when they are stored beside it.
const UPCOMING_TILES = 8

interface ChannelRead {
  readonly channel: MorphologyCanvasChannel
  readonly cache: TileCache
  readonly level: number
}

interface TileRead {
  readonly channelIndex: number
  readonly tile: TileIndex
}

export class ScreenshotImageComposer {
  private readonly reads: readonly ChannelRead[]
  private flatImage: Promise<FlatImageElement> | null = null

  constructor(
    private readonly source: ScreenshotImageSource,
    private readonly options: ScreenshotImageOptions,
  ) {
    const cacheTiles = options.maxConcurrentRequests * 2 + 8
    this.reads = source.channels.map((channel) => ({
      channel,
      level: screenshotImageLevel(channel.loader, options.viewState.zoom, options.scale),
      cache: new TileCache({
        maxTiles: cacheTiles,
        color: channel.color,
        alphaFromIntensity: channel.alphaFromIntensity ?? true,
        ...(channel.contrast === undefined ? {} : { displayWindow: channel.contrast }),
        ...(options.decodeTile === undefined ? {} : { decodeTile: options.decodeTile }),
      }),
    }))
  }

  get hasImage(): boolean {
    return this.reads.length > 0 || this.source.flatImage !== null
  }

  // The tiles every channel reads under a rect of the frame.
  tileCount(rect: ScreenshotRect): number {
    return this.reads.reduce(
      (count, read) => count + this.tilesUnder(read, rect).length,
      0,
    )
  }

  // Draws the image under a rect of the frame into a context the size of
  // the rect in the screenshot's pixels, which it clears first.
  async drawTile(context: CanvasRenderingContext2D, rect: ScreenshotRect): Promise<void> {
    const { scale, signal } = this.options
    const viewport = { width: rect.width * scale, height: rect.height * scale }
    const viewState = scaledViewState(
      screenshotTileViewState(this.options.viewState, this.options.frame, rect),
      scale,
    )

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, viewport.width, viewport.height)
    throwIfAborted(signal)

    if (this.reads.length === 0) {
      await this.drawFlatImage(context, viewState, viewport)
      return
    }

    const queue: TileRead[] = this.reads.flatMap((read, channelIndex) =>
      this.tilesUnder(read, rect).map((tile) => ({ channelIndex, tile })),
    )
    let next = 0
    const work = async () => {
      while (next < queue.length) {
        const index = next
        next += 1
        const item = queue[index]
        if (item === undefined) return
        const upcoming = queue
          .slice(index + 1, index + 1 + UPCOMING_TILES)
          .filter((other) => other.channelIndex === item.channelIndex)
          .map((other) => other.tile)
        const ready = await this.readTile(item, upcoming)
        throwIfAborted(signal)
        addMorphologyTileChannels(
          context,
          this.batches(item, ready),
          viewState,
          viewport,
          1,
        )
        this.options.onTileDrawn?.()
      }
    }
    const workers = Math.max(
      1,
      Math.min(this.options.maxConcurrentRequests, queue.length),
    )

    await Promise.all(Array.from({ length: workers }, work))
  }

  dispose(): void {
    for (const read of this.reads) {
      read.cache.clear()
    }
    this.flatImage = null
  }

  private tilesUnder(read: ChannelRead, rect: ScreenshotRect): readonly TileIndex[] {
    return screenshotImageTiles(
      read.channel.loader,
      read.level,
      this.options.viewState,
      this.options.frame,
      rect,
    )
  }

  // Each channel in its colour, with only this tile: the canvas's rules for
  // one channel or many.
  private batches(
    item: TileRead,
    entry: TileReadyEntry,
  ): readonly MorphologyChannelTileBatch[] {
    return this.reads.map((read, index) => {
      const { placement } = read.channel.loader

      return {
        color: read.channel.color,
        opacity: normalizeLayerOpacity(read.channel.opacity ?? 1),
        tiles:
          index === item.channelIndex
            ? [
                {
                  id: read.cache.key(entry.level, item.tile.col, item.tile.row),
                  level: entry.level,
                  image: entry.bitmap,
                  bounds: entry.bounds,
                  sourceWidth: entry.sourceWidth,
                  sourceHeight: entry.sourceHeight,
                },
              ]
            : [],
        ...(placement === undefined ? {} : { placement }),
      }
    })
  }

  // A tile read through the screenshot's cache, read again after each of
  // TILE_RETRY_DELAYS_MS as the canvas's tiles are.
  private async readTile(
    item: TileRead,
    upcoming: readonly TileIndex[],
  ): Promise<TileReadyEntry> {
    const read = this.reads[item.channelIndex]
    if (read === undefined) throw new Error('No such channel.')
    const { signal } = this.options
    const loader: ImagePyramidLoader = read.channel.loader
    const waitUntil = this.options.waitUntil ?? waitUntilTime

    for (let failures = 0; ;) {
      const entry = await read.cache.request(
        loader,
        read.level,
        item.tile.col,
        item.tile.row,
        signal,
        { upcoming, persist: false },
      )
      throwIfAborted(signal)

      if (entry.state === 'ready') return entry
      if (entry.state === 'loading') continue
      if (isAbortError(entry.error)) throw abortError(signal)

      failures += 1
      if (entry.retryAt === undefined || failures > TILE_RETRY_DELAYS_MS.length) {
        throw new ScreenshotImageError(channelName(read.channel), entry.error)
      }
      await waitUntil(entry.retryAt, signal)
    }
  }

  private async drawFlatImage(
    context: CanvasRenderingContext2D,
    viewState: OverviewViewState,
    viewport: { readonly width: number; readonly height: number },
  ): Promise<void> {
    const flat = this.source.flatImage
    if (flat === null) return

    this.flatImage ??= (this.options.loadFlatImage ?? loadFlatImageElement)(flat.url)
    const element = await this.flatImage
    throwIfAborted(this.options.signal)
    const size = flat.size ?? element.naturalSize
    if (size === null) return

    drawFlatImage(
      context,
      {
        image: element.image,
        size,
        scaleFactor: flat.scaleFactor,
        micrometersPerPixel: flat.micrometersPerPixel,
      },
      viewState,
      viewport,
    )
    this.options.onTileDrawn?.()
  }
}

function channelName(channel: MorphologyCanvasChannel): string {
  return (
    channel.loader.channels.find((info) => info.id === channel.id)?.name ?? channel.id
  )
}

async function loadFlatImageElement(url: string): Promise<FlatImageElement> {
  const image = await new MorphologyTileStore().flatImage(url)
  return {
    image,
    naturalSize:
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? [image.naturalWidth, image.naturalHeight]
        : null,
  }
}

// Resolves once Date.now() reaches the time. A timer can fire a moment
// before Date.now() does, so it waits again until it has (PR #426).
export function waitUntilTime(time: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const check = () => {
      const left = time - Date.now()
      if (left <= 0) {
        signal.removeEventListener('abort', onAbort)
        resolve()
        return
      }
      timer = setTimeout(check, left)
    }

    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    check()
  })
}
