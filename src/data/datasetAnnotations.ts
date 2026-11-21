import { cachedXeniumDataset } from './xeniumDatasetCache'
import { datasetFileUrlFor } from './datasetFiles'
import {
  readAnalysisZarrAnnotationGroupOptions,
  type AnalysisAnnotationGroupOption,
} from './analysisAnnotations'
import type { Annotation } from '../datasets/spatialDataset'
import { throwIfAborted } from '../utils/abort'

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
    datasetFileUrlFor(baseUrl, 'analysis'),
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
