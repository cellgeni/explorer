import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { ZarrChunkSource, ZarrChunkWindow } from '../workers/zarrDecodeMessages'
import {
  micrometers,
  micrometersPerPixelY,
  placeFrameBbox,
  type BBox,
  type ImageFramePlacement,
  type ImagePixelFrame,
  type ImagePixels,
  type TileIndex,
  type UnitsDescriptor,
} from './coords'
import type { FallbackNotifier } from './fallbackNotice'
import type { TileSamples, TileSampling } from './tileSamples'

export interface ImagePyramidChannelContrast {
  readonly min: number
  readonly max: number
}

// Where one plane of a z-stack is stored: in a TIFF image, or on an OME-Zarr
// image's z axis.
export type ImagePyramidPlaneRef = ImagePyramidTiffPlaneRef | ImagePyramidZarrPlaneRef

// An IFD of the TIFF image file, or of `fileName` beside it.
export interface ImagePyramidTiffPlaneRef {
  readonly ifdIndex: number
  readonly fileName?: string
}

// An index on the OME-Zarr image's z axis, which the channel's URL selects
// with a `z` hash parameter.
export interface ImagePyramidZarrPlaneRef {
  readonly zIndex: number
}

export interface ImagePyramidChannelInfo {
  readonly id: string
  readonly index: number
  readonly name: string
  readonly color: readonly [number, number, number]
  readonly contrast: ImagePyramidChannelContrast
  readonly samplesPerPixel?: number
  readonly fileName?: string
  readonly ifdIndex?: number
  // The channel's plane at each z, indexed by z. Only set for z-stacks.
  readonly zPlanes?: readonly ImagePyramidPlaneRef[]
  readonly sourceUrl?: string
  readonly alphaFromIntensity?: boolean
  readonly purpose?: string
}

// Channel colours by index, for OME-TIFF and OME-Zarr channels whose metadata
// gives none.
export const DEFAULT_CHANNEL_COLORS: readonly (readonly [number, number, number])[] = [
  [88, 144, 255],
  [32, 166, 122],
  [240, 200, 75],
  [215, 63, 124],
  [255, 253, 247],
]

export interface ImagePyramidZStack {
  readonly sizeZ: number
  readonly micrometersPerPlane?: number
  // The plane the loader itself reads, which the z-stack opens on unless
  // another is asked for. Unset, it opens on the middle plane.
  readonly defaultZPlane?: number
}

// An image with more than one time point (plan 28). The loader reads one;
// `atPlane` gives the others.
export interface ImagePyramidTimeSeries {
  readonly sizeT: number
  // The time point the loader itself reads.
  readonly defaultTimePoint: number
  // Time between points, when the time axis gives a unit, in that unit's
  // symbol: { value: 1.5, unit: 'min' }.
  readonly timeStep?: { readonly value: number; readonly unit: string }
}

// A plane of an image with z planes or time points. An axis left out keeps
// the loader's index.
export interface ImagePyramidPlane {
  readonly z?: number
  readonly t?: number
}

// A plane as one string, "z:t" with an axis left out empty: the canvas's frame
// and outlines read at a plane are named so (plan 28).
export function imagePlaneKey(plane: ImagePyramidPlane): string {
  return `${plane.z?.toString() ?? ''}:${plane.t?.toString() ?? ''}`
}

export function imagePlaneFromKey(key: string): ImagePyramidPlane {
  const [z = '', t = ''] = key.split(':')
  return {
    ...(z === '' ? {} : { z: Number(z) }),
    ...(t === '' ? {} : { t: Number(t) }),
  }
}

export type ImagePyramidPixelArray =
  | Uint8Array
  | Uint16Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array

export interface ImagePyramidTilePixels {
  readonly pixels: ImagePyramidPixelArray
  readonly width: number
  readonly height: number
}

export interface ImagePyramidTileRenderOptions
  extends RgbaRenderOptions, TiffTileDecodeMetadata {
  readonly displayWindow?: DisplayWindow
}

// What a caller tells a tile fetch, so that tiles can share requests.
export interface ImagePyramidTileFetchOptions {
  // Other tiles of the same level the caller will fetch soon. A loader that
  // reads tiles stored next to each other in one request (TIFF) adds those
  // among them to this tile's request.
  readonly upcoming?: readonly TileIndex[]
  // Called when the tile's bytes come from a request made for another tile,
  // so that the caller can stop counting it against its request limit.
  readonly onSharedRead?: () => void
  // False reads the persistent byte-range cache but adds nothing to it, so a
  // pass over a whole level (Cell Query's image measurements, plan 26-D8)
  // does not evict what the canvas and the other readers keep there. True
  // by default. TIFF tiles cut from strips or NDPI blocks share their reads
  // with the canvas and are still kept.
  readonly persist?: boolean
}

