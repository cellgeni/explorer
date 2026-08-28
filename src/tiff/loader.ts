import { fromUrl } from 'geotiff'
import type { GeoTIFF } from 'geotiff'
import type { ImageFileDirectory } from 'geotiff'
import {
  defaultPersistentByteRangeCache,
  fetchByteRangeWithCache,
  TIFF_TILE_CACHE_NAMESPACE,
} from '../data/persistentByteRangeCache'
import { imagePixels, micrometers } from '../data/coords'
import { tiffChunkKey } from './chunkKeys'
import { loadZchunkStorePyramidOptions } from './zchunkStore'
import { parseOmeTiffMetadata } from './omeMetadata'
import { notifyFallback, type FallbackNotifier } from '../data/fallbackNotice'
import type { BBox, ImagePixels, TileIndex, UnitsDescriptor } from '../data/coords'
import type { TileSourceSize } from './tileCache'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type { TiffChannelInfo } from './omeMetadata'

export interface TiffChunk {
  readonly offset: number
  readonly length: number
}

export interface TiffChunkIndexEntry extends TiffChunk {
  readonly sampleChunks?: readonly TiffChunk[]
}

export interface TiffLevelMeta {
  readonly width: ImagePixels
  readonly height: ImagePixels
  readonly nCols: number
  readonly nRows: number
  readonly scaleX?: number
  readonly scaleY?: number
}

