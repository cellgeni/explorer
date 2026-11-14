import { fromUrl } from 'geotiff'
import type {
  BlockedSourceOptions,
  GeoTIFF,
  GeoTIFFImage,
  RemoteSourceOptions,
} from 'geotiff'
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
import {
  isQptiffDescription,
  isQptiffUrl,
  parseQptiffDescription,
  qptiffChannelInfos,
  qptiffLayout,
  qptiffMicrometersPerPixel,
} from './qptiff'
import {
  isSvsAssociatedImageAfterPyramid,
  isSvsDescription,
  isSvsUrl,
  parseSvsDescription,
  svsChannelInfo,
  svsLayout,
} from './svs'
import {
  compressedStripBand,
  STRIP_TILE_SIZE,
  StripBandCache,
  stripBandRead,
  stripBandsForRows,
  stripPieceBytes,
  stripTileBytes,
  tiffStripLevel,
  uncompressedStripBand,
} from './strips'
import { decodeTiffStripBand } from '../codecs/tiffStrips'
import { sharedStripDecodePool } from '../workers/tileDecodePool'
import { abortable } from '../utils/abortable'
import { notifyFallback, type FallbackNotifier } from '../data/fallbackNotice'
import type { BBox, ImagePixels, TileIndex, UnitsDescriptor } from '../data/coords'
import type { TileSourceSize } from './tileCache'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type { TiffStripLevel, TiffStripTags } from './strips'
import type { OmeTiffZStack, TiffChannelInfo } from './omeMetadata'
import type { OpenImagePyramidOptions } from '../data/imagePyramid'
import type { QptiffIfdSummary } from './qptiff'

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

export type TiffChunkIndex = ReadonlyMap<string, TiffChunkIndexEntry>

export interface TiffPyramidLoaderOptions {
  readonly url: string
  readonly sourceUrl?: string
  // The tile index, or a function that reads one level's index when that
  // level's first tile is fetched.
  readonly chunkIndex: TiffChunkIndex | ((level: number) => Promise<TiffChunkIndex>)
  readonly levelMeta: ReadonlyMap<number, TiffLevelMeta>
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels?: readonly TiffChannelInfo[]
  readonly zStack?: OmeTiffZStack
  readonly compression?: number
  readonly bitsPerSample?: readonly number[]
  readonly samplesPerPixel?: number
  readonly predictor?: number
  readonly planarConfiguration?: number
  readonly photometric?: number
  readonly littleEndian?: boolean
  readonly jpegTables?: Uint8Array
  // Per-level decode tags, indexed by level, for files whose levels are
  // separate IFDs with their own tags (SVS levels each have JPEGTables).
  // Levels without an entry use the tags above.
  readonly levelDecodeMetadata?: readonly TiffTileDecodeMetadata[]
  // Reads a tile together with the tiles stored next to it in the file that
  // lie near it in the image (see readAdjacentTileRun).
  readonly readAdjacentTiles?: boolean
  // Levels stored in strips, whose tiles are cut from bands of rows instead
  // of read from the tile index.
  readonly stripLevels?: ReadonlyMap<number, TiffStripLevel>
  readonly fetcher?: typeof fetch
  readonly byteRangeCache?: PersistentByteRangeCache | null
}
export { parsePhysicalSizeMicrometersPerPixel } from './omeMetadata'

// A sidecar was found but could not be parsed.
const UNREADABLE_ZCHUNK_STORE = 'unreadable' as const

// Adjacent tile reads: a run holds the tiles stored back to back with the
// requested one (gaps up to ADJACENT_TILE_MAX_GAP) that lie within
// ADJACENT_TILE_RADIUS tiles of it, up to a byte and tile limit. Tiles read
// ahead wait in memory, at most PREFETCHED_TILE_LIMIT of them.
const ADJACENT_TILE_RADIUS = 4
const ADJACENT_TILE_MAX_GAP = 4096
const ADJACENT_RUN_MAX_BYTES = 1024 * 1024
const ADJACENT_RUN_MAX_TILES = 16
const PREFETCHED_TILE_LIMIT = 512

// Opened TIFF files, least recently used first. Loaders of one file (its
// channel IFDs or z planes) share its header and parsed IFD chain, so opening
// IFD N after IFD M reads only the IFDs between them.
const OPEN_TIFF_FILE_LIMIT = 4
const openTiffFiles = new Map<string, Promise<GeoTIFF>>()

// Bands of stripped levels, shared by every loader so that the planes and
// channels of one image share one memory limit.
const stripBands = new StripBandCache()

function openTiffFile(sourceUrl: string): Promise<GeoTIFF> {
  let file = openTiffFiles.get(sourceUrl)

  if (file === undefined) {
    const opened = fromUrl(sourceUrl, { allowFullFile: false })
    opened.catch(() => {
      forgetTiffFile(sourceUrl, opened)
    })
    file = opened
  }

  openTiffFiles.delete(sourceUrl)
  openTiffFiles.set(sourceUrl, file)

  for (const openUrl of openTiffFiles.keys()) {
    if (openTiffFiles.size <= OPEN_TIFF_FILE_LIMIT) {
      break
    }

    openTiffFiles.delete(openUrl)
  }

  return file
}

// geotiff keeps a failed IFD read, so a file whose open failed is reopened
// next time.
function forgetTiffFile(sourceUrl: string, file: Promise<GeoTIFF>): void {
  if (openTiffFiles.get(sourceUrl) === file) {
    openTiffFiles.delete(sourceUrl)
  }
}

// Tests open different fake files at one URL.
export function clearOpenTiffFiles(): void {
  openTiffFiles.clear()
  stripBands.clear()
}

