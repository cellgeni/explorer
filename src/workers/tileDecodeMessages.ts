import type { DisplayWindow } from '../codecs/jpeg2000'

export interface TileDecodeRequest {
  readonly id: number
  readonly bytes: ArrayBuffer
  readonly displayWindow?: DisplayWindow
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
