import { createWorkerTileDecoder } from '../workers/tileDecodePool'
import type { DisplayWindow } from '../codecs/jpeg2000'
import type { BBox } from '../data/coords'
import type { TileBitmapDecoder } from '../workers/tileDecodePool'

export interface TileSource {
  tileBounds(level: number, col: number, row: number): BBox
  fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
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
}

export interface TileReadyEntry {
  readonly state: 'ready'
  readonly bounds: BBox
  readonly bitmap: ImageBitmap
}

export interface TileErrorEntry {
  readonly state: 'error'
  readonly bounds: BBox
  readonly error: Error
}

export interface ReadyTile {
  readonly id: string
  readonly image: ImageBitmap
  readonly bounds: BBox
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
      this.touch(key)
      return existing.state === 'loading' ? existing.promise : existing
    }

    const bounds = loader.tileBounds(level, col, row)
    const promise = this.load(loader, level, col, row, key, bounds, signal)
    const entry: TileLoadingEntry = {
      state: 'loading',
      bounds,
      promise,
    }

    this.cache.set(key, entry)
    this.order.push(key)
    this.evict()

    return promise
  }

  readyTiles(bbox: BBox): readonly ReadyTile[] {
    const ready: ReadyTile[] = []

    for (const [id, entry] of this.cache.entries()) {
      if (entry.state !== 'ready' || !bboxesOverlap(entry.bounds, bbox)) {
        continue
      }

      ready.push({ id, image: entry.bitmap, bounds: entry.bounds })
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
    signal?: AbortSignal,
  ): Promise<TileCacheEntry> {
    try {
      const bytes = await loader.fetchTileBytes(level, col, row, signal)
      const decoded = await this.decodeTile(bytes, this.displayWindow)

      this.displayWindow ??= { lo: decoded.lo, hi: decoded.hi }

      if (!this.cache.has(key)) {
        decoded.bitmap.close()
        return {
          state: 'error',
          bounds,
          error: new Error(`Tile ${key} was evicted before decode completed.`),
        }
      }

      const ready: TileReadyEntry = {
        state: 'ready',
        bounds,
        bitmap: decoded.bitmap,
      }

      this.cache.set(key, ready)
      this.touch(key)
      this.evict()
      return ready
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
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
    const index = this.order.indexOf(key)

    if (index >= 0) {
      this.order.splice(index, 1)
    }

    this.order.push(key)
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
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

function noop(): void {}