// A level of a z-stack that can be read whole, for the 3D view.
export interface ImagePyramidVolumeLevel {
  readonly level: number
  readonly width: number
  readonly height: number
  readonly depth: number
  // Voxel size along each axis, in the units of `units.micrometersPerPixel`.
  // `z` is unset when the image does not give the plane spacing in those
  // units.
  readonly voxelSize: {
    readonly x: number
    readonly y: number
    readonly z?: number
  }
}

// One channel of a z-stack level, plane after plane, each row by row.
export interface ImagePyramidVolume {
  readonly data: ImagePyramidPixelArray
  readonly width: number
  readonly height: number
  readonly depth: number
}

// A level's chunks (OME-Zarr), for passes over a whole level such as Cell
// Query's image measurements (plan 26): each chunk is fetched and decoded
// once, however many tiles the canvas cuts it into.
export interface ImagePyramidChunkGrid {
  // In the level's pixels; chunks at the right and bottom edges are cut to
  // the level.
  readonly chunkWidth: number
  readonly chunkHeight: number
  // A chunk decoded, with every channel and plane it holds.
  readonly chunkBytes: number
  // The level's pixel size, from its scale. The first tile's bounds are cut
  // to the image's extent, so on a level one chunk wide they give another.
  readonly micrometersPerPixel: number
  readonly micrometersPerPixelY: number
}

// A chunk as stored, with what a decode worker needs to read the loader's
// channel and plane out of it.
export interface ImagePyramidChunkRead {
  readonly source: ZarrChunkSource
  // Undefined for a chunk the store does not have, which is the fill value.
  readonly bytes: Uint8Array | undefined
  readonly window: ZarrChunkWindow
}

export interface ImagePyramidDecodedTile {
  readonly bitmap: ImageBitmap
  readonly width: number
  readonly height: number
  readonly lo: number
  readonly hi: number
}

export interface ImagePyramidLoader {
  readonly url: string
  readonly units: UnitsDescriptor
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
  readonly numLevels: number
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly channels: readonly ImagePyramidChannelInfo[]
  // Set for a z-stack whose channels list their `zPlanes`. The loader itself
  // reads one plane; other planes open as other loaders.
  readonly zStack?: ImagePyramidZStack
  // Set for an image with more than one time point.
  readonly timeSeries?: ImagePyramidTimeSeries
  // Set when every tile is cut from bands or blocks that are read and
  // decoded once for many tiles (NDPI), so a large uncompressed tile is no
  // heavier to load than its neighbours.
  readonly tilesFromSharedReads?: boolean
  // Set when the image is flipped or its axes swapped in the dataset; tile
  // bounds stay in the loader's frame. Absent means the frame is the
  // dataset's.
  readonly placement?: ImageFramePlacement

