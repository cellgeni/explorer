import { createWorkerTileDecoder } from '../workers/tileDecodePool'
import type { DisplayWindow } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { BBox, ImagePixels } from '../data/coords'
import type {
  ImagePyramidDecodedTile,
  ImagePyramidTileFetchOptions,
  ImagePyramidTileRenderOptions,
} from '../data/imagePyramid'
import type { TileBitmapDecoder } from '../workers/tileDecodePool'
import { abortError, isAbortError, throwIfAborted } from '../utils/abort'
import { LiveInstances, registerMemoryReporter } from '../data/memoryTelemetry'

export interface TileSource {
  tileBounds(level: number, col: number, row: number): BBox
  tileSourceSize(level: number, col: number, row: number): TileSourceSize
  fetchTileBytes?(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
    options?: ImagePyramidTileFetchOptions,
  ): Promise<Uint8Array>
  tileDecodeOptions?(level: number, col: number, row: number): TiffTileDecodeMetadata
  loadTile?(
    level: number,
    col: number,
    row: number,
    options?: ImagePyramidTileRenderOptions,
    signal?: AbortSignal,
  ): Promise<ImagePyramidDecodedTile>
}

export interface TileSourceSize {
  readonly width: ImagePixels
  readonly height: ImagePixels
}

export interface TileCacheOptions {
  readonly maxTiles?: number
  readonly displayWindow?: DisplayWindow
  readonly color?: readonly [number, number, number]
  readonly alphaFromIntensity?: boolean
  readonly decodeTile?: TileBitmapDecoder
  readonly onError?: (error: Error) => void
  readonly onEvict?: (evictedTileCount: number) => void
}

export type TileCacheEntry = TileLoadingEntry | TileReadyEntry | TileErrorEntry

export interface TileLoadingEntry {
  readonly state: 'loading'
  readonly bounds: BBox
  readonly promise: Promise<TileCacheEntry>
  readonly signal?: AbortSignal
}

export interface TileReadyEntry {
  readonly state: 'ready'
  readonly level: number
  readonly bounds: BBox
  readonly bitmap: ImageBitmap
  readonly sourceWidth: ImagePixels
  readonly sourceHeight: ImagePixels
}

export interface TileErrorEntry {
  readonly state: 'error'
  readonly bounds: BBox
  readonly error: Error
  // Failed reads of the tile in a row, and when a request may read it again
  // (Date.now() ms). Left out on cancels, and retryAt once the retries are
  // spent.
  readonly failures?: number
  readonly retryAt?: number
}

// After a failed read, a request reads the tile again once each of these has
// passed: a dropped connection, a 503 or a decode-worker reset is often gone a
// moment later. The error is reported once they are spent, and the tile then
// keeps it until it is evicted or the cache cleared.
export const TILE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000]

export interface ReadyTile {
  readonly id: string
  readonly level: number
  readonly image: ImageBitmap
  readonly bounds: BBox
  readonly sourceWidth: ImagePixels
  readonly sourceHeight: ImagePixels
}

interface CachedTileKey {
  readonly level: number
  readonly col: number
  readonly row: number
  readonly key: string
}

// Every tile cache, for the memory table (O20): a decoded tile is an RGBA
// bitmap, 4 bytes a pixel.
const liveTileCaches = new LiveInstances<TileCache>()
registerMemoryReporter('Image tiles', () => {
  let entries = 0
  let pixels = 0

  for (const cache of liveTileCaches) {
    const held = cache.heldTiles()
    entries += held.tiles
    pixels += held.pixels
  }

  return { entries, workers: 0, bytes: pixels * 4 }
})

export class TileCache {
  private readonly cache = new Map<string, TileCacheEntry>()
  private readonly order: string[] = []
  private readonly maxTiles: number
  private readonly decodeTile: TileBitmapDecoder
  private readonly onError: (error: Error) => void
  private readonly onEvict: (evictedTileCount: number) => void
  private readonly initialDisplayWindow: DisplayWindow | undefined
  private displayWindow: DisplayWindow | undefined
  // The decode that will set the display window, while there is none.
  private windowDecode: Promise<void> | undefined
  private readonly color: readonly [number, number, number] | undefined
  private readonly alphaFromIntensity: boolean | undefined

  constructor(options: TileCacheOptions) {
    this.maxTiles = options.maxTiles ?? 150
    this.decodeTile = options.decodeTile ?? createWorkerTileDecoder()
    this.onError = options.onError ?? noop
    this.onEvict = options.onEvict ?? noopNumber
    this.initialDisplayWindow = options.displayWindow
    this.displayWindow = options.displayWindow
    this.color = options.color
    this.alphaFromIntensity = options.alphaFromIntensity
    liveTileCaches.add(this)
  }

