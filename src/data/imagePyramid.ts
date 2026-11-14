import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { BBox, ImagePixels, TileIndex, UnitsDescriptor } from './coords'
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
}

export interface OpenImagePyramidOptions {
  // `.zchunkstore` sidecar named by the dataset manifest, tried instead of the
  // locations derived from the TIFF URL. Only TIFF images use it.
  readonly zchunkStoreUrl?: string
}

// Opens an image pyramid: the generic opener (`openImagePyramid`), a TIFF-only
// one, or a dataset's opener for its channel files.
export type ImagePyramidOpener<Loader extends ImagePyramidLoader = ImagePyramidLoader> = (
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
  options?: OpenImagePyramidOptions,
) => Promise<Loader>
