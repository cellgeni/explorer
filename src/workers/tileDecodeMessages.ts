import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TileCellDiscs, TileCellMeasureOptions } from '../data/tileCellMeasure'
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

// The cells whose discs touch a tile and what to measure under them.
export interface TileMeasure extends TileCellMeasureOptions {
  readonly cells: TileCellDiscs
}

// Decodes a tile and returns per-cell sums instead of a bitmap (plan 25).
export interface TileMeasureRequest extends TiffTileDecodeMetadata {
  readonly id: number
  readonly bytes: ArrayBuffer
  readonly measure: TileMeasure
}

// Decodes a band of TIFF strips and returns its sample bytes.
export interface TileStripBandRequest extends TiffStripBandDecodeOptions {
  readonly id: number
  readonly bytes: ArrayBuffer
}

export type TileDecodeWorkerRequest =
  | TileDecodeRequest
  | TileSamplesRequest
  | TileMeasureRequest
  | TileStripBandRequest

export type TileDecodeResponse =
  | TileDecodeSuccess
  | TileSamplesSuccess
  | TileMeasureSuccess
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

export interface TileMeasureSuccess {
  readonly id: number
  readonly ok: true
  readonly sum: Float64Array
  readonly count: Uint32Array
  readonly above: Uint32Array
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