  key(level: number, col: number, row: number): string {
    return `${level}:${col}:${row}`
  }

  get(level: number, col: number, row: number): TileCacheEntry | undefined {
    return this.cache.get(this.key(level, col, row))
  }

  async request(
    loader: TileSource,
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
    fetchOptions?: ImagePyramidTileFetchOptions,
  ): Promise<TileCacheEntry> {
    const key = this.key(level, col, row)
    const existing = this.cache.get(key)
    const failures = existing?.state === 'error' ? (existing.failures ?? 0) : 0

    if (existing !== undefined) {
      if (
        (existing.state === 'loading' && existing.signal?.aborted) ||
        (existing.state === 'error' &&
          existing.retryAt !== undefined &&
          Date.now() >= existing.retryAt)
      ) {
        this.cache.delete(key)
        this.removeFromOrder(key)
      } else {
        this.touch(key)
        return existing.state === 'loading' ? existing.promise : existing
      }
    }

    if (signal?.aborted) {
      return {
        state: 'error',
        bounds: loader.tileBounds(level, col, row),
        error: abortError(signal),
      }
    }

    const bounds = loader.tileBounds(level, col, row)
    const sourceSize = loader.tileSourceSize(level, col, row)
    const promise = this.load(
      loader,
      { level, col, row, key },
      failures,
      bounds,
      sourceSize,
      signal,
      fetchOptions,
    )
    const entry: TileLoadingEntry = {
      state: 'loading',
      bounds,
      promise,
      ...(signal === undefined ? {} : { signal }),
    }

    this.cache.set(key, entry)
    this.order.push(key)
    this.evict()

    return promise
  }

  readyTiles(bbox: BBox, level?: number): readonly ReadyTile[] {
    const ready: ReadyTile[] = []

    for (const [id, entry] of this.cache.entries()) {
      if (
        entry.state !== 'ready' ||
        (level !== undefined && entry.level !== level) ||
        !bboxesOverlap(entry.bounds, bbox)
      ) {
        continue
      }

      ready.push({
        id,
        level: entry.level,
        image: entry.bitmap,
        bounds: entry.bounds,
        sourceWidth: entry.sourceWidth,
        sourceHeight: entry.sourceHeight,
      })
    }

    return ready
  }

  // Pixels of the decoded tiles held, for a limit over several caches.
  readyPixels(): number {
    let pixels = 0

    for (const entry of this.cache.values()) {
      if (entry.state === 'ready') {
        pixels += entry.sourceWidth * entry.sourceHeight
      }
    }

    return pixels
  }

  // The decoded tiles held, and their bitmaps' pixels.
  heldTiles(): { readonly tiles: number; readonly pixels: number } {
    let tiles = 0
    let pixels = 0

    for (const entry of this.cache.values()) {
      if (entry.state === 'ready') {
        tiles += 1
        pixels += entry.bitmap.width * entry.bitmap.height
      }
    }

    return { tiles, pixels }
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      if (entry.state === 'ready') {
        entry.bitmap.close()
      }
    }

