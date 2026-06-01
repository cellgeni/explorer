import { normaliseToRgba } from '../codecs/jpeg2000'
import type { DecodedJpeg2000, DisplayWindow } from '../codecs/jpeg2000'
import type { BBox } from '../data/coords'

export interface TileSource {
  tileBounds(level: number, col: number, row: number): BBox
  fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

export type TileDecoder = (bytes: Uint8Array) => Promise<DecodedJpeg2000>
export type BitmapFactory = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) => Promise<ImageBitmap>

export interface TileCacheOptions {
  readonly maxTiles?: number
  readonly decodeTile: TileDecoder
  readonly createBitmap?: BitmapFactory
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
  private readonly decodeTile: TileDecoder
  private readonly createBitmap: BitmapFactory
  private displayWindow: DisplayWindow | undefined

  constructor(options: TileCacheOptions) {
    this.maxTiles = options.maxTiles ?? 150
    this.decodeTile = options.decodeTile
    this.createBitmap = options.createBitmap ?? defaultCreateBitmap
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
      const decoded = await this.decodeTile(bytes)
      const rgba = normaliseToRgba(
        decoded.pixels,
        decoded.width,
        decoded.height,
        this.displayWindow,
      )

      this.displayWindow ??= { lo: rgba.lo, hi: rgba.hi }

      const bitmap = await this.createBitmap(rgba.rgba, decoded.width, decoded.height)

      if (!this.cache.has(key)) {
        bitmap.close()
        return {
          state: 'error',
          bounds,
          error: new Error(`Tile ${key} was evicted before decode completed.`),
        }
      }

      const ready: TileReadyEntry = {
        state: 'ready',
        bounds,
        bitmap,
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

async function defaultCreateBitmap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw new Error('createImageBitmap is not available in this runtime.')
  }

  const imageDataArray: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(rgba)
  const imageData = new ImageData(imageDataArray, width, height)

  return globalThis.createImageBitmap(imageData)
}
