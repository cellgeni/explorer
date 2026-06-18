import { fromUrl } from 'geotiff'
import type { GeoTIFF } from 'geotiff'
import type { ImageFileDirectory } from 'geotiff'
import {
  defaultPersistentByteRangeCache,
  fetchByteRangeWithCache,
  TIFF_TILE_CACHE_NAMESPACE,
} from '../data/persistentByteRangeCache'
import {
  imagePixels,
  micrometers,
  tileBounds as coordsTileBounds,
  tilesForBbox,
} from '../data/coords'
import { tiffChunkKey } from './chunkKeys'
import { loadZchunkStorePyramidOptions } from './zchunkStore'
import { parseOmeTiffMetadata } from './omeMetadata'
import { notifyFallback, type FallbackNotifier } from '../data/fallbackNotice'
import type {
  BBox,
  ImagePixels,
  TileGrid,
  TileIndex,
  UnitsDescriptor,
} from '../data/coords'
import type { TileSourceSize } from './tileCache'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type { TiffChannelInfo } from './omeMetadata'

export interface TiffChunk {
  readonly offset: number
  readonly length: number
}

export interface TiffLevelMeta {
  readonly width: ImagePixels
  readonly height: ImagePixels
  readonly nCols: number
  readonly nRows: number
}

export interface TiffPyramidLoaderOptions {
  readonly url: string
  readonly sourceUrl?: string
  readonly chunkIndex: ReadonlyMap<string, TiffChunk>
  readonly levelMeta: ReadonlyMap<number, TiffLevelMeta>
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels?: readonly TiffChannelInfo[]
  readonly compression?: number
  readonly bitsPerSample?: readonly number[]
  readonly samplesPerPixel?: number
  readonly predictor?: number
  readonly planarConfiguration?: number
  readonly littleEndian?: boolean
  readonly fetcher?: typeof fetch
  readonly byteRangeCache?: PersistentByteRangeCache | null
}
export { parsePhysicalSizeMicrometersPerPixel } from './omeMetadata'

