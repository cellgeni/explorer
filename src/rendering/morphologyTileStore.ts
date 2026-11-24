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
  // Makes the channel's cache the first time a canvas draws it, given how
  // many channels the store holds.
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

interface HeldChannel extends MorphologyTileChannel {
  readonly canvases: Set<unknown>
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
export class MorphologyTileStore {
  readonly prefetch: boolean
  private readonly channels = new Map<string, HeldChannel>()
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
  ): readonly MorphologyTileChannel[] {
    const used = specs.map((spec) => {
      let held = this.channels.get(spec.key)

      if (held === undefined) {
        const options = spec.cacheOptions(this.channels.size)
        const cache = new TileCache(options)
        held = {
          cache,
          scheduler: new TileRequestScheduler<ImagePyramidLoader>(cache, this.slots),
          maxTiles: options.maxTiles,
          canvases: new Set(),
        }
        this.channels.set(spec.key, held)
      }

      held.canvases.add(canvas)
      return held
    })
    const keys = new Set(specs.map((spec) => spec.key))

    for (const [key, held] of this.channels) {
      if (keys.has(key)) {
        continue
      }

      if (held.canvases.delete(canvas)) {
        held.scheduler.release(canvas)
      }

      if (held.canvases.size === 0) {
        this.drop(key, held)
      }
    }

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

  private drop(key: string, held: HeldChannel): void {
    held.scheduler.cancel()
    held.cache.clear()
    this.channels.delete(key)
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
