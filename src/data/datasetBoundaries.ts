import type { BBox } from './coords'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedSpatialDataset } from '../datasets/datasetFactory'
import type { ElementBatch, SpatialDataset } from '../datasets/spatialDataset'
import type { DatasetRangeValidator } from './datasetOverview'

export interface LoadDatasetBoundaryElementsOptions {
  readonly getDataset?: (baseUrl: string) => Promise<SpatialDataset> | SpatialDataset
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
}

export async function loadDatasetBoundaryElements(
  baseUrl: string,
  bbox: BBox,
  options: LoadDatasetBoundaryElementsOptions = {},
): Promise<ElementBatch> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const dataset = await (options.getDataset?.(baseUrl) ?? cachedSpatialDataset(baseUrl))
  throwIfAborted(options.signal)
  const meta = await dataset.meta()
  throwIfAborted(options.signal)

  if (!meta.capabilities.cellBoundaries) {
    return { elements: [] }
  }

  if (meta.platform === 'xenium') {
    await validateRangeSupport(datasetFileUrl(baseUrl, 'cell_boundaries.parquet'), {
      label: 'cell_boundaries.parquet',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    throwIfAborted(options.signal)
  }

  const batch = await dataset.elements(bbox)
  throwIfAborted(options.signal)
  return batch
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

  const error = new Error('Boundary request aborted.')
  error.name = 'AbortError'
  return error
}
