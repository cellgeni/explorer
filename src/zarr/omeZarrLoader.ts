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
  ImagePyramidPixelArray,
  ImagePyramidTilePixels,
  ImagePyramidTileRenderOptions,
} from '../data/imagePyramid'
import type { Array as ZarrArray, DataType } from 'zarrita'
import {
  consolidatedZarrStore,
  createZarrFetchStore,
  readConsolidatedZarrMetadata,
} from './zarrStores'

const DEFAULT_TILE_SIZE = 256
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
  readonly channels: readonly ImagePyramidChannelInfo[]
  readonly units: UnitsDescriptor
  readonly origin?: { readonly x: number; readonly y: number }
  readonly createBitmap: (imageData: ImageData) => Promise<ImageBitmap>
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
  const group = await zarr.open(location, {
    kind: 'group',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
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
  const channels = buildOmeZarrChannels({
    array: firstArray,
    attrs: group.attrs,
    channelAxis,
    sourceUrl: selection.sourceUrl,
  })

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
    channels,
    units,
    ...(planarTransform === undefined
      ? {}
      : { origin: { x: planarTransform.translateX, y: planarTransform.translateY } }),
    createBitmap: options.createBitmap ?? createBitmapFromImageData,
  })
}

// Uses consolidated metadata when the image root has it, so opening each
// pyramid level needs no per-array metadata requests.
async function openImageStore(
  url: string,
  options: Pick<OpenOmeZarrImageOptions, 'fetcher' | 'signal'>,
): Promise<zarr.AsyncReadable> {
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

export function isOmeZarrImageUrl(url: string): boolean {
  const path = new URL(url).pathname
  return /(?:\.ome\.zarr|\.zarr|\/zarr\.json|\/\.zattrs)$/i.test(path)
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
  const parsedUrl = new URL(url)
  const params = new URLSearchParams(
    parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash,
  )

  params.set('c', channelIndex.toString())
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
  private readonly levels: readonly OmeZarrLevelMeta[]
  private readonly axes: readonly OmeZarrAxis[]
  private readonly xAxis: number
  private readonly yAxis: number
  private readonly channelAxis: number | undefined
  private readonly selectedChannelIndex: number | undefined
  private readonly originX: number
  private readonly originY: number
  private readonly createBitmap: (imageData: ImageData) => Promise<ImageBitmap>

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
    this.channels = options.channels
    this.units = options.units
    this.tileWidth = firstLevel.tileWidth
    this.tileHeight = firstLevel.tileHeight
    this.numLevels = options.levels.length
    this.imageWidth = firstLevel.width
    this.imageHeight = firstLevel.height
    this.originX = options.origin?.x ?? 0
    this.originY = options.origin?.y ?? 0
    this.createBitmap = options.createBitmap
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

  private tileSelection(
    meta: OmeZarrLevelMeta,
    col: number,
    row: number,
  ): {
    readonly projection: (number | zarr.Slice)[]
    readonly outputAxes: readonly ('x' | 'y')[]
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

      projection.push(0)
    }

    return {
      projection,
      outputAxes,
      width,
      height,
    }
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
  const rawChannelIndex = params.get('c') ?? params.get('channel')
  parsedUrl.hash = ''

  if (rawChannelIndex === null) {
    return { sourceUrl: parsedUrl.toString() }
  }

  const channelIndex = Number(rawChannelIndex)

  if (!Number.isInteger(channelIndex) || channelIndex < 0) {
    return { sourceUrl: parsedUrl.toString() }
  }

  return { sourceUrl: parsedUrl.toString(), channelIndex }
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

function findRequiredAxis(axes: readonly OmeZarrAxis[], name: 'x' | 'y'): number {
  const index = axes.findIndex((axis) => axis.name.toLowerCase() === name)

  if (index >= 0) {
    return index
  }

  throw new Error(`Not a supported OME-Zarr image: missing ${name} spatial axis.`)
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

  return {
    path: options.path,
    array: options.array,
    width: imagePixels(positiveDimension(options.array.shape[options.xAxis], 'width')),
    height: imagePixels(positiveDimension(options.array.shape[options.yAxis], 'height')),
    tileWidth: imagePixels(
      positiveDimension(chunkShape[options.xAxis] ?? DEFAULT_TILE_SIZE, 'tile width'),
    ),
    tileHeight: imagePixels(
      positiveDimension(chunkShape[options.yAxis] ?? DEFAULT_TILE_SIZE, 'tile height'),
    ),
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

function micrometerMultiplierForUnit(unit: string | undefined): number {
  switch (unit?.toLowerCase()) {
    case undefined:
    case '':
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
      return 1
  }
}

function buildOmeZarrChannels(options: {
  readonly array: ZarrArray<DataType, zarr.Readable>
  readonly attrs: Readonly<Record<string, unknown>>
  readonly channelAxis: number | undefined
  readonly sourceUrl: string
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
  const nativeRgb = isNativeRgbChannelSet(channelCount, omeroChannels)
  const dtypeContrast = contrastForDataType(options.array.dtype)

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
      ...(nativeRgb ? { alphaFromIntensity: false } : {}),
    }
  })
}

function isNativeRgbChannelSet(
  channelCount: number,
  omeroChannels: readonly Record<string, unknown>[],
): boolean {
  if (channelCount !== RGB_CHANNELS.length) {
    return false
  }

  if (omeroChannels.length === 0) {
    return true
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

function newPixelArray(
  source: ImagePyramidPixelArray,
  length: number,
): ImagePyramidPixelArray {
  if (source instanceof Uint8Array) return new Uint8Array(length)
  if (source instanceof Uint16Array) return new Uint16Array(length)
  if (source instanceof Int8Array) return new Int8Array(length)
  if (source instanceof Int16Array) return new Int16Array(length)
  if (source instanceof Int32Array) return new Int32Array(length)
  if (source instanceof Uint32Array) return new Uint32Array(length)
  if (source instanceof Float32Array) return new Float32Array(length)
  return new Float64Array(length)
}

function numericPixelsToRgba(
  pixels: ImagePyramidPixelArray,
  width: number,
  height: number,
  options: {
    readonly displayWindow?: { readonly lo: number; readonly hi: number }
    readonly color?: readonly [number, number, number]
    readonly alphaFromIntensity?: boolean
  },
): { readonly rgba: Uint8ClampedArray; readonly lo: number; readonly hi: number } {
  const window = options.displayWindow ?? percentileWindow(pixels)
  const range = Math.max(1e-12, window.hi - window.lo)
  const rgba = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < pixels.length; index += 1) {
    const pixel = pixels[index] ?? 0
    const value = clampByte(Math.round(((pixel - window.lo) / range) * 255))
    const offset = index * 4

    if (options.color === undefined) {
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = value
      rgba[offset + 3] = 255
      continue
    }

    rgba[offset] = Math.round((options.color[0] * value) / 255)
    rgba[offset + 1] = Math.round((options.color[1] * value) / 255)
    rgba[offset + 2] = Math.round((options.color[2] * value) / 255)
    rgba[offset + 3] = options.alphaFromIntensity === true ? value : 255
  }

  return {
    rgba,
    lo: window.lo,
    hi: window.hi,
  }
}

function percentileWindow(pixels: ImagePyramidPixelArray): {
  readonly lo: number
  readonly hi: number
} {
  if (pixels.length === 0) {
    return { lo: 0, hi: 1 }
  }

  const step = Math.max(1, Math.floor(pixels.length / 10_000))
  const sample: number[] = []

  for (let index = 0; index < pixels.length; index += step) {
    sample.push(pixels[index] ?? 0)
  }

  sample.sort((a, b) => a - b)

  const lo = sample[Math.floor(sample.length * 0.02)] ?? 0
  const hi = sample[Math.floor(sample.length * 0.98)] ?? lo + 1

  return { lo, hi: hi === lo ? lo + 1 : hi }
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

function isSupportedPixelArray(value: unknown): value is ImagePyramidPixelArray {
  return (
    value instanceof Uint8Array ||
    value instanceof Uint16Array ||
    value instanceof Int8Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  )
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value))
}
