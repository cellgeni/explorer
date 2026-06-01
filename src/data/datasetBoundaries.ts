import type { BBox } from './coords'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import type { ElementBatch, SpatialDataset } from '../datasets/spatialDataset'
import type { DatasetRangeValidator } from './datasetOverview'

export interface LoadDatasetBoundaryElementsOptions {
  readonly getDataset?: (baseUrl: string) => SpatialDataset
  readonly validateRangeSupport?: DatasetRangeValidator
}

const datasetCache = new Map<string, Promise<SpatialDataset>>()

export async function loadDatasetBoundaryElements(
  baseUrl: string,
  bbox: BBox,
  options: LoadDatasetBoundaryElementsOptions = {},
): Promise<ElementBatch> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

  await validateRangeSupport(datasetFileUrl(baseUrl, 'cell_boundaries.parquet'), {
    label: 'cell_boundaries.parquet',
  })

  const dataset = options.getDataset?.(baseUrl) ?? (await cachedXeniumDataset(baseUrl))

  return dataset.elements(bbox)
}

function cachedXeniumDataset(baseUrl: string): Promise<SpatialDataset> {
  const normalizedUrl = baseUrl.replace(/\/+$/, '')
  const existing = datasetCache.get(normalizedUrl)

  if (existing !== undefined) {
    return existing
  }

  const datasetPromise = import('../datasets/xeniumDataset').then(
    ({ XeniumDataset }) => new XeniumDataset({ baseUrl: normalizedUrl }),
  )
  datasetCache.set(normalizedUrl, datasetPromise)
  return datasetPromise
}
