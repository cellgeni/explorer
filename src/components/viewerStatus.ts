import type { ViewerLoadStatus } from './viewerCoreTypes'

const DATASET_LOADING_TASK_ID = 'dataset'
const MORPHOLOGY_LOADING_TASK_ID = 'morphology'
const BOUNDARY_LOADING_TASK_IDS = ['boundaries', 'nucleus-boundaries']
const DATASET_ERROR = 'Dataset load failed.'
const IMAGE_ERROR = 'OME-TIFF image load failed.'
const BOUNDARY_ERROR = 'Cell boundary load failed.'

interface ViewportErrorMessages {
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
}

export function readViewportMessage(
  status: ViewerLoadStatus,
  imageStatus: ViewerLoadStatus,
  boundaryStatus: ViewerLoadStatus,
  messages: ViewportErrorMessages,
  loadingTaskIds: ReadonlySet<string>,
): { readonly kind: 'info' | 'error'; readonly text: string } | null {
  if (status === 'loading' && !loadingTaskIds.has(DATASET_LOADING_TASK_ID)) {
    return { kind: 'info', text: 'Loading overview cells…' }
  }

  if (status === 'error') {
    return {
      kind: 'error',
      text: messages.errorMessage ?? DATASET_ERROR,
    }
  }

  if (imageStatus === 'loading' && !loadingTaskIds.has(MORPHOLOGY_LOADING_TASK_ID)) {
    return { kind: 'info', text: 'Reading OME-TIFF image…' }
  }

  if (imageStatus === 'error') {
    return {
      kind: 'error',
      text: messages.imageErrorMessage ?? IMAGE_ERROR,
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
      text: messages.boundaryErrorMessage ?? BOUNDARY_ERROR,
    }
  }

  return null
}

// Every load's error now, shown or not: one under a higher message (a cells
// reload over an image error) is still there.
export function viewportErrorTexts(
  status: ViewerLoadStatus,
  imageStatus: ViewerLoadStatus,
  boundaryStatus: ViewerLoadStatus,
  messages: ViewportErrorMessages,
): readonly string[] {
  return [
    status === 'error' ? (messages.errorMessage ?? DATASET_ERROR) : null,
    imageStatus === 'error' ? (messages.imageErrorMessage ?? IMAGE_ERROR) : null,
    boundaryStatus === 'error' ? (messages.boundaryErrorMessage ?? BOUNDARY_ERROR) : null,
  ].filter((text) => text !== null)
}
