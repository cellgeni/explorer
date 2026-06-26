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
export const IDLE_MORPHOLOGY_LOAD_STATE: MorphologyLoadState<never> = {
  status: 'idle',
}
export const IDLE_DATASET_DIAGNOSTICS_STATE: DatasetDiagnosticsState<never> = {
  status: 'idle',
}
export const IDLE_BOUNDARY_LOAD_STATE: BoundaryLoadState<never> = { status: 'idle' }
export const IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE: CellFeatureMatrixCapabilityState =
  { status: 'idle' }

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

export function morphologyLoadStarted(url: string): MorphologyLoadState<never> {
  return { status: 'loading', url }
}

export function morphologyLoadReady(url: string): MorphologyLoadState<never> {
  return { status: 'ready', url }
}

export function morphologyLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): MorphologyLoadState<ErrorType> {
  return { status: 'error', url, error }
}

export function datasetDiagnosticsStarted(url: string): DatasetDiagnosticsState<never> {
  return { status: 'loading', url }
}

export function datasetDiagnosticsReady(
  url: string,
  report: DatasetDiagnosticsReport,
): DatasetDiagnosticsState<never> {
  return { status: 'ready', url, report }
}

export function datasetDiagnosticsFailed<ErrorType>(
  url: string,
  error: ErrorType,
): DatasetDiagnosticsState<ErrorType> {
  return { status: 'error', url, error }
}

export function boundaryLoadStarted(url: string): BoundaryLoadState<never> {
  return { status: 'loading', url }
}

export function boundaryLoadReady(
  url: string,
  cellCount: number,
): BoundaryLoadState<never> {
  return { status: 'ready', url, cellCount }
}

export function boundaryLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): BoundaryLoadState<ErrorType> {
  return { status: 'error', url, error }
}

export function cellFeatureMatrixCapabilityReady(
  url: string,
  hasCellMajorCsc: boolean,
): CellFeatureMatrixCapabilityState {
  return { status: 'ready', url, hasCellMajorCsc }
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
