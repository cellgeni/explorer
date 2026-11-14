import type {
  SpatialDataShapes,
  SpatialDataShapesReadLayout,
} from '../datasets/spatialDataShapes'
import type { Affine2D } from '../datasets/spatialDataTransforms'

// A SpatialData shapes worker reads one shapes.parquet and exits: it decodes
// the file with hyparquet and sends the shapes back as transferred columns.

export type SpatialDataShapesSource =
  // Fetched by the worker.
  | { readonly kind: 'url'; readonly url: string }
  // Read by the main thread and sent slice by slice: a file inside a zipped
  // store, or one fetched with a custom fetcher.
  | { readonly kind: 'slices'; readonly url: string; readonly byteLength: number }

export type SpatialDataShapesWorkerRequest =
  | {
      readonly type: 'read'
      readonly source: SpatialDataShapesSource
      readonly affine: Affine2D
      readonly layout?: SpatialDataShapesReadLayout
    }
  | { readonly type: 'slice'; readonly id: number; readonly bytes: ArrayBuffer }
  | { readonly type: 'slice-error'; readonly id: number; readonly error: string }

export type SpatialDataShapesWorkerResponse =
  // Asks the main thread for bytes [start, end) of a `slices` source.
  | {
      readonly type: 'slice'
      readonly id: number
      readonly start: number
      readonly end: number
    }
  | { readonly type: 'shapes'; readonly shapes: SpatialDataShapes }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
