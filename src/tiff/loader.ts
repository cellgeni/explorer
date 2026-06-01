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
import type {
  BBox,
  ImagePixels,
  TileGrid,
  TileIndex,
  UnitsDescriptor,
} from '../data/coords'
import type { TileSourceSize } from './tileCache'
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
  readonly chunkIndex: ReadonlyMap<string, TiffChunk>
  readonly levelMeta: ReadonlyMap<number, TiffLevelMeta>
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels?: readonly TiffChannelInfo[]
  readonly fetcher?: typeof fetch
  readonly byteRangeCache?: PersistentByteRangeCache | null
}
export { parsePhysicalSizeMicrometersPerPixel } from './omeMetadata'

export async function openTiff(
  url: string,
  signal?: AbortSignal,
): Promise<TiffPyramidLoader> {
  const tiff = await fromUrl(url, { allowFullFile: false }, signal)
  const firstImage = await tiff.getImage(0)
  const firstDirectory = firstImage.getFileDirectory()
  const omeMetadata = parseOmeTiffMetadata(
    await readOptionalStringTag(firstDirectory, 'ImageDescription'),
  )

  const zchunkStoreOptions = await loadZchunkStorePyramidOptions(url, signal).catch(
    (cause: unknown) => {
      if (isAbortError(cause)) {
        throw cause
      }

      return null
    },
  )

  if (zchunkStoreOptions !== null) {
    return new TiffPyramidLoader({
      url,
      ...zchunkStoreOptions,
      units: {
        ...zchunkStoreOptions.units,
        micrometersPerPixel: micrometers(omeMetadata.micrometersPerPixel),
      },
      channels: omeMetadata.channels,
    })
  }

  const imageWidth = imagePixels(firstImage.getWidth())
  const imageHeight = imagePixels(firstImage.getHeight())
  const tileWidth = imagePixels(firstImage.getTileWidth() || 256)
  const tileHeight = imagePixels(firstImage.getTileHeight() || 256)
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

export class TiffPyramidLoader {
  readonly url: string
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels: readonly TiffChannelInfo[]
  private readonly chunks: ReadonlyMap<string, TiffChunk>
  private readonly levels: ReadonlyMap<number, TiffLevelMeta>
  private readonly fetcher: typeof fetch
  private readonly byteRangeCache: PersistentByteRangeCache | null

  constructor(options: TiffPyramidLoaderOptions) {
    this.url = options.url
    this.chunks = options.chunkIndex
    this.levels = options.levelMeta
    this.units = options.units
    this.tileWidth = options.tileWidth
    this.tileHeight = options.tileHeight
    this.numLevels = options.numLevels
    this.imageWidth = options.imageWidth
    this.imageHeight = options.imageHeight
    this.channels = options.channels ?? []
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
      url: this.url,
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

        const response = await this.fetcher(this.url, requestInit)

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