export async function openTiff(
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
  options: OpenImagePyramidOptions = {},
): Promise<TiffPyramidLoader> {
  const selection = parseTiffImageSelection(url)

  if (isQptiffUrl(selection.sourceUrl)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, QPTIFF_FORMAT)
  }

  if (isSvsUrl(selection.sourceUrl)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, SVS_FORMAT)
  }

  const file = openTiffFile(selection.sourceUrl)

  try {
    // The shared open ignores this caller's signal, since other loaders may
    // still need it; `abortable` stops this caller waiting instead.
    const tiff = await abortable(file, signal)

    return await openTiffImage(url, selection, tiff, signal, onFallback, options)
  } catch (cause) {
    if (!isAbortError(cause)) {
      forgetTiffFile(selection.sourceUrl, file)
    }

    throw cause
  }
}

async function openTiffImage(
  url: string,
  selection: TiffImageSelection,
  tiff: GeoTIFF,
  signal: AbortSignal | undefined,
  onFallback: FallbackNotifier | undefined,
  options: OpenImagePyramidOptions,
): Promise<TiffPyramidLoader> {
  const metadataImage = await tiff.getImage(0)
  const metadataDirectory = metadataImage.getFileDirectory()
  const description = await readOptionalStringTag(metadataDirectory, 'ImageDescription')

  // A QPTIFF or SVS saved under a plain TIFF name.
  if (isQptiffDescription(description)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, QPTIFF_FORMAT)
  }

  if (isSvsDescription(description)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, SVS_FORMAT)
  }

  const omeMetadata = parseOmeTiffMetadata(description)
  const channelIndex =
    selection.ifdIndex ?? channelIndexForUrl(selection.sourceUrl, omeMetadata.channels)

  // The sidecar request runs while the selected IFD's tags load.
  const [{ firstImage, decodeMetadata }, zchunkStoreOptions] = await Promise.all([
    (async () => {
      const image = await tiff.getImage(selection.ifdIndex ?? 0)
      return {
        firstImage: image,
        decodeMetadata: await readTileDecodeMetadata(tiff, image.getFileDirectory()),
      }
    })(),
    loadZchunkStorePyramidOptions(selection.sourceUrl, {
      ...(signal === undefined ? {} : { signal }),
      channelIndex,
      zchunkStoreUrl: options.zchunkStoreUrl,
      multiFile: isMultiFileOmeTiff(selection.sourceUrl, omeMetadata.channels),
    }).catch((cause: unknown) => {
      if (isAbortError(cause)) {
        throw cause
      }

      return UNREADABLE_ZCHUNK_STORE
    }),
  ])
  const firstDirectory = firstImage.getFileDirectory()
  const imageWidth = imagePixels(firstImage.getWidth())
  const imageHeight = imagePixels(firstImage.getHeight())

  if (
    zchunkStoreOptions !== null &&
    zchunkStoreOptions !== UNREADABLE_ZCHUNK_STORE &&
    zchunkStoreMatchesImage(zchunkStoreOptions, firstImage, decodeMetadata)
  ) {
    return new TiffPyramidLoader({
      url,
      sourceUrl: selection.sourceUrl,
      ...decodeMetadata,
      ...zchunkStoreOptions,
      units: {
        ...zchunkStoreOptions.units,
        micrometersPerPixel: micrometers(omeMetadata.micrometersPerPixel),
      },
      channels: omeMetadata.channels,
      ...(omeMetadata.zStack === undefined ? {} : { zStack: omeMetadata.zStack }),
    })
  }

  // Reading tile offsets from the TIFF is the normal path; only a sidecar
  // that was named or found but cannot be used is worth a notice.
  if (zchunkStoreOptions !== null || options.zchunkStoreUrl !== undefined) {
    notifyFallback(onFallback, {
      source: 'Morphology image',
      message:
        'The .zchunkstore tile-offset sidecar was missing, unreadable, or did not match the TIFF, so the app read the tile offsets from the TIFF.',
      action: 'The image loads normally. Regenerate or remove the sidecar.',
      coalesceKey: `morphology-zchunkstore-unused:${selection.sourceUrl}`,
    })
  }

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
  const stripLevels = new Map<number, TiffStripLevel>()
  const subIfds = await readNumberArrayTag(firstDirectory, 'SubIFDs')
  const levelDirectories = [
    firstDirectory,
    ...(await Promise.all(subIfds.map((offset) => parseFileDirectoryAt(tiff, offset)))),
  ]
  const levelStripTags = await Promise.all(levelDirectories.map(readStripTags))
  // Tiled levels keep their tiles; stripped levels are cut into tiles of
  // the same size.
  const tileSize =
    levelStripTags[0] === undefined
      ? {
          tileWidth: imagePixels(firstImage.getTileWidth() || 256),
          tileHeight: imagePixels(firstImage.getTileHeight() || 256),
        }
      : await stripImageTileSize(levelDirectories, levelStripTags)
  const { tileWidth, tileHeight } = tileSize

  await Promise.all(
    levelDirectories.map(async (directory, level) => {
      const width =
        level === 0
          ? imageWidth
          : imagePixels(await readRequiredNumberTag(directory, 'ImageWidth'))
      const height =
        level === 0
          ? imageHeight
          : imagePixels(await readRequiredNumberTag(directory, 'ImageLength'))
      const stripTags = levelStripTags[level]
      const levelSize = {
        width,
        height,
        tileWidth,
        tileHeight,
        fullWidth: imageWidth,
        fullHeight: imageHeight,
      }

      if (stripTags !== undefined) {
        stripLevels.set(
          level,
          tiffStripLevel({
            level,
            width,
            height,
            tags: stripTags,
            decodeMetadata,
            tileHeight,
          }),
        )
        levelMeta.set(level, tiffLevelMeta(levelSize))
        return
      }

      await indexLevel({
        ...levelSize,
        chunkIndex,
        directory,
        level,
        levelMeta,
        ...(indexPlanarConfiguration === undefined
          ? {}
          : { planarConfiguration: indexPlanarConfiguration }),
        ...(indexSamplesPerPixel === undefined
          ? {}
          : { samplesPerPixel: indexSamplesPerPixel }),
      })
    }),
  )

  return new TiffPyramidLoader({
    url,
    sourceUrl: selection.sourceUrl,
    ...decodeMetadata,
    chunkIndex,
    levelMeta,
    ...(stripLevels.size === 0 ? {} : { stripLevels }),
    units,
    tileWidth,
    tileHeight,
    numLevels: levelDirectories.length,
    imageWidth,
    imageHeight,
    channels: omeMetadata.channels,
    ...(omeMetadata.zStack === undefined ? {} : { zStack: omeMetadata.zStack }),
  })
}

