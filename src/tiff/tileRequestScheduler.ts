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

interface ClientTiles {
  readonly tiles: readonly QueuedTile[]
  readonly keys: ReadonlySet<string>
  readonly priority: number
  readonly order: number
  readonly onSettled: () => void
}

// The view of a scheduler used by one canvas alone.
const ONLY_CLIENT = Symbol('only client')

// A limit on requests in flight shared by several schedulers, such as one per
// channel of every cell picture (plan 23-D11). A scheduler held back by it
// starts again when another frees a slot.
export class TileRequestSlots {
  private used = 0
  private readonly waiting = new Set<() => void>()

  constructor(readonly limit: number) {}

  get inUse(): number {
    return this.used
  }

  take(onFree: () => void): boolean {
    if (this.used >= this.limit) {
      this.waiting.add(onFree)
      return false
    }

    this.used += 1
    return true
  }

  give(count = 1): void {
    if (count <= 0) {
      return
    }

    this.used = Math.max(0, this.used - count)
    const waiting = [...this.waiting]
    this.waiting.clear()

    for (const pump of waiting) {
      pump()
    }
  }
}

// Loads the tiles a view wants, a few at a time and nearest first. When the
// view moves, tiles still wanted keep loading and only those no longer wanted
// are cancelled, so tiles keep arriving while the view pans.
//
// Each tile fetch is told which tiles are still queued, so a loader can read
// those stored beside it in the same request. A tile whose bytes then come
// from another tile's request gives up its slot, so the limit counts requests
// rather than tiles.
//
// Several canvases can share a scheduler, each naming itself as a client: the
// tiles wanted are those of every client, the lowest priority first, and a
// tile is cancelled once no client wants it.
//
// A tile whose read failed and may be read again (the cache's retryAt) is
// asked for again once that time comes, if a client still wants it, so it is
// drawn without waiting for the view to move.
export class TileRequestScheduler<Loader> {
  private readonly inFlight = new Map<string, AbortController>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  // In-flight tiles that count against the limit.
  private readonly holdingSlots = new Set<string>()
  private readonly clients = new Map<unknown, ClientTiles>()
  private queue: QueuedTile[] = []
  private loader: Loader | null = null
  private maxConcurrentRequests = 1
  private updates = 0
  private readonly pumpLater = () => {
    this.pump()
  }

  constructor(
    private readonly cache: TileRequestCache<Loader>,
    private readonly slots?: TileRequestSlots,
  ) {}

  update(options: {
    readonly loader: Loader
    readonly level: number
    // In priority order.
    readonly tiles: readonly TileIndex[]
    readonly maxConcurrentRequests: number
    readonly onSettled: () => void
    // A canvas sharing the scheduler; one used alone leaves it out.
    readonly client?: unknown
    // Lower goes first among clients; ties go in the order clients came.
    readonly priority?: number
  }): void {
    if (this.loader !== null && this.loader !== options.loader) {
      this.cancelInFlight()
    }

    this.loader = options.loader
    this.maxConcurrentRequests = Math.max(1, options.maxConcurrentRequests)

    const client = options.client ?? ONLY_CLIENT
    const tiles = options.tiles.map((tile) => ({
      key: `${options.level}:${tile.col}:${tile.row}`,
      level: options.level,
      col: tile.col,
      row: tile.row,
    }))

    this.clients.set(client, {
      tiles,
      keys: new Set(tiles.map((tile) => tile.key)),
      priority: options.priority ?? 0,
      order: this.clients.get(client)?.order ?? this.updates++,
      onSettled: options.onSettled,
    })
    this.replan()
  }

  // A client that wants no more tiles, such as a canvas that unmounts.
  release(client: unknown): void {
    if (this.clients.delete(client)) {
      this.replan()
    }
  }

  cancel(): void {
    this.clients.clear()
    this.cancelInFlight()
  }

  private cancelInFlight(): void {
    for (const controller of this.inFlight.values()) {
      controller.abort()
    }

    for (const timer of this.retries.values()) {
      clearTimeout(timer)
    }
    this.retries.clear()

    const freed = this.holdingSlots.size
    this.inFlight.clear()
    this.holdingSlots.clear()
    this.queue = []
    this.slots?.give(freed)
  }

  private replan(): void {
    const wanted = this.wantedTiles()
    const wantedKeys = new Set(wanted.map((tile) => tile.key))
    const unwanted = [...this.inFlight].filter(([key]) => !wantedKeys.has(key))

    // The queue is set before slots are freed, since a freed slot can start
    // this scheduler's next tile.
    this.queue = wanted.filter((tile) => !this.inFlight.has(tile.key))

    for (const [key, controller] of unwanted) {
      controller.abort()
      this.inFlight.delete(key)
      this.freeSlot(key)
    }

    this.pump()
  }

  private wantedTiles(): readonly QueuedTile[] {
    const clients = [...this.clients.values()].sort(
      (a, b) => a.priority - b.priority || a.order - b.order,
    )

    if (clients.length === 1) {
      return clients[0]?.tiles ?? []
    }

    const seen = new Set<string>()
    const wanted: QueuedTile[] = []

    for (const client of clients) {
      for (const tile of client.tiles) {
        if (!seen.has(tile.key)) {
          seen.add(tile.key)
          wanted.push(tile)
        }
      }
    }

    return wanted
  }

  private freeSlot(key: string): boolean {
    if (!this.holdingSlots.delete(key)) {
      return false
    }

    this.slots?.give()
    return true
  }

  // `time` is the cache's retryAt, in Date.now() ms. Timers keep another clock
  // and can fire a millisecond before Date.now() reaches it; the cache would
  // then hand back the failure unread, and the tile would settle (and its
  // canvas redraw) once more, so an early timer waits again.
  private retryAt(tile: QueuedTile, time: number): void {
    clearTimeout(this.retries.get(tile.key))
    this.retries.set(
      tile.key,
      setTimeout(
        () => {
          this.retries.delete(tile.key)

          if (
            this.inFlight.has(tile.key) ||
            this.queue.some((queued) => queued.key === tile.key) ||
            !this.wantedTiles().some((wanted) => wanted.key === tile.key)
          ) {
            return
          }

          if (Date.now() < time) {
            this.retryAt(tile, time)
            return
          }

          this.queue.unshift(tile)
          this.pump()
        },
        Math.max(0, time - Date.now()),
      ),
    )
  }

  private pump(): void {
    const loader = this.loader

    while (
      loader !== null &&
      this.holdingSlots.size < this.maxConcurrentRequests &&
      this.queue.length > 0 &&
      (this.slots?.take(this.pumpLater) ?? true)
    ) {
      const tile = this.queue.shift()

      if (tile === undefined) {
        this.slots?.give()
        return
      }

      const controller = new AbortController()
      this.inFlight.set(tile.key, controller)
      this.holdingSlots.add(tile.key)
      const isCurrent = () => this.inFlight.get(tile.key) === controller
      const settle = (entry: TileCacheEntry | null) => {
        if (isCurrent()) {
          this.inFlight.delete(tile.key)
          this.freeSlot(tile.key)
        }

        if (
          !controller.signal.aborted &&
          entry !== null &&
          !(entry.state === 'error' && entry.error.name === 'AbortError')
        ) {
          if (entry.state === 'error' && entry.retryAt !== undefined) {
            this.retryAt(tile, entry.retryAt)
          }

          for (const client of this.clients.values()) {
            if (client.keys.has(tile.key)) {
              client.onSettled()
            }
          }
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
            if (isCurrent() && this.freeSlot(tile.key)) {
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