  bestLevel(deckScale: number): number
  tilesForBbox(level: number, bbox: BBox): readonly TileIndex[]
  tilesForLevel(level: number): readonly TileIndex[]
  tileBounds(level: number, col: number, row: number): BBox
  tileSourceSize(
    level: number,
    col: number,
    row: number,
  ): { readonly width: ImagePixels; readonly height: ImagePixels }
  fetchTileBytes?(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
    options?: ImagePyramidTileFetchOptions,
  ): Promise<Uint8Array>
  tileDecodeOptions?(
    level?: number,
    col?: number,
    row?: number,
  ): ImagePyramidTileRenderOptions
  // The bytes that fetching these tiles of a level reads, from the file's
  // tile index; null when the loader cannot tell.
  tileReadBytes?(
    level: number,
    tiles: readonly TileIndex[],
    signal?: AbortSignal,
  ): Promise<number | null>
  // A level's chunks, for loaders whose chunks a worker can read one by one.
  chunkGrid?(level: number): ImagePyramidChunkGrid
  // The chunk at a column and row of chunkGrid's grid. It fails for an image
  // whose chunks cannot be read one by one, such as a sharded one.
  readChunk?(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<ImagePyramidChunkRead>
  loadTile?(
    level: number,
    col: number,
    row: number,
    options?: ImagePyramidTileRenderOptions,
    signal?: AbortSignal,
  ): Promise<ImagePyramidDecodedTile>
  loadTilePixels?(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<ImagePyramidTilePixels>
  // Auto-contrast samples of a tile, taken off the main thread; null when the
  // loader cannot.
  sampleTilePixels?(
    level: number,
    col: number,
    row: number,
    sampling: TileSampling,
    signal?: AbortSignal,
  ): Promise<TileSamples | null>
  // The levels of a z-stack that `loadVolume` reads, finest first; unset when
  // the loader cannot read along z.
  volumeLevels?(): readonly ImagePyramidVolumeLevel[]
  // The loader's channel at every plane of a level. `onProgress` gets the
  // planes read so far.
  loadVolume?(
    level: number,
    signal?: AbortSignal,
    onProgress?: (planesRead: number) => void,
  ): Promise<ImagePyramidVolume>
  // The same channel at another z plane or time point, made from what this
  // loader has already opened, without requests. Its URL names the plane, so
  // caches keyed by URL keep planes apart. It returns this loader at its own
  // plane. Unset for loaders that open each plane from its URL (TIFF).
  atPlane?(plane: ImagePyramidPlane): ImagePyramidLoader
  // A small picture of the whole image over the image's extent, such as an
  // SVS slide's thumbnail, which the minimap draws instead of the coarsest
  // level. It has the image's channels.
  readonly overview?: ImagePyramidLoader
  // Pictures stored beside the image, such as a slide scanner's label and
  // macro (the whole glass slide), read when asked for.
  associatedImages?(signal?: AbortSignal): Promise<readonly ImagePyramidAssociatedImage[]>
}

// The image's bounds in the dataset: its level 0 frame from the first tile's
// origin, turned into place when the image is flipped or its axes swapped.
export function placedImageExtent(loader: ImagePyramidLoader): BBox {
  const origin = loader.tileBounds(0, 0, 0)
  const frame: BBox = {
    minX: origin.minX,
    minY: origin.minY,
    maxX: micrometers(origin.minX + loader.imageWidth * loader.units.micrometersPerPixel),
    maxY: micrometers(
      origin.minY + loader.imageHeight * micrometersPerPixelY(loader.units),
    ),
  }

  return loader.placement === undefined ? frame : placeFrameBbox(loader.placement, frame)
}

// The image's full-resolution pixels in the dataset, as placedImageExtent
// places its frame.
export function imagePixelFrame(loader: ImagePyramidLoader): ImagePixelFrame {
  const origin = loader.tileBounds(0, 0, 0)

  return {
    originX: origin.minX,
    originY: origin.minY,
    micrometersPerPixelX: loader.units.micrometersPerPixel,
    micrometersPerPixelY: micrometersPerPixelY(loader.units),
    placement: loader.placement,
  }
}

// An associated image (see ImagePyramidLoader.associatedImages): a one-level
// loader in the image's own pixels, or why it cannot be read.
export type ImagePyramidAssociatedImage = {
  // As the file names it: 'thumbnail', 'label' or 'macro' in an SVS.
  readonly name: string
  // Opens it on its own, as `#ifd=N` on the file's URL.
  readonly ifdIndex: number
  readonly width: number
  readonly height: number
} & (
  | { readonly loader: ImagePyramidLoader; readonly error?: never }
  | { readonly error: string; readonly loader?: never }
)

export interface OpenImagePyramidOptions {
  // `.zchunkstore` sidecar named by the dataset manifest, tried instead of the
  // locations derived from the TIFF URL. Only TIFF images use it.
  readonly zchunkStoreUrl?: string
  // The image's top-left corner in data micrometres, for an image that does
  // not start at the data origin (MERSCOPE mosaics sit at stage
  // coordinates). TIFF images only.
  readonly origin?: { readonly x: number; readonly y: number }
  // Replaces the pixel size the file states. TIFF images only.
  readonly micrometersPerPixel?: number
  // The whole TIFF already in memory, such as an entry inflated from a zip;
  // it is read without requests, and the URL only names it.
  readonly bytes?: Uint8Array<ArrayBuffer>
  // Replaces the name of a single-channel image's channel.
  readonly channelName?: string
  // Opens a segmentation label image, whose tiles are read as raw label
  // values: 32-bit samples are allowed. TIFF images only.
  readonly labels?: boolean
}

// Opens an image pyramid: the generic opener (`openImagePyramid`), a TIFF-only
// one, or a dataset's opener for its channel files.
export type ImagePyramidOpener<Loader extends ImagePyramidLoader = ImagePyramidLoader> = (
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
  options?: OpenImagePyramidOptions,
) => Promise<Loader>