// The strip tags of a stripped IFD; undefined for a tiled one.
async function readStripTags(
  directory: TiffDirectoryValueLoader,
): Promise<TiffStripTags | undefined> {
  if ((await readOptionalNumberTag(directory, 'TileWidth')) !== undefined) {
    return undefined
  }

  const offsets = await readNumberArrayTag(directory, 'StripOffsets')

  if (offsets.length === 0) {
    return undefined
  }

  const [byteCounts, rowsPerStrip] = await Promise.all([
    readNumberArrayTag(directory, 'StripByteCounts'),
    readOptionalNumberTag(directory, 'RowsPerStrip'),
  ])

  return { offsets, byteCounts, ...(rowsPerStrip === undefined ? {} : { rowsPerStrip }) }
}

// A stripped full-resolution level takes the tile size of the first tiled
// pyramid level, if any.
async function stripImageTileSize(
  directories: readonly TiffDirectoryValueLoader[],
  stripTags: readonly (TiffStripTags | undefined)[],
): Promise<{ readonly tileWidth: ImagePixels; readonly tileHeight: ImagePixels }> {
  for (const [index, directory] of directories.entries()) {
    if (stripTags[index] !== undefined) {
      continue
    }

    const [tileWidth, tileHeight] = await Promise.all([
      readOptionalNumberTag(directory, 'TileWidth'),
      readOptionalNumberTag(directory, 'TileLength'),
    ])

    if (tileWidth !== undefined && tileHeight !== undefined) {
      return { tileWidth: imagePixels(tileWidth), tileHeight: imagePixels(tileHeight) }
    }
  }

  return {
    tileWidth: imagePixels(STRIP_TILE_SIZE),
    tileHeight: imagePixels(STRIP_TILE_SIZE),
  }
}

// QPTIFF and SVS keep every pyramid level (and QPTIFF every channel) in
// top-level IFDs, so a loader needs IFDs from the whole chain. The chain is
// walked once per file and shared by the loaders of the most recently opened
// files. Reads go through a geotiff block cache, so IFDs and tag data that
// sit together cost one request.
const TOP_LEVEL_PYRAMID_FILE_CACHE_SIZE = 2
const TOP_LEVEL_PYRAMID_MAX_IFDS = 10_000
const topLevelPyramidFiles = new Map<string, Promise<TopLevelPyramidFile>>()

interface TopLevelPyramidFile {
  readonly tiff: GeoTIFF
  readonly directories: ReadonlyMap<number, ImageFileDirectory>
  // levels[level][channel] is an IFD index.
  readonly levels: readonly (readonly number[])[]
  readonly levelMeta: ReadonlyMap<number, TiffLevelMeta>
  readonly channels: readonly TiffChannelInfo[]
  readonly micrometersPerPixel: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
}

interface TopLevelPyramidFormat {
  // Names the format in messages ("the QPTIFF", "a QPTIFF").
  readonly name: string
  readonly withArticle: string
  readonly read: (sourceUrl: string) => Promise<TopLevelPyramidFile>
  readonly readAdjacentTiles: boolean
}

// Akoya writes the IFDs together near the start of the file, so the walk
// reads that region in large blocks rather than one request per IFD.
const QPTIFF_FORMAT: TopLevelPyramidFormat = {
  name: 'QPTIFF',
  withArticle: 'a QPTIFF',
  readAdjacentTiles: false,
  read: (sourceUrl) =>
    readQptiffFile(sourceUrl, {
      allowFullFile: false,
      blockSize: 1024 * 1024,
      cacheSize: 16,
    }),
}

// Aperio writes each IFD after its image data, with the IFD's tag data
// beside it, so the IFDs are spread through the file. Small blocks fetch
// each IFD with its JPEGTables and tile offsets in one request. Its tiles
// are small (240 or 256 pixels, a few KB of JPEG) and stored in runs, so
// neighbouring tiles are read together.
const SVS_FORMAT: TopLevelPyramidFormat = {
  name: 'SVS',
  withArticle: 'an SVS',
  readAdjacentTiles: true,
  read: (sourceUrl) =>
    readSvsFile(sourceUrl, {
      allowFullFile: false,
      blockSize: 64 * 1024,
      cacheSize: 64,
    }),
}

// fromUrl hands the block options to its BlockedSource, though its type
// leaves them out.
type BlockedRemoteSourceOptions = RemoteSourceOptions & BlockedSourceOptions

