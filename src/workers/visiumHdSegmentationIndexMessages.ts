import type { VisiumHdSegmentationIndex } from '../datasets/visiumHdSegmentationIndex'
import type { VisiumHdSegmentationIndexParserOptions } from '../datasets/visiumHdSegmentations'

// A Visium HD segmentation index worker parses one GeoJSON file and exits.
// The main thread fetches the file and sends its body chunk by chunk; the
// worker answers with the index as transferred columns.

export type VisiumHdSegmentationIndexWorkerRequest =
  | {
      readonly type: 'start'
      readonly options: VisiumHdSegmentationIndexParserOptions
    }
  | { readonly type: 'chunk'; readonly bytes: ArrayBuffer }
  | { readonly type: 'end' }

export type VisiumHdSegmentationIndexWorkerResponse =
  | { readonly type: 'index'; readonly index: VisiumHdSegmentationIndex }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
