import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type {
  BBox,
  ImageFramePlacement,
  ImagePixels,
  TileIndex,
  UnitsDescriptor,
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
  // A small picture of the whole image over the image's extent, such as an
  // SVS slide's thumbnail, which the minimap draws instead of the coarsest
  // level. It has the image's channels.
  readonly overview?: ImagePyramidLoader
  // Pictures stored beside the image, such as a slide scanner's label and
  // macro (the whole glass slide), read when asked for.
  associatedImages?(signal?: AbortSignal): Promise<readonly ImagePyramidAssociatedImage[]>
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
}

// Opens an image pyramid: the generic opener (`openImagePyramid`), a TIFF-only
// one, or a dataset's opener for its channel files.
export type ImagePyramidOpener<Loader extends ImagePyramidLoader = ImagePyramidLoader> = (
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
  options?: OpenImagePyramidOptions,
) => Promise<Loader>