    this.cache.clear()
    this.order.splice(0)
    this.displayWindow = this.initialDisplayWindow
  }

  private async load(
    loader: TileSource,
    { level, col, row, key }: CachedTileKey,
    failures: number,
    bounds: BBox,
    sourceSize: TileSourceSize,
    signal?: AbortSignal,
    fetchOptions?: ImagePyramidTileFetchOptions,
  ): Promise<TileCacheEntry> {
    try {
      throwIfAborted(signal)
      const loadTile = loader.loadTile?.bind(loader)
      const decoded =
        loadTile === undefined
          ? await this.decodeFetchedTile(
              loader,
              level,
              col,
              row,
              signal,
              this.uncachedFetchOptions(level, fetchOptions),
            )
          : await this.decodeInDisplayWindow(signal, () =>
              loadTile(
                level,
                col,
                row,
                this.decodeOptions(loader, level, col, row),
                signal,
              ),
            )

      if (signal?.aborted) {
        decoded.bitmap.close()
        throw abortError(signal)
      }

      if (!this.isCurrentLoading(key, signal)) {
        decoded.bitmap.close()
        return {
          state: 'error',
          bounds,
          error: new Error(`Tile ${key} was evicted before decode completed.`),
        }
      }

      const ready: TileReadyEntry = {
        state: 'ready',
        level,
        bounds,
        bitmap: decoded.bitmap,
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height,
      }

      this.cache.set(key, ready)
      this.touch(key)
      this.evict()
      return ready
    } catch (cause) {
      // A read that fails after the tile was cancelled is a cancel, whatever
      // error the fetcher gave for it.
      const error =
        signal?.aborted === true
          ? abortError(signal)
          : cause instanceof Error
            ? cause
            : new Error(String(cause))

      if (isAbortError(error)) {
        if (this.isCurrentLoading(key, signal)) {
          this.cache.delete(key)
          this.removeFromOrder(key)
        }

        return { state: 'error', bounds, error }
      }

      const failed = failedTile(bounds, error, failures + 1)

      // A tile evicted while it loaded keeps nothing, nor overwrites a newer
      // read of it.
      if (!this.isCurrentLoading(key, signal)) {
        return failed
      }

      this.cache.set(key, failed)
      if (failed.retryAt === undefined) {
        this.onError(error)
      }
      return failed
    }
  }

  private touch(key: string): void {
    this.removeFromOrder(key)

    this.order.push(key)
  }

  private removeFromOrder(key: string): void {
    const index = this.order.indexOf(key)

    if (index >= 0) {
      this.order.splice(index, 1)
    }
  }

  private evict(): void {
    let evictedTileCount = 0

    while (this.order.length > this.maxTiles) {
      const oldest = this.order.shift()

      if (oldest === undefined) {
        return
      }

      const entry = this.cache.get(oldest)

      if (entry?.state === 'ready') {
        entry.bitmap.close()
      }

      this.cache.delete(oldest)
      evictedTileCount += 1
    }

    if (evictedTileCount > 0) {
      this.onEvict(evictedTileCount)
    }
  }

  private isCurrentLoading(key: string, signal: AbortSignal | undefined): boolean {
    const entry = this.cache.get(key)
    return entry?.state === 'loading' && entry.signal === signal
  }

  private decodeOptions(
    loader: TileSource,
    level: number,
    col: number,
    row: number,
  ): ImagePyramidTileRenderOptions {
    return {
      ...loader.tileDecodeOptions?.(level, col, row),
      ...(this.displayWindow === undefined ? {} : { displayWindow: this.displayWindow }),
      ...(this.color === undefined ? {} : { color: this.color }),
      ...(this.alphaFromIntensity === undefined
        ? {}
        : { alphaFromIntensity: this.alphaFromIntensity }),
    }
  }

  // Tiles this cache holds, loading or loaded, are not worth reading again
  // with another tile.
  private uncachedFetchOptions(
    level: number,
    options: ImagePyramidTileFetchOptions | undefined,
  ): ImagePyramidTileFetchOptions | undefined {
    if (options?.upcoming === undefined) {
      return options
    }

    return {
      ...options,
      upcoming: options.upcoming.filter(
        (tile) => !this.cache.has(this.key(level, tile.col, tile.row)),
      ),
    }
  }

  private async decodeFetchedTile(
    loader: TileSource,
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
    fetchOptions?: ImagePyramidTileFetchOptions,
  ): Promise<ImagePyramidDecodedTile> {
    if (loader.fetchTileBytes === undefined) {
      throw new Error('Tile source does not expose tile bytes or decoded tiles.')
    }

    const bytes = await loader.fetchTileBytes(level, col, row, signal, fetchOptions)
    throwIfAborted(signal)
    return this.decodeInDisplayWindow(signal, () =>
      this.decodeTile(bytes, this.decodeOptions(loader, level, col, row)),
    )
  }

  // A cache made without a display window takes the first decoded tile's.
  // Until then, tiles wait to decode one at a time: decoded together, each
  // would stretch its own contrast, and a single-level image draws those first
  // tiles again at every zoom.
  private async decodeInDisplayWindow(
    signal: AbortSignal | undefined,
    decode: () => Promise<ImagePyramidDecodedTile>,
  ): Promise<ImagePyramidDecodedTile> {
    while (this.displayWindow === undefined && this.windowDecode !== undefined) {
      await this.windowDecode
      throwIfAborted(signal)
    }

    if (this.displayWindow !== undefined) {
      return decode()
    }

    let settle = noop
    const windowDecode = new Promise<void>((resolve) => {
      settle = resolve
    })
    this.windowDecode = windowDecode

    try {
      const decoded = await decode()
      this.displayWindow ??= { lo: decoded.lo, hi: decoded.hi }
      return decoded
    } finally {
      if (this.windowDecode === windowDecode) {
        this.windowDecode = undefined
      }
      settle()
    }
  }
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

function failedTile(bounds: BBox, error: Error, failures: number): TileErrorEntry {
  const delay = TILE_RETRY_DELAYS_MS[failures - 1]

  return {
    state: 'error',
    bounds,
    error,
    failures,
    ...(delay === undefined ? {} : { retryAt: Date.now() + delay }),
  }
}

function noop(): void {}

function noopNumber(): void {}
