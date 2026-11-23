import type { H5StructureWalk, H5ValuePreview } from '../data/h5StructureTypes'
import type { VisiumFeatureSliceMetadata } from '../data/visiumFeatureSliceH5'

// An H5 file worker holds one HDF5 file, opened with h5wasm from bytes the main
// thread downloaded or from a URL it reads itself. The main thread reads
// datasets by path; values come back as transferred typed arrays or cloned
// strings.

export type H5TreeAttrs = readonly (readonly [string, unknown])[]

export type H5TreeNode = H5TreeGroup | H5TreeDataset

export interface H5TreeGroup {
  readonly kind: 'group'
  readonly attrs: H5TreeAttrs
  readonly children: readonly (readonly [string, H5TreeNode])[]
}

export interface H5TreeDataset {
  readonly kind: 'dataset'
  readonly attrs: H5TreeAttrs
  readonly shape: readonly number[] | null
  // Bytes per element, as h5wasm decodes it.
  readonly itemSize: number | null
}

export type H5FileWorkerRequest =
  | H5FileOpenRequest
  | H5FileReadRequest
  | H5FileMatrixCellsRequest
  | H5FileFeatureSliceRequest
  | H5FileFeatureSliceMetadataRequest
  | H5FileStatsRequest
  | H5FileStructureRequest
  | H5FilePreviewRequest

export interface H5FileOpenRequest {
  readonly id: number
  readonly op: 'open'
  readonly source: H5FileSource
  // Walk the file's groups, datasets and attributes into an `H5TreeGroup`.
  readonly tree: boolean
  // Walk only these slash-separated paths below the root, each whole, and the
  // groups above them with just those children. Each object the walk visits
  // costs a read of its header, which on a remote file can be a request.
  readonly treePaths?: readonly string[]
}

export type H5FileSource =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  // Read by the worker, so the file never reaches the main thread: by range
  // when the server answers range requests, otherwise whole, unless
  // `rangeOnly`, which fails the open with `H5_RANGE_UNSUPPORTED_ERROR` for the
  // caller to read the file another way. `label` names the file in an HTTP
  // error.
  | {
      readonly kind: 'url'
      readonly url: string
      readonly label: string
      readonly rangeOnly?: boolean
    }

// The error name of a `rangeOnly` open the server's replies cannot serve: it
// ignores Range, or hides the file's size, which HDF5 needs.
export const H5_RANGE_UNSUPPORTED_ERROR = 'H5RangeUnsupportedError'

export interface H5FileReadRequest {
  readonly id: number
  readonly op: 'read'
  readonly path: string
  // A hyperslab of a numeric dataset: per dimension, start and end (exclusive),
  // or null for all of it. Without it the whole value is read.
  readonly slice?: H5FileSlice
}

export type H5FileSlice = readonly (readonly [start: number, end: number] | null)[]

// The range reads a file opened from a URL has made so far.
export interface H5FileStatsRequest {
  readonly id: number
  readonly op: 'stats'
}

export interface H5FileRangeStats {
  readonly size: number
  readonly requests: number
  readonly fetchedBytes: number
}

// Every group, dataset, committed datatype and link, with attributes, for
// Browse File. The worker sends `progress` replies as it walks.
export interface H5FileStructureRequest {
  readonly id: number
  readonly op: 'structure'
  // Names the root node.
  readonly rootName: string
  readonly maxNodes?: number
}

// The first values of a dataset (see `H5ValuePreview`).
export interface H5FilePreviewRequest {
  readonly id: number
  readonly op: 'preview'
  readonly path: string
}

// Rows of a 10x feature-barcode matrix (`/matrix`), by barcode.
export interface H5FileMatrixCellsRequest {
  readonly id: number
  readonly op: 'matrix-cells'
  readonly elementIds: readonly string[]
}

// Selected genes of a Visium HD feature_slice.h5 for bins of one size. A
// target's row and col are in that size's grid.
export interface H5FileFeatureSliceRequest {
  readonly id: number
  readonly op: 'feature-slice'
  readonly targets: readonly H5FileFeatureSliceTarget[]
  readonly genes: readonly string[]
  readonly binSizeMicrometers: number
}

// A Visium HD feature_slice.h5's `metadata_json`: its grid size, spot pitch
// and spot-to-pixel transform.
export interface H5FileFeatureSliceMetadataRequest {
  readonly id: number
  readonly op: 'feature-slice-metadata'
}

export interface H5FileFeatureSliceTarget {
  readonly id: string
  readonly row: number
  readonly col: number
}

export type H5FileWorkerResponse =
  | H5FileOpenResponse
  | H5FileReadResponse
  | H5FileMatrixCellsResponse
  | H5FileFeatureSliceResponse
  | H5FileFeatureSliceMetadataResponse
  | H5FileStatsResponse
  | H5FileStructureResponse
  | H5FilePreviewResponse
  | H5FileProgressResponse
  | H5FileWorkerFailure

export interface H5FileOpenResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'open'
  readonly tree: H5TreeGroup | null
  // Null unless the file is read by range.
  readonly range: H5FileRangeStats | null
}

export interface H5FileStatsResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'stats'
  readonly range: H5FileRangeStats | null
}

export interface H5FileStructureResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'structure'
  readonly structure: H5StructureWalk
}

export interface H5FilePreviewResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'preview'
  readonly preview: H5ValuePreview
}

// Sent while a request runs, before its reply: the objects a structure walk
// has read so far.
export interface H5FileProgressResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'progress'
  readonly count: number
}

export interface H5FileReadResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'read'
  readonly value: unknown
}

export interface H5FileMatrixCellsResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'matrix-cells'
  readonly cells: H5MatrixCellsPayload
}

export interface H5FileFeatureSliceResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'feature-slice'
  readonly cells: H5MatrixCellsPayload
}

export interface H5FileFeatureSliceMetadataResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'feature-slice-metadata'
  readonly metadata: VisiumFeatureSliceMetadata
}

export interface H5FileWorkerFailure {
  readonly id: number
  readonly ok: false
  readonly error: string
  readonly errorName?: string
}

// A `GexResult` packed into typed arrays, so an ROI of many cells is
// transferred instead of cloned as one string per count. Cell `i` holds the
// counts `offsets[i]` to `offsets[i + 1]`; each count's gene is
// `names[nameIndices[j]]`.
export interface H5MatrixCellsPayload {
  readonly geneNames: readonly string[]
  readonly names: readonly string[]
  readonly ids: readonly string[]
  readonly offsets: Uint32Array
  readonly nameIndices: Uint32Array
  readonly counts: Float64Array
}
