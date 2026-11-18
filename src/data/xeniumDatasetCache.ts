import { DatasetCache, normalizeDatasetUrl } from '../datasets/datasetCache'
import type { XeniumDataset } from '../datasets/xeniumDataset'

// Instances of their own for annotations and for transcript reads, apart from
// the viewer's dataset (datasetFactory.ts), each with its own DuckDB client.
// Besides the ones in use, the one used last is kept.
const MAX_INACTIVE_XENIUM_DATASETS = 1
const datasetCache = new DatasetCache<XeniumDataset>(MAX_INACTIVE_XENIUM_DATASETS)
const transcriptDatasetCache = new DatasetCache<XeniumDataset>(
  MAX_INACTIVE_XENIUM_DATASETS,
)

export function cachedXeniumDataset(baseUrl: string): Promise<XeniumDataset> {
  return cachedDataset(baseUrl, datasetCache)
}

export function cachedXeniumTranscriptDataset(baseUrl: string): Promise<XeniumDataset> {
  return cachedDataset(baseUrl, transcriptDatasetCache)
}

function cachedDataset(
  baseUrl: string,
  cache: DatasetCache<XeniumDataset>,
): Promise<XeniumDataset> {
  const normalizedUrl = normalizeDatasetUrl(baseUrl)

  return cache.get(normalizedUrl, normalizedUrl, () =>
    import('../datasets/xeniumDataset').then(
      ({ XeniumDataset }) => new XeniumDataset({ baseUrl: normalizedUrl }),
    ),
  )
}
