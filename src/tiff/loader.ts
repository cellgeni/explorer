import { fromArrayBuffer } from 'geotiff'
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
import { imagePixels, micrometers, tilesForBboxOnAxes } from '../data/coords'
import { tiffChunkKey } from './chunkKeys'
import {
  hasPrefetchedZchunkStore,
  loadZchunkStorePyramidOptions,
  prefetchZchunkStores,
} from './zchunkStore'
import { openRemoteTiff, remoteTiffVersion } from './remoteTiff'
import { assertSquareOmePixels, parseOmeTiffMetadata } from './omeMetadata'
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
  svsAssociatedImageName,
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
import {
  isNdpiUrl,
  NDPI_DC_LEVEL_MIN_SIZE,
  NDPI_DC_SCALE,
  NDPI_FORMAT_FLAG_TAG,
  NDPI_MAGNIFICATION_TAG,
  NDPI_MCU_STARTS_HIGH_BYTES_TAG,
  NDPI_MCU_STARTS_TAG,
  NDPI_OVER_4GB_MESSAGE,
  NDPI_TILE_SIZE,
  NDPI_Z_OFFSET_TAG,
  ndpiBandByteRange,
  ndpiBlockDecodeOptions,
  ndpiBlockJpeg,
  ndpiBlocksForWindow,
  ndpiBlockWindow,
  ndpiDcWindow,
  ndpiLayout,
  ndpiLevelGeometry,
  ndpiTileBytes,
  ndpiTileDecodeMetadata,
} from './ndpi'
import { decodeTiffStripBand } from '../codecs/tiffStrips'
import {
  JPEG_2000_COMPRESSION_CODES,
  TIFF_COMPRESSION_JPEG,
  TIFF_COMPRESSION_NONE,
} from '../codecs/tiffTile'
import { sharedStripDecodePool } from '../workers/tileDecodePool'
import { abortable } from '../utils/abortable'
import { notifyFallback, type FallbackNotifier } from '../data/fallbackNotice'
import type { BBox, ImagePixels, TileIndex, UnitsDescriptor } from '../data/coords'
import type { TileSourceSize } from './tileCache'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type { TiffStripLevel, TiffStripTags } from './strips'
import {
  retiledTileBytes,
  retiledTileDecodeOptions,
  retiledTilesUnder,
  tiffRetiledLevel,
  type RetiledStoredTile,
  type TiffRetiledLevel,
} from './retiledLevels'
import type {
  NdpiBlock,
  NdpiIfdSummary,
  NdpiLevelGeometry,
  NdpiLevelRead,
  NdpiLevelSource,
} from './ndpi'
import type { OmeTiffZStack, TiffChannelInfo } from './omeMetadata'
import type {
  ImagePyramidAssociatedImage,
  ImagePyramidLoader,
  ImagePyramidTileFetchOptions,
  OpenImagePyramidOptions,
} from '../data/imagePyramid'
import type { QptiffIfdSummary } from './qptiff'
import { isAbortError } from '../utils/abort'
import { retryingFetch } from '../data/fetchRetry'

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
  // The source file's version (see byteRangeFileVersion), which its tiles are
  // cached under. Tiles of a file without one are cached by URL alone.
  readonly sourceVersion?: string
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
  readonly sampleFormat?: number
  readonly littleEndian?: boolean
  readonly jpegTables?: Uint8Array
  // Per-level decode tags, indexed by level, for files whose levels are
  // separate IFDs with their own tags (SVS levels each have JPEGTables).
  // Levels without an entry use the tags above.
  readonly levelDecodeMetadata?: readonly TiffTileDecodeMetadata[]
  // Levels stored in strips, whose tiles are cut from bands of rows instead
  // of read from the tile index.
  readonly stripLevels?: ReadonlyMap<number, TiffStripLevel>
  // Levels stored in tiles of another size than the loader's, whose tiles
  // are cut from the stored tiles they overlap.
  readonly retiledLevels?: ReadonlyMap<number, TiffRetiledLevel>
  // NDPI levels, whose tiles are cut from blocks of JPEG restart intervals.
  readonly ndpiLevels?: ReadonlyMap<number, NdpiLevelRead>
  readonly fetcher?: typeof fetch
  readonly byteRangeCache?: PersistentByteRangeCache | null
  // The image's top-left corner in data micrometres; 0, 0 by default.
  readonly origin?: { readonly x: number; readonly y: number }
  // A small picture of the whole image for the minimap (an SVS thumbnail).
  readonly overview?: ImagePyramidLoader
  // Lists the images stored beside the pyramid (SVS label and macro).
  readonly associatedImages?: (
    signal?: AbortSignal,
  ) => Promise<readonly ImagePyramidAssociatedImage[]>
}
export { parsePhysicalSizeMicrometersPerPixel } from './omeMetadata'

// A sidecar was found but could not be parsed.
const UNREADABLE_ZCHUNK_STORE = 'unreadable' as const

// Adjacent tile reads: a run holds the tiles stored back to back with the
// requested one (gaps up to ADJACENT_TILE_MAX_GAP) that the caller will fetch
// next, up to a byte and tile limit. Tiles read ahead wait in memory, at most
// PREFETCHED_TILE_LIMIT of them.
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
const TIFF_SAMPLE_FORMAT_SIGNED = 2

// Bands of NDPI MCU rows as read, kept while the blocks across them decode.
const NDPI_BAND_CACHE_BYTES = 64 * 1024 * 1024
const ndpiBands = new StripBandCache(NDPI_BAND_CACHE_BYTES)
// First read of an NDPI level's JPEG header (660 bytes in NanoZoomer files).
const NDPI_HEADER_READ_BYTES = 4096

