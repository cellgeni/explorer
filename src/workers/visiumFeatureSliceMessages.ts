export interface VisiumFeatureSliceWorkerTarget {
  readonly id: string
  readonly row: number
  readonly col: number
}

export interface VisiumFeatureSliceWorkerRequest {
  readonly id: number
  readonly url: string
  readonly targets: readonly VisiumFeatureSliceWorkerTarget[]
  readonly genes: readonly string[]
  readonly binSizeMicrometers: number
}

export type VisiumFeatureSliceWorkerResponse =
  | VisiumFeatureSliceWorkerSuccess
  | VisiumFeatureSliceWorkerFailure

export interface VisiumFeatureSliceWorkerSuccess {
  readonly id: number
  readonly ok: true
  readonly geneNames: readonly string[]
  readonly cells: readonly VisiumFeatureSliceWorkerCell[]
}

export interface VisiumFeatureSliceWorkerFailure {
  readonly id: number
  readonly ok: false
  readonly error: string
  readonly errorName?: string
}

export interface VisiumFeatureSliceWorkerCell {
  readonly id: string
  readonly geneNames: readonly string[]
  readonly counts: readonly number[]
}
