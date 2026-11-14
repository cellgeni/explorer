import * as zarr from 'zarrita'
import {
  imagePixels,
  micrometers,
  type BBox,
  type ImagePixels,
  type TileIndex,
  type UnitsDescriptor,
} from '../data/coords'
import type {
  ImagePyramidChannelInfo,
  ImagePyramidDecodedTile,
  ImagePyramidLoader,
  ImagePyramidTilePixels,
  ImagePyramidTileRenderOptions,
  ImagePyramidZStack,
} from '../data/imagePyramid'
import type { TileSamples, TileSampling } from '../data/tileSamples'
import type { Array as ZarrArray, DataType } from 'zarrita'
import {
  consolidatedZarrStore,
  createZarrFetchStore,
  readConsolidatedZarrMetadata,
  ZarrChunkUnavailableError,
  zarrArrayMetadata,
  zarrChunkKey,
} from './zarrStores'
import type { ZarrChunkSource, ZarrChunkWindow } from '../workers/zarrDecodeMessages'
import { sharedZarrDecodePool, type ZarrDecodePool } from '../workers/zarrDecodePool'
import { isIcechunkUrl } from './icechunkUrl'
import {
  isSupportedPixelArray,
  newPixelArray,
  numericPixelsToRgba,
} from './omeZarrPixels'

const DEFAULT_TILE_SIZE = 256
// Chunks larger than this are served as several virtual tiles, so a 4096²
// chunk does not become a 64 MB bitmap. The decoded chunk is cached and shared
// by its tiles and by per-channel loaders.
const MAX_VIRTUAL_TILE_SIZE = 512
const DECODED_CHUNK_CACHE_MAX_BYTES = 256 * 1024 * 1024
const MAX_SOURCE_PIXEL_SCREEN_SIZE = 1.5
const DEFAULT_CHANNEL_COLORS: readonly (readonly [number, number, number])[] = [
  [88, 144, 255],
  [32, 166, 122],
  [240, 200, 75],
  [215, 63, 124],
  [255, 253, 247],
]
const RGB_CHANNELS: readonly {
  readonly name: string
  readonly color: readonly [number, number, number]
}[] = [
  { name: 'Red', color: [255, 0, 0] },
  { name: 'Green', color: [0, 255, 0] },
  { name: 'Blue', color: [0, 0, 255] },
]

interface OpenOmeZarrImageOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly createBitmap?: (imageData: ImageData) => Promise<ImageBitmap>
  // Places level-0 pixels into an external coordinate system (for example a
  // SpatialData coordinate system). Replaces the multiscale-level
  // coordinateTransformations and axis units; per-level dataset scales still
  // apply.
  readonly planarTransform?: OmeZarrPlanarTransform
  // Opens the image group from an existing Zarr location (for example a
  // SpatialData store with consolidated metadata) instead of fetching `url`.
  readonly location?: zarr.Location<zarr.Readable>
  // Decodes tiles in workers; null decodes on the main thread. Defaults to the
  // shared pool when workers are available.
  readonly decodePool?: ZarrDecodePool | null
}

export interface OmeZarrPlanarTransform {
  readonly scaleX: number
  readonly scaleY: number
  readonly translateX: number
  readonly translateY: number
}

interface OmeZarrImageSelection {
  readonly sourceUrl: string
  readonly channelIndex?: number
  readonly zIndex?: number
}

interface OmeZarrAxis {
  readonly name: string
  readonly type?: string
  readonly unit?: string
}

interface OmeZarrDatasetMetadata {
  readonly path: string
  readonly coordinateTransformations?: readonly unknown[]
}

interface OmeZarrMultiscaleMetadata {
  readonly axes?: readonly unknown[]
  readonly coordinateTransformations?: readonly unknown[]
  readonly datasets: readonly OmeZarrDatasetMetadata[]
}

interface OmeZarrOmeroChannel {
  readonly label?: string
  readonly color?: unknown
  readonly window?: {
    readonly start?: unknown
    readonly end?: unknown
    readonly min?: unknown
    readonly max?: unknown
  }
}

interface OmeZarrLevelMeta {
  readonly path: string
  readonly array: ZarrArray<DataType, zarr.Readable>
  readonly width: ImagePixels
  readonly height: ImagePixels
  readonly chunkWidth: number
  readonly chunkHeight: number
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly xMicrometersPerPixel: number
  readonly yMicrometersPerPixel: number
}

interface OmeZarrLoaderOptions {
  readonly url: string
  readonly sourceUrl: string
  readonly levels: readonly OmeZarrLevelMeta[]
  readonly axes: readonly OmeZarrAxis[]
  readonly xAxis: number
  readonly yAxis: number
  readonly channelAxis?: number
  readonly selectedChannelIndex?: number
  // Index read on each axis other than x, y and channel, at level 0.
  readonly planeIndices: readonly number[]
  readonly channels: readonly ImagePyramidChannelInfo[]
  readonly zStack?: ImagePyramidZStack
  readonly units: UnitsDescriptor
  readonly origin?: { readonly x: number; readonly y: number }
  readonly createBitmap: (imageData: ImageData) => Promise<ImageBitmap>
  readonly decodePool?: ZarrDecodePool | null
}

export async function openOmeZarrImage(
  url: string,
  signal?: AbortSignal,
): Promise<OmeZarrImagePyramidLoader> {
  return openOmeZarrImageWithOptions(url, signal === undefined ? {} : { signal })
}