async function openTopLevelPyramid(
  url: string,
  selection: TiffImageSelection,
  signal: AbortSignal | undefined,
  onFallback: FallbackNotifier | undefined,
  options: OpenImagePyramidOptions,
  format: TopLevelPyramidFormat,
): Promise<TiffPyramidLoader> {
  if (options.zchunkStoreUrl !== undefined) {
    notifyFallback(onFallback, {
      source: 'Morphology image',
      message: `The dataset manifest names a .zchunkstore sidecar, but the image is ${format.withArticle}, so the sidecar is not used.`,
      action: `Remove the sidecar from the manifest; ${format.name} images do not need one.`,
      coalesceKey: `zchunkstore-${format.name.toLowerCase()}:${options.zchunkStoreUrl}`,
    })
  }

  const file = await abortable(topLevelPyramidFile(selection.sourceUrl, format), signal)
  const baseline = file.levels[0] ?? []
  const channel =
    selection.ifdIndex === undefined ? 0 : baseline.indexOf(selection.ifdIndex)

  if (channel < 0) {
    throw new Error(
      `IFD ${String(selection.ifdIndex)} is not a full-resolution channel of the ${format.name}.`,
    )
  }

  const channelDirectories = file.levels.map((level) => {
    const directory = file.directories.get(level[channel] ?? -1)

    if (directory === undefined) {
      throw new Error(
        `The ${format.name} has no IFD for channel ${channel} at every level.`,
      )
    }

    return directory
  })
  const levelDecodeMetadata = await Promise.all(
    channelDirectories.map((directory) => readTileDecodeMetadata(file.tiff, directory)),
  )
  const decodeMetadata = levelDecodeMetadata[0] ?? {}

  return new TiffPyramidLoader({
    url,
    sourceUrl: selection.sourceUrl,
    ...decodeMetadata,
    levelDecodeMetadata,
    readAdjacentTiles: format.readAdjacentTiles,
    // A level's tile offsets are read when its first tile is fetched, so
    // full-resolution offsets wait until the view zooms in, and channels
    // that stay hidden cost nothing.
    chunkIndex: (level) =>
      indexTopLevelPyramidLevel(file, channelDirectories, level, decodeMetadata),
    levelMeta: file.levelMeta,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(file.micrometersPerPixel),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    tileWidth: file.tileWidth,
    tileHeight: file.tileHeight,
    numLevels: file.levels.length,
    imageWidth: file.imageWidth,
    imageHeight: file.imageHeight,
    channels: file.channels,
  })
}

function topLevelPyramidFile(
  sourceUrl: string,
  format: TopLevelPyramidFormat,
): Promise<TopLevelPyramidFile> {
  const cached = topLevelPyramidFiles.get(sourceUrl)

  // Map order is insertion order; re-inserting marks the file most recent.
  topLevelPyramidFiles.delete(sourceUrl)

  const file = cached ?? format.read(sourceUrl)
  topLevelPyramidFiles.set(sourceUrl, file)

  if (cached === undefined) {
    file.catch(() => {
      if (topLevelPyramidFiles.get(sourceUrl) === file) {
        topLevelPyramidFiles.delete(sourceUrl)
      }
    })
  }

  for (const oldestUrl of topLevelPyramidFiles.keys()) {
    if (topLevelPyramidFiles.size <= TOP_LEVEL_PYRAMID_FILE_CACHE_SIZE) {
      break
    }

    topLevelPyramidFiles.delete(oldestUrl)
  }

  return file
}

async function readQptiffFile(
  sourceUrl: string,
  sourceOptions: BlockedRemoteSourceOptions,
): Promise<TopLevelPyramidFile> {
  const tiff = await fromUrl(sourceUrl, sourceOptions)
  const directories = await readIfdChain(tiff)
  const summaries = await Promise.all(
    directories.map((directory, index) => summarizeQptiffIfd(directory, index)),
  )
  const { levels } = qptiffLayout(summaries)
  const baseline = levels[0] ?? []
  const firstIndex = baseline[0]
  const first = firstIndex === undefined ? undefined : summaries[firstIndex]
  const firstDirectory = firstIndex === undefined ? undefined : directories[firstIndex]

  if (first === undefined || firstDirectory === undefined) {
    throw new Error('The QPTIFF has no full-resolution image.')
  }

  if (first.tileWidth === undefined || first.tileHeight === undefined) {
    throw new Error('The QPTIFF is not tiled, so it cannot be read by tile.')
  }

  const bitsPerSample = await readNumberArrayTag(firstDirectory, 'BitsPerSample')

  return topLevelPyramid({
    tiff,
    directories,
    summaries,
    levels,
    channels: qptiffChannelInfos(
      baseline.flatMap((index) => summaries[index] ?? []),
      bitsPerSample[0],
    ),
    micrometersPerPixel: qptiffMicrometersPerPixel(
      await readOptionalRationalTag(firstDirectory, 'XResolution'),
      await readOptionalNumberTag(firstDirectory, 'ResolutionUnit'),
    ),
  })
}

async function readSvsFile(
  sourceUrl: string,
  sourceOptions: BlockedRemoteSourceOptions,
): Promise<TopLevelPyramidFile> {
  const tiff = await fromUrl(sourceUrl, sourceOptions)
  // The label and macro follow the last level, so the walk stops at the
  // label rather than reading the macro IFD too.
  const directories = await readIfdChain(
    tiff,
    async (directory, index) =>
      index > 0 &&
      isSvsAssociatedImageAfterPyramid({
        tiled: directory.hasTag('TileWidth'),
        subfileType: (await readOptionalNumberTag(directory, 'NewSubfileType')) ?? 0,
      }),
  )
  const summaries = await Promise.all(
    directories.map((directory, index) => summarizeIfdShape(directory, index)),
  )
  const levelIfds = svsLayout(summaries)
  const first = summaries[0]
  const firstDirectory = directories[0]

  if (first === undefined || firstDirectory === undefined || levelIfds.length === 0) {
    throw new Error('The SVS is not tiled, so it cannot be read by tile.')
  }

  const [description, bitsPerSample, xResolution, resolutionUnit] = await Promise.all([
    readOptionalStringTag(firstDirectory, 'ImageDescription'),
    readNumberArrayTag(firstDirectory, 'BitsPerSample'),
    readOptionalRationalTag(firstDirectory, 'XResolution'),
    readOptionalNumberTag(firstDirectory, 'ResolutionUnit'),
  ])

  return topLevelPyramid({
    tiff,
    directories,
    summaries,
    levels: levelIfds.map((index) => [index]),
    channels: [svsChannelInfo(first.samplesPerPixel, bitsPerSample[0])],
    // Aperio states the pixel size as MPP; its resolution tags are often
    // missing.
    micrometersPerPixel:
      parseSvsDescription(description).micrometersPerPixel ??
      qptiffMicrometersPerPixel(xResolution, resolutionUnit),
  })
}

