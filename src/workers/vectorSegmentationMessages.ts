import type { SpatialDataShapes } from '../datasets/spatialDataShapes'
import type {
  VectorSegmentationFile,
  VectorSegmentationFormat,
} from '../datasets/vectorSegmentation'

// A vector segmentation worker reads one polygon file (fetching a URL itself,
// or reading a picked file), reports progress, sends the shapes back as
// transferred columns, and exits.

export interface VectorSegmentationWorkerRequest {
  readonly type: 'read'
  readonly file: VectorSegmentationFile
  readonly format: VectorSegmentationFormat
  readonly micrometersPerUnit: number
  readonly yMicrometersPerUnit?: number
}

export type VectorSegmentationWorkerResponse =
  | { readonly type: 'progress'; readonly shapeCount: number }
  | { readonly type: 'shapes'; readonly shapes: SpatialDataShapes }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