export async function openOmeZarrImageWithOptions(
  url: string,
  options: OpenOmeZarrImageOptions = {},
): Promise<OmeZarrImagePyramidLoader> {
  const selection = parseOmeZarrImageSelection(url)
  const sourceUrl = omeZarrImageRootUrl(selection.sourceUrl)
  const location = options.location ?? (await openImageStore(sourceUrl, options))
  const rootGroup = await zarr.open(location, {
    kind: 'group',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const group = await bioformats2rawImageGroup(rootGroup, options.signal)
  const declaredMultiscale = firstOmeZarrMultiscale(group.attrs)
  const planarTransform = options.planarTransform
  const multiscale: OmeZarrMultiscaleMetadata =
    planarTransform === undefined
      ? declaredMultiscale
      : {
          ...(declaredMultiscale.axes === undefined
            ? {}
            : { axes: declaredMultiscale.axes }),
          datasets: declaredMultiscale.datasets,
        }
  const firstDataset = multiscale.datasets[0]

  if (firstDataset === undefined) {
    throw new Error('OME-Zarr image does not declare any multiscale datasets.')
  }

  const firstArray = await zarr.open(group.resolve(firstDataset.path), {
    kind: 'array',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const axes = normalizeAxes(multiscale.axes, firstArray)
  const xAxis = findRequiredAxis(axes, 'x')
  const yAxis = findRequiredAxis(axes, 'y')
  const channelAxis = findOptionalChannelAxis(axes)
  const zAxis = findOptionalZAxis(axes)
  const levels = await Promise.all(
    multiscale.datasets.map(async (dataset) => {
      const array =
        dataset === firstDataset
          ? firstArray
          : await zarr.open(group.resolve(dataset.path), {
              kind: 'array',
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            })

      return levelMetaFromArray({
        array,
        axes,
        dataset,
        multiscale,
        path: dataset.path,
        xAxis,
        yAxis,
        ...(planarTransform === undefined
          ? {}
          : {
              planarScale: { x: planarTransform.scaleX, y: planarTransform.scaleY },
            }),
      })
    }),
  )
  const baseLevel = levels[0]

  if (baseLevel === undefined) {
    throw new Error('OME-Zarr image did not load any multiscale levels.')
  }

  const units: UnitsDescriptor = {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(baseLevel.xMicrometersPerPixel),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const planeIndices = initialPlaneIndices({
    axes,
    shape: firstArray.shape,
    attrs: group.attrs,
    zAxis,
    ...(selection.zIndex === undefined ? {} : { selectedZIndex: selection.zIndex }),
  })
  const sizeZ = zAxis === undefined ? 1 : (firstArray.shape[zAxis] ?? 1)
  const channels = buildOmeZarrChannels({
    array: firstArray,
    attrs: group.attrs,
    channelAxis,
    // Channel loaders read the plane this URL selects.
    sourceUrl:
      selection.zIndex === undefined
        ? selection.sourceUrl
        : omeZarrPlaneSelectionUrl(selection.sourceUrl, selection.zIndex),
    ...(sizeZ > 1 ? { sizeZ } : {}),
  })
  const micrometersPerPlane =
    zAxis === undefined
      ? undefined
      : micrometersPerPlaneForAxis({
          axis: zAxis,
          axes,
          dataset: firstDataset,
          multiscale,
        })
  const zStack: ImagePyramidZStack | undefined =
    zAxis === undefined || sizeZ <= 1 || channels.length === 0
      ? undefined
      : {
          sizeZ,
          ...(micrometersPerPlane === undefined ? {} : { micrometersPerPlane }),
          defaultZPlane: planeIndices[zAxis] ?? 0,
        }

  return new OmeZarrImagePyramidLoader({
    url,
    sourceUrl,
    levels,
    axes,
    xAxis,
    yAxis,
    ...(channelAxis === undefined ? {} : { channelAxis }),
    ...(selection.channelIndex === undefined
      ? {}
      : { selectedChannelIndex: selection.channelIndex }),
    planeIndices,
    channels,
    ...(zStack === undefined ? {} : { zStack }),
    units,
    ...(planarTransform === undefined
      ? {}
      : { origin: { x: planarTransform.translateX, y: planarTransform.translateY } }),
    createBitmap: options.createBitmap ?? createBitmapFromImageData,
    decodePool:
      options.decodePool === undefined ? sharedZarrDecodePool() : options.decodePool,
  })
}

// Uses consolidated metadata when the image root has it, so opening each
// pyramid level needs no per-array metadata requests. An Icechunk repository's
// snapshot holds every node's metadata.
async function openImageStore(
  url: string,
  options: Pick<OpenOmeZarrImageOptions, 'fetcher' | 'signal'>,
): Promise<zarr.AsyncReadable> {
  if (isIcechunkUrl(url)) {
    const { openIcechunkRepository } = await import('./icechunkStore')
    const repository = await openIcechunkRepository(url, options)
    return consolidatedZarrStore(repository.store, repository.metadata)
  }

  const base = createZarrFetchStore(
    url,
    options.fetcher === undefined ? {} : { fetcher: options.fetcher },
  )
  const consolidated = await readConsolidatedZarrMetadata(
    base,
    options.signal === undefined ? {} : { signal: options.signal },
  )

  return consolidated === null
    ? base
    : consolidatedZarrStore(base, consolidated.knownMetadata)
}

export function omeZarrImageRootUrl(url: string): string {
  const parsedUrl = new URL(url)

  parsedUrl.hash = ''

  if (/\/zarr\.json$/i.test(parsedUrl.pathname)) {
    parsedUrl.pathname = parsedUrl.pathname.slice(0, -'/zarr.json'.length)
  } else if (/\/\.zattrs$/i.test(parsedUrl.pathname)) {
    parsedUrl.pathname = parsedUrl.pathname.slice(0, -'/.zattrs'.length)
  }

  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '')
  return parsedUrl.toString()
}

export function omeZarrChannelSelectionUrl(url: string, channelIndex: number): string {
  return withHashParameter(url, 'c', channelIndex)
}

// The image read at index `zIndex` of its z axis.
export function omeZarrPlaneSelectionUrl(url: string, zIndex: number): string {
  return withHashParameter(url, 'z', zIndex)
}

function withHashParameter(url: string, name: string, value: number): string {
  const parsedUrl = new URL(url)
  const params = new URLSearchParams(
    parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash,
  )

  params.set(name, value.toString())
  parsedUrl.hash = params.toString()
  return parsedUrl.toString()
}

export class OmeZarrImagePyramidLoader implements ImagePyramidLoader {
  readonly url: string
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels: readonly ImagePyramidChannelInfo[]
  readonly zStack?: ImagePyramidZStack
  private readonly levels: readonly OmeZarrLevelMeta[]
  private readonly axes: readonly OmeZarrAxis[]
  private readonly xAxis: number
  private readonly yAxis: number
  private readonly channelAxis: number | undefined
  private readonly selectedChannelIndex: number | undefined
  private readonly planeIndices: readonly number[]
  private readonly originX: number
  private readonly originY: number
  private readonly sourceKey: string
  private readonly createBitmap: (imageData: ImageData) => Promise<ImageBitmap>
  private readonly decodePool: ZarrDecodePool | null

  constructor(options: OmeZarrLoaderOptions) {
    const firstLevel = options.levels[0]

    if (firstLevel === undefined) {
      throw new Error('OME-Zarr image requires at least one pyramid level.')
    }

    this.url = options.url
    this.levels = options.levels
    this.axes = options.axes
    this.xAxis = options.xAxis
    this.yAxis = options.yAxis
    this.channelAxis = options.channelAxis
    this.selectedChannelIndex = options.selectedChannelIndex
    this.planeIndices = options.planeIndices
    this.channels = options.channels

    if (options.zStack !== undefined) {
      this.zStack = options.zStack
    }

    this.units = options.units
    this.tileWidth = firstLevel.tileWidth
    this.tileHeight = firstLevel.tileHeight
    this.numLevels = options.levels.length
    this.imageWidth = firstLevel.width
    this.imageHeight = firstLevel.height
    this.originX = options.origin?.x ?? 0
    this.originY = options.origin?.y ?? 0
    this.sourceKey = options.sourceUrl
    this.createBitmap = options.createBitmap
    this.decodePool = options.decodePool ?? null
  }

  bestLevel(deckScale: number): number {
    for (let level = this.numLevels - 1; level >= 0; level -= 1) {
      const meta = this.levelMetaFor(level)
      const sourcePixelScreenSize = meta.xMicrometersPerPixel * deckScale

      if (sourcePixelScreenSize <= MAX_SOURCE_PIXEL_SCREEN_SIZE) {
        return level
      }
    }

    return 0
  }

  tilesForBbox(level: number, imageBbox: BBox): readonly TileIndex[] {
    const meta = this.levelMetaFor(level)
    const bbox = {
      minX: imageBbox.minX - this.originX,
      maxX: imageBbox.maxX - this.originX,
      minY: imageBbox.minY - this.originY,
      maxY: imageBbox.maxY - this.originY,
    }
    const nCols = Math.ceil(meta.width / meta.tileWidth)
    const nRows = Math.ceil(meta.height / meta.tileHeight)
    const col0 = Math.max(
      0,
      Math.floor(Math.max(0, bbox.minX / meta.xMicrometersPerPixel) / meta.tileWidth),
    )
    const col1 = Math.min(
      nCols - 1,
      Math.floor(
        Math.max(0, bbox.maxX / meta.xMicrometersPerPixel - 1e-9) / meta.tileWidth,
      ),
    )
    const row0 = Math.max(
      0,
      Math.floor(Math.max(0, bbox.minY / meta.yMicrometersPerPixel) / meta.tileHeight),
    )
    const row1 = Math.min(
      nRows - 1,
      Math.floor(
        Math.max(0, bbox.maxY / meta.yMicrometersPerPixel - 1e-9) / meta.tileHeight,
      ),
    )
    const tiles: TileIndex[] = []

    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) {
        tiles.push({ col, row })
      }
    }

    return tiles
  }

  tilesForLevel(level: number): readonly TileIndex[] {
    const meta = this.levelMetaFor(level)
    const tiles: TileIndex[] = []
    const nCols = Math.ceil(meta.width / meta.tileWidth)
    const nRows = Math.ceil(meta.height / meta.tileHeight)

    for (let row = 0; row < nRows; row += 1) {
      for (let col = 0; col < nCols; col += 1) {
        tiles.push({ col, row })
      }
    }

    return tiles
  }

  tileBounds(level: number, col: number, row: number): BBox {
    const meta = this.levelMetaFor(level)
    const left = col * meta.tileWidth * meta.xMicrometersPerPixel
    const right = (col + 1) * meta.tileWidth * meta.xMicrometersPerPixel
    const top = row * meta.tileHeight * meta.yMicrometersPerPixel
    const bottom = (row + 1) * meta.tileHeight * meta.yMicrometersPerPixel
    const baseLevel = this.levelMetaFor(0)
    const imageWidthMicrometers = baseLevel.width * baseLevel.xMicrometersPerPixel
    const imageHeightMicrometers = baseLevel.height * baseLevel.yMicrometersPerPixel

    return {
      minX: micrometers(this.originX + Math.max(0, left)),
      maxX: micrometers(this.originX + Math.min(imageWidthMicrometers, right)),
      minY: micrometers(this.originY + Math.max(0, top)),
      maxY: micrometers(this.originY + Math.min(imageHeightMicrometers, bottom)),
    }
  }

  tileSourceSize(
    level: number,
    col: number,
    row: number,
  ): {
    readonly width: ImagePixels
    readonly height: ImagePixels
  } {
    const meta = this.levelMetaFor(level)
    const width = imagePixels(
      Math.max(1, Math.min(meta.tileWidth, meta.width - col * meta.tileWidth)),
    )
    const height = imagePixels(
      Math.max(1, Math.min(meta.tileHeight, meta.height - row * meta.tileHeight)),
    )

    return { width, height }
  }

  async loadTilePixels(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<ImagePyramidTilePixels> {
    const meta = this.levelMetaFor(level)
    const selection = this.tileSelection(meta, col, row)
    const fromChunk = await this.loadTilePixelsFromChunk(meta, selection, signal)

    if (fromChunk !== null) {
      return fromChunk
    }

    const chunk = await zarr.get(meta.array, selection.projection, {
      ...(signal === undefined ? {} : { signal }),
    })

    if (typeof chunk === 'number' || typeof chunk === 'bigint') {
      throw new Error('OME-Zarr tile selection unexpectedly returned a scalar.')
    }

    return copyTilePixels({
      chunk,
      height: selection.height,
      outputAxes: selection.outputAxes,
      width: selection.width,
    })
  }

  async loadTile(
    level: number,
    col: number,
    row: number,
    options: ImagePyramidTileRenderOptions = {},
    signal?: AbortSignal,
  ): Promise<ImagePyramidDecodedTile> {
    const fromWorker = await this.loadTileInWorker(level, col, row, options, signal)

    if (fromWorker !== null) {
      return fromWorker
    }

    const tile = await this.loadTilePixels(level, col, row, signal)
    const rgba = numericPixelsToRgba(tile.pixels, tile.width, tile.height, {
      ...(options.displayWindow === undefined
        ? {}
        : { displayWindow: options.displayWindow }),
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.alphaFromIntensity === undefined
        ? {}
        : { alphaFromIntensity: options.alphaFromIntensity }),
    })
    const imageDataArray: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
      rgba.rgba,
    )
    const bitmap = await this.createBitmap(
      new ImageData(imageDataArray, tile.width, tile.height),
    )

    return {
      bitmap,
      width: tile.width,
      height: tile.height,
      lo: rgba.lo,
      hi: rgba.hi,
    }
  }

  // Auto-contrast samples of a tile, taken in the worker that caches its
  // chunk. Returns null when workers are unavailable or cannot handle the
  // tile, so the caller samples decoded pixels on the main thread.
  async sampleTilePixels(
    level: number,
    col: number,
    row: number,
    sampling: TileSampling,
    signal?: AbortSignal,
  ): Promise<TileSamples | null> {
    const target = await this.workerChunkTarget(level, col, row)

    if (target === null) {
      return null
    }

    try {
      const tile = await target.pool.sampleTile({ ...target.request, sampling })
      throwIfAborted(signal)
      return tile
    } catch (error) {
      if (isFinalWorkerError(error)) {
        throw error
      }

      return null
    }
  }

  // Decodes and renders a tile in a worker that caches its chunk. Returns null
  // when workers are unavailable or cannot handle the tile, so the caller
  // decodes on the main thread.
  private async loadTileInWorker(
    level: number,
    col: number,
    row: number,
    options: ImagePyramidTileRenderOptions,
    signal: AbortSignal | undefined,
  ): Promise<ImagePyramidDecodedTile | null> {
    const target = await this.workerChunkTarget(level, col, row)

    if (target === null) {
      return null
    }

    try {
      const tile = await target.pool.renderTile({
        ...target.request,
        render: {
          ...(options.displayWindow === undefined
            ? {}
            : { displayWindow: options.displayWindow }),
          ...(options.color === undefined ? {} : { color: options.color }),
          ...(options.alphaFromIntensity === undefined
            ? {}
            : { alphaFromIntensity: options.alphaFromIntensity }),
        },
      })

      if (signal?.aborted === true) {
        tile.bitmap.close()
        throwIfAborted(signal)
      }

      return tile
    } catch (error) {
      if (isFinalWorkerError(error)) {
        throw error
      }

      return null
    }
  }

  // The decode pool and the chunk a tile lies in, or null when there is no
  // pool or the tile straddles chunks.
  private async workerChunkTarget(
    level: number,
    col: number,
    row: number,
  ): Promise<{
    readonly pool: ZarrDecodePool
    readonly request: {
      readonly cacheKey: string
      readonly source: ZarrChunkSource
      readonly loadBytes: () => Promise<Uint8Array | undefined>
      readonly window: ZarrChunkWindow
    }
  } | null> {
    const pool = this.decodePool
    const meta = this.levelMetaFor(level)
    const selection = this.tileSelection(meta, col, row)
    const placement = this.chunkPlacement(meta, selection)

    if (pool === null || placement === null) {
      return null
    }

    const arrayMetadata = await zarrArrayMetadata(meta.array)

    if (arrayMetadata === null) {
      return null
    }

    const chunkKey = zarrChunkKey(arrayMetadata.metadata, placement.coords)
    const arrayPath = meta.array.path === '/' ? '' : meta.array.path

    return {
      pool,
      request: {
        cacheKey: placement.cacheKey,
        source: { ...arrayMetadata, chunkKey, coords: placement.coords },
        loadBytes: () =>
          Promise.resolve(
            meta.array.store.get(`${arrayPath}/${chunkKey}` as `/${string}`),
          ),
        window: {
          xAxis: this.xAxis,
          yAxis: this.yAxis,
          x0: placement.x0,
          y0: placement.y0,
          width: selection.width,
          height: selection.height,
          fixedAxes: placement.fixedAxes,
        },
      },
    }
  }

  // Chunk coordinates and in-chunk origin of a tile that lies inside one
  // chunk, or null for tiles that straddle chunks.
  private chunkPlacement(
    meta: OmeZarrLevelMeta,
    selection: ReturnType<OmeZarrImagePyramidLoader['tileSelection']>,
  ): {
    readonly coords: readonly number[]
    readonly cacheKey: string
    readonly x0: number
    readonly y0: number
    readonly fixedAxes: readonly { readonly axis: number; readonly index: number }[]
  } | null {
    const chunkCol = Math.floor(selection.xStart / meta.chunkWidth)
    const chunkRow = Math.floor(selection.yStart / meta.chunkHeight)

    if (
      Math.floor((selection.xStart + selection.width - 1) / meta.chunkWidth) !==
        chunkCol ||
      Math.floor((selection.yStart + selection.height - 1) / meta.chunkHeight) !==
        chunkRow
    ) {
      return null
    }

    const chunkShape = meta.array.chunks
    const coords = selection.projection.map((index, axis) =>
      axis === this.xAxis
        ? chunkCol
        : axis === this.yAxis
          ? chunkRow
          : Math.floor((index as number) / (chunkShape[axis] ?? 1)),
    )
    const fixedAxes = selection.projection.flatMap((index, axis) =>
      axis === this.xAxis || axis === this.yAxis
        ? []
        : [{ axis, index: (index as number) % (chunkShape[axis] ?? 1) }],
    )

    return {
      coords,
      cacheKey: `${this.sourceKey}\n${meta.path}\n${coords.join(',')}`,
      x0: selection.xStart - chunkCol * meta.chunkWidth,
      y0: selection.yStart - chunkRow * meta.chunkHeight,
      fixedAxes,
    }
  }

  // Copies a tile that lies inside one chunk from the shared decoded-chunk
  // cache. Returns null for tiles that straddle chunks.
  private async loadTilePixelsFromChunk(
    meta: OmeZarrLevelMeta,
    selection: ReturnType<OmeZarrImagePyramidLoader['tileSelection']>,
    signal: AbortSignal | undefined,
  ): Promise<ImagePyramidTilePixels | null> {
    const placement = this.chunkPlacement(meta, selection)

    if (placement === null) {
      return null
    }

    const chunkShape = meta.array.chunks
    const chunkCol = placement.coords[this.xAxis] ?? 0
    const chunkRow = placement.coords[this.yAxis] ?? 0
    const chunk = await decodedChunk(placement.cacheKey, meta.array, placement.coords)
    throwIfAborted(signal)

    const data = chunk.data

    if (!isSupportedPixelArray(data)) {
      throw new Error('Unsupported OME-Zarr image dtype for tile rendering.')
    }

    let offset = 0

    selection.projection.forEach((index, axis) => {
      if (axis !== this.xAxis && axis !== this.yAxis) {
        offset +=
          ((index as number) % (chunkShape[axis] ?? 1)) * (chunk.stride[axis] ?? 0)
      }
    })

    const xStride = chunk.stride[this.xAxis] ?? 1
    const yStride = chunk.stride[this.yAxis] ?? meta.chunkWidth
    const x0 = selection.xStart - chunkCol * meta.chunkWidth
    const y0 = selection.yStart - chunkRow * meta.chunkHeight
    const pixels = newPixelArray(data, selection.width * selection.height)

    for (let y = 0; y < selection.height; y += 1) {
      const sourceRow = offset + (y0 + y) * yStride + x0 * xStride
      const targetRow = y * selection.width

      for (let x = 0; x < selection.width; x += 1) {
        pixels[targetRow + x] = data[sourceRow + x * xStride] ?? 0
      }
    }

    return { pixels, width: selection.width, height: selection.height }
  }

  private tileSelection(
    meta: OmeZarrLevelMeta,
    col: number,
    row: number,
  ): {
    readonly projection: (number | zarr.Slice)[]
    readonly outputAxes: readonly ('x' | 'y')[]
    readonly xStart: number
    readonly yStart: number
    readonly width: number
    readonly height: number
  } {
    const xStart = col * meta.tileWidth
    const yStart = row * meta.tileHeight
    const width = Math.max(1, Math.min(meta.tileWidth, meta.width - xStart))
    const height = Math.max(1, Math.min(meta.tileHeight, meta.height - yStart))
    const projection: (number | zarr.Slice)[] = []
    const outputAxes: ('x' | 'y')[] = []

    for (let axis = 0; axis < this.axes.length; axis += 1) {
      if (axis === this.xAxis) {
        projection.push(zarr.slice(xStart, xStart + width))
        outputAxes.push('x')
        continue
      }

      if (axis === this.yAxis) {
        projection.push(zarr.slice(yStart, yStart + height))
        outputAxes.push('y')
        continue
      }

      if (axis === this.channelAxis) {
        projection.push(this.selectedChannelIndex ?? 0)
        continue
      }

      projection.push(this.planeIndexAt(meta, axis))
    }

    return {
      projection,
      outputAxes,
      xStart,
      yStart,
      width,
      height,
    }
  }

  // The level-0 plane index on `axis` at a level, which may be downsampled
  // along it.
  private planeIndexAt(meta: OmeZarrLevelMeta, axis: number): number {
    const index = this.planeIndices[axis] ?? 0
    const baseSize = this.levelMetaFor(0).array.shape[axis] ?? 1
    const size = meta.array.shape[axis] ?? 1

    return size === baseSize
      ? index
      : Math.min(size - 1, Math.floor((index * size) / baseSize))
  }

  private levelMetaFor(level: number): OmeZarrLevelMeta {
    const meta = this.levels[level]

    if (meta === undefined) {
      throw new Error(`No OME-Zarr metadata for level ${level}.`)
    }

    return meta
  }
}

function parseOmeZarrImageSelection(url: string): OmeZarrImageSelection {
  const parsedUrl = new URL(url)
  const hash = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash
  const params = new URLSearchParams(hash)
  const channelIndex = hashParameterIndex(params.get('c') ?? params.get('channel'))
  const zIndex = hashParameterIndex(params.get('z'))
  parsedUrl.hash = ''

  return {
    sourceUrl: parsedUrl.toString(),
    ...(channelIndex === undefined ? {} : { channelIndex }),
    ...(zIndex === undefined ? {} : { zIndex }),
  }
}

function hashParameterIndex(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const index = Number(value)
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

// bioformats2raw writes each image series to its own group under a root that
// carries only `bioformats2raw.layout`. The `OME` group's `series` attribute
// lists the series paths; without it they are 0, 1, ... The first series is
// opened.
async function bioformats2rawImageGroup(
  root: zarr.Group<zarr.Readable>,
  signal: AbortSignal | undefined,
): Promise<zarr.Group<zarr.Readable>> {
  const metadataRoot = objectRecord(root.attrs.ome) ?? root.attrs

  if (
    metadataRoot.multiscales !== undefined ||
    metadataRoot['bioformats2raw.layout'] === undefined
  ) {
    return root
  }

  const openOptions = {
    kind: 'group',
    ...(signal === undefined ? {} : { signal }),
  } as const
  let seriesPath = '0'

  try {
    const omeGroup = await zarr.open(root.resolve('OME'), openOptions)
    const series = (objectRecord(omeGroup.attrs.ome) ?? omeGroup.attrs).series

    if (Array.isArray(series) && typeof series[0] === 'string' && series[0] !== '') {
      seriesPath = series[0]
    }
  } catch (error) {
    if (signal?.aborted === true) {
      throw error
    }
    // Without a readable OME group, the first series is at 0.
  }

  return zarr.open(root.resolve(seriesPath), openOptions)
}

function firstOmeZarrMultiscale(
  attrs: Readonly<Record<string, unknown>>,
): OmeZarrMultiscaleMetadata {
  const metadataRoot = objectRecord(attrs.ome) ?? attrs
  const multiscales = metadataRoot.multiscales

  if (!Array.isArray(multiscales) || multiscales.length === 0) {
    throw new Error('Not a supported OME-Zarr image: missing multiscales metadata.')
  }

  const multiscale = objectRecord(multiscales[0])

  if (multiscale === null || !Array.isArray(multiscale.datasets)) {
    throw new Error('Not a supported OME-Zarr image: invalid multiscales metadata.')
  }

  return {
    ...(Array.isArray(multiscale.axes) ? { axes: multiscale.axes } : {}),
    ...(Array.isArray(multiscale.coordinateTransformations)
      ? { coordinateTransformations: multiscale.coordinateTransformations }
      : {}),
    datasets: multiscale.datasets.map((dataset, index) => {
      const record = objectRecord(dataset)
      const path = typeof record?.path === 'string' ? record.path : undefined

      if (path === undefined || path.length === 0) {
        throw new Error(`OME-Zarr multiscale dataset ${index} is missing a path.`)
      }

      return {
        path,
        ...(Array.isArray(record?.coordinateTransformations)
          ? { coordinateTransformations: record.coordinateTransformations }
          : {}),
      }
    }),
  }
}

function normalizeAxes(
  rawAxes: readonly unknown[] | undefined,
  array: ZarrArray<DataType, zarr.Readable>,
): readonly OmeZarrAxis[] {
  const axes =
    rawAxes === undefined || rawAxes.length === 0
      ? axesFromArray(array)
      : rawAxes.map((axis, index) => normalizeAxis(axis, index))

  if (axes.length !== array.shape.length) {
    throw new Error(
      `OME-Zarr axis count ${axes.length} does not match array rank ${array.shape.length}.`,
    )
  }

  return axes
}

function axesFromArray(
  array: ZarrArray<DataType, zarr.Readable>,
): readonly OmeZarrAxis[] {
  if (array.dimensionNames !== undefined && array.dimensionNames.length > 0) {
    return array.dimensionNames.map((name) => ({
      name,
      ...(spatialAxisName(name) ? { type: 'space' } : {}),
      ...(name === 'c' ? { type: 'channel' } : {}),
    }))
  }

  if (array.shape.length < 2) {
    throw new Error('OME-Zarr image arrays must have at least x and y axes.')
  }

  return array.shape.map((_size, index) => {
    if (index === array.shape.length - 1) {
      return { name: 'x', type: 'space' }
    }

    if (index === array.shape.length - 2) {
      return { name: 'y', type: 'space' }
    }

    if (index === array.shape.length - 3) {
      return { name: 'c', type: 'channel' }
    }

    return { name: `axis${index}` }
  })
}

function normalizeAxis(axis: unknown, index: number): OmeZarrAxis {
  if (typeof axis === 'string') {
    return {
      name: axis,
      ...(spatialAxisName(axis) ? { type: 'space' } : {}),
      ...(axis === 'c' ? { type: 'channel' } : {}),
    }
  }

  const record = objectRecord(axis)
  const name = typeof record?.name === 'string' ? record.name : `axis${index}`
  const type = typeof record?.type === 'string' ? record.type : undefined
  const unit = typeof record?.unit === 'string' ? record.unit : undefined

  return {
    name,
    ...(type === undefined ? {} : { type }),
    ...(unit === undefined ? {} : { unit }),
  }
}

// The index read on each axis other than x and y. On z: the plane the URL
// selects, else the one OMERO rendering settings open on
// (`omero.rdefs.defaultZ`), else the middle plane, as for other z-stacks. On t:
// `omero.rdefs.defaultT`, else 0. bioformats2raw sets defaultZ to the middle of
// a z-stack, whose first plane can be nearly empty.
function initialPlaneIndices(options: {
  readonly axes: readonly OmeZarrAxis[]
  readonly shape: readonly number[]
  readonly attrs: Readonly<Record<string, unknown>>
  readonly zAxis: number | undefined
  readonly selectedZIndex?: number
}): readonly number[] {
  const { attrs } = options
  const omero = objectRecord(attrs.omero) ?? objectRecord(objectRecord(attrs.ome)?.omero)
  const rdefs = objectRecord(omero?.rdefs)

  return options.axes.map((axis, index) => {
    const size = options.shape[index] ?? 1
    const preferred =
      index === options.zAxis
        ? [options.selectedZIndex, rdefs?.defaultZ, Math.floor((size - 1) / 2)]
        : axis.name.toLowerCase() === 't' || axis.type === 'time'
          ? [rdefs?.defaultT]
          : []

    return (
      preferred.find(
        (value): value is number =>
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0 &&
          value < size,
      ) ?? 0
    )
  })
}

function findRequiredAxis(axes: readonly OmeZarrAxis[], name: 'x' | 'y'): number {
  const index = axes.findIndex((axis) => axis.name.toLowerCase() === name)

  if (index >= 0) {
    return index
  }

  throw new Error(`Not a supported OME-Zarr image: missing ${name} spatial axis.`)
}

function findOptionalZAxis(axes: readonly OmeZarrAxis[]): number | undefined {
  const index = axes.findIndex((axis) => axis.name.toLowerCase() === 'z')

  return index >= 0 ? index : undefined
}

function findOptionalChannelAxis(axes: readonly OmeZarrAxis[]): number | undefined {
  const index = axes.findIndex(
    (axis) => axis.name.toLowerCase() === 'c' || axis.type === 'channel',
  )

  return index >= 0 ? index : undefined
}

function levelMetaFromArray(options: {
  readonly array: ZarrArray<DataType, zarr.Readable>
  readonly axes: readonly OmeZarrAxis[]
  readonly dataset: OmeZarrDatasetMetadata
  readonly multiscale: OmeZarrMultiscaleMetadata
  readonly path: string
  readonly xAxis: number
  readonly yAxis: number
  readonly planarScale?: { readonly x: number; readonly y: number }
}): OmeZarrLevelMeta {
  const chunkShape = options.array.chunks
  const xScale = micrometersPerPixelForAxis({
    axis: options.xAxis,
    axes: options.axes,
    dataset: options.dataset,
    multiscale: options.multiscale,
    ...(options.planarScale === undefined ? {} : { planarScale: options.planarScale.x }),
  })
  const yScale = micrometersPerPixelForAxis({
    axis: options.yAxis,
    axes: options.axes,
    dataset: options.dataset,
    multiscale: options.multiscale,
    ...(options.planarScale === undefined ? {} : { planarScale: options.planarScale.y }),
  })

  const chunkWidth = positiveDimension(
    chunkShape[options.xAxis] ?? DEFAULT_TILE_SIZE,
    'tile width',
  )
  const chunkHeight = positiveDimension(
    chunkShape[options.yAxis] ?? DEFAULT_TILE_SIZE,
    'tile height',
  )

  return {
    path: options.path,
    array: options.array,
    width: imagePixels(positiveDimension(options.array.shape[options.xAxis], 'width')),
    height: imagePixels(positiveDimension(options.array.shape[options.yAxis], 'height')),
    chunkWidth,
    chunkHeight,
    tileWidth: imagePixels(virtualTileSize(chunkWidth)),
    tileHeight: imagePixels(virtualTileSize(chunkHeight)),
    xMicrometersPerPixel: xScale,
    yMicrometersPerPixel: yScale,
  }
}

function micrometersPerPixelForAxis(options: {
  readonly axis: number
  readonly axes: readonly OmeZarrAxis[]
  readonly dataset: OmeZarrDatasetMetadata
  readonly multiscale: OmeZarrMultiscaleMetadata
  readonly planarScale?: number
}): number {
  const scale =
    scaleForAxis(options.axis, options.multiscale.coordinateTransformations) *
    scaleForAxis(options.axis, options.dataset.coordinateTransformations)
  const unitMultiplier =
    options.planarScale ?? micrometerMultiplierForUnit(options.axes[options.axis]?.unit)
  const value = scale * unitMultiplier

  return Number.isFinite(value) && value > 0 ? value : 1
}

function scaleForAxis(
  axis: number,
  transformations: readonly unknown[] | undefined,
): number {
  if (transformations === undefined) {
    return 1
  }

  let scale = 1

  for (const transformation of transformations) {
    const record = objectRecord(transformation)

    if (record?.type !== 'scale' || !Array.isArray(record.scale)) {
      continue
    }

    const value = record.scale[axis]

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      scale *= value
    }
  }

  return scale
}

// Micrometers between planes along `axis`, when the axis declares a length
// unit. bioformats2raw writes a z scale of 1 without a unit when the physical
// plane spacing is unknown.
function micrometersPerPlaneForAxis(options: {
  readonly axis: number
  readonly axes: readonly OmeZarrAxis[]
  readonly dataset: OmeZarrDatasetMetadata
  readonly multiscale: OmeZarrMultiscaleMetadata
}): number | undefined {
  const unitMultiplier = micrometersPerLengthUnit(options.axes[options.axis]?.unit)

  if (unitMultiplier === undefined) {
    return undefined
  }

  const value =
    scaleForAxis(options.axis, options.multiscale.coordinateTransformations) *
    scaleForAxis(options.axis, options.dataset.coordinateTransformations) *
    unitMultiplier

  return Number.isFinite(value) && value > 0 ? value : undefined
}

function micrometerMultiplierForUnit(unit: string | undefined): number {
  return micrometersPerLengthUnit(unit) ?? 1
}

function micrometersPerLengthUnit(unit: string | undefined): number | undefined {
  switch (unit?.toLowerCase()) {
    case 'micrometer':
    case 'micrometers':
    case 'micrometre':
    case 'micrometres':
    case 'um':
    case 'µm':
      return 1
    case 'nanometer':
    case 'nanometers':
    case 'nanometre':
    case 'nanometres':
    case 'nm':
      return 0.001
    case 'millimeter':
    case 'millimeters':
    case 'millimetre':
    case 'millimetres':
    case 'mm':
      return 1000
    case 'meter':
    case 'meters':
    case 'metre':
    case 'metres':
    case 'm':
      return 1_000_000
    default:
      return undefined
  }
}

function buildOmeZarrChannels(options: {
  readonly array: ZarrArray<DataType, zarr.Readable>
  readonly attrs: Readonly<Record<string, unknown>>
  readonly channelAxis: number | undefined
  readonly sourceUrl: string
  // Plane count of a z-stack, whose channels list their planes.
  readonly sizeZ?: number
}): readonly ImagePyramidChannelInfo[] {
  if (options.channelAxis === undefined) {
    return []
  }

  const channelCount = options.array.shape[options.channelAxis] ?? 0

  if (!Number.isInteger(channelCount) || channelCount <= 0) {
    return []
  }

  const omero =
    objectRecord(options.attrs.omero) ??
    objectRecord(objectRecord(options.attrs.ome)?.omero)
  const omeroChannels = Array.isArray(omero?.channels)
    ? omero.channels.map((channel) => objectRecord(channel) ?? {})
    : []
  const nativeRgb = isNativeRgbChannelSet(
    channelCount,
    omeroChannels,
    options.array.dtype,
  )
  const dtypeContrast = contrastForDataType(options.array.dtype)
  const zPlanes =
    options.sizeZ === undefined
      ? undefined
      : Array.from({ length: options.sizeZ }, (_value, zIndex) => ({ zIndex }))

  return Array.from({ length: channelCount }, (_value, index) => {
    const omeroChannel = omeroChannels[index] as OmeZarrOmeroChannel | undefined
    const rgbChannel = nativeRgb ? RGB_CHANNELS[index] : undefined
    const color = rgbChannel?.color ??
      parseOmeroColor(omeroChannel?.color) ??
      DEFAULT_CHANNEL_COLORS[index % DEFAULT_CHANNEL_COLORS.length] ?? [255, 255, 255]
    const name =
      rgbChannel?.name ??
      (typeof omeroChannel?.label === 'string' && omeroChannel.label.trim() !== ''
        ? omeroChannel.label.trim()
        : `Channel ${index + 1}`)

    return {
      id: `Channel:${index}`,
      index,
      name,
      color,
      contrast: contrastFromOmeroWindow(omeroChannel?.window) ?? dtypeContrast,
      ...(index === 0
        ? {}
        : { sourceUrl: omeZarrChannelSelectionUrl(options.sourceUrl, index) }),
      ...(zPlanes === undefined ? {} : { zPlanes }),
      ...(nativeRgb ? { alphaFromIntensity: false } : {}),
    }
  })
}

// Three 8-bit channels without channel names or colors are treated as an RGB
// image (for example H&E). SpatialData writes the channel coordinate as the
// omero label, so default-named images carry labels 0, 1, 2.
function isNativeRgbChannelSet(
  channelCount: number,
  omeroChannels: readonly Record<string, unknown>[],
  dtype: DataType,
): boolean {
  if (channelCount !== RGB_CHANNELS.length) {
    return false
  }

  if (
    omeroChannels.length === 0 ||
    omeroChannels.every((channel, index) => isUnnamedOmeroChannel(channel, index))
  ) {
    return dtype === 'uint8'
  }

  return RGB_CHANNELS.every((channel, index) => {
    const omeroChannel = omeroChannels[index]
    const label = typeof omeroChannel?.label === 'string' ? omeroChannel.label : ''
    const color = parseOmeroColor(omeroChannel?.color)

    const normalizedLabel = label.trim().toLowerCase()

    return (
      normalizedLabel === channel.name.toLowerCase() ||
      normalizedLabel === channel.name.charAt(0).toLowerCase() ||
      colorsEqual(color, channel.color)
    )
  })
}

function isUnnamedOmeroChannel(channel: Record<string, unknown>, index: number): boolean {
  const label = channel.label
  const unnamed =
    label === undefined ||
    label === null ||
    label === index ||
    (typeof label === 'string' && (label.trim() === '' || label.trim() === String(index)))

  return unnamed && parseOmeroColor(channel.color) === undefined
}

function contrastFromOmeroWindow(
  window: OmeZarrOmeroChannel['window'] | undefined,
): { readonly min: number; readonly max: number } | undefined {
  const min = finiteNumber(window?.start) ?? finiteNumber(window?.min)
  const max = finiteNumber(window?.end) ?? finiteNumber(window?.max)

  if (min === undefined || max === undefined || max <= min) {
    return undefined
  }

  return { min, max }
}

function contrastForDataType(dtype: DataType): {
  readonly min: number
  readonly max: number
} {
  switch (dtype) {
    case 'uint8':
    case 'int8':
      return { min: 0, max: 255 }
    case 'float32':
    case 'float64':
    case 'float16':
      return { min: 0, max: 1 }
    default:
      return { min: 0, max: 65_535 }
  }
}

// Splits a chunk dimension into the fewest equal tiles of at most
// MAX_VIRTUAL_TILE_SIZE pixels.
function virtualTileSize(chunkSize: number): number {
  return Math.ceil(chunkSize / Math.ceil(chunkSize / MAX_VIRTUAL_TILE_SIZE))
}

interface DecodedChunkEntry {
  readonly promise: Promise<zarr.Chunk<DataType>>
  bytes: number
}

const decodedChunks = new Map<string, DecodedChunkEntry>()
let decodedChunkBytes = 0

// Decoded chunks shared by virtual tiles, channels, and loaders of the same
// source. Requests are not aborted individually because other tiles wait on
// the same chunk.
function decodedChunk(
  key: string,
  array: ZarrArray<DataType, zarr.Readable>,
  coords: readonly number[],
): Promise<zarr.Chunk<DataType>> {
  const existing = decodedChunks.get(key)

  if (existing !== undefined) {
    decodedChunks.delete(key)
    decodedChunks.set(key, existing)
    return existing.promise
  }

  const entry: DecodedChunkEntry = {
    promise: array.getChunk([...coords]),
    bytes: 0,
  }
  decodedChunks.set(key, entry)
  entry.promise.then(
    (chunk) => {
      if (decodedChunks.get(key) !== entry) {
        return
      }

      entry.bytes = chunkByteLength(chunk)
      decodedChunkBytes += entry.bytes
      evictDecodedChunks()
    },
    () => {
      if (decodedChunks.get(key) === entry) {
        decodedChunks.delete(key)
      }
    },
  )
  return entry.promise
}

function evictDecodedChunks(): void {
  for (const [key, entry] of decodedChunks) {
    if (decodedChunkBytes <= DECODED_CHUNK_CACHE_MAX_BYTES || decodedChunks.size <= 1) {
      return
    }

    if (entry.bytes === 0) {
      continue
    }

    decodedChunks.delete(key)
    decodedChunkBytes -= entry.bytes
  }
}

function chunkByteLength(chunk: zarr.Chunk<DataType>): number {
  const data = chunk.data as { readonly byteLength?: unknown; readonly length?: unknown }
  return typeof data.byteLength === 'number'
    ? data.byteLength
    : typeof data.length === 'number'
      ? data.length * 8
      : 0
}

// Store errors and aborts are final; worker failures fall back to the main
// thread.
function isFinalWorkerError(error: unknown): boolean {
  return (
    error instanceof ZarrChunkUnavailableError ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted.', 'AbortError')
  }
}

function copyTilePixels(options: {
  readonly chunk: zarr.Chunk<DataType>
  readonly outputAxes: readonly ('x' | 'y')[]
  readonly width: number
  readonly height: number
}): ImagePyramidTilePixels {
  const yOutputIndex = options.outputAxes.indexOf('y')
  const xOutputIndex = options.outputAxes.indexOf('x')

  if (xOutputIndex < 0 || yOutputIndex < 0) {
    throw new Error('OME-Zarr tile selection did not include x and y axes.')
  }

  const data = options.chunk.data

  if (!isSupportedPixelArray(data)) {
    throw new Error('Unsupported OME-Zarr image dtype for tile rendering.')
  }

  const pixels = newPixelArray(data, options.width * options.height)
  const xStride = options.chunk.stride[xOutputIndex] ?? 1
  const yStride = options.chunk.stride[yOutputIndex] ?? options.width

  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const sourceIndex = y * yStride + x * xStride
      pixels[y * options.width + x] = data[sourceIndex] ?? 0
    }
  }

  return {
    pixels,
    width: options.width,
    height: options.height,
  }
}

function createBitmapFromImageData(imageData: ImageData): Promise<ImageBitmap> {
  return createImageBitmap(imageData)
}

function parseOmeroColor(color: unknown): readonly [number, number, number] | undefined {
  if (typeof color !== 'string') {
    return undefined
  }

  const hex = color.trim().replace(/^#/, '')

  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return undefined
  }

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ]
}

function colorsEqual(
  left: readonly [number, number, number] | undefined,
  right: readonly [number, number, number],
): boolean {
  return (
    left !== undefined &&
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2]
  )
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveDimension(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`OME-Zarr image has invalid ${label}.`)
  }

  return Math.floor(value)
}

function spatialAxisName(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized === 'x' || normalized === 'y' || normalized === 'z'
}