export async function openTiff(
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
): Promise<TiffPyramidLoader> {
  const selection = parseTiffImageSelection(url)
  const tiff = await fromUrl(selection.sourceUrl, { allowFullFile: false }, signal)
  const metadataImage = await tiff.getImage(0)
  const metadataDirectory = metadataImage.getFileDirectory()
  const omeMetadata = parseOmeTiffMetadata(
    await readOptionalStringTag(metadataDirectory, 'ImageDescription'),
  )
  const channelIndex =
    selection.ifdIndex ?? channelIndexForUrl(selection.sourceUrl, omeMetadata.channels)

  const zchunkStoreOptions = await loadZchunkStorePyramidOptions(
    selection.sourceUrl,
    signal,
    globalThis.fetch.bind(globalThis),
    channelIndex,
  ).catch((cause: unknown) => {
    if (isAbortError(cause)) {
      throw cause
    }

    return null
  })

  if (zchunkStoreOptions !== null) {
    return new TiffPyramidLoader({
      url,
      sourceUrl: selection.sourceUrl,
      ...zchunkStoreOptions,
      units: {
        ...zchunkStoreOptions.units,
        micrometersPerPixel: micrometers(omeMetadata.micrometersPerPixel),
      },
      channels: omeMetadata.channels,
    })
  }

  notifyFallback(onFallback, {
    source: 'Morphology image',
    message:
      'Zarr chunk-store tile metadata was unavailable, so the app switched to GeoTIFF metadata parsing.',
    action:
      'The image can still load, but opening the TIFF may be slower than the chunk-store path.',
    coalesceKey: `morphology-geotiff-metadata:${selection.sourceUrl}`,
  })

  const firstImage = await tiff.getImage(selection.ifdIndex ?? 0)
  const firstDirectory = firstImage.getFileDirectory()
  const imageWidth = imagePixels(firstImage.getWidth())
  const imageHeight = imagePixels(firstImage.getHeight())
  const tileWidth = imagePixels(firstImage.getTileWidth() || 256)
  const tileHeight = imagePixels(firstImage.getTileHeight() || 256)
  const decodeMetadata = await readTileDecodeMetadata(tiff, firstDirectory)
  const units: UnitsDescriptor = {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(omeMetadata.micrometersPerPixel),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const chunkIndex = new Map<string, TiffChunk>()
  const levelMeta = new Map<number, TiffLevelMeta>()

  await indexLevel({
    chunkIndex,
    directory: firstDirectory,
    height: imageHeight,
    level: 0,
    levelMeta,
    tileHeight,
    tileWidth,
    width: imageWidth,
  })

  const subIfds = await readNumberArrayTag(firstDirectory, 'SubIFDs')
  await Promise.all(
    subIfds.map(async (offset, index) => {
      const directory = await parseFileDirectoryAt(tiff, offset)
      const level = index + 1
      const width = imagePixels(await readRequiredNumberTag(directory, 'ImageWidth'))
      const height = imagePixels(await readRequiredNumberTag(directory, 'ImageLength'))

      await indexLevel({
        chunkIndex,
        directory,
        height,
        level,
        levelMeta,
        tileHeight,
        tileWidth,
        width,
      })
    }),
  )

  return new TiffPyramidLoader({
    url,
    sourceUrl: selection.sourceUrl,
    ...decodeMetadata,
    chunkIndex,
    levelMeta,
    units,
    tileWidth,
    tileHeight,
    numLevels: 1 + subIfds.length,
    imageWidth,
    imageHeight,
    channels: omeMetadata.channels,
  })
}

function channelIndexForUrl(url: string, channels: readonly TiffChannelInfo[]): number {
  const fileName = new URL(url).pathname.split('/').at(-1)

  if (fileName === undefined) {
    return 0
  }

  return channels.find((channel) => channel.fileName === fileName)?.index ?? 0
}

export function tiffImageSelectionUrl(url: string, ifdIndex: number): string {
  const parsedUrl = new URL(url)
  parsedUrl.hash = `ifd=${ifdIndex.toString()}`
  return parsedUrl.toString()
}

function parseTiffImageSelection(url: string): {
  readonly sourceUrl: string
  readonly ifdIndex?: number
} {
  const parsedUrl = new URL(url)
  const hash = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash
  const params = new URLSearchParams(hash)
  const rawIfdIndex = params.get('ifd')
  parsedUrl.hash = ''

  if (rawIfdIndex === null) {
    return { sourceUrl: parsedUrl.toString() }
  }

  const ifdIndex = Number(rawIfdIndex)

  if (!Number.isInteger(ifdIndex) || ifdIndex < 0) {
    return { sourceUrl: parsedUrl.toString() }
  }

  return { sourceUrl: parsedUrl.toString(), ifdIndex }
}

async function readTileDecodeMetadata(
  tiff: GeoTIFF,
  directory: ImageFileDirectory,
): Promise<TiffTileDecodeMetadata> {
  const compression = await readOptionalNumberTag(directory, 'Compression')
  const bitsPerSample = await readNumberArrayTag(directory, 'BitsPerSample')
  const samplesPerPixel = await readOptionalNumberTag(directory, 'SamplesPerPixel')
  const predictor = await readOptionalNumberTag(directory, 'Predictor')
  const planarConfiguration = await readOptionalNumberTag(
    directory,
    'PlanarConfiguration',
  )

  return {
    ...(compression === undefined ? {} : { compression }),
    ...(bitsPerSample.length === 0 ? {} : { bitsPerSample }),
    ...(samplesPerPixel === undefined ? {} : { samplesPerPixel }),
    ...(predictor === undefined ? {} : { predictor }),
    ...(planarConfiguration === undefined ? {} : { planarConfiguration }),
    littleEndian: tiff.littleEndian,
  }
}

export class TiffPyramidLoader {
  readonly url: string
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels: readonly TiffChannelInfo[]
  private readonly compression: number | undefined
  private readonly bitsPerSample: readonly number[] | undefined
  private readonly samplesPerPixel: number | undefined
  private readonly predictor: number | undefined
  private readonly planarConfiguration: number | undefined
  private readonly littleEndian: boolean | undefined
  private readonly chunks: ReadonlyMap<string, TiffChunk>
  private readonly levels: ReadonlyMap<number, TiffLevelMeta>
  private readonly fetcher: typeof fetch
  private readonly sourceUrl: string
  private readonly byteRangeCache: PersistentByteRangeCache | null

  constructor(options: TiffPyramidLoaderOptions) {
    this.url = options.url
    this.sourceUrl = options.sourceUrl ?? options.url
    this.chunks = options.chunkIndex
    this.levels = options.levelMeta
    this.units = options.units
    this.tileWidth = options.tileWidth
    this.tileHeight = options.tileHeight
    this.numLevels = options.numLevels
    this.imageWidth = options.imageWidth
    this.imageHeight = options.imageHeight
    this.channels = options.channels ?? []
    this.compression = options.compression
    this.bitsPerSample = options.bitsPerSample
    this.samplesPerPixel = options.samplesPerPixel
    this.predictor = options.predictor
    this.planarConfiguration = options.planarConfiguration
    this.littleEndian = options.littleEndian
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.byteRangeCache =
      options.byteRangeCache === undefined
        ? defaultPersistentByteRangeCache()
        : options.byteRangeCache
  }

  bestLevel(deckScale: number): number {
    const maxSourcePixelScreenSize = 1.5

    for (let level = this.numLevels - 1; level >= 0; level -= 1) {
      const sourcePixelScreenSize =
        this.units.micrometersPerPixel * 2 ** level * deckScale

      if (sourcePixelScreenSize <= maxSourcePixelScreenSize) {
        return level
      }
    }

    return 0
  }

  tilesForBbox(level: number, bbox: BBox): readonly TileIndex[] {
    return tilesForBbox(level, bbox, this.gridForLevel(level), this.units)
  }

  tilesForLevel(level: number): readonly TileIndex[] {
    const grid = this.gridForLevel(level)
    const tiles: TileIndex[] = []
    const nCols = Math.ceil(grid.imageWidth / grid.tileWidth)
    const nRows = Math.ceil(grid.imageHeight / grid.tileHeight)

    for (let row = 0; row < nRows; row += 1) {
      for (let col = 0; col < nCols; col += 1) {
        tiles.push({ col, row })
      }
    }

    return tiles
  }

  tileBounds(level: number, col: number, row: number): BBox {
    return coordsTileBounds(level, col, row, this.gridForLevel(level), this.units)
  }

  tileSourceSize(level: number, col: number, row: number): TileSourceSize {
    const meta = this.levelMetaFor(level)
    const width = imagePixels(
      Math.max(1, Math.min(this.tileWidth, meta.width - col * this.tileWidth)),
    )
    const height = imagePixels(
      Math.max(1, Math.min(this.tileHeight, meta.height - row * this.tileHeight)),
    )

    return { width, height }
  }

  tileDecodeOptions(): TiffTileDecodeMetadata {
    return {
      ...(this.compression === undefined ? {} : { compression: this.compression }),
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      ...(this.bitsPerSample === undefined ? {} : { bitsPerSample: this.bitsPerSample }),
      ...(this.samplesPerPixel === undefined
        ? {}
        : { samplesPerPixel: this.samplesPerPixel }),
      ...(this.predictor === undefined ? {} : { predictor: this.predictor }),
      ...(this.planarConfiguration === undefined
        ? {}
        : { planarConfiguration: this.planarConfiguration }),
      ...(this.littleEndian === undefined ? {} : { littleEndian: this.littleEndian }),
    }
  }

  async fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const chunk = this.chunks.get(tiffChunkKey(level, row, col))

    if (chunk === undefined) {
      throw new Error(`No TIFF chunk for level=${level} row=${row} col=${col}.`)
    }

    const start = chunk.offset
    const end = chunk.offset + chunk.length

    return fetchByteRangeWithCache({
      cache: this.byteRangeCache,
      namespace: TIFF_TILE_CACHE_NAMESPACE,
      url: this.sourceUrl,
      start,
      end,
      ...(signal === undefined ? {} : { signal }),
      fetchRange: async (rangeSignal) => {
        const requestInit: RequestInit = {
          headers: {
            Range: `bytes=${start}-${end - 1}`,
          },
        }

        if (rangeSignal !== undefined) {
          requestInit.signal = rangeSignal
        }

        const response = await this.fetcher(this.sourceUrl, requestInit)

        if (response.status !== 206) {
          throw new Error(
            `Expected HTTP 206 for TIFF Range request, received ${response.status}.`,
          )
        }

        return new Uint8Array(await response.arrayBuffer())
      },
    })
  }

  private gridForLevel(level: number): TileGrid {
    const meta = this.levelMetaFor(level)

    return {
      fullImageWidth: this.imageWidth,
      fullImageHeight: this.imageHeight,
      imageWidth: meta.width,
      imageHeight: meta.height,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
    }
  }

  private levelMetaFor(level: number): TiffLevelMeta {
    const meta = this.levels.get(level)

    if (meta === undefined) {
      throw new Error(`No TIFF metadata for level ${level}.`)
    }

    return meta
  }
}

