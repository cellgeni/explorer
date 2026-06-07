import type { DatasetDiagnosticsReport } from '../../data/datasetDiagnostics'

export type DatasetLoadState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export type DatasetWarmupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error'; readonly url: string }

export type CellFeatureMatrixCapabilityState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly hasCellMajorCsc: boolean
    }

export type DatasetDiagnosticsState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly report: DatasetDiagnosticsReport
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export type MorphologyLoadState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export type BoundaryLoadState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }
