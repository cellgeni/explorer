import type { TileIndex } from '../data/coords'
import type { ImagePyramidTileFetchOptions } from '../data/imagePyramid'
import type { TileCacheEntry } from './tileCache'

export interface TileRequestCache<Loader> {
  request(
    loader: Loader,
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
    fetchOptions?: ImagePyramidTileFetchOptions,
  ): Promise<TileCacheEntry>
}

interface QueuedTile {
  readonly key: string
  readonly level: number
  readonly col: number
  readonly row: number
}

// Loads the tiles a view wants, a few at a time and nearest first. When the
// view moves, tiles still wanted keep loading and only those no longer wanted
// are cancelled, so tiles keep arriving while the view pans.
//
// Each tile fetch is told which tiles are still queued, so a loader can read
// those stored beside it in the same request. A tile whose bytes then come
// from another tile's request gives up its slot, so the limit counts requests
// rather than tiles.
export class TileRequestScheduler<Loader> {
  private readonly inFlight = new Map<string, AbortController>()
  // In-flight tiles that count against the limit.
  private readonly holdingSlots = new Set<string>()
  private queue: QueuedTile[] = []
  private loader: Loader | null = null
  private maxConcurrentRequests = 1
  private onSettled: () => void = () => {}

  constructor(private readonly cache: TileRequestCache<Loader>) {}

  update(options: {
    readonly loader: Loader
    readonly level: number
    // In priority order.
    readonly tiles: readonly TileIndex[]
    readonly maxConcurrentRequests: number
    readonly onSettled: () => void
  }): void {
    if (this.loader !== null && this.loader !== options.loader) {
      this.cancel()
    }

    this.loader = options.loader
    this.maxConcurrentRequests = Math.max(1, options.maxConcurrentRequests)
    this.onSettled = options.onSettled

    const wanted = options.tiles.map((tile) => ({
      key: `${options.level}:${tile.col}:${tile.row}`,
      level: options.level,
      col: tile.col,
      row: tile.row,
    }))
    const wantedKeys = new Set(wanted.map((tile) => tile.key))

    for (const [key, controller] of this.inFlight) {
      if (!wantedKeys.has(key)) {
        controller.abort()
        this.inFlight.delete(key)
        this.holdingSlots.delete(key)
      }
    }

    this.queue = wanted.filter((tile) => !this.inFlight.has(tile.key))
    this.pump()
  }

  cancel(): void {
    for (const controller of this.inFlight.values()) {
      controller.abort()
    }

    this.inFlight.clear()
    this.holdingSlots.clear()
    this.queue = []
  }

  private pump(): void {
    const loader = this.loader

    while (
      loader !== null &&
      this.holdingSlots.size < this.maxConcurrentRequests &&
      this.queue.length > 0
    ) {
      const tile = this.queue.shift()

      if (tile === undefined) {
        return
      }

      const controller = new AbortController()
      this.inFlight.set(tile.key, controller)
      this.holdingSlots.add(tile.key)
      const isCurrent = () => this.inFlight.get(tile.key) === controller
      const settle = (entry: TileCacheEntry | null) => {
        if (isCurrent()) {
          this.inFlight.delete(tile.key)
          this.holdingSlots.delete(tile.key)
        }

        if (
          !controller.signal.aborted &&
          entry !== null &&
          !(entry.state === 'error' && entry.error.name === 'AbortError')
        ) {
          this.onSettled()
        }

        this.pump()
      }
      const upcoming = this.queue
        .filter((queued) => queued.level === tile.level)
        .map(({ col, row }) => ({ col, row }))

      void this.cache
        .request(loader, tile.level, tile.col, tile.row, controller.signal, {
          upcoming,
          onSharedRead: () => {
            if (isCurrent() && this.holdingSlots.delete(tile.key)) {
              this.pump()
            }
          },
        })
        .then(settle, () => {
          settle(null)
        })
    }
  }
}