function topLevelPyramid(options: {
  readonly tiff: GeoTIFF
  readonly directories: readonly ImageFileDirectory[]
  readonly summaries: readonly IfdShape[]
  readonly levels: readonly (readonly number[])[]
  readonly channels: readonly TiffChannelInfo[]
  readonly micrometersPerPixel: number
}): TopLevelPyramidFile {
  const { directories, summaries, levels } = options
  const first = summaries[levels[0]?.[0] ?? -1]

  if (first?.tileWidth === undefined || first.tileHeight === undefined) {
    throw new Error('The full-resolution image is not tiled.')
  }

  const imageWidth = imagePixels(first.width)
  const imageHeight = imagePixels(first.height)
  const tileWidth = imagePixels(first.tileWidth)
  const tileHeight = imagePixels(first.tileHeight)
  const levelMeta = new Map<number, TiffLevelMeta>()

  levels.forEach((level, levelIndex) => {
    const summary = summaries[level[0] ?? -1]

    if (summary !== undefined) {
      levelMeta.set(
        levelIndex,
        tiffLevelMeta({
          width: imagePixels(summary.width),
          height: imagePixels(summary.height),
          tileWidth,
          tileHeight,
          fullWidth: imageWidth,
          fullHeight: imageHeight,
        }),
      )
    }
  })

  const usedIfds = new Set(levels.flat())

  return {
    tiff: options.tiff,
    directories: new Map(
      directories.flatMap((directory, index) =>
        usedIfds.has(index) ? [[index, directory] as const] : [],
      ),
    ),
    levels,
    levelMeta,
    channels: options.channels,
    micrometersPerPixel: options.micrometersPerPixel,
    imageWidth,
    imageHeight,
    tileWidth,
    tileHeight,
  }
}

// Walks the IFD chain until its end, a loop, or an IFD for which `isLast`
// is true.
async function readIfdChain(
  tiff: GeoTIFF,
  isLast?: (directory: ImageFileDirectory, index: number) => Promise<boolean>,
): Promise<readonly ImageFileDirectory[]> {
  const directories: ImageFileDirectory[] = []
  const seenOffsets = new Set<number>()

  for (let index = 0; index < TOP_LEVEL_PYRAMID_MAX_IFDS; index += 1) {
    const directory = await tiff.requestIFD(index)
    directories.push(directory)

    const next = directory.nextIFDByteOffset

    if (
      next === 0 ||
      seenOffsets.has(next) ||
      (isLast !== undefined && (await isLast(directory, index)))
    ) {
      break
    }

    seenOffsets.add(next)
  }

  return directories
}

interface IfdShape {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  // Undefined for stripped IFDs.
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly subfileType: number
}

async function summarizeIfdShape(
  directory: ImageFileDirectory,
  index: number,
): Promise<IfdShape> {
  const [width, height, samplesPerPixel, tileWidth, tileHeight, subfileType] =
    await Promise.all([
      readRequiredNumberTag(directory, 'ImageWidth'),
      readRequiredNumberTag(directory, 'ImageLength'),
      readOptionalNumberTag(directory, 'SamplesPerPixel'),
      readOptionalNumberTag(directory, 'TileWidth'),
      readOptionalNumberTag(directory, 'TileLength'),
      readOptionalNumberTag(directory, 'NewSubfileType'),
    ])

  return {
    index,
    width,
    height,
    samplesPerPixel: samplesPerPixel ?? 1,
    ...(tileWidth === undefined || tileHeight === undefined
      ? {}
      : { tileWidth, tileHeight }),
    subfileType: subfileType ?? 0,
  }
}

async function summarizeQptiffIfd(
  directory: ImageFileDirectory,
  index: number,
): Promise<QptiffIfdSummary & IfdShape> {
  const [shape, description] = await Promise.all([
    summarizeIfdShape(directory, index),
    readOptionalStringTag(directory, 'ImageDescription'),
  ])

  return {
    ...shape,
    reducedResolution: (shape.subfileType & 1) === 1,
    description: parseQptiffDescription(description),
  }
}

async function indexTopLevelPyramidLevel(
  file: TopLevelPyramidFile,
  directories: readonly ImageFileDirectory[],
  level: number,
  decodeMetadata: TiffTileDecodeMetadata,
): Promise<TiffChunkIndex> {
  const chunkIndex = new Map<string, TiffChunkIndexEntry>()
  const directory = directories[level]
  const meta = file.levelMeta.get(level)

  if (directory === undefined || meta === undefined) {
    throw new Error(`No TIFF metadata for level ${level}.`)
  }

  const samplesPerPixel =
    decodeMetadata.samplesPerPixel ?? decodeMetadata.bitsPerSample?.length

  await indexLevel({
    chunkIndex,
    directory,
    height: meta.height,
    level,
    ...(decodeMetadata.planarConfiguration === undefined
      ? {}
      : { planarConfiguration: decodeMetadata.planarConfiguration }),
    ...(samplesPerPixel === undefined ? {} : { samplesPerPixel }),
    tileHeight: file.tileHeight,
    tileWidth: file.tileWidth,
    width: meta.width,
    fullWidth: file.imageWidth,
    fullHeight: file.imageHeight,
  })

  return chunkIndex
}

// A sidecar only stores byte ranges, so check it was built for this TIFF's
// level 0 grid and lists every tile of this channel at every level. Separated
// planar multi-sample tiles need one byte range per sample, which a sidecar
// does not record.
function zchunkStoreMatchesImage(
  options: Pick<
    TiffPyramidLoaderOptions,
    'imageWidth' | 'imageHeight' | 'tileWidth' | 'tileHeight' | 'levelMeta'
  > & { readonly chunkIndex: TiffChunkIndex },
  image: Pick<GeoTIFFImage, 'getWidth' | 'getHeight' | 'getTileWidth' | 'getTileHeight'>,
  decodeMetadata: TiffTileDecodeMetadata,
): boolean {
  const samplesPerPixel =
    decodeMetadata.samplesPerPixel ?? decodeMetadata.bitsPerSample?.length ?? 1

  return (
    options.imageWidth === image.getWidth() &&
    options.imageHeight === image.getHeight() &&
    options.tileWidth === image.getTileWidth() &&
    options.tileHeight === image.getTileHeight() &&
    !(samplesPerPixel > 1 && (decodeMetadata.planarConfiguration ?? 1) === 2) &&
    hasEveryTile(options.chunkIndex, options.levelMeta)
  )
}

