import { TileCache } from '../tiff/tileCache'
import { TileRequestScheduler, TileRequestSlots } from '../tiff/tileRequestScheduler'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import type { TileCacheOptions } from '../tiff/tileCache'

// The decoded tiles of one image channel at one contrast, and the requests
// that fill them.
export interface MorphologyTileChannel {
  readonly cache: TileCache
  readonly scheduler: TileRequestScheduler<ImagePyramidLoader>
  readonly maxTiles: number
}

export interface MorphologyTileChannelSpec {
  readonly key: string
  // Channels that differ only in their plane: one image channel in one colour
  // and contrast at each time point or z plane (plan 28-D8). One that no
  // canvas draws is kept for replay while a canvas draws one of its group,
  // within the limit given to `use`.
  readonly replayGroup?: string
  // Makes the channel's cache the first time a canvas draws it, given how
  // many other channels stay drawn (kept ones are not counted).
  readonly cacheOptions: (heldChannels: number) => TileCacheOptions & {
    readonly maxTiles: number
  }
}

export interface MorphologyTileStoreOptions {
  // Requests in flight over every channel and canvas.
  readonly maxConcurrentRequests?: number
  // Tiles just outside a canvas's view, read before it pans to them.
  readonly prefetch?: boolean
}

export interface MorphologyTileUseOptions {
  // Pixels of decoded tiles kept for replay over every channel no canvas
  // draws; none by default.
  readonly replayPixels?: number
}

interface HeldChannel extends MorphologyTileChannel {
  readonly canvases: Set<unknown>
  readonly replayGroup: string | undefined
}

// The tiles of the channels one or more `MorphologyCanvas`es draw (plan
// 23-D11), and their flat images. A canvas makes its own store unless given
// one: the main view, the minimap and the slide images each keep their own,
// and the Cell Query pictures share one, so neighbouring cells decode a
// shared tile once, a Visium image is decoded once for every picture, and
// their requests stay under one limit.
//
// A canvas names itself when it draws. A channel stays while a canvas draws
// it; one a canvas moves off goes once no canvas draws it, and one whose
// canvases unmount stays for the canvases that come next, until another
// channel set or `dispose`.
//
// A channel with a replay group that no canvas draws stays while a canvas
// draws its group, the most recently drawn first, until its tiles pass the
// replay limit: played time points then show again from memory.
export class MorphologyTileStore {
  readonly prefetch: boolean
  private readonly channels = new Map<string, HeldChannel>()
  // Keys of channels kept for replay, the least recently drawn first.
  private readonly replay = new Set<string>()
  private readonly flatImages = new Map<string, Promise<HTMLImageElement>>()
  private readonly slots: TileRequestSlots | undefined

  constructor(options: MorphologyTileStoreOptions = {}) {
    this.prefetch = options.prefetch ?? true
    this.slots =
      options.maxConcurrentRequests === undefined
        ? undefined
        : new TileRequestSlots(options.maxConcurrentRequests)
  }

  // The channels a canvas draws now, in the order given.
  use(
    canvas: unknown,
    specs: readonly MorphologyTileChannelSpec[],
    options: MorphologyTileUseOptions = {},
  ): readonly MorphologyTileChannel[] {
    const replayPixels = options.replayPixels ?? 0
    const keys = new Set(specs.map((spec) => spec.key))
    const used = specs.map((spec) => {
      let held = this.channels.get(spec.key)

      if (held === undefined) {
        const cacheOptions = spec.cacheOptions(this.drawnChannelCount(canvas, keys))
        const cache = new TileCache(cacheOptions)
        held = {
          cache,
          scheduler: new TileRequestScheduler<ImagePyramidLoader>(cache, this.slots),
          maxTiles: cacheOptions.maxTiles,
          canvases: new Set(),
          replayGroup: spec.replayGroup,
        }
        this.channels.set(spec.key, held)
      }

      this.replay.delete(spec.key)
      held.canvases.add(canvas)
      return held
    })

    for (const [key, held] of this.channels) {
      if (keys.has(key) || this.replay.has(key)) {
        continue
      }

      if (held.canvases.delete(canvas)) {
        held.scheduler.release(canvas)
      }

      if (held.canvases.size === 0) {
        if (held.replayGroup !== undefined && replayPixels > 0) {
          this.replay.add(key)
        } else {
          this.drop(key, held)
        }
      }
    }

    this.trimReplay(replayPixels)
    return used
  }

  // A canvas that stops drawing, as when it unmounts: its requests stop, and
  // the tiles stay.
  release(canvas: unknown): void {
    for (const held of this.channels.values()) {
      if (held.canvases.delete(canvas)) {
        held.scheduler.release(canvas)
      }
    }
  }

  // A flat image (Visium), decoded once for every canvas of the store. The
  // store keeps the latest image only, as a canvas showing another dataset
  // needs the old one no more. One that fails is read again next time.
  flatImage(url: string): Promise<HTMLImageElement> {
    const known = this.flatImages.get(url)
    if (known !== undefined) return known

    const image = decodeFlatImage(url)
    this.flatImages.clear()
    this.flatImages.set(url, image)
    image.catch(() => {
      if (this.flatImages.get(url) === image) this.flatImages.delete(url)
    })
    return image
  }

  dispose(): void {
    for (const [key, held] of this.channels) {
      this.drop(key, held)
    }
    this.flatImages.clear()
  }

  // Channels drawn once `canvas` draws `keys`: those, and others' channels.
  private drawnChannelCount(canvas: unknown, keys: ReadonlySet<string>): number {
    let count = 0

    for (const [key, held] of this.channels) {
      if (keys.has(key) || [...held.canvases].some((other) => other !== canvas)) {
        count += 1
      }
    }

    return count
  }

  // Drops kept channels whose group no canvas draws, then the least recently
  // drawn until the rest fit the limit.
  private trimReplay(replayPixels: number): void {
    const drawnGroups = new Set<string | undefined>()

    for (const held of this.channels.values()) {
      if (held.canvases.size > 0) {
        drawnGroups.add(held.replayGroup)
      }
    }

    let pixels = 0

    for (const key of [...this.replay].reverse()) {
      const held = this.channels.get(key)

      if (held === undefined) {
        this.replay.delete(key)
        continue
      }

      if (!drawnGroups.has(held.replayGroup)) {
        this.drop(key, held)
        continue
      }

      pixels += held.cache.readyPixels()

      if (pixels > replayPixels) {
        this.drop(key, held)
      }
    }
  }

  private drop(key: string, held: HeldChannel): void {
    held.scheduler.cancel()
    held.cache.clear()
    this.channels.delete(key)
    this.replay.delete(key)
  }
}

// The browser says only "The source image cannot be decoded." for an image
// that is missing, blocked by CORS or damaged, so the error names the address
// (EXP-327).
export class FlatImageLoadError extends Error {
  constructor(url: string, cause?: unknown) {
    super(
      cause instanceof Error && cause.message.length > 0
        ? `Failed to load flat morphology image ${url}: ${cause.message}`
        : `Failed to load flat morphology image ${url}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'FlatImageLoadError'
  }
}

function decodeFlatImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'

  const ready =
    typeof image.decode === 'function'
      ? null
      : new Promise<void>((resolve, reject) => {
          image.onload = () => {
            resolve()
          }
          image.onerror = () => {
            reject(new FlatImageLoadError(url))
          }
        })

  image.src = url

  return (ready ?? image.decode()).then(
    () => image,
    (error: unknown) => {
      throw error instanceof FlatImageLoadError
        ? error
        : new FlatImageLoadError(url, error)
    },
  )
}
