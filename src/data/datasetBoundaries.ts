import type { BBox } from './coords'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { ElementBatch, SpatialDataset } from '../datasets/spatialDataset'
import type { DatasetRangeValidator } from './datasetOverview'

export interface LoadDatasetBoundaryElementsOptions {
  readonly getDataset?: (baseUrl: string) => SpatialDataset
  readonly validateRangeSupport?: DatasetRangeValidator
}

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
