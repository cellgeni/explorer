import type { BBox } from './coords'
import type { ElementBatch, SpatialDataset } from '../datasets/spatialDataset'

export interface LoadDatasetBoundaryElementsOptions {
  readonly getDataset?: (baseUrl: string) => SpatialDataset
}

const datasetCache = new Map<string, Promise<SpatialDataset>>()

export async function loadDatasetBoundaryElements(
  baseUrl: string,
  bbox: BBox,
  options: LoadDatasetBoundaryElementsOptions = {},
): Promise<ElementBatch> {
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
