import type { ViewerLoadStatus } from './viewerCoreTypes'

const DATASET_LOADING_TASK_ID = 'dataset'
const MORPHOLOGY_LOADING_TASK_ID = 'morphology'
const BOUNDARY_LOADING_TASK_IDS = ['boundaries', 'nucleus-boundaries']

export function readViewportMessage(
  status: ViewerLoadStatus,
  imageStatus: ViewerLoadStatus,
  boundaryStatus: ViewerLoadStatus,
  messages: {
    readonly errorMessage?: string
    readonly imageErrorMessage?: string
    readonly boundaryErrorMessage?: string
  },
  loadingTaskIds: ReadonlySet<string>,
): { readonly kind: 'info' | 'error'; readonly text: string } | null {
  if (status === 'loading' && !loadingTaskIds.has(DATASET_LOADING_TASK_ID)) {
    return { kind: 'info', text: 'Loading overview cells…' }
  }

  if (status === 'error') {
    return {
      kind: 'error',
      text: messages.errorMessage ?? 'Dataset load failed.',
    }
  }

  if (imageStatus === 'loading' && !loadingTaskIds.has(MORPHOLOGY_LOADING_TASK_ID)) {
    return { kind: 'info', text: 'Reading OME-TIFF image…' }
  }

  if (imageStatus === 'error') {
    return {
      kind: 'error',
      text: messages.imageErrorMessage ?? 'OME-TIFF image load failed.',
    }
  }

  if (
    boundaryStatus === 'loading' &&
    !BOUNDARY_LOADING_TASK_IDS.some((id) => loadingTaskIds.has(id))
  ) {
    return { kind: 'info', text: 'Loading cell boundaries…' }
  }

  if (boundaryStatus === 'error') {
    return {
      kind: 'error',
      text: messages.boundaryErrorMessage ?? 'Cell boundary load failed.',
    }
  }

  return null
}
