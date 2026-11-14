import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
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

// Decodes a band of TIFF strips and returns its sample bytes.
export interface TileStripBandRequest extends TiffStripBandDecodeOptions {
  readonly id: number
  readonly bytes: ArrayBuffer
}

export type TileDecodeWorkerRequest =
  | TileDecodeRequest
  | TileSamplesRequest
  | TileStripBandRequest

export type TileDecodeResponse =
  | TileDecodeSuccess
  | TileSamplesSuccess
  | TileStripBandSuccess
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

export interface TileStripBandSuccess {
  readonly id: number
  readonly ok: true
  readonly band: ArrayBuffer
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
