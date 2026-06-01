import { createWorkerTileDecoder } from '../workers/tileDecodePool'
import type { DisplayWindow } from '../codecs/jpeg2000'
import type { BBox, ImagePixels } from '../data/coords'
import type { TileBitmapDecoder } from '../workers/tileDecodePool'

export interface TileSource {
  tileBounds(level: number, col: number, row: number): BBox
  tileSourceSize(level: number, col: number, row: number): TileSourceSize
  fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

export interface TileSourceSize {
  readonly width: ImagePixels
  readonly height: ImagePixels
}

export interface TileCacheOptions {
  readonly maxTiles?: number
  readonly decodeTile?: TileBitmapDecoder
  readonly onError?: (error: Error) => void
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
}

export interface ReadyTile {
  readonly id: string
  readonly level: number
  readonly image: ImageBitmap
  readonly bounds: BBox
  readonly sourceWidth: ImagePixels
  readonly sourceHeight: ImagePixels
}

export class TileCache {
  private readonly cache = new Map<string, TileCacheEntry>()
  private readonly order: string[] = []
  private readonly maxTiles: number
  private readonly decodeTile: TileBitmapDecoder
  private readonly onError: (error: Error) => void
  private displayWindow: DisplayWindow | undefined

  constructor(options: TileCacheOptions) {
    this.maxTiles = options.maxTiles ?? 150
    this.decodeTile = options.decodeTile ?? createWorkerTileDecoder()
    this.onError = options.onError ?? noop
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
  ): Promise<TileCacheEntry> {
    const key = this.key(level, col, row)
    const existing = this.cache.get(key)

    if (existing !== undefined) {
      if (existing.state === 'loading' && existing.signal?.aborted) {
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
    const promise = this.load(loader, level, col, row, key, bounds, sourceSize, signal)
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

  clear(): void {
    for (const entry of this.cache.values()) {
      if (entry.state === 'ready') {
        entry.bitmap.close()
      }
    }

    this.cache.clear()
    this.order.splice(0)
    this.displayWindow = undefined
  }

  private async load(
    loader: TileSource,
    level: number,
    col: number,
    row: number,
    key: string,
    bounds: BBox,
    sourceSize: TileSourceSize,
    signal?: AbortSignal,
  ): Promise<TileCacheEntry> {
    try {
      throwIfAborted(signal)
      const bytes = await loader.fetchTileBytes(level, col, row, signal)
      throwIfAborted(signal)
      const decoded = await this.decodeTile(bytes, this.displayWindow)

      if (signal?.aborted) {
        decoded.bitmap.close()
        throw abortError(signal)
      }

      this.displayWindow ??= { lo: decoded.lo, hi: decoded.hi }

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
      const error = cause instanceof Error ? cause : new Error(String(cause))

      if (isAbortError(error)) {
        if (this.isCurrentLoading(key, signal)) {
          this.cache.delete(key)
          this.removeFromOrder(key)
        }

        return { state: 'error', bounds, error }
      }

      const failed: TileErrorEntry = {
        state: 'error',
        bounds,
        error,
      }

      this.cache.set(key, failed)
      this.onError(error)
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
    }
  }

  private isCurrentLoading(key: string, signal: AbortSignal | undefined): boolean {
    const entry = this.cache.get(key)
    return entry?.state === 'loading' && entry.signal === signal
  }
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

function noop(): void {}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Tile request aborted.')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: Error): boolean {
  return error.name === 'AbortError'
}