function openTiffFile(sourceUrl: string): Promise<GeoTIFF> {
  let file = openTiffFiles.get(sourceUrl)

  if (file === undefined) {
    const opened = openRemoteTiff(sourceUrl, { allowFullFile: false })
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
  ndpiBands.clear()
  ndpiFiles.clear()
}

export async function openTiff(
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
  options: OpenImagePyramidOptions = {},
): Promise<TiffPyramidLoader> {
  const selection = parseTiffImageSelection(url)

  // A file already in memory, such as a zip entry, is read without requests.
  if (options.bytes !== undefined) {
    const tiff = await fromArrayBuffer(wholeArrayBuffer(options.bytes))
    return openTiffImage(url, selection, tiff, signal, onFallback, options)
  }

  if (isQptiffUrl(selection.sourceUrl)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, QPTIFF_FORMAT)
  }

  if (isSvsUrl(selection.sourceUrl)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, SVS_FORMAT)
  }

  // `#ifd=N` opens one IFD on its own, such as the macro image.
  if (isNdpiUrl(selection.sourceUrl) && selection.ifdIndex === undefined) {
    return openNdpi(url, selection, signal, onFallback, options)
  }

  // An OME-TIFF's sidecar lookups go out with its header read rather than
  // after its description. Other TIFFs are looked up only once they turn out
  // not to be QPTIFF, SVS or NDPI files, which never have one.
  if (isOmeTiffUrl(selection.sourceUrl) || options.zchunkStoreUrl !== undefined) {
    prefetchZchunkStores(selection.sourceUrl, { zchunkStoreUrl: options.zchunkStoreUrl })
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
  // IFD 0's SubIFDs, its pyramid levels in an OME-TIFF, are read with its
  // description, which Xenium writes at the end of the file. Not when a
  // sidecar gives their tiles instead.
  const metadataLevels =
    (selection.ifdIndex ?? 0) === 0
      ? readSubIfdDirectories(
          tiff,
          metadataDirectory,
          options.bytes === undefined
            ? hasPrefetchedZchunkStore(selection.sourceUrl, {
                zchunkStoreUrl: options.zchunkStoreUrl,
              })
            : Promise.resolve(false),
        )
      : undefined
  void metadataLevels?.catch(() => undefined)
  const description = await readOptionalStringTag(metadataDirectory, 'ImageDescription')

  // A QPTIFF or SVS saved under a plain TIFF name.
  if (isQptiffDescription(description)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, QPTIFF_FORMAT)
  }

  if (isSvsDescription(description)) {
    return openTopLevelPyramid(url, selection, signal, onFallback, options, SVS_FORMAT)
  }

  // An NDPI saved under another name.
  if (
    selection.ifdIndex === undefined &&
    (await readOptionalFloatTag(metadataDirectory, NDPI_FORMAT_FLAG_TAG)) !== undefined
  ) {
    return openNdpi(url, selection, signal, onFallback, options, tiff)
  }

  if (
    selection.ifdIndex === undefined &&
    (await isPagePyramid(tiff, metadataDirectory, description))
  ) {
    return openTopLevelPyramid(
      url,
      selection,
      signal,
      onFallback,
      options,
      PAGE_PYRAMID_FORMAT,
      tiff,
    )
  }

  const omeMetadata = parseOmeTiffMetadata(description)
  if (options.bytes === undefined) {
    openOtherChannelFiles(
      selection.sourceUrl,
      omeMetadata.channels,
      options.zchunkStoreUrl,
    )
  }
  // A pixel size given with the image is square by definition.
  if (options.micrometersPerPixel === undefined) {
    assertSquareOmePixels(description)
  }
  const channelIndex =
    selection.ifdIndex ?? channelIndexForUrl(selection.sourceUrl, omeMetadata.channels)

  // The sidecar request runs while the selected IFD's tags load.
  const [{ firstImage, decodeMetadata }, zchunkStoreOptions] = await Promise.all([
    (async () => {
      const image = await tiff.getImage(selection.ifdIndex ?? 0)
      const decodeMetadata = await readTileDecodeMetadata(tiff, image.getFileDirectory())
      refuseUnreadableSamples(decodeMetadata, options)
      return { firstImage: image, decodeMetadata }
    })(),
    // A file in memory has its tile offsets at hand.
    options.bytes !== undefined
      ? Promise.resolve(null)
      : loadZchunkStorePyramidOptions(selection.sourceUrl, {
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
      sourceVersion: remoteTiffVersion(tiff),
      ...decodeMetadata,
      ...zchunkStoreOptions,
      ...loaderSourceOptions(options),
      units: {
        ...zchunkStoreOptions.units,
        micrometersPerPixel: micrometers(
          options.micrometersPerPixel ?? omeMetadata.micrometersPerPixel,
        ),
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
    micrometersPerPixel: micrometers(
      options.micrometersPerPixel ?? omeMetadata.micrometersPerPixel,
    ),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const chunkIndex = new Map<string, TiffChunkIndexEntry>()
  const levelMeta = new Map<number, TiffLevelMeta>()
  const stripLevels = new Map<number, TiffStripLevel>()
  const retiledLevels = new Map<number, TiffRetiledLevel>()
  const levelDirectories = [
    firstDirectory,
    ...((await metadataLevels) ??
      (await readSubIfdDirectories(tiff, firstDirectory, Promise.resolve(false))) ??
      []),
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
            ...(options.labels === true ? { labels: true } : {}),
          }),
        )
        levelMeta.set(level, tiffLevelMeta(levelSize))
        return
      }

      // A level tiled in another size is indexed by its own tiles.
      const storedTileSize =
        level === 0 ? tileSize : await readStoredTileSize(directory, tileSize)

      if (
        storedTileSize.tileWidth !== tileWidth ||
        storedTileSize.tileHeight !== tileHeight
      ) {
        retiledLevels.set(
          level,
          tiffRetiledLevel({
            level,
            width,
            ...storedTileSize,
            decodeMetadata,
            ...(options.labels === true ? { labels: true } : {}),
          }),
        )
        levelMeta.set(level, tiffLevelMeta(levelSize))
      }

      await indexLevel({
        ...levelSize,
        ...storedTileSize,
        chunkIndex,
        directory,
        level,
        ...(retiledLevels.has(level) ? {} : { levelMeta }),
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
    sourceVersion: remoteTiffVersion(tiff),
    ...decodeMetadata,
    ...loaderSourceOptions(options),
    chunkIndex,
    levelMeta,
    ...(stripLevels.size === 0 ? {} : { stripLevels }),
    ...(retiledLevels.size === 0 ? {} : { retiledLevels }),
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

// A tiled level's own tile size, or the given one where its tags are missing.
async function readStoredTileSize(
  directory: ImageFileDirectory,
  fallback: { readonly tileWidth: ImagePixels; readonly tileHeight: ImagePixels },
): Promise<{ readonly tileWidth: ImagePixels; readonly tileHeight: ImagePixels }> {
  const [width, height] = await Promise.all([
    readOptionalNumberTag(directory, 'TileWidth'),
    readOptionalNumberTag(directory, 'TileLength'),
  ])

  return {
    tileWidth:
      width === undefined || width <= 0 ? fallback.tileWidth : imagePixels(width),
    tileHeight:
      height === undefined || height <= 0 ? fallback.tileHeight : imagePixels(height),
  }
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
  // Stripped images stored beside the pyramid (SVS): the thumbnail, read
  // in the walk, and all of them, read on first use.
  readonly thumbnail?: AssociatedImageIfd
  readonly associatedImages?: () => Promise<readonly AssociatedImageIfd[]>
}

interface AssociatedImageIfd {
  readonly name: string
  readonly index: number
  readonly directory: ImageFileDirectory
}

interface TopLevelPyramidFormat {
  // Names the format in messages ("the QPTIFF", "a QPTIFF").
  readonly name: string
  readonly withArticle: string
  // How the file is read over HTTP.
  readonly sourceOptions: BlockedRemoteSourceOptions
  readonly read: (
    tiff: GeoTIFF,
    options: OpenImagePyramidOptions,
  ) => Promise<TopLevelPyramidFile>
}

// Akoya writes the IFDs together near the start of the file, so the walk
// reads that region in large blocks rather than one request per IFD.
const QPTIFF_FORMAT: TopLevelPyramidFormat = {
  name: 'QPTIFF',
  withArticle: 'a QPTIFF',
  sourceOptions: { allowFullFile: false, blockSize: 1024 * 1024, cacheSize: 16 },
  read: (tiff, options) => readQptiffFile(tiff, options),
}

// Aperio writes each IFD after its image data, with the IFD's tag data
// beside it, so the IFDs are spread through the file. Small blocks fetch
// each IFD with its JPEGTables and tile offsets in one request.
const SVS_FORMAT: TopLevelPyramidFormat = {
  name: 'SVS',
  withArticle: 'an SVS',
  sourceOptions: { allowFullFile: false, blockSize: 64 * 1024, cacheSize: 64 },
  read: (tiff, options) => readSvsFile(tiff, options),
}

// A pyramid written as pages (see isPagePyramid). tifffile writes each IFD
// after its level's tiles, so the IFDs are spread through the file.
const PAGE_PYRAMID_FORMAT: TopLevelPyramidFormat = {
  name: 'TIFF page pyramid',
  withArticle: 'a TIFF page pyramid',
  sourceOptions: { allowFullFile: false, blockSize: 64 * 1024, cacheSize: 64 },
  read: (tiff, options) => readPagePyramidFile(tiff, options),
}

type BlockedRemoteSourceOptions = RemoteSourceOptions & BlockedSourceOptions

async function openTopLevelPyramid(
  url: string,
  selection: TiffImageSelection,
  signal: AbortSignal | undefined,
  onFallback: FallbackNotifier | undefined,
  options: OpenImagePyramidOptions,
  format: TopLevelPyramidFormat,
  // The file when the caller has already opened it.
  openedTiff?: GeoTIFF,
): Promise<TiffPyramidLoader> {
  notifyUnusedZchunkStore(onFallback, options, format)

  const file = await abortable(
    sharedPyramidFile(topLevelPyramidFiles, selection.sourceUrl, async () => {
      const tiff =
        openedTiff ??
        (options.bytes === undefined
          ? await openRemoteTiff(selection.sourceUrl, format.sourceOptions)
          : await fromArrayBuffer(wholeArrayBuffer(options.bytes)))
      return format.read(tiff, options)
    }),
    signal,
  )
  const baseline = file.levels[0] ?? []
  const channel =
    selection.ifdIndex === undefined ? 0 : baseline.indexOf(selection.ifdIndex)
  const sourceOptions = loaderSourceOptions(options)

  if (channel < 0) {
    // `#ifd=N` can name an associated image, such as an SVS label.
    const associated = (
      await abortable(file.associatedImages?.() ?? Promise.resolve([]), signal)
    ).find((image) => image.index === selection.ifdIndex)

    if (associated !== undefined) {
      return associatedImageLoader(file.tiff, associated, {
        url,
        sourceUrl: selection.sourceUrl,
        sourceOptions,
        ...(options.micrometersPerPixel === undefined
          ? {}
          : { micrometersPerPixel: options.micrometersPerPixel }),
      })
    }

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
  refuseUnreadableSamples(decodeMetadata, options)
  const units: UnitsDescriptor = {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(
      options.micrometersPerPixel ?? file.micrometersPerPixel,
    ),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const overview = await overviewLoader(file, selection.sourceUrl, {
    units,
    sourceOptions,
    onFallback,
    format,
  })

  return new TiffPyramidLoader({
    url,
    sourceUrl: selection.sourceUrl,
    sourceVersion: remoteTiffVersion(file.tiff),
    ...decodeMetadata,
    ...sourceOptions,
    ...(overview === undefined ? {} : { overview }),
    ...(file.associatedImages === undefined
      ? {}
      : {
          associatedImages: associatedImageList(
            file.tiff,
            file.associatedImages,
            selection.sourceUrl,
            sourceOptions,
          ),
        }),
    levelDecodeMetadata,
    // A level's tile offsets are read when its first tile is fetched, so
    // full-resolution offsets wait until the view zooms in, and channels
    // that stay hidden cost nothing.
    chunkIndex: (level) =>
      indexTopLevelPyramidLevel(file, channelDirectories, level, decodeMetadata),
    levelMeta: file.levelMeta,
    units,
    tileWidth: file.tileWidth,
    tileHeight: file.tileHeight,
    numLevels: file.levels.length,
    imageWidth: file.imageWidth,
    imageHeight: file.imageHeight,
    channels: file.channels,
  })
}

// The thumbnail of an RGB slide, stretched over the slide, for the minimap
// to draw instead of the coarsest level: one small read and decode rather
// than every tile of that level. A thumbnail that cannot be read leaves the
// minimap to the coarsest level, with a notice.
async function overviewLoader(
  file: TopLevelPyramidFile,
  sourceUrl: string,
  options: {
    readonly units: UnitsDescriptor
    readonly sourceOptions: Pick<
      TiffPyramidLoaderOptions,
      'origin' | 'fetcher' | 'byteRangeCache'
    >
    readonly onFallback: FallbackNotifier | undefined
    readonly format: Pick<TopLevelPyramidFormat, 'name'>
  },
): Promise<TiffPyramidLoader | undefined> {
  const [channel] = file.channels

  if (
    file.thumbnail === undefined ||
    file.channels.length !== 1 ||
    (channel?.samplesPerPixel ?? 1) < 3
  ) {
    return undefined
  }

  try {
    return await stripImageLoader(file.tiff, file.thumbnail, {
      url: tiffImageSelectionUrl(sourceUrl, file.thumbnail.index),
      sourceUrl,
      sourceOptions: options.sourceOptions,
      units: options.units,
      extent: { width: file.imageWidth, height: file.imageHeight },
      channel,
    })
  } catch (cause) {
    notifyFallback(options.onFallback, {
      source: 'Morphology image',
      message: `The ${options.format.name} thumbnail could not be read (${cause instanceof Error ? cause.message : String(cause)}), so the minimap draws the coarsest pyramid level.`,
      action: 'The image loads normally.',
      coalesceKey: `${options.format.name.toLowerCase()}-thumbnail:${sourceUrl}`,
    })
    return undefined
  }
}

// Lists a file's associated images, each opened as a one-level loader in its
// own pixels. The list is read once per loader; a failed read is retried.
function associatedImageList(
  tiff: GeoTIFF,
  readIfds: () => Promise<readonly AssociatedImageIfd[]>,
  sourceUrl: string,
  sourceOptions: Pick<TiffPyramidLoaderOptions, 'fetcher' | 'byteRangeCache'>,
): (signal?: AbortSignal) => Promise<readonly ImagePyramidAssociatedImage[]> {
  let listing: Promise<readonly ImagePyramidAssociatedImage[]> | undefined

  const list = async (): Promise<readonly ImagePyramidAssociatedImage[]> =>
    Promise.all(
      (await readIfds()).map(async (ifd): Promise<ImagePyramidAssociatedImage> => {
        try {
          const loader = await associatedImageLoader(tiff, ifd, {
            url: tiffImageSelectionUrl(sourceUrl, ifd.index),
            sourceUrl,
            sourceOptions: {
              ...(sourceOptions.fetcher === undefined
                ? {}
                : { fetcher: sourceOptions.fetcher }),
              ...(sourceOptions.byteRangeCache === undefined
                ? {}
                : { byteRangeCache: sourceOptions.byteRangeCache }),
            },
          })

          return {
            name: ifd.name,
            ifdIndex: ifd.index,
            width: loader.imageWidth,
            height: loader.imageHeight,
            loader,
          }
        } catch (cause) {
          const shape = await summarizeIfdShape(ifd.directory, ifd.index).catch(
            () => undefined,
          )

          return {
            name: ifd.name,
            ifdIndex: ifd.index,
            width: shape?.width ?? 0,
            height: shape?.height ?? 0,
            error: cause instanceof Error ? cause.message : String(cause),
          }
        }
      }),
    )

  return (signal) => {
    if (listing === undefined) {
      const reading = list()
      reading.catch(() => {
        if (listing === reading) {
          listing = undefined
        }
      })
      listing = reading
    }

    return abortable(listing, signal)
  }
}

// An associated image on its own, at 1 µm per pixel unless the caller gives
// a pixel size: the label and macro have no scale of their own.
function associatedImageLoader(
  tiff: GeoTIFF,
  ifd: AssociatedImageIfd,
  options: {
    readonly url: string
    readonly sourceUrl: string
    readonly sourceOptions: Pick<
      TiffPyramidLoaderOptions,
      'origin' | 'fetcher' | 'byteRangeCache'
    >
    readonly micrometersPerPixel?: number
  },
): Promise<TiffPyramidLoader> {
  return stripImageLoader(tiff, ifd, {
    ...options,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(options.micrometersPerPixel ?? 1),
      origin: 'top-left',
      imageYAxis: 'down',
    },
  })
}

// A stripped IFD as a one-level loader, cut into tiles like any stripped
// level. `extent` stretches it over a larger image, as a thumbnail covers its
// slide; `channel` replaces its own channel. Associated images are drawn as
// stored: RGB, or grey.
async function stripImageLoader(
  tiff: GeoTIFF,
  ifd: AssociatedImageIfd,
  options: {
    readonly url: string
    readonly sourceUrl: string
    readonly sourceOptions: Pick<
      TiffPyramidLoaderOptions,
      'origin' | 'fetcher' | 'byteRangeCache'
    >
    readonly units: UnitsDescriptor
    readonly extent?: { readonly width: ImagePixels; readonly height: ImagePixels }
    readonly channel?: TiffChannelInfo | undefined
  },
): Promise<TiffPyramidLoader> {
  const [shape, decodeMetadata, stripTags] = await Promise.all([
    summarizeIfdShape(ifd.directory, ifd.index),
    readTileDecodeMetadata(tiff, ifd.directory),
    readStripTags(ifd.directory),
  ])

  if (stripTags === undefined) {
    throw new Error(`IFD ${ifd.index} is not stored in strips.`)
  }

  const width = imagePixels(shape.width)
  const height = imagePixels(shape.height)
  const tileSize = imagePixels(STRIP_TILE_SIZE)
  const stripLevel = tiffStripLevel({
    level: 0,
    width,
    height,
    tags: stripTags,
    decodeMetadata,
    tileHeight: tileSize,
  })
  const imageWidth = options.extent?.width ?? width
  const imageHeight = options.extent?.height ?? height
  const channel = options.channel ?? {
    ...svsChannelInfo(shape.samplesPerPixel, decodeMetadata.bitsPerSample?.[0]),
    color: [255, 255, 255] as const,
  }

  return new TiffPyramidLoader({
    url: options.url,
    sourceUrl: options.sourceUrl,
    sourceVersion: remoteTiffVersion(tiff),
    ...decodeMetadata,
    ...options.sourceOptions,
    chunkIndex: new Map(),
    levelMeta: new Map([
      [
        0,
        tiffLevelMeta({
          width,
          height,
          tileWidth: tileSize,
          tileHeight: tileSize,
          fullWidth: imageWidth,
          fullHeight: imageHeight,
        }),
      ],
    ]),
    stripLevels: new Map([[0, stripLevel]]),
    units: options.units,
    tileWidth: tileSize,
    tileHeight: tileSize,
    numLevels: 1,
    imageWidth,
    imageHeight,
    channels: [channel],
  })
}

function notifyUnusedZchunkStore(
  onFallback: FallbackNotifier | undefined,
  options: OpenImagePyramidOptions,
  format: Pick<TopLevelPyramidFormat, 'name' | 'withArticle'>,
): void {
  if (options.zchunkStoreUrl !== undefined) {
    notifyFallback(onFallback, {
      source: 'Morphology image',
      message: `The dataset manifest names a .zchunkstore sidecar, but the image is ${format.withArticle}, so the sidecar is not used.`,
      action: `Remove the sidecar from the manifest; ${format.name} images do not need one.`,
      coalesceKey: `zchunkstore-${format.name.toLowerCase()}:${options.zchunkStoreUrl}`,
    })
  }
}

function sharedPyramidFile<T>(
  files: Map<string, Promise<T>>,
  sourceUrl: string,
  read: () => Promise<T>,
): Promise<T> {
  const cached = files.get(sourceUrl)

  // Map order is insertion order; re-inserting marks the file most recent.
  files.delete(sourceUrl)

  const file = cached ?? read()
  files.set(sourceUrl, file)

  if (cached === undefined) {
    file.catch(() => {
      if (files.get(sourceUrl) === file) {
        files.delete(sourceUrl)
      }
    })
  }

  for (const oldestUrl of files.keys()) {
    if (files.size <= TOP_LEVEL_PYRAMID_FILE_CACHE_SIZE) {
      break
    }

    files.delete(oldestUrl)
  }

  return file
}

// An NDPI's levels (see ndpi.ts) as the loader reads them: levels with
// restart offsets by block, and small levels without them by strip.
interface NdpiFile {
  readonly sourceVersion: string
  readonly levelMeta: ReadonlyMap<number, TiffLevelMeta>
  readonly ndpiLevels: ReadonlyMap<number, NdpiLevelRead>
  readonly stripLevels: ReadonlyMap<number, TiffStripLevel>
  readonly channel: TiffChannelInfo
  readonly micrometersPerPixel: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly numLevels: number
}

const ndpiFiles = new Map<string, Promise<NdpiFile>>()

const NDPI_FORMAT = { name: 'NDPI', withArticle: 'an NDPI' }

// Hamamatsu writes each IFD after its level's JPEG, with the McuStarts tag
// data just before the IFD, so the IFDs are spread through the file.
const NDPI_SOURCE_OPTIONS: BlockedRemoteSourceOptions = {
  allowFullFile: false,
  blockSize: 64 * 1024,
  cacheSize: 64,
}

async function openNdpi(
  url: string,
  selection: TiffImageSelection,
  signal: AbortSignal | undefined,
  onFallback: FallbackNotifier | undefined,
  options: OpenImagePyramidOptions,
  // The file when the caller has already opened it.
  openedTiff?: GeoTIFF,
): Promise<TiffPyramidLoader> {
  notifyUnusedZchunkStore(onFallback, options, NDPI_FORMAT)

  const file = await abortable(
    sharedPyramidFile(ndpiFiles, selection.sourceUrl, async () => {
      const tiff =
        openedTiff ??
        (options.bytes === undefined
          ? await openRemoteTiff(selection.sourceUrl, NDPI_SOURCE_OPTIONS)
          : await fromArrayBuffer(wholeArrayBuffer(options.bytes)))
      return readNdpiFile(tiff)
    }),
    signal,
  )

  return new TiffPyramidLoader({
    url,
    sourceUrl: selection.sourceUrl,
    sourceVersion: file.sourceVersion,
    ...loaderSourceOptions(options),
    chunkIndex: new Map(),
    levelMeta: file.levelMeta,
    ndpiLevels: file.ndpiLevels,
    stripLevels: file.stripLevels,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(
        options.micrometersPerPixel ?? file.micrometersPerPixel,
      ),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    tileWidth: imagePixels(NDPI_TILE_SIZE),
    tileHeight: imagePixels(NDPI_TILE_SIZE),
    numLevels: file.numLevels,
    imageWidth: file.imageWidth,
    imageHeight: file.imageHeight,
    channels: [
      options.channelName === undefined
        ? file.channel
        : { ...file.channel, name: options.channelName },
    ],
  })
}

async function readNdpiFile(tiff: GeoTIFF): Promise<NdpiFile> {
  if ((tiff.source.fileSize ?? 0) > 0xffff_ffff) {
    throw new Error(NDPI_OVER_4GB_MESSAGE)
  }

  // The macro image and map follow the pyramid, so the walk stops at the
  // macro rather than reading the map's IFD too.
  const directories = await readIfdChain(
    tiff,
    async (directory, index) =>
      index > 0 &&
      ((await readOptionalFloatTag(directory, NDPI_MAGNIFICATION_TAG)) ?? 0) < 0,
  )
  const summaries = await Promise.all(
    directories.map(async (directory, index): Promise<NdpiIfdSummary> => {
      const [shape, magnification, zOffset] = await Promise.all([
        summarizeIfdShape(directory, index),
        readOptionalFloatTag(directory, NDPI_MAGNIFICATION_TAG),
        readOptionalFloatTag(directory, NDPI_Z_OFFSET_TAG),
      ])

      return {
        index,
        width: shape.width,
        height: shape.height,
        ...(magnification === undefined ? {} : { magnification }),
        ...(zOffset === undefined ? {} : { zOffset }),
      }
    }),
  )

  if (directories.some((directory) => directory.hasTag(NDPI_MCU_STARTS_HIGH_BYTES_TAG))) {
    throw new Error(NDPI_OVER_4GB_MESSAGE)
  }

  const levels = (
    await Promise.all(
      ndpiLayout(summaries).map(async (index) => {
        const directory = directories[index]
        const summary = summaries[index]

        return directory === undefined || summary === undefined
          ? undefined
          : readNdpiLevel(tiff, directory, summary)
      }),
    )
  ).filter((level) => level !== undefined)
  const first = levels[0]

  // A level that cannot be read is left out, unless it is the first.
  if (first === undefined || 'error' in first) {
    throw new Error(
      first === undefined
        ? 'The NDPI has no pyramid images.'
        : `The NDPI's full-resolution image cannot be read: ${first.error}`,
    )
  }

  const usable = levels.filter(
    (level): level is Exclude<NdpiFileLevel, { readonly error: string }> =>
      !('error' in level),
  )
  const imageWidth = imagePixels(first.width)
  const imageHeight = imagePixels(first.height)
  const levelMeta = new Map<number, TiffLevelMeta>()
  const ndpiLevels = new Map<number, NdpiLevelRead>()
  const stripLevels = new Map<number, TiffStripLevel>()
  const levelSize = (width: number, height: number) =>
    tiffLevelMeta({
      width: imagePixels(width),
      height: imagePixels(height),
      tileWidth: imagePixels(NDPI_TILE_SIZE),
      tileHeight: imagePixels(NDPI_TILE_SIZE),
      fullWidth: imageWidth,
      fullHeight: imageHeight,
    })

  usable.forEach((level, index) => {
    levelMeta.set(index, levelSize(level.width, level.height))

    if (level.kind === 'ndpi') {
      ndpiLevels.set(index, { source: level.source, sourceLevel: index, dcOnly: false })
    } else {
      stripLevels.set(index, level.strip)
    }
  })

  const smallest = usable.at(-1)
  const smallestMeta = levelMeta.get(usable.length - 1)

  if (
    smallest?.kind === 'ndpi' &&
    smallestMeta !== undefined &&
    Math.max(smallest.width, smallest.height) > NDPI_DC_LEVEL_MIN_SIZE
  ) {
    const level = usable.length

    levelMeta.set(level, {
      ...levelSize(
        Math.ceil(smallest.width / NDPI_DC_SCALE),
        Math.ceil(smallest.height / NDPI_DC_SCALE),
      ),
      // Exactly an eighth: partial blocks make the size round up.
      scaleX: (smallestMeta.scaleX ?? 1) * NDPI_DC_SCALE,
      scaleY: (smallestMeta.scaleY ?? 1) * NDPI_DC_SCALE,
    })
    ndpiLevels.set(level, {
      source: smallest.source,
      sourceLevel: usable.length - 1,
      dcOnly: true,
    })
  }

  return {
    sourceVersion: remoteTiffVersion(tiff),
    levelMeta,
    ndpiLevels,
    stripLevels,
    channel: svsChannelInfo(first.samplesPerPixel, first.bitsPerSample),
    micrometersPerPixel: qptiffMicrometersPerPixel(
      first.xResolution,
      first.resolutionUnit,
    ),
    imageWidth,
    imageHeight,
    numLevels: levelMeta.size,
  }
}

type NdpiFileLevel =
  | (NdpiLevelBase & { readonly kind: 'ndpi'; readonly source: NdpiLevelSource })
  | (NdpiLevelBase & { readonly kind: 'strip'; readonly strip: TiffStripLevel })
  | { readonly error: string }

interface NdpiLevelBase {
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  readonly bitsPerSample: number | undefined
  readonly xResolution: number | undefined
  readonly resolutionUnit: number | undefined
}

// A level with restart offsets in one JPEG strip is read by block; any
// other level only when its strips decode small enough to read whole.
async function readNdpiLevel(
  tiff: GeoTIFF,
  directory: ImageFileDirectory,
  summary: NdpiIfdSummary,
): Promise<NdpiFileLevel> {
  const [decodeMetadata, stripTags, xResolution, resolutionUnit] = await Promise.all([
    readTileDecodeMetadata(tiff, directory),
    readStripTags(directory),
    readOptionalRationalTag(directory, 'XResolution'),
    readOptionalNumberTag(directory, 'ResolutionUnit'),
  ])
  const samplesPerPixel =
    decodeMetadata.samplesPerPixel ?? decodeMetadata.bitsPerSample?.length ?? 1
  const base: NdpiLevelBase = {
    width: summary.width,
    height: summary.height,
    samplesPerPixel,
    bitsPerSample: decodeMetadata.bitsPerSample?.[0],
    xResolution,
    resolutionUnit,
  }

  if (stripTags === undefined) {
    return { error: `IFD ${summary.index} is tiled, which NDPI levels are not.` }
  }

  const streamOffset = stripTags.offsets[0]
  const streamLength = stripTags.byteCounts[0]

  if (
    directory.hasTag(NDPI_MCU_STARTS_TAG) &&
    decodeMetadata.compression === TIFF_COMPRESSION_JPEG &&
    stripTags.offsets.length === 1 &&
    streamOffset !== undefined &&
    streamLength !== undefined
  ) {
    let intervalStarts: Promise<ArrayLike<number>> | undefined

    return {
      ...base,
      kind: 'ndpi',
      source: {
        width: summary.width,
        height: summary.height,
        samplesPerPixel,
        ...(decodeMetadata.photometric === undefined
          ? {}
          : { photometric: decodeMetadata.photometric }),
        streamOffset,
        streamLength,
        // Read when the level's first tile is fetched; a failed read is
        // retried by the next one.
        intervalStarts: () => {
          if (intervalStarts === undefined) {
            const loading = readMcuStarts(directory)
            loading.catch(() => {
              if (intervalStarts === loading) {
                intervalStarts = undefined
              }
            })
            intervalStarts = loading
          }

          return intervalStarts
        },
      },
    }
  }

  try {
    return {
      ...base,
      kind: 'strip',
      strip: tiffStripLevel({
        level: summary.index,
        width: summary.width,
        height: summary.height,
        tags: stripTags,
        decodeMetadata,
        tileHeight: NDPI_TILE_SIZE,
      }),
    }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}

async function readMcuStarts(directory: ImageFileDirectory): Promise<ArrayLike<number>> {
  const value: unknown = await directory.loadValue(NDPI_MCU_STARTS_TAG)

  if (typeof value === 'number') {
    return [value]
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value) {
    return value as unknown as ArrayLike<number>
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value
  }

  throw new Error('The NDPI McuStarts tag is not a list of offsets.')
}

async function readQptiffFile(
  tiff: GeoTIFF,
  options: OpenImagePyramidOptions,
): Promise<TopLevelPyramidFile> {
  void options
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
  tiff: GeoTIFF,
  options: OpenImagePyramidOptions,
): Promise<TopLevelPyramidFile> {
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

  const svsDescription = parseSvsDescription(description)
  const thumbnailSummary = summaries.find(
    (summary) =>
      svsAssociatedImageName({ ...summary, tiled: summary.tileWidth !== undefined }) ===
      'thumbnail',
  )
  const thumbnailDirectory =
    thumbnailSummary === undefined ? undefined : directories[thumbnailSummary.index]
  let associated: Promise<readonly AssociatedImageIfd[]> | undefined

  return {
    ...topLevelPyramid({
      tiff,
      directories,
      summaries,
      levels: levelIfds.map((index) => [index]),
      channels: [
        svsChannelInfo(
          first.samplesPerPixel,
          bitsPerSample[0],
          options.channelName,
          svsDescription,
        ),
      ],
      // Aperio states the pixel size as MPP; its resolution tags are often
      // missing.
      micrometersPerPixel:
        svsDescription.micrometersPerPixel ??
        qptiffMicrometersPerPixel(xResolution, resolutionUnit),
    }),
    ...(thumbnailSummary === undefined || thumbnailDirectory === undefined
      ? {}
      : {
          thumbnail: {
            name: 'thumbnail',
            index: thumbnailSummary.index,
            directory: thumbnailDirectory,
          },
        }),
    // The walk stopped at the label, so the macro's IFD is read only when
    // the associated images are asked for. A failed read is retried.
    associatedImages: () => {
      if (associated === undefined) {
        const reading = readSvsAssociatedImages(tiff, directories)
        reading.catch(() => {
          if (associated === reading) {
            associated = undefined
          }
        })
        associated = reading
      }

      return associated
    },
  }
}

// The thumbnail, label, and macro, in file order: the IFDs after the
// walk's, then each stripped IFD named as OpenSlide names them.
async function readSvsAssociatedImages(
  tiff: GeoTIFF,
  walked: readonly ImageFileDirectory[],
): Promise<readonly AssociatedImageIfd[]> {
  const directories = await readIfdChain(tiff, undefined, walked)
  const named = await Promise.all(
    directories.map(async (directory, index): Promise<AssociatedImageIfd | undefined> => {
      if (index === 0 || directory.hasTag('TileWidth')) {
        return undefined
      }

      const [subfileType, description] = await Promise.all([
        readOptionalNumberTag(directory, 'NewSubfileType'),
        readOptionalStringTag(directory, 'ImageDescription'),
      ])
      const name = svsAssociatedImageName({
        index,
        tiled: false,
        subfileType: subfileType ?? 0,
        description,
      })

      return name === undefined ? undefined : { name, index, directory }
    }),
  )
  const seen = new Set<string>()

  return named.filter((image): image is AssociatedImageIfd => {
    if (image === undefined || seen.has(image.name)) {
      return false
    }

    seen.add(image.name)
    return true
  })
}

// Pages that shrink: the first tiled page at full resolution, then each
// tiled page of the same tile size and sample count that is smaller. The
// pyramid levels beyond the shared tile size are left out (svsLayout).
async function readPagePyramidFile(
  tiff: GeoTIFF,
  options: OpenImagePyramidOptions,
): Promise<TopLevelPyramidFile> {
  const directories = await readIfdChain(tiff)
  const summaries = await Promise.all(
    directories.map((directory, index) => summarizeIfdShape(directory, index)),
  )
  const levelIfds = svsLayout(summaries)
  const first = summaries[0]
  const firstDirectory = directories[0]

  if (first === undefined || firstDirectory === undefined || levelIfds.length === 0) {
    throw new Error('The TIFF page pyramid is not tiled, so it cannot be read by tile.')
  }

  const [bitsPerSample, xResolution, resolutionUnit] = await Promise.all([
    readNumberArrayTag(firstDirectory, 'BitsPerSample'),
    readOptionalRationalTag(firstDirectory, 'XResolution'),
    readOptionalNumberTag(firstDirectory, 'ResolutionUnit'),
  ])

  return topLevelPyramid({
    tiff,
    directories,
    summaries,
    levels: levelIfds.map((index) => [index]),
    channels: [
      svsChannelInfo(first.samplesPerPixel, bitsPerSample[0], options.channelName),
    ],
    micrometersPerPixel: qptiffMicrometersPerPixel(xResolution, resolutionUnit),
  })
}

// A pyramid stored as pages rather than SubIFDs, as tifffile writes the
// MERSCOPE `.vzg` pyramids: IFD 0 tiled, without SubIFDs, and IFD 1 tiled
// with the same tile size and sample count but smaller. OME-TIFFs keep
// channels and planes in their pages, so they are left alone.
async function isPagePyramid(
  tiff: GeoTIFF,
  firstDirectory: ImageFileDirectory,
  description: string | undefined,
): Promise<boolean> {
  if (
    description?.includes('<OME') === true ||
    !(firstDirectory.nextIFDByteOffset > 0) ||
    (await readNumberArrayTag(firstDirectory, 'SubIFDs')).length > 0
  ) {
    return false
  }

  const [first, second] = await Promise.all([
    summarizeIfdShape(firstDirectory, 0),
    tiff.getImage(1).then((image) => summarizeIfdShape(image.getFileDirectory(), 1)),
  ])

  return (
    first.tileWidth !== undefined &&
    second.tileWidth === first.tileWidth &&
    second.tileHeight === first.tileHeight &&
    second.samplesPerPixel === first.samplesPerPixel &&
    second.width < first.width &&
    second.height < first.height
  )
}

// Placement and byte source that the caller gives the opener.
function loaderSourceOptions(
  options: OpenImagePyramidOptions,
): Pick<TiffPyramidLoaderOptions, 'origin' | 'fetcher' | 'byteRangeCache'> {
  return {
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.bytes === undefined
      ? {}
      : { fetcher: memoryRangeFetcher(options.bytes), byteRangeCache: null }),
  }
}

// Answers the loader's Range requests from a file in memory.
export function memoryRangeFetcher(bytes: Uint8Array): typeof fetch {
  return (async (...[, init]: Parameters<typeof fetch>) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(
      new Headers(init?.headers).get('Range') ?? '',
    )

    if (match === null) {
      return new Response(null, { status: 416 })
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]) + 1, bytes.length)
    return new Response(bytes.slice(start, end), { status: 206 })
  }) as typeof fetch
}

// geotiff reads the buffer from offset 0 to its end.
function wholeArrayBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer
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
// is true. A walk that stopped early continues from its IFDs (`walked`).
async function readIfdChain(
  tiff: GeoTIFF,
  isLast?: (directory: ImageFileDirectory, index: number) => Promise<boolean>,
  walked: readonly ImageFileDirectory[] = [],
): Promise<readonly ImageFileDirectory[]> {
  const directories = [...walked]
  const seenOffsets = new Set(
    walked.slice(0, -1).map((directory) => directory.nextIFDByteOffset),
  )
  const lastNext = walked.at(-1)?.nextIFDByteOffset

  if (lastNext !== undefined) {
    if (lastNext === 0 || seenOffsets.has(lastNext)) {
      return directories
    }

    seenOffsets.add(lastNext)
  }

  for (let index = directories.length; index < TOP_LEVEL_PYRAMID_MAX_IFDS; index += 1) {
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
  const fileName = decodedFileName(url)

  return channels.some(
    (channel) => channel.fileName !== undefined && channel.fileName !== fileName,
  )
}

// The IFDs of a directory's SubIFDs, read together; undefined when `skip`
// says not to read them.
async function readSubIfdDirectories(
  tiff: GeoTIFF,
  directory: ImageFileDirectory,
  skip: Promise<boolean>,
): Promise<readonly ImageFileDirectory[] | undefined> {
  const offsets = await readNumberArrayTag(directory, 'SubIFDs')

  if (offsets.length === 0) {
    return []
  }

  if (await skip) {
    return undefined
  }

  return Promise.all(offsets.map((offset) => parseFileDirectoryAt(tiff, offset)))
}

function isOmeTiffUrl(url: string): boolean {
  return /\.ome\.tiff?$/i.test(new URL(url).pathname)
}

// The other files of a multi-file OME-TIFF are opened as soon as this one's
// OME-XML names them, so that their channels' loaders find them read. Not
// when there are more than the open-file limit, which would close files that
// are still opening.
function openOtherChannelFiles(
  sourceUrl: string,
  channels: readonly TiffChannelInfo[],
  zchunkStoreUrl: string | undefined,
): void {
  const fileName = decodedFileName(sourceUrl)
  const otherUrls = [
    ...new Set(
      channels.flatMap((channel) =>
        channel.fileName === undefined || channel.fileName === fileName
          ? []
          : [new URL(channel.fileName, sourceUrl).toString()],
      ),
    ),
  ]

  if (otherUrls.length === 0 || otherUrls.length >= OPEN_TIFF_FILE_LIMIT) {
    return
  }

  for (const url of otherUrls) {
    if (openTiffFiles.has(url)) {
      continue
    }

    prefetchZchunkStores(url, { zchunkStoreUrl, multiFile: true })
    const file = openTiffFile(url)
    // A failed read is not kept for the channel's own open to meet.
    file
      .then((tiff) => tiff.getImage(0))
      .catch(() => {
        forgetTiffFile(url, file)
      })
  }
}

function channelIndexForUrl(url: string, channels: readonly TiffChannelInfo[]): number {
  const fileName = decodedFileName(url)

  if (fileName === undefined) {
    return 0
  }

  return channels.find((channel) => channel.fileName === fileName)?.index ?? 0
}

// The file's name as OME-XML writes it: "stain 0001.ome.tif" for
// …/stain%200001.ome.tif (EXP-331).
function decodedFileName(url: string): string | undefined {
  const segment = new URL(url).pathname.split('/').at(-1)
  if (segment === undefined) return undefined
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
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

// Signed samples would be read as unsigned (-500 as 65036), so an image
// storing them is refused (EXP-015). Label images read them as IDs.
function refuseUnreadableSamples(
  decodeMetadata: TiffTileDecodeMetadata,
  options: Pick<OpenImagePyramidOptions, 'labels'>,
): void {
  refuseUnreadableSampleBits(decodeMetadata, options)

  if (
    decodeMetadata.sampleFormat !== TIFF_SAMPLE_FORMAT_SIGNED ||
    options.labels === true
  ) {
    return
  }

  const bits = decodeMetadata.bitsPerSample?.[0] ?? 8

  throw new Error(
    `The image stores signed ${bits}-bit samples (TIFF SampleFormat 2), which the viewer cannot show. Save it with unsigned 8- or 16-bit samples.`,
  )
}

// Tiles are read as whole 8- or 16-bit samples (32-bit in a label image), or
// as JPEG's 8 or 12 bits, or as JPEG 2000 decodes them. A bilevel mask or
// packed 12-bit samples were read a byte per sample and drawn scrambled
// (EXP-330); strips and re-tiled levels already refuse them.
function refuseUnreadableSampleBits(
  decodeMetadata: TiffTileDecodeMetadata,
  options: Pick<OpenImagePyramidOptions, 'labels'>,
): void {
  const compression = decodeMetadata.compression ?? TIFF_COMPRESSION_NONE
  if (JPEG_2000_COMPRESSION_CODES.has(compression)) return

  const bitsPerSample =
    decodeMetadata.bitsPerSample === undefined ||
    decodeMetadata.bitsPerSample.length === 0
      ? [8]
      : decodeMetadata.bitsPerSample
  const bits = bitsPerSample[0] ?? 8
  const readable =
    compression === TIFF_COMPRESSION_JPEG
      ? bits === 8 || bits === 12
      : bits === 8 || bits === 16 || (options.labels === true && bits === 32)

  if (readable && bitsPerSample.every((value) => value === bits)) return

  throw new Error(
    `The image stores ${bitsPerSample.join('/')}-bit samples, which the viewer cannot read from its tiles. Save it with 8- or 16-bit samples.`,
  )
}

async function readTileDecodeMetadata(
  tiff: GeoTIFF,
  directory: ImageFileDirectory,
): Promise<TiffTileDecodeMetadata> {
  // Read together: each value stored outside the IFD is a request of its own.
  const [
    compression,
    bitsPerSample,
    samplesPerPixel,
    predictor,
    planarConfiguration,
    photometric,
    jpegTables,
    [sampleFormat],
  ] = await Promise.all([
    readOptionalNumberTag(directory, 'Compression'),
    readNumberArrayTag(directory, 'BitsPerSample'),
    readOptionalNumberTag(directory, 'SamplesPerPixel'),
    readOptionalNumberTag(directory, 'Predictor'),
    readOptionalNumberTag(directory, 'PlanarConfiguration'),
    readOptionalNumberTag(directory, 'PhotometricInterpretation'),
    readOptionalByteArrayTag(directory, 'JPEGTables'),
    // Only label images use it, so an odd value never stops an image opening.
    readNumberArrayTag(directory, 'SampleFormat').catch((): readonly number[] => []),
  ])

  return {
    // TIFF's default: a file without the tag is uncompressed.
    compression: compression ?? TIFF_COMPRESSION_NONE,
    ...(bitsPerSample.length === 0 ? {} : { bitsPerSample }),
    ...(samplesPerPixel === undefined ? {} : { samplesPerPixel }),
    ...(predictor === undefined ? {} : { predictor }),
    ...(planarConfiguration === undefined ? {} : { planarConfiguration }),
    ...(photometric === undefined ? {} : { photometric }),
    ...(jpegTables === undefined ? {} : { jpegTables }),
    ...(sampleFormat === undefined ? {} : { sampleFormat }),
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
  readonly tilesFromSharedReads: boolean
  readonly overview?: ImagePyramidLoader
  readonly associatedImages?: (
    signal?: AbortSignal,
  ) => Promise<readonly ImagePyramidAssociatedImage[]>
  private readonly decodeMetadata: TiffTileDecodeMetadata
  private readonly levelDecodeMetadata: readonly TiffTileDecodeMetadata[]
  // The whole tile index, or each level's index once read.
  private readonly chunks: TiffChunkIndex | undefined
  private readonly levelChunks = new Map<number, TiffChunkIndex>()
  private readonly levelChunkRequests = new Map<number, Promise<TiffChunkIndex>>()
  // Each level's tiles in file order, built on its first adjacent read.
  private readonly levelFileOrder = new Map<number, LevelFileOrder>()
  // Tiles read with a neighbour, by chunk key, until fetched themselves.
  private readonly prefetchedTiles = new Map<string, PrefetchedTile>()
  // Tiles being read by a run, by chunk key, so that no other run reads them.
  private readonly tilesInRuns = new Map<string, TileRun>()
  private readonly loadLevelChunks:
    ((level: number) => Promise<TiffChunkIndex>) | undefined
  private readonly levels: ReadonlyMap<number, TiffLevelMeta>
  private readonly stripLevels: ReadonlyMap<number, TiffStripLevel>
  private readonly retiledLevels: ReadonlyMap<number, TiffRetiledLevel>
  private readonly ndpiLevels: ReadonlyMap<number, NdpiLevelRead>
  // Each NDPI level's restart-interval layout, read with its first tile.
  private readonly ndpiGeometries = new Map<number, Promise<NdpiLevelGeometry>>()
  private readonly fetcher: typeof fetch
  private readonly sourceUrl: string
  private readonly sourceVersion: string
  private readonly byteRangeCache: PersistentByteRangeCache | null
  // The image's top-left corner in data micrometres.
  private readonly originX: number
  private readonly originY: number

  constructor(options: TiffPyramidLoaderOptions) {
    this.url = options.url
    this.sourceUrl = options.sourceUrl ?? options.url
    this.sourceVersion = options.sourceVersion ?? ''
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

    if (options.overview !== undefined) {
      this.overview = options.overview
    }

    if (options.associatedImages !== undefined) {
      this.associatedImages = options.associatedImages
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
      ...(options.sampleFormat === undefined
        ? {}
        : { sampleFormat: options.sampleFormat }),
      ...(options.littleEndian === undefined
        ? {}
        : { littleEndian: options.littleEndian }),
      ...(options.jpegTables === undefined ? {} : { jpegTables: options.jpegTables }),
    }
    this.levelDecodeMetadata = options.levelDecodeMetadata ?? []
    this.stripLevels = options.stripLevels ?? new Map()
    this.retiledLevels = options.retiledLevels ?? new Map()
    this.ndpiLevels = options.ndpiLevels ?? new Map()
    this.tilesFromSharedReads =
      this.ndpiLevels.size > 0 &&
      this.ndpiLevels.size + this.stripLevels.size === this.numLevels
    // Tile and tag reads time out and are tried again (O7).
    this.fetcher = retryingFetch(
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    )
    this.byteRangeCache =
      options.byteRangeCache === undefined
        ? defaultPersistentByteRangeCache()
        : options.byteRangeCache
    this.originX = options.origin?.x ?? 0
    this.originY = options.origin?.y ?? 0
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

    // The image extent is the one tileBounds clips tiles to.
    return tilesForBboxOnAxes(
      bbox,
      {
        origin: this.originX,
        imageExtent: this.imageWidth * this.units.micrometersPerPixel,
        micrometersPerPixel: this.units.micrometersPerPixel * scale.x,
        tileSize: this.tileWidth,
        tileCount: meta.nCols,
      },
      {
        origin: this.originY,
        imageExtent: this.imageHeight * this.units.micrometersPerPixel,
        micrometersPerPixel: this.units.micrometersPerPixel * scale.y,
        tileSize: this.tileHeight,
        tileCount: meta.nRows,
      },
    )
  }

  // A level's size in its own pixels.
  levelSize(level: number): { readonly width: number; readonly height: number } {
    const meta = this.levelMetaFor(level)
    return { width: meta.width, height: meta.height }
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
      minX: micrometers(this.originX + Math.max(0, left)),
      maxX: micrometers(this.originX + Math.min(imageWidthMicrometers, right)),
      minY: micrometers(this.originY + Math.max(0, bottom)),
      maxY: micrometers(this.originY + Math.min(imageHeightMicrometers, top)),
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
    const retiledLevel = this.retiledLevels.get(level ?? 0)
    const planarSampleByteLengths =
      level === undefined || col === undefined || row === undefined || retiledLevel
        ? undefined
        : this.planarSampleByteLengths(level, col, row)

    const ndpiLevel = this.ndpiLevels.get(level ?? 0)

    // Without a level, the full-resolution level's tags.
    return {
      ...(this.stripLevels.get(level ?? 0)?.tileDecode ??
        retiledLevel?.tileDecode ??
        (ndpiLevel === undefined
          ? undefined
          : ndpiTileDecodeMetadata(ndpiLevel.source.samplesPerPixel)) ??
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
    options?: ImagePyramidTileFetchOptions,
  ): Promise<Uint8Array> {
    const stripLevel = this.stripLevels.get(level)

    if (stripLevel !== undefined) {
      return this.fetchStripTileBytes(level, stripLevel, col, row, signal)
    }

    const retiledLevel = this.retiledLevels.get(level)

    if (retiledLevel !== undefined) {
      return this.fetchRetiledTileBytes(retiledLevel, col, row, signal)
    }

    const ndpiLevel = this.ndpiLevels.get(level)

    if (ndpiLevel !== undefined) {
      return this.fetchNdpiTileBytes(level, ndpiLevel, col, row, signal)
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
          this.fetchChunkBytes(sampleChunk, signal, undefined, options?.persist),
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
      { level, row, col, chunks, options },
      options?.persist,
    )
  }

  async tileReadBytes(
    level: number,
    tiles: readonly TileIndex[],
    signal?: AbortSignal,
  ): Promise<number | null> {
    // Strip, re-tiled and NDPI tiles are cut from reads shared between tiles.
    if (
      this.stripLevels.has(level) ||
      this.retiledLevels.has(level) ||
      this.ndpiLevels.has(level)
    ) {
      return null
    }

    const chunks = await this.chunkIndex(level)
    signal?.throwIfAborted()
    let bytes = 0

    for (const tile of tiles) {
      const chunk = chunks.get(tiffChunkKey(level, tile.row, tile.col))

      if (chunk === undefined) {
        continue
      }

      bytes += hasSampleChunks(chunk)
        ? chunk.sampleChunks.reduce((total, sample) => total + sample.length, 0)
        : chunk.length
    }

    return bytes
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

  // A tile of a level stored in tiles of another size, cut from the decoded
  // stored tiles it overlaps.
  private async fetchRetiledTileBytes(
    retiledLevel: TiffRetiledLevel,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const { level } = retiledLevel
    const size = this.tileSourceSize(level, col, row)
    const window = {
      left: col * this.tileWidth,
      top: row * this.tileHeight,
      width: size.width,
      height: size.height,
    }
    const stored = await Promise.all(
      retiledTilesUnder(retiledLevel, window).map(async (tile) => ({
        ...tile,
        bytes: await stripBands.get(
          `${this.url}|${level}:tile:${tile.row}:${tile.col}`,
          (tileSignal) => this.readRetiledTile(retiledLevel, tile, tileSignal),
          signal,
        ),
      })),
    )

    return retiledTileBytes(retiledLevel, stored, window, this.tileWidth, this.tileHeight)
  }

  private async readRetiledTile(
    retiledLevel: TiffRetiledLevel,
    tile: RetiledStoredTile,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const chunks = await this.chunkIndex(retiledLevel.level)
    const chunk = chunks.get(tiffChunkKey(retiledLevel.level, tile.row, tile.col))

    if (chunk === undefined) {
      throw new Error(
        `No TIFF chunk for level=${retiledLevel.level} row=${tile.row} col=${tile.col}.`,
      )
    }

    const planes = await Promise.all(
      (hasSampleChunks(chunk) ? chunk.sampleChunks : [chunk]).map((plane) =>
        this.fetchChunkBytes(plane, signal),
      ),
    )
    const bytes = new Uint8Array(planes.reduce((sum, plane) => sum + plane.byteLength, 0))
    let offset = 0

    for (const plane of planes) {
      bytes.set(plane, offset)
      offset += plane.byteLength
    }

    return abortable(
      decodeStripBandOffMainThread(
        bytes,
        retiledTileDecodeOptions(
          retiledLevel,
          planes.map((plane) => plane.byteLength),
        ),
      ),
      signal,
    )
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
          version: this.sourceVersion,
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

  // An NDPI level's tile, cut from the decoded blocks of restart intervals
  // across it (see ndpi.ts). A DC level's blocks decode an eighth the size.
  private async fetchNdpiTileBytes(
    level: number,
    read: NdpiLevelRead,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const geometry = await this.ndpiGeometry(read, signal)
    const size = this.tileSourceSize(level, col, row)
    const window = {
      left: col * this.tileWidth,
      top: row * this.tileHeight,
      width: size.width,
      height: size.height,
    }
    const sourceWindow = read.dcOnly
      ? {
          left: window.left * NDPI_DC_SCALE,
          top: window.top * NDPI_DC_SCALE,
          width: window.width * NDPI_DC_SCALE,
          height: window.height * NDPI_DC_SCALE,
        }
      : window
    const blocks = await Promise.all(
      ndpiBlocksForWindow(geometry, sourceWindow).map(async (block) => {
        const blockWindow = ndpiBlockWindow(geometry, block)

        return {
          window: read.dcOnly ? ndpiDcWindow(blockWindow) : blockWindow,
          bytes: await stripBands.get(
            `${this.url}|ndpi:${read.sourceLevel}:${read.dcOnly ? 'dc' : 'full'}:${block.band}:${block.group}`,
            (blockSignal) => this.readNdpiBlock(read, geometry, block, blockSignal),
            signal,
          ),
        }
      }),
    )

    return ndpiTileBytes(
      blocks,
      window,
      this.tileWidth,
      this.tileHeight,
      geometry.samplesPerPixel,
    )
  }

  private ndpiGeometry(
    read: NdpiLevelRead,
    signal?: AbortSignal,
  ): Promise<NdpiLevelGeometry> {
    let geometry = this.ndpiGeometries.get(read.sourceLevel)

    if (geometry === undefined) {
      const loading = this.readNdpiGeometry(read.source)
      // A failed read is retried by the next tile fetch.
      loading.catch(() => {
        if (this.ndpiGeometries.get(read.sourceLevel) === loading) {
          this.ndpiGeometries.delete(read.sourceLevel)
        }
      })
      this.ndpiGeometries.set(read.sourceLevel, loading)
      geometry = loading
    }

    return abortable(geometry, signal)
  }

  // The McuStarts tag and the JPEG header, read together: the header is
  // usually well under NDPI_HEADER_READ_BYTES, and read again in full if not.
  private async readNdpiGeometry(source: NdpiLevelSource): Promise<NdpiLevelGeometry> {
    const guess = Math.min(source.streamLength, NDPI_HEADER_READ_BYTES)
    const [intervalStarts, guessed] = await Promise.all([
      source.intervalStarts(),
      this.readFileRange(source.streamOffset, source.streamOffset + guess),
    ])
    const headerLength = Math.min(source.streamLength, intervalStarts[0] ?? 0)
    const header =
      headerLength <= guessed.byteLength
        ? guessed
        : await this.readFileRange(
            source.streamOffset,
            source.streamOffset + headerLength,
          )

    return ndpiLevelGeometry({
      width: source.width,
      height: source.height,
      samplesPerPixel: source.samplesPerPixel,
      header,
      intervalStarts,
      streamLength: source.streamLength,
    })
  }

  // One block: its band of MCU rows is read once for every block across
  // it, and the block's intervals decode as their own JPEG off the main
  // thread.
  private async readNdpiBlock(
    read: NdpiLevelRead,
    geometry: NdpiLevelGeometry,
    block: NdpiBlock,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const { source } = read
    const range = ndpiBandByteRange(geometry, block.band)
    const band = await ndpiBands.get(
      `${this.sourceUrl}|${read.sourceLevel}:${block.band}`,
      (bandSignal) =>
        this.readFileRange(
          source.streamOffset + range.start,
          source.streamOffset + range.end,
          bandSignal,
        ),
      signal,
    )
    const jpeg = ndpiBlockJpeg(geometry, band, block)

    return abortable(
      decodeStripBandOffMainThread(
        jpeg.bytes,
        ndpiBlockDecodeOptions(geometry, jpeg, source.photometric, read.dcOnly),
      ),
      signal,
    )
  }

  private readFileRange(
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return fetchByteRangeWithCache({
      cache: this.byteRangeCache,
      namespace: TIFF_TILE_CACHE_NAMESPACE,
      url: this.sourceUrl,
      version: this.sourceVersion,
      start,
      end,
      ...(signal === undefined ? {} : { signal }),
      fetchRange: (rangeSignal) => this.fetchRange(start, end, rangeSignal),
    })
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
    persist = true,
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
      version: this.sourceVersion,
      start,
      end,
      ...(signal === undefined ? {} : { signal }),
      fetchRange: (rangeSignal) =>
        adjacent === undefined
          ? this.fetchRange(start, end, rangeSignal)
          : this.adjacentTileBytes(adjacent, chunk, rangeSignal),
      write: persist,
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

  // A tile read ahead with a neighbour is taken from memory, and a tile
  // another fetch is reading waits for that request: the canvas and
  // auto-contrast read the same coarse tiles as an image opens. Otherwise it
  // is read together with the upcoming tiles stored next to it, which wait in
  // memory for their own fetch. A run is cancelled only when every tile that
  // has asked for it has stopped waiting, and the tiles it was reading for
  // later are then read again by their own fetch.
  private adjacentTileBytes(
    adjacent: AdjacentTileContext,
    chunk: TiffChunk,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const key = tiffChunkKey(adjacent.level, adjacent.row, adjacent.col)
    const prefetched = this.prefetchedTiles.get(key)

    if (prefetched !== undefined) {
      this.prefetchedTiles.delete(key)
      prefetched.run.unclaimed.delete(key)
      adjacent.options?.onSharedRead?.()
      return this.waitForRun(prefetched.run, prefetched.bytes, signal)
    }

    const reading = this.tilesInRuns.get(key)

    if (reading !== undefined && !reading.controller.signal.aborted) {
      adjacent.options?.onSharedRead?.()
      return this.waitForRun(reading, runTileBytes(reading, chunk), signal)
    }

    const upcoming = new Set(
      (adjacent.options?.upcoming ?? []).map((tile) =>
        tiffChunkKey(adjacent.level, tile.row, tile.col),
      ),
    )
    const tiles = readAdjacentTileRun(
      this.fileOrder(adjacent.level, adjacent.chunks),
      key,
      (candidate) =>
        upcoming.has(candidate) &&
        !this.prefetchedTiles.has(candidate) &&
        !this.tilesInRuns.has(candidate),
    )
    const first = tiles[0]
    const last = tiles.at(-1)

    if (first === undefined || last === undefined) {
      throw new Error(`No TIFF chunk for ${key}.`)
    }

    const controller = new AbortController()
    const runStart = first.chunk.offset
    const runBytes = this.fetchRange(
      runStart,
      last.chunk.offset + last.chunk.length,
      controller.signal,
    )
    const run: TileRun = {
      controller,
      start: runStart,
      bytes: runBytes,
      waiters: 0,
      settled: false,
      unclaimed: new Set(),
    }
    const settle = () => {
      run.settled = true

      for (const tile of tiles) {
        if (this.tilesInRuns.get(tile.key) === run) {
          this.tilesInRuns.delete(tile.key)
        }
      }
    }
    runBytes.then(settle, settle)
    let requested: Promise<Uint8Array> | undefined

    for (const tile of tiles) {
      this.tilesInRuns.set(tile.key, run)
      const bytes = runTileBytes(run, tile.chunk)

      if (tile.key === key) {
        requested = bytes
        continue
      }

      // A failed run leaves nothing behind, so the tile is read again.
      bytes.catch(() => {
        if (this.prefetchedTiles.get(tile.key)?.bytes === bytes) {
          this.prefetchedTiles.delete(tile.key)
        }
      })
      this.prefetchedTiles.set(tile.key, { bytes, run })
      run.unclaimed.add(tile.key)
    }

    for (const [oldest, entry] of this.prefetchedTiles) {
      if (this.prefetchedTiles.size <= PREFETCHED_TILE_LIMIT) {
        break
      }

      this.prefetchedTiles.delete(oldest)
      entry.run.unclaimed.delete(oldest)
    }

    return this.waitForRun(run, requested ?? runBytes, signal)
  }

  // Waits for a run's bytes until `signal` aborts; the run is cancelled when
  // its last waiter leaves before it has finished.
  private waitForRun(
    run: TileRun,
    bytes: Promise<Uint8Array>,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    run.waiters += 1

    if (signal === undefined) {
      return bytes
    }

    const leave = () => {
      run.waiters -= 1

      if (run.waiters > 0 || run.settled) {
        return
      }

      run.controller.abort()

      for (const unclaimed of run.unclaimed) {
        if (this.prefetchedTiles.get(unclaimed)?.run === run) {
          this.prefetchedTiles.delete(unclaimed)
        }
      }

      run.unclaimed.clear()
    }

    if (signal.aborted) {
      leave()
    } else {
      signal.addEventListener('abort', leave, { once: true })
      const stopListening = () => {
        signal.removeEventListener('abort', leave)
      }
      bytes.then(stopListening, stopListening)
    }

    return abortable(bytes, signal)
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
  readonly options: ImagePyramidTileFetchOptions | undefined
}

// One request for tiles stored back to back.
interface TileRun {
  readonly controller: AbortController
  // The file offset of the run's first byte, and its bytes, which each tile
  // takes a copy from: a caller may transfer its tile to a worker.
  readonly start: number
  readonly bytes: Promise<Uint8Array>
  // Fetches waiting for the run's bytes.
  waiters: number
  settled: boolean
  // The run's tiles that wait in memory for their own fetch.
  readonly unclaimed: Set<string>
}

interface PrefetchedTile {
  readonly bytes: Promise<Uint8Array>
  readonly run: TileRun
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

// A copy of `chunk`'s bytes from the run reading it.
function runTileBytes(run: TileRun, chunk: TiffChunk): Promise<Uint8Array> {
  const start = chunk.offset - run.start
  return run.bytes.then((data) => data.slice(start, start + chunk.length))
}

// The tile `key` and the tiles stored back to back with it that may join it,
// in file order. Tiles are mostly stored row by row (Aperio writes small
// tiles in scan stripes), so the tiles a view wants next to the requested
// one usually lie beside it in the file. The run grows both ways in turn and
// stops at a tile that may not join.
export function readAdjacentTileRun(
  order: LevelFileOrder,
  key: string,
  canJoin: (key: string) => boolean,
): readonly FileOrderedTile[] {
  const index = order.indexByKey.get(key)

  if (index === undefined || order.tiles[index] === undefined) {
    return []
  }

  let first = index
  let last = index
  // `candidate` joins at the end of the run nearer `neighbour`.
  const joins = (
    candidate: FileOrderedTile | undefined,
    neighbour: FileOrderedTile | undefined,
  ): candidate is FileOrderedTile => {
    const runFirst = order.tiles[first]
    const runLast = order.tiles[last]

    if (
      candidate === undefined ||
      neighbour === undefined ||
      runFirst === undefined ||
      runLast === undefined
    ) {
      return false
    }

    const [before, after] =
      candidate.chunk.offset < neighbour.chunk.offset
        ? [candidate, neighbour]
        : [neighbour, candidate]
    const gap = after.chunk.offset - (before.chunk.offset + before.chunk.length)
    const runStart = Math.min(runFirst.chunk.offset, candidate.chunk.offset)
    const runEnd = Math.max(
      runLast.chunk.offset + runLast.chunk.length,
      candidate.chunk.offset + candidate.chunk.length,
    )

    return (
      gap >= 0 &&
      gap <= ADJACENT_TILE_MAX_GAP &&
      runEnd - runStart <= ADJACENT_RUN_MAX_BYTES &&
      canJoin(candidate.key)
    )
  }

  while (last - first + 1 < ADJACENT_RUN_MAX_TILES) {
    let grew = false

    if (joins(order.tiles[last + 1], order.tiles[last])) {
      last += 1
      grew = true
    }

    if (
      last - first + 1 < ADJACENT_RUN_MAX_TILES &&
      joins(order.tiles[first - 1], order.tiles[first])
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
  const [offsets, byteCounts] = await Promise.all([
    readNumberArrayTag(options.directory, 'TileOffsets'),
    readNumberArrayTag(options.directory, 'TileByteCounts'),
  ])
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

// FLOAT or signed tags, such as NDPI's magnification of 2.5 or -1.
async function readOptionalFloatTag(
  directory: TiffDirectoryValueLoader,
  tag: number,
): Promise<number | undefined> {
  const value = await directory.loadValue(tag)
  const number =
    typeof value === 'number'
      ? value
      : ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value
        ? Number((value as unknown as ArrayLike<number>)[0])
        : undefined

  return number !== undefined && Number.isFinite(number) ? number : undefined
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
