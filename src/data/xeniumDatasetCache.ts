import type { XeniumDataset } from '../datasets/xeniumDataset'

const datasetCache = new Map<string, Promise<XeniumDataset>>()
const transcriptDatasetCache = new Map<string, Promise<XeniumDataset>>()

export function cachedXeniumDataset(baseUrl: string): Promise<XeniumDataset> {
  return cachedDataset(baseUrl, datasetCache)
}

export function cachedXeniumTranscriptDataset(
  baseUrl: string,
): Promise<XeniumDataset> {
  return cachedDataset(baseUrl, transcriptDatasetCache)
}

function cachedDataset(
  baseUrl: string,
  cache: Map<string, Promise<XeniumDataset>>,
): Promise<XeniumDataset> {
  const normalizedUrl = baseUrl.replace(/\/+$/, '')
  const existing = cache.get(normalizedUrl)

  if (existing !== undefined) {
    return existing
  }

  const datasetPromise = import('../datasets/xeniumDataset').then(
    ({ XeniumDataset }) => new XeniumDataset({ baseUrl: normalizedUrl }),
  )
  cache.set(normalizedUrl, datasetPromise)
  return datasetPromise
}
