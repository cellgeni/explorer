// An H5 file worker holds one HDF5 file, opened with h5wasm from bytes the main
// thread downloaded or from a URL it fetches itself. The main thread reads
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
}

export type H5FileWorkerRequest =
  | H5FileOpenRequest
  | H5FileReadRequest
  | H5FileMatrixCellsRequest

export interface H5FileOpenRequest {
  readonly id: number
  readonly op: 'open'
  readonly source: H5FileSource
  // Walk the file's groups, datasets and attributes into an `H5TreeGroup`.
  readonly tree: boolean
}

export type H5FileSource =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  // Fetched whole by the worker, so the file never reaches the main thread.
  // `label` names the file in an HTTP error.
  | { readonly kind: 'url'; readonly url: string; readonly label: string }

export interface H5FileReadRequest {
  readonly id: number
  readonly op: 'read'
  readonly path: string
}

// Rows of a 10x feature-barcode matrix (`/matrix`), by barcode.
export interface H5FileMatrixCellsRequest {
  readonly id: number
  readonly op: 'matrix-cells'
  readonly elementIds: readonly string[]
}

export type H5FileWorkerResponse =
  | H5FileOpenResponse
  | H5FileReadResponse
  | H5FileMatrixCellsResponse
  | H5FileWorkerFailure

export interface H5FileOpenResponse {
  readonly id: number
  readonly ok: true
  readonly op: 'open'
  readonly tree: H5TreeGroup | null
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