function hasEveryTile(
  chunkIndex: TiffChunkIndex,
  levelMeta: ReadonlyMap<number, TiffLevelMeta>,
): boolean {
  for (const [level, meta] of levelMeta) {
    for (let row = 0; row < meta.nRows; row += 1) {
      for (let col = 0; col < meta.nCols; col += 1) {
        if (!chunkIndex.has(tiffChunkKey(level, row, col))) {
          return false
        }
      }
    }
  }

  return true
}

// One file of a multi-file OME-TIFF: its OME-XML lists channels stored in
// other files.
function isMultiFileOmeTiff(url: string, channels: readonly TiffChannelInfo[]): boolean {
  const fileName = new URL(url).pathname.split('/').at(-1)

  return channels.some(
    (channel) => channel.fileName !== undefined && channel.fileName !== fileName,
  )
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

interface TiffImageSelection {
  readonly sourceUrl: string
  readonly ifdIndex?: number
}

function parseTiffImageSelection(url: string): TiffImageSelection {
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
  const photometric = await readOptionalNumberTag(directory, 'PhotometricInterpretation')
  const jpegTables = await readOptionalByteArrayTag(directory, 'JPEGTables')

  return {
    ...(compression === undefined ? {} : { compression }),
    ...(bitsPerSample.length === 0 ? {} : { bitsPerSample }),
    ...(samplesPerPixel === undefined ? {} : { samplesPerPixel }),
    ...(predictor === undefined ? {} : { predictor }),
    ...(planarConfiguration === undefined ? {} : { planarConfiguration }),
    ...(photometric === undefined ? {} : { photometric }),
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
  readonly zStack?: OmeTiffZStack
  private readonly decodeMetadata: TiffTileDecodeMetadata
  private readonly levelDecodeMetadata: readonly TiffTileDecodeMetadata[]
  // The whole tile index, or each level's index once read.
  private readonly chunks: TiffChunkIndex | undefined
  private readonly levelChunks = new Map<number, TiffChunkIndex>()
  private readonly levelChunkRequests = new Map<number, Promise<TiffChunkIndex>>()
  private readonly readAdjacentTiles: boolean
  // Each level's tiles in file order, built on its first adjacent read.
  private readonly levelFileOrder = new Map<number, LevelFileOrder>()
  // Tiles read with a neighbour, by chunk key, until fetched themselves.
  private readonly prefetchedTiles = new Map<string, Promise<Uint8Array>>()
  private readonly loadLevelChunks:
    | ((level: number) => Promise<TiffChunkIndex>)
    | undefined
  private readonly levels: ReadonlyMap<number, TiffLevelMeta>
  private readonly stripLevels: ReadonlyMap<number, TiffStripLevel>
  private readonly fetcher: typeof fetch
  private readonly sourceUrl: string
  private readonly byteRangeCache: PersistentByteRangeCache | null

  constructor(options: TiffPyramidLoaderOptions) {
    this.url = options.url
    this.sourceUrl = options.sourceUrl ?? options.url
    if (typeof options.chunkIndex === 'function') {
      this.loadLevelChunks = options.chunkIndex
    } else {
      this.chunks = options.chunkIndex
    }
    this.levels = options.levelMeta
    this.units = options.units
    this.tileWidth = options.tileWidth
    this.tileHeight = options.tileHeight
    this.numLevels = options.numLevels
    this.imageWidth = options.imageWidth
    this.imageHeight = options.imageHeight
    this.channels = options.channels ?? []

    if (options.zStack !== undefined) {
      this.zStack = options.zStack
    }

    this.decodeMetadata = {
      ...(options.compression === undefined ? {} : { compression: options.compression }),
      ...(options.bitsPerSample === undefined
        ? {}
        : { bitsPerSample: options.bitsPerSample }),
      ...(options.samplesPerPixel === undefined
        ? {}
        : { samplesPerPixel: options.samplesPerPixel }),
      ...(options.predictor === undefined ? {} : { predictor: options.predictor }),
      ...(options.planarConfiguration === undefined
        ? {}
        : { planarConfiguration: options.planarConfiguration }),
      ...(options.photometric === undefined ? {} : { photometric: options.photometric }),
      ...(options.littleEndian === undefined
        ? {}
        : { littleEndian: options.littleEndian }),
      ...(options.jpegTables === undefined ? {} : { jpegTables: options.jpegTables }),
    }
    this.levelDecodeMetadata = options.levelDecodeMetadata ?? []
    this.readAdjacentTiles = options.readAdjacentTiles === true
    this.stripLevels = options.stripLevels ?? new Map()
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

    // Without a level, the full-resolution level's tags.
    return {
      ...(this.stripLevels.get(level ?? 0)?.tileDecode ??
        (level === undefined ? undefined : this.levelDecodeMetadata[level]) ??
        this.decodeMetadata),
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      ...(planarSampleByteLengths === undefined ? {} : { planarSampleByteLengths }),
    }
  }

  async fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const stripLevel = this.stripLevels.get(level)

    if (stripLevel !== undefined) {
      return this.fetchStripTileBytes(level, stripLevel, col, row, signal)
    }

    const chunks = await this.chunkIndex(level)
    const chunk = chunks.get(tiffChunkKey(level, row, col))

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

    return this.fetchChunkBytes(
      chunk,
      signal,
      this.readAdjacentTiles ? { level, row, col, chunks } : undefined,
    )
  }

  // A stripped level's tile, cut from the bands of rows across it.
  private async fetchStripTileBytes(
    level: number,
    stripLevel: TiffStripLevel,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const size = this.tileSourceSize(level, col, row)
    const window = {
      left: col * this.tileWidth,
      top: row * this.tileHeight,
      width: size.width,
      height: size.height,
    }
    const bands = await Promise.all(
      stripBandsForRows(stripLevel, window.top, window.top + window.height).map(
        async (index) => ({
          index,
          bytes: await stripBands.get(
            `${this.url}|${level}:${index}`,
            (bandSignal) => this.readStripBand(stripLevel, index, bandSignal),
            signal,
          ),
        }),
      ),
    )

    return stripTileBytes(stripLevel, bands, window, this.tileWidth, this.tileHeight)
  }

  private async readStripBand(
    stripLevel: TiffStripLevel,
    band: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const read = stripBandRead(stripLevel, band)
    const runBytes = await Promise.all(
      read.runs.map((run) =>
        fetchByteRangeWithCache({
          cache: this.byteRangeCache,
          namespace: TIFF_TILE_CACHE_NAMESPACE,
          url: this.sourceUrl,
          start: run.start,
          end: run.end,
          signal,
          fetchRange: (rangeSignal) => this.fetchRange(run.start, run.end, rangeSignal),
        }),
      ),
    )
    const pieces = stripPieceBytes(read, runBytes)

    if (!stripLevel.compressed) {
      return uncompressedStripBand(stripLevel, read, pieces)
    }

    const compressed = compressedStripBand(stripLevel, pieces, read)

    return abortable(
      decodeStripBandOffMainThread(compressed.bytes, compressed.options),
      signal,
    )
  }

  private chunkIndex(level: number): Promise<TiffChunkIndex> {
    const loaded = this.chunks ?? this.levelChunks.get(level)

    if (loaded !== undefined) {
      return Promise.resolve(loaded)
    }

    let request = this.levelChunkRequests.get(level)

    if (request === undefined) {
      const levelRequest = (
        this.loadLevelChunks?.(level) ?? Promise.resolve(new Map())
      ).then((chunks) => {
        this.levelChunks.set(level, chunks)
        this.levelChunkRequests.delete(level)
        return chunks
      })
      this.levelChunkRequests.set(level, levelRequest)
      // A failed read is retried by the next tile fetch.
      levelRequest.catch(() => {
        if (this.levelChunkRequests.get(level) === levelRequest) {
          this.levelChunkRequests.delete(level)
        }
      })
      request = levelRequest
    }

    return request
  }

  private async fetchChunkBytes(
    chunk: TiffChunk,
    signal?: AbortSignal,
    adjacent?: AdjacentTileContext,
  ): Promise<Uint8Array> {
    // A zero-length tile was never written (Aperio leaves blank areas out);
    // decoders draw it transparent.
    if (chunk.length === 0) {
      return new Uint8Array(0)
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
      fetchRange: (rangeSignal) =>
        adjacent === undefined
          ? this.fetchRange(start, end, rangeSignal)
          : abortable(this.adjacentTileBytes(adjacent), rangeSignal),
    })
  }

  private async fetchRange(
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    // Chromium's HTTP cache lets one request at a time use a URL's cache
    // entry, so Range requests to one file wait for each other. Tiles are
    // kept in the byte-range cache instead.
    const requestInit: RequestInit = {
      headers: {
        Range: `bytes=${start}-${end - 1}`,
      },
      cache: 'no-store',
    }

    if (signal !== undefined) {
      requestInit.signal = signal
    }

    const response = await this.fetcher(this.sourceUrl, requestInit)

    if (response.status !== 206) {
      throw new Error(
        `Expected HTTP 206 for TIFF Range request, received ${response.status}.`,
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  // A tile read ahead with a neighbour is taken from memory; otherwise its
  // run is read, which no single caller can cancel, since the run's other
  // tiles may be waited on.
  private adjacentTileBytes(adjacent: AdjacentTileContext): Promise<Uint8Array> {
    const key = tiffChunkKey(adjacent.level, adjacent.row, adjacent.col)
    const prefetched = this.prefetchedTiles.get(key)

    if (prefetched !== undefined) {
      this.prefetchedTiles.delete(key)
      return prefetched
    }

    const run = readAdjacentTileRun(
      this.fileOrder(adjacent.level, adjacent.chunks),
      key,
      (candidate) => this.prefetchedTiles.has(candidate),
    )
    const first = run[0]
    const last = run.at(-1)

    if (first === undefined || last === undefined) {
      throw new Error(`No TIFF chunk for ${key}.`)
    }

    const runStart = first.chunk.offset
    const runBytes = this.fetchRange(runStart, last.chunk.offset + last.chunk.length)
    let requested: Promise<Uint8Array> | undefined

    for (const tile of run) {
      const tileStart = tile.chunk.offset - runStart
      const bytes = runBytes.then((data) =>
        data.slice(tileStart, tileStart + tile.chunk.length),
      )

      if (tile.key === key) {
        requested = bytes
        continue
      }

      // A failed run leaves nothing behind, so the tile is read again.
      bytes.catch(() => {
        if (this.prefetchedTiles.get(tile.key) === bytes) {
          this.prefetchedTiles.delete(tile.key)
        }
      })
      this.prefetchedTiles.set(tile.key, bytes)
    }

    for (const oldest of this.prefetchedTiles.keys()) {
      if (this.prefetchedTiles.size <= PREFETCHED_TILE_LIMIT) {
        break
      }

      this.prefetchedTiles.delete(oldest)
    }

    return requested ?? runBytes
  }

  private fileOrder(level: number, chunks: TiffChunkIndex): LevelFileOrder {
    let order = this.levelFileOrder.get(level)

    if (order === undefined) {
      order = levelFileOrder(level, this.levelMetaFor(level), chunks)
      this.levelFileOrder.set(level, order)
    }

    return order
  }

  private planarSampleByteLengths(
    level: number,
    col: number,
    row: number,
  ): readonly number[] | undefined {
    if (!this.isSeparatedPlanarMultiSample()) {
      return undefined
    }

    const chunk = (this.chunks ?? this.levelChunks.get(level))?.get(
      tiffChunkKey(level, row, col),
    )

    return hasSampleChunks(chunk)
      ? chunk.sampleChunks.map((sampleChunk) => sampleChunk.length)
      : undefined
  }

  private isSeparatedPlanarMultiSample(): boolean {
    return (
      (this.decodeMetadata.samplesPerPixel ?? 1) > 1 &&
      (this.decodeMetadata.planarConfiguration ?? 1) === 2
    )
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

// Compressed bands decode in a shared worker pool, or on this thread where
// there are no workers.
function decodeStripBandOffMainThread(
  bytes: Uint8Array,
  options: TiffStripBandDecodeOptions,
): Promise<Uint8Array> {
  const pool = sharedStripDecodePool()

  return pool === null
    ? decodeTiffStripBand(bytes, options)
    : pool.decodeStripBand(bytes, options)
}

interface AdjacentTileContext {
  readonly level: number
  readonly row: number
  readonly col: number
  readonly chunks: TiffChunkIndex
}

interface FileOrderedTile {
  readonly key: string
  readonly row: number
  readonly col: number
  readonly chunk: TiffChunk
}

interface LevelFileOrder {
  readonly tiles: readonly FileOrderedTile[]
  readonly indexByKey: ReadonlyMap<string, number>
}

function levelFileOrder(
  level: number,
  meta: TiffLevelMeta,
  chunks: TiffChunkIndex,
): LevelFileOrder {
  const tiles: FileOrderedTile[] = []

  for (let row = 0; row < meta.nRows; row += 1) {
    for (let col = 0; col < meta.nCols; col += 1) {
      const key = tiffChunkKey(level, row, col)
      const chunk = chunks.get(key)

      if (chunk !== undefined && chunk.length > 0) {
        tiles.push({ key, row, col, chunk })
      }
    }
  }

  tiles.sort((left, right) => left.chunk.offset - right.chunk.offset)

  return {
    tiles,
    indexByKey: new Map(tiles.map((tile, index) => [tile.key, index])),
  }
}

// The tile `key` and the tiles stored back to back with it that lie within
// ADJACENT_TILE_RADIUS tiles of it in the image, in file order. Aperio writes
// small tiles row by row, or in scan stripes, so a run covers the requested
// tile's nearby neighbours. The run grows both ways in turn and stops at a
// tile already read ahead.
export function readAdjacentTileRun(
  order: LevelFileOrder,
  key: string,
  isPrefetched: (key: string) => boolean,
): readonly FileOrderedTile[] {
  const index = order.indexByKey.get(key)
  const requested = index === undefined ? undefined : order.tiles[index]

  if (index === undefined || requested === undefined) {
    return []
  }

  let first = index
  let last = index
  const joins = (
    before: FileOrderedTile | undefined,
    after: FileOrderedTile | undefined,
    candidate: FileOrderedTile | undefined,
    runStart: number,
    runEnd: number,
  ): boolean => {
    if (before === undefined || after === undefined || candidate === undefined) {
      return false
    }

    const gap = after.chunk.offset - (before.chunk.offset + before.chunk.length)

    return (
      gap >= 0 &&
      gap <= ADJACENT_TILE_MAX_GAP &&
      Math.abs(candidate.row - requested.row) <= ADJACENT_TILE_RADIUS &&
      Math.abs(candidate.col - requested.col) <= ADJACENT_TILE_RADIUS &&
      !isPrefetched(candidate.key) &&
      Math.max(runEnd, candidate.chunk.offset + candidate.chunk.length) -
        Math.min(runStart, candidate.chunk.offset) <=
        ADJACENT_RUN_MAX_BYTES
    )
  }

  while (last - first + 1 < ADJACENT_RUN_MAX_TILES) {
    const runStart = order.tiles[first]?.chunk.offset ?? 0
    const lastTile = order.tiles[last]
    const runEnd = (lastTile?.chunk.offset ?? 0) + (lastTile?.chunk.length ?? 0)
    const next = order.tiles[last + 1]
    const previous = order.tiles[first - 1]
    let grew = false

    if (joins(lastTile, next, next, runStart, runEnd)) {
      last += 1
      grew = true
    }

    if (
      last - first + 1 < ADJACENT_RUN_MAX_TILES &&
      joins(previous, order.tiles[first], previous, runStart, runEnd)
    ) {
      first -= 1
      grew = true
    }

    if (!grew) {
      break
    }
  }

  return order.tiles.slice(first, last + 1)
}

interface IndexLevelOptions {
  readonly chunkIndex: Map<string, TiffChunkIndexEntry>
  readonly directory: ImageFileDirectory
  readonly height: ImagePixels
  readonly level: number
  readonly levelMeta?: Map<number, TiffLevelMeta>
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

  options.levelMeta?.set(options.level, tiffLevelMeta(options))
}

function tiffLevelMeta(options: {
  readonly width: ImagePixels
  readonly height: ImagePixels
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly fullWidth: ImagePixels
  readonly fullHeight: ImagePixels
}): TiffLevelMeta {
  return {
    width: options.width,
    height: options.height,
    nCols: Math.ceil(options.width / options.tileWidth),
    nRows: Math.ceil(options.height / options.tileHeight),
    scaleX: options.fullWidth / options.width,
    scaleY: options.fullHeight / options.height,
  }
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

// RATIONAL tags load as [numerator, denominator].
async function readOptionalRationalTag(
  directory: TiffDirectoryValueLoader,
  key: string,
): Promise<number | undefined> {
  const value = await directory.loadValue(key)

  if (isNumberLike(value)) {
    return Number(value)
  }

  const parts =
    Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
      ? Array.from(value as unknown as ArrayLike<number | bigint>, Number)
      : []
  const [numerator, denominator] = parts

  return parts.length === 2 &&
    numerator !== undefined &&
    denominator !== undefined &&
    denominator !== 0
    ? numerator / denominator
    : undefined
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
