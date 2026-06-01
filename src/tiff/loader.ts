import { fromUrl } from 'geotiff'
import type { GeoTIFF } from 'geotiff'
import type { ImageFileDirectory } from 'geotiff'
import {
  imagePixels,
  micrometers,
  tileBounds as coordsTileBounds,
  tilesForBbox,
} from '../data/coords'
import type {
  BBox,
  ImagePixels,
  TileGrid,
  TileIndex,
  UnitsDescriptor,
} from '../data/coords'

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
  readonly fetcher?: typeof fetch
}

export function parsePhysicalSizeMicrometersPerPixel(
  description: string | undefined,
): number {
  if (description === undefined) {
    return 0.2125
  }

  const match = description.match(/PhysicalSizeX="([^"]+)"/)
  const value = match?.[1] === undefined ? Number.NaN : Number.parseFloat(match[1])

  return value > 0 ? value : 0.2125
}

export async function openTiff(
  url: string,
  signal?: AbortSignal,
): Promise<TiffPyramidLoader> {
  const tiff = await fromUrl(url, { allowFullFile: false }, signal)
  const firstImage = await tiff.getImage(0)
  const firstDirectory = firstImage.getFileDirectory()
  const firstTags = firstDirectory.toObject()
  const imageWidth = imagePixels(firstImage.getWidth())
  const imageHeight = imagePixels(firstImage.getHeight())
  const tileWidth = imagePixels(firstImage.getTileWidth() || 256)
  const tileHeight = imagePixels(firstImage.getTileHeight() || 256)
  const units: UnitsDescriptor = {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(
      parsePhysicalSizeMicrometersPerPixel(
        readOptionalStringTag(firstTags, 'ImageDescription'),
      ),
    ),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const chunkIndex = new Map<string, TiffChunk>()
  const levelMeta = new Map<number, TiffLevelMeta>()

  indexLevel({
    chunkIndex,
    directory: firstTags,
    height: imageHeight,
    level: 0,
    levelMeta,
    tileHeight,
    tileWidth,
    width: imageWidth,
  })

  const subIfds = readNumberArrayTag(firstTags, 'SubIFDs')
  await Promise.all(
    subIfds.map(async (offset, index) => {
      const directory = await parseFileDirectoryAt(tiff, offset)
      const tags = directory.toObject()
      const level = index + 1
      const width = imagePixels(readRequiredNumberTag(tags, 'ImageWidth'))
      const height = imagePixels(readRequiredNumberTag(tags, 'ImageLength'))

      indexLevel({
        chunkIndex,
        directory: tags,
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
  private readonly chunks: ReadonlyMap<string, TiffChunk>
  private readonly levels: ReadonlyMap<number, TiffLevelMeta>
  private readonly fetcher: typeof fetch

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
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  bestLevel(deckScale: number): number {
    for (let level = this.numLevels - 1; level >= 0; level -= 1) {
      if ((this.tileWidth * deckScale) / 2 ** level >= 128) {
        return level
      }
    }

    return this.numLevels - 1
  }

  tilesForBbox(level: number, bbox: BBox): readonly TileIndex[] {
    return tilesForBbox(level, bbox, this.gridForLevel(level), this.units)
  }

  tileBounds(level: number, col: number, row: number): BBox {
    return coordsTileBounds(level, col, row, this.gridForLevel(level), this.units)
  }

  async fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const chunk = this.chunks.get(chunkKey(level, row, col))

    if (chunk === undefined) {
      throw new Error(`No TIFF chunk for level=${level} row=${row} col=${col}.`)
    }

    const requestInit: RequestInit = {
      headers: {
        Range: `bytes=${chunk.offset}-${chunk.offset + chunk.length - 1}`,
      },
    }

    if (signal !== undefined) {
      requestInit.signal = signal
    }

    const response = await this.fetcher(this.url, requestInit)

    if (response.status !== 206) {
      throw new Error(
        `Expected HTTP 206 for TIFF Range request, received ${response.status}.`,
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  private gridForLevel(level: number): TileGrid {
    const meta = this.levels.get(level)

    if (meta === undefined) {
      throw new Error(`No TIFF metadata for level ${level}.`)
    }

    return {
      fullImageWidth: this.imageWidth,
      fullImageHeight: this.imageHeight,
      imageWidth: meta.width,
      imageHeight: meta.height,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
    }
  }
}

interface IndexLevelOptions {
  readonly chunkIndex: Map<string, TiffChunk>
  readonly directory: Readonly<Record<string, unknown>>
  readonly height: ImagePixels
  readonly level: number
  readonly levelMeta: Map<number, TiffLevelMeta>
  readonly tileHeight: ImagePixels
  readonly tileWidth: ImagePixels
  readonly width: ImagePixels
}

function indexLevel(options: IndexLevelOptions): void {
  const offsets = readNumberArrayTag(options.directory, 'TileOffsets')
  const byteCounts = readNumberArrayTag(options.directory, 'TileByteCounts')
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
      chunkKey(options.level, Math.floor(index / nCols), index % nCols),
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

function chunkKey(level: number, row: number, col: number): string {
  return `${level}/${row}/${col}`
}

function readOptionalStringTag(
  tags: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = tags[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Expected TIFF tag ${key} to be a string.`)
  }

  return value
}

function readRequiredNumberTag(
  tags: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = tags[key]

  if (typeof value !== 'number') {
    throw new Error(`Expected TIFF tag ${key} to be a number.`)
  }

  return value
}

function readNumberArrayTag(
  tags: Readonly<Record<string, unknown>>,
  key: string,
): readonly number[] {
  const value = tags[key]

  if (value === undefined) {
    return []
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value
  }

  if (ArrayBuffer.isView(value) && 'length' in value) {
    return Array.from(value as unknown as ArrayLike<number>)
  }

  throw new Error(`Expected TIFF tag ${key} to be a number array.`)
}
