import type { XeniumDataset } from '../datasets/xeniumDataset'

const datasetCache = new Map<string, Promise<XeniumDataset>>()

export function cachedXeniumDataset(baseUrl: string): Promise<XeniumDataset> {
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