export interface TiffPyramidLoaderOptions {
  readonly url: string
  readonly sourceUrl?: string
  readonly chunkIndex: ReadonlyMap<string, TiffChunkIndexEntry>
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
  readonly jpegTables?: Uint8Array
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
  const indexPlanarConfiguration = decodeMetadata.planarConfiguration
  const indexSamplesPerPixel =
    decodeMetadata.samplesPerPixel ?? decodeMetadata.bitsPerSample?.length
  const units: UnitsDescriptor = {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(omeMetadata.micrometersPerPixel),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const chunkIndex = new Map<string, TiffChunkIndexEntry>()
  const levelMeta = new Map<number, TiffLevelMeta>()

  await indexLevel({
    chunkIndex,
    directory: firstDirectory,
    height: imageHeight,
    level: 0,
    levelMeta,
    ...(indexPlanarConfiguration === undefined
      ? {}
      : { planarConfiguration: indexPlanarConfiguration }),
    ...(indexSamplesPerPixel === undefined
      ? {}
      : { samplesPerPixel: indexSamplesPerPixel }),
    tileHeight,
    tileWidth,
    width: imageWidth,
    fullWidth: imageWidth,
    fullHeight: imageHeight,
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
        ...(indexPlanarConfiguration === undefined
          ? {}
          : { planarConfiguration: indexPlanarConfiguration }),
        ...(indexSamplesPerPixel === undefined
          ? {}
          : { samplesPerPixel: indexSamplesPerPixel }),
        tileHeight,
        tileWidth,
        width,
        fullWidth: imageWidth,
        fullHeight: imageHeight,
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
  const jpegTables = await readOptionalByteArrayTag(directory, 'JPEGTables')

  return {
    ...(compression === undefined ? {} : { compression }),
    ...(bitsPerSample.length === 0 ? {} : { bitsPerSample }),
    ...(samplesPerPixel === undefined ? {} : { samplesPerPixel }),
    ...(predictor === undefined ? {} : { predictor }),
    ...(planarConfiguration === undefined ? {} : { planarConfiguration }),
    ...(jpegTables === undefined ? {} : { jpegTables }),
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
  private readonly jpegTables: Uint8Array | undefined
  private readonly chunks: ReadonlyMap<string, TiffChunkIndexEntry>
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
    this.jpegTables = options.jpegTables
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.byteRangeCache =
      options.byteRangeCache === undefined
        ? defaultPersistentByteRangeCache()
        : options.byteRangeCache
  }

  bestLevel(deckScale: number): number {
    const maxSourcePixelScreenSize = 1.5

    for (let level = this.numLevels - 1; level >= 0; level -= 1) {
      const scale = this.levelScaleFor(this.levelMetaFor(level))
      const sourcePixelScreenSize =
        this.units.micrometersPerPixel * Math.max(scale.x, scale.y) * deckScale

      if (sourcePixelScreenSize <= maxSourcePixelScreenSize) {
        return level
      }
    }

    return 0
  }

  tilesForBbox(level: number, bbox: BBox): readonly TileIndex[] {
    const meta = this.levelMetaFor(level)
    const scale = this.levelScaleFor(meta)
    const levelScaleX = this.units.micrometersPerPixel * scale.x
    const levelScaleY = this.units.micrometersPerPixel * scale.y
    const col0 = Math.max(
      0,
      Math.floor(Math.max(0, bbox.minX / levelScaleX) / this.tileWidth),
    )
    const col1 = Math.min(
      meta.nCols - 1,
      Math.floor(Math.max(0, bbox.maxX / levelScaleX - 1e-9) / this.tileWidth),
    )
    const row0 = Math.max(
      0,
      Math.floor(Math.max(0, bbox.minY / levelScaleY) / this.tileHeight),
    )
    const row1 = Math.min(
      meta.nRows - 1,
      Math.floor(Math.max(0, bbox.maxY / levelScaleY - 1e-9) / this.tileHeight),
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

    for (let row = 0; row < meta.nRows; row += 1) {
      for (let col = 0; col < meta.nCols; col += 1) {
        tiles.push({ col, row })
      }
    }

    return tiles
  }

  tileBounds(level: number, col: number, row: number): BBox {
    const meta = this.levelMetaFor(level)
    const scale = this.levelScaleFor(meta)
    const left = col * this.tileWidth * scale.x * this.units.micrometersPerPixel
    const right = (col + 1) * this.tileWidth * scale.x * this.units.micrometersPerPixel
    const bottom = row * this.tileHeight * scale.y * this.units.micrometersPerPixel
    const top = (row + 1) * this.tileHeight * scale.y * this.units.micrometersPerPixel
    const imageWidthMicrometers = this.imageWidth * this.units.micrometersPerPixel
    const imageHeightMicrometers = this.imageHeight * this.units.micrometersPerPixel

    return {
      minX: micrometers(Math.max(0, left)),
      maxX: micrometers(Math.min(imageWidthMicrometers, right)),
      minY: micrometers(Math.max(0, bottom)),
      maxY: micrometers(Math.min(imageHeightMicrometers, top)),
    }
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

  tileDecodeOptions(level?: number, col?: number, row?: number): TiffTileDecodeMetadata {
    const planarSampleByteLengths =
      level === undefined || col === undefined || row === undefined
        ? undefined
        : this.planarSampleByteLengths(level, col, row)

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
      ...(planarSampleByteLengths === undefined ? {} : { planarSampleByteLengths }),
      ...(this.littleEndian === undefined ? {} : { littleEndian: this.littleEndian }),
      ...(this.jpegTables === undefined ? {} : { jpegTables: this.jpegTables }),
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

    if (this.isSeparatedPlanarMultiSample()) {
      if (!hasSampleChunks(chunk)) {
        throw new Error(
          `No separated planar TIFF sample chunks for level=${level} row=${row} col=${col}.`,
        )
      }

      const sampleBytes = await Promise.all(
        chunk.sampleChunks.map((sampleChunk) =>
          this.fetchChunkBytes(sampleChunk, signal),
        ),
      )
      const totalByteLength = sampleBytes.reduce(
        (sum, bytes) => sum + bytes.byteLength,
        0,
      )
      const bytes = new Uint8Array(totalByteLength)
      let offset = 0

      for (const sample of sampleBytes) {
        bytes.set(sample, offset)
        offset += sample.byteLength
      }

      return bytes
    }

    return this.fetchChunkBytes(chunk, signal)
  }

  private async fetchChunkBytes(
    chunk: TiffChunk,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
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

  private planarSampleByteLengths(
    level: number,
    col: number,
    row: number,
  ): readonly number[] | undefined {
    if (!this.isSeparatedPlanarMultiSample()) {
      return undefined
    }

    const chunk = this.chunks.get(tiffChunkKey(level, row, col))

    return hasSampleChunks(chunk)
      ? chunk.sampleChunks.map((sampleChunk) => sampleChunk.length)
      : undefined
  }

  private isSeparatedPlanarMultiSample(): boolean {
    return (this.samplesPerPixel ?? 1) > 1 && (this.planarConfiguration ?? 1) === 2
  }

  private levelScaleFor(meta: TiffLevelMeta): {
    readonly x: number
    readonly y: number
  } {
    return {
      x: positiveFiniteScale(meta.scaleX ?? this.imageWidth / meta.width),
      y: positiveFiniteScale(meta.scaleY ?? this.imageHeight / meta.height),
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
  readonly chunkIndex: Map<string, TiffChunkIndexEntry>
  readonly directory: ImageFileDirectory
  readonly height: ImagePixels
  readonly level: number
  readonly levelMeta: Map<number, TiffLevelMeta>
  readonly planarConfiguration?: number
  readonly samplesPerPixel?: number
  readonly tileHeight: ImagePixels
  readonly tileWidth: ImagePixels
  readonly width: ImagePixels
  readonly fullWidth: ImagePixels
  readonly fullHeight: ImagePixels
}

async function indexLevel(options: IndexLevelOptions): Promise<void> {
  const offsets = await readNumberArrayTag(options.directory, 'TileOffsets')
  const byteCounts = await readNumberArrayTag(options.directory, 'TileByteCounts')
  const nCols = Math.ceil(options.width / options.tileWidth)
  const nRows = Math.ceil(options.height / options.tileHeight)
  const tileCount = nCols * nRows
  const samplesPerPixel = options.samplesPerPixel ?? 1
  const separatedPlanar = samplesPerPixel > 1 && (options.planarConfiguration ?? 1) === 2

  if (offsets.length !== byteCounts.length) {
    throw new Error(
      `TIFF level ${options.level} has mismatched tile offset/count arrays.`,
    )
  }

  if (separatedPlanar) {
    const expectedChunks = tileCount * samplesPerPixel

    if (offsets.length < expectedChunks) {
      throw new Error(
        `TIFF level ${options.level} has ${offsets.length} planar sample chunks, expected ${expectedChunks}.`,
      )
    }

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const sampleChunks: TiffChunk[] = []

      for (let sampleIndex = 0; sampleIndex < samplesPerPixel; sampleIndex += 1) {
        const index = sampleIndex * tileCount + tileIndex
        const offset = offsets[index]
        const length = byteCounts[index]

        if (offset === undefined || length === undefined) {
          throw new Error(`TIFF level ${options.level} has an incomplete tile index.`)
        }

        sampleChunks.push({ offset, length })
      }

      const firstChunk = sampleChunks[0]

      if (firstChunk === undefined) {
        throw new Error(`TIFF level ${options.level} has an incomplete tile index.`)
      }

      options.chunkIndex.set(
        tiffChunkKey(options.level, Math.floor(tileIndex / nCols), tileIndex % nCols),
        {
          ...firstChunk,
          sampleChunks,
        },
      )
    }
  } else {
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
  }

  options.levelMeta.set(options.level, {
    width: options.width,
    height: options.height,
    nCols,
    nRows,
    scaleX: options.fullWidth / options.width,
    scaleY: options.fullHeight / options.height,
  })
}

function hasSampleChunks(
  chunk: TiffChunkIndexEntry | undefined,
): chunk is TiffChunkIndexEntry & { readonly sampleChunks: readonly TiffChunk[] } {
  return chunk?.sampleChunks !== undefined && chunk.sampleChunks.length > 0
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

async function readOptionalByteArrayTag(
  directory: TiffDirectoryValueLoader,
  key: string,
): Promise<Uint8Array | undefined> {
  const value = await directory.loadValue(key)

  if (value === undefined) {
    return undefined
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (Array.isArray(value) && value.every(isNumberLike)) {
    return bytesFromNumberLikes(value, key)
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value) {
    return bytesFromNumberLikes(value as unknown as ArrayLike<number | bigint>, key)
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  throw new Error(`Expected TIFF tag ${key} to be a byte array.`)
}

function bytesFromNumberLikes(
  values: ArrayLike<number | bigint>,
  key: string,
): Uint8Array {
  return Uint8Array.from(values, (item) => {
    const byte = numberLikeToNumber(item, key)

    if (byte < 0 || byte > 255) {
      throw new Error(`Expected TIFF tag ${key} to contain byte values.`)
    }

    return byte
  })
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

function positiveFiniteScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}
