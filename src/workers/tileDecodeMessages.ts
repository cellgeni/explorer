import type { DisplayWindow, RgbaRenderOptions } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'

export interface TileDecodeOptions extends RgbaRenderOptions, TiffTileDecodeMetadata {
  readonly displayWindow?: DisplayWindow
}

export interface TileDecodeRequest extends TileDecodeOptions {
  readonly id: number
  readonly bytes: ArrayBuffer
}

export type TileDecodeResponse = TileDecodeSuccess | TileDecodeFailure

export interface TileDecodeSuccess {
  readonly id: number
  readonly ok: true
  readonly bitmap: ImageBitmap
  readonly width: number
  readonly height: number
  readonly lo: number
  readonly hi: number
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
