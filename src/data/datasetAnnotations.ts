import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { Annotation } from '../datasets/spatialDataset'

export interface LoadDatasetAnnotationsOptions {
  readonly signal?: AbortSignal
}

export async function loadDatasetAnnotations(
  baseUrl: string,
  options: LoadDatasetAnnotationsOptions = {},
): Promise<readonly Annotation[]> {
  throwIfAborted(options.signal)
  const dataset = await cachedXeniumDataset(baseUrl)
  throwIfAborted(options.signal)
  const annotations = await dataset.annotations()
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
