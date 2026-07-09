import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { BBox, ImagePixels, TileIndex, UnitsDescriptor } from './coords'

export interface ImagePyramidChannelContrast {
  readonly min: number
  readonly max: number
}

export interface ImagePyramidChannelInfo {
  readonly id: string
  readonly index: number
  readonly name: string
  readonly color: readonly [number, number, number]
  readonly contrast: ImagePyramidChannelContrast
  readonly fileName?: string
  readonly ifdIndex?: number
  readonly sourceUrl?: string
  readonly alphaFromIntensity?: boolean
  readonly purpose?: string
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
}
