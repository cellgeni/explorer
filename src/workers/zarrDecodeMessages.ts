import type { TileSampling } from '../data/tileSamples'
import type { PackedLabelTrace } from '../datasets/spatialDataLabelTrace'

// Zarr array metadata as stored (`.zarray` for v2, `zarr.json` for v3), so a
// worker can rebuild the codec pipeline for one chunk.
export interface ZarrChunkSource {
  readonly metadataKey: '.zarray' | 'zarr.json'
  readonly metadata: unknown
  // Chunk key relative to the array, for example `0.1` or `c/0/1`.
  readonly chunkKey: string
  readonly coords: readonly number[]
}

export interface ZarrChunkWindow {
  readonly xAxis: number
  readonly yAxis: number
  // Window origin inside the chunk.
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  // Index inside the chunk for every non-spatial axis.
  readonly fixedAxes: readonly { readonly axis: number; readonly index: number }[]
}

export interface ZarrTileRender {
  readonly displayWindow?: { readonly lo: number; readonly hi: number }
  readonly color?: readonly [number, number, number]
  readonly alphaFromIntensity?: boolean
}

// Stores a chunk's bytes in the worker and starts decoding it. `bytes` is
// null for chunks the store does not have, which decode to the fill value.
export interface ZarrPutChunkMessage {
  readonly type: 'put-chunk'
  readonly cacheKey: string
  readonly source: ZarrChunkSource
  readonly bytes: ArrayBuffer | null
}

export interface ZarrRenderTileMessage {
  readonly type: 'render-tile'
  readonly id: number
  readonly cacheKey: string
  readonly window: ZarrChunkWindow
  readonly render: ZarrTileRender
}

// Auto-contrast samples of a window of a chunk the worker holds.
export interface ZarrSampleTileMessage {
  readonly type: 'sample-tile'
  readonly id: number
  readonly cacheKey: string
  readonly window: ZarrChunkWindow
  readonly sampling: TileSampling
}

export interface ZarrTraceLabelsMessage {
  readonly type: 'trace-labels'
  readonly id: number
  readonly source: ZarrChunkSource
  readonly bytes: ArrayBuffer | null
  readonly window: ZarrChunkWindow
  // Level-pixel origin of the window and level width, for edge keys.
  readonly levelX0: number
  readonly levelY0: number
  readonly levelWidth: number
}

export type ZarrDecodeRequest =
  | ZarrPutChunkMessage
  | ZarrRenderTileMessage
  | ZarrSampleTileMessage
  | ZarrTraceLabelsMessage

export type ZarrDecodeResponse =
  | {
      readonly type: 'tile'
      readonly id: number
      readonly bitmap: ImageBitmap
      readonly width: number
      readonly height: number
      readonly lo: number
      readonly hi: number
    }
  | {
      readonly type: 'samples'
      readonly id: number
      readonly samples: Float64Array
      readonly pixelCount: number
    }
  | { readonly type: 'labels'; readonly id: number; readonly trace: PackedLabelTrace }
  // The worker no longer holds the chunk; the caller resends it.
  | { readonly type: 'miss'; readonly id: number }
  | { readonly type: 'error'; readonly id: number; readonly error: string }
