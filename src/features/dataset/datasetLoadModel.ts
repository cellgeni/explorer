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

export const IDLE_DATASET_LOAD_STATE: DatasetLoadState<never> = { status: 'idle' }
export const IDLE_DATASET_WARMUP_STATE: DatasetWarmupState = { status: 'idle' }

export function datasetLoadStarted(url: string): DatasetLoadState<never> {
  return { status: 'loading', url }
}

export function datasetLoadReady(
  url: string,
  cellCount: number,
): DatasetLoadState<never> {
  return { status: 'ready', url, cellCount }
}

export function datasetLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): DatasetLoadState<ErrorType> {
  return { status: 'error', url, error }
}

export function datasetWarmupStarted(url: string): DatasetWarmupState {
  return { status: 'loading', url }
}

export function datasetWarmupReady(url: string): DatasetWarmupState {
  return { status: 'ready', url }
}

export function datasetWarmupFailed(url: string): DatasetWarmupState {
  return { status: 'error', url }
}

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