interface IndexLevelOptions {
  readonly chunkIndex: Map<string, TiffChunk>
  readonly directory: ImageFileDirectory
  readonly height: ImagePixels
  readonly level: number
  readonly levelMeta: Map<number, TiffLevelMeta>
  readonly tileHeight: ImagePixels
  readonly tileWidth: ImagePixels
  readonly width: ImagePixels
}

async function indexLevel(options: IndexLevelOptions): Promise<void> {
  const offsets = await readNumberArrayTag(options.directory, 'TileOffsets')
  const byteCounts = await readNumberArrayTag(options.directory, 'TileByteCounts')
  const nCols = Math.ceil(options.width / options.tileWidth)
  const nRows = Math.ceil(options.height / options.tileHeight)

  if (offsets.length !== byteCounts.length) {
    throw new Error(
      `TIFF level ${options.level} has mismatched tile offset/count arrays.`,
    )
  }

  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]
    const length = byteCounts[index]

    if (offset === undefined || length === undefined) {
      throw new Error(`TIFF level ${options.level} has an incomplete tile index.`)
    }

    options.chunkIndex.set(
      tiffChunkKey(options.level, Math.floor(index / nCols), index % nCols),
      {
        offset,
        length,
      },
    )
  }

  options.levelMeta.set(options.level, {
    width: options.width,
    height: options.height,
    nCols,
    nRows,
  })
}

async function parseFileDirectoryAt(
  tiff: GeoTIFF,
  offset: number,
): Promise<ImageFileDirectory> {
  return tiff.parser.parseFileDirectoryAt(offset)
}

interface TiffDirectoryValueLoader {
  loadValue(tagIdentifier: string | number): Promise<unknown>
}

export async function readOptionalStringTag(
  directory: TiffDirectoryValueLoader,
  key: string,
): Promise<string | undefined> {
  const value = await directory.loadValue(key)

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Expected TIFF tag ${key} to be a string.`)
  }

  return value
}

export async function readRequiredNumberTag(
  directory: TiffDirectoryValueLoader,
  key: string,
): Promise<number> {
  const value = await directory.loadValue(key)

  if (!isNumberLike(value)) {
    throw new Error(`Expected TIFF tag ${key} to be a number.`)
  }

  return numberLikeToNumber(value, key)
}

export async function readOptionalNumberTag(
  directory: TiffDirectoryValueLoader,
  key: string,
): Promise<number | undefined> {
  const value = await directory.loadValue(key)

  if (value === undefined) {
    return undefined
  }

  if (!isNumberLike(value)) {
    throw new Error(`Expected TIFF tag ${key} to be a number.`)
  }

  return numberLikeToNumber(value, key)
}

export async function readNumberArrayTag(
  directory: TiffDirectoryValueLoader,
  key: string,
): Promise<readonly number[]> {
  const value = await directory.loadValue(key)

  if (value === undefined) {
    return []
  }

  if (Array.isArray(value) && value.every(isNumberLike)) {
    return value.map((item) => numberLikeToNumber(item, key))
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value) {
    return Array.from(value as unknown as ArrayLike<number | bigint>, (item) =>
      numberLikeToNumber(item, key),
    )
  }

  throw new Error(`Expected TIFF tag ${key} to be a number array.`)
}

function isNumberLike(value: unknown): value is number | bigint {
  return typeof value === 'number' || typeof value === 'bigint'
}

function numberLikeToNumber(value: number | bigint, key: string): number {
  const numberValue = typeof value === 'bigint' ? Number(value) : value

  if (!Number.isFinite(numberValue) || !Number.isSafeInteger(numberValue)) {
    throw new Error(`Expected TIFF tag ${key} to contain a safe finite number.`)
  }

  return numberValue
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}
