export interface FeatureBarcodeMatrixWorkerRequest {
  readonly id: number
  readonly url: string
  readonly elementIds: readonly string[]
}

export type FeatureBarcodeMatrixWorkerResponse =
  | FeatureBarcodeMatrixWorkerSuccess
  | FeatureBarcodeMatrixWorkerFailure

export interface FeatureBarcodeMatrixWorkerSuccess {
  readonly id: number
  readonly ok: true
  readonly geneNames: readonly string[]
  readonly cells: readonly FeatureBarcodeMatrixWorkerCell[]
}

export interface FeatureBarcodeMatrixWorkerFailure {
  readonly id: number
  readonly ok: false
  readonly error: string
  readonly errorName?: string
}

export interface FeatureBarcodeMatrixWorkerCell {
  readonly id: string
  readonly geneNames: readonly string[]
  readonly counts: readonly number[]
}
