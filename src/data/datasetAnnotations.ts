import { cachedXeniumDataset } from './xeniumDatasetCache'
import { datasetFileUrl } from './datasetFiles'
import {
  readAnalysisZarrAnnotationGroupOptions,
  type AnalysisAnnotationGroupOption,
} from './analysisAnnotations'
import type { Annotation } from '../datasets/spatialDataset'

export const ALL_ANNOTATION_GROUP_ID = 'all'
export const NO_ANNOTATION_GROUP_ID = 'none'

export interface LoadDatasetAnnotationsOptions {
  readonly groupId?: string
  readonly signal?: AbortSignal
}

export type AnnotationGroupOption = AnalysisAnnotationGroupOption

export interface LoadDatasetAnnotationGroupsOptions {
  readonly signal?: AbortSignal
}

export async function loadDatasetAnnotationGroups(
  baseUrl: string,
  options: LoadDatasetAnnotationGroupsOptions = {},
): Promise<readonly AnnotationGroupOption[]> {
  throwIfAborted(options.signal)
  const groups = await readAnalysisZarrAnnotationGroupOptions(
    datasetFileUrl(baseUrl, 'analysis.zarr.zip'),
  )
  throwIfAborted(options.signal)

  return groups
}

export async function loadDatasetAnnotations(
  baseUrl: string,
  options: LoadDatasetAnnotationsOptions = {},
): Promise<readonly Annotation[]> {
  throwIfAborted(options.signal)
  const dataset = await cachedXeniumDataset(baseUrl)
  throwIfAborted(options.signal)
  const annotations = await dataset.annotations({
    ...(options.groupId === undefined || options.groupId === ALL_ANNOTATION_GROUP_ID
      ? {}
      : { groupId: options.groupId }),
  })
  throwIfAborted(options.signal)

  return annotations
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Annotation request aborted.')
  error.name = 'AbortError'
  return error
}
