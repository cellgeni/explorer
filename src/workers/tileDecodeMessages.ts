import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TileSampling } from '../data/tileSamples'

export interface TileDecodeOptions extends RgbaRenderOptions, TiffTileDecodeMetadata {
  readonly displayWindow?: DisplayWindow
}

export interface TileDecodeRequest extends TileDecodeOptions {
  readonly id: number
  readonly bytes: ArrayBuffer
}

// Decodes a tile and returns auto-contrast samples instead of a bitmap.
export interface TileSamplesRequest extends TiffTileDecodeMetadata {
  readonly id: number
  readonly bytes: ArrayBuffer
  readonly sampling: TileSampling
}

export type TileDecodeWorkerRequest = TileDecodeRequest | TileSamplesRequest

export type TileDecodeResponse =
  | TileDecodeSuccess
  | TileSamplesSuccess
  | TileDecodeFailure

export interface TileDecodeSuccess {
  readonly id: number
  readonly ok: true
  readonly bitmap: ImageBitmap
  readonly width: number
  readonly height: number
  readonly lo: number
  readonly hi: number
}

export interface TileSamplesSuccess {
  readonly id: number
  readonly ok: true
  readonly samples: Float64Array
  readonly pixelCount: number
}

export interface TileDecodeFailure {
  readonly id: number
  readonly ok: false
  readonly error: string
}

export interface WorkerDecodedTile {
  readonly bitmap: ImageBitmap
  readonly width: number
  readonly height: number
  readonly lo: number
  readonly hi: number
}
