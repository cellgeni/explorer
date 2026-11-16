// Dataset collection: a JSON file listing datasets to browse together, such
// as the sections of one study. The viewer opens it with `collection=<url>`
// and shows one dataset at a time; each entry is anything `dataset=` opens (a
// dataset folder, file or store, or a dataset manifest). The format is
// described in docs/dataset-collections.md and
// public/schemas/explorer-collection.v1.json.

import {
  checkKeys,
  optionalPath,
  optionalString,
  parentUrl,
  parseDefaults,
  parseImageAttachment,
  parseSource,
  resolveManifestPath,
  trimTrailingSlashes,
  type DatasetImageAttachment,
  type DatasetManifestDefaults,
  type DatasetManifestSource,
  type Fail,
} from './datasetManifest'

export const DATASET_COLLECTION_VERSION = 1

export const DATASET_COLLECTION_TOP_LEVEL_KEYS = [
  '$schema',
  'version',
  'name',
  'description',
  'source',
  'root',
  'datasets',
  'defaults',
] as const

export const DATASET_COLLECTION_ENTRY_KEYS = [
  'dataset',
  'name',
  'group',
  'image',
  'coordinates',
  'labels',
  'labelColumn',
] as const

// The dataset manifest defaults that make sense across datasets. Layer
// toggles, opacities and channels belong to each dataset's own manifest;
// a point size suits sections of one kind, which a collection usually holds.
export const DATASET_COLLECTION_DEFAULT_KEYS = [
  'genes',
  'colorCellsBy',
  'geneColorScale',
  'geneRange',
  'geneScoreMode',
  'cellPointScale',
] as const

// The viewer keeps every entry in memory and lists them all, so a collection
// is a study's worth of datasets, not a repository's.
export const MAX_COLLECTION_DATASETS = 500

export const COLLECTION_FETCH_TIMEOUT_MS = 15_000

export type DatasetCollectionDefaults = Pick<
  DatasetManifestDefaults,
  (typeof DATASET_COLLECTION_DEFAULT_KEYS)[number]
>

export interface DatasetCollectionEntry {
  // As written in the collection.
  readonly path: string
  // Resolved against `root` or the collection's folder: what `dataset=` opens.
  readonly url: string
  readonly name?: string
  readonly group?: string
  readonly image?: DatasetImageAttachment
}

export interface DatasetCollection {
  readonly url: string
  readonly name?: string
  readonly description?: string
  readonly source?: DatasetManifestSource
  readonly datasets: readonly DatasetCollectionEntry[]
  // Applied to the first dataset opened from the collection.
  readonly defaults?: DatasetCollectionDefaults
}

export class DatasetCollectionError extends Error {
  readonly collectionUrl: string

  constructor(collectionUrl: string, message: string, options?: ErrorOptions) {
    super(`${collectionLabel(collectionUrl)}: ${message}`, options)
    this.name = 'DatasetCollectionError'
    this.collectionUrl = collectionUrl
  }
}

export function parseDatasetCollection(
  json: unknown,
  collectionUrl: string,
): DatasetCollection {
  const fail: Fail = (message) => {
    throw new DatasetCollectionError(collectionUrl, message)
  }

  if (!isRecord(json)) {
    return fail('expected a JSON object.')
  }

  if ('platform' in json) {
    return fail(
      'this is a dataset manifest, not a collection; open it with dataset= in the address instead of collection=.',
    )
  }

  checkKeys(json, DATASET_COLLECTION_TOP_LEVEL_KEYS, '', fail)

  if (json.version !== DATASET_COLLECTION_VERSION) {
    return fail(
      json.version === undefined
        ? `"version" is required; use ${DATASET_COLLECTION_VERSION}.`
        : `"version" ${JSON.stringify(json.version)} is not supported; this viewer reads version ${DATASET_COLLECTION_VERSION}.`,
    )
  }

  const collectionFolderUrl = parentUrl(collectionUrl)
  const root = optionalPath(json, 'root', '', fail)
  const rootUrl =
    root === undefined
      ? collectionFolderUrl
      : trimTrailingSlashes(resolveManifestPath(collectionFolderUrl, root))
  const name = optionalString(json, 'name', '', fail)
  const description = optionalString(json, 'description', '', fail)
  const source = parseSource(json.source, fail)
  const datasets = parseEntries(json.datasets, rootUrl, fail)
  let defaults: DatasetCollectionDefaults | undefined

  if (json.defaults !== undefined) {
    if (!isRecord(json.defaults)) {
      return fail('"defaults" must be an object.')
    }

    checkKeys(json.defaults, DATASET_COLLECTION_DEFAULT_KEYS, 'defaults.', fail)
    defaults = parseDefaults(json.defaults, fail)
  }

  return {
    url: collectionUrl,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(source === undefined ? {} : { source }),
    datasets,
    ...(defaults === undefined ? {} : { defaults }),
  }
}

function parseEntries(
  value: unknown,
  rootUrl: string,
  fail: Fail,
): readonly DatasetCollectionEntry[] {
  if (value === undefined) {
    return fail('"datasets" is required.')
  }

  if (!Array.isArray(value) || value.length === 0) {
    return fail('"datasets" must be a non-empty array.')
  }

  if (value.length > MAX_COLLECTION_DATASETS) {
    return fail(
      `"datasets" lists ${value.length.toLocaleString()} datasets; a collection holds up to ${MAX_COLLECTION_DATASETS.toLocaleString()}.`,
    )
  }

  const seen = new Map<string, number>()

  return value.map((entry: unknown, index) => {
    const prefix = `datasets[${index}].`

    if (!isRecord(entry)) {
      return fail(`"datasets[${index}]" must be an object.`)
    }

    checkKeys(entry, DATASET_COLLECTION_ENTRY_KEYS, prefix, fail)
    const path =
      optionalPath(entry, 'dataset', prefix, fail) ??
      fail(`"${prefix}dataset" is required.`)
    const url = resolveManifestPath(rootUrl, path)
    const earlier = seen.get(url)

    // The address names the open dataset by URL, so each must be distinct.
    if (earlier !== undefined) {
      fail(`"${prefix}dataset" is the same dataset as "datasets[${earlier}].dataset".`)
    }

    seen.set(url, index)
    const name = optionalString(entry, 'name', prefix, fail)
    const group = optionalString(entry, 'group', prefix, fail)
    const image = parseEntryImage(entry, rootUrl, prefix, fail)

    return {
      path,
      url,
      ...(name === undefined ? {} : { name }),
      ...(group === undefined ? {} : { group }),
      ...(image === undefined ? {} : { image }),
    }
  })
}

function parseEntryImage(
  entry: Readonly<Record<string, unknown>>,
  rootUrl: string,
  prefix: string,
  fail: Fail,
): DatasetImageAttachment | undefined {
  return parseImageAttachment(
    {
      image: optionalPath(entry, 'image', prefix, fail),
      labels: optionalPath(entry, 'labels', prefix, fail),
      coordinates: entry.coordinates,
      labelColumn: optionalString(entry, 'labelColumn', prefix, fail),
    },
    {
      image: `${prefix}image`,
      labels: `${prefix}labels`,
      coordinates: `${prefix}coordinates`,
      labelColumn: `${prefix}labelColumn`,
    },
    rootUrl,
    fail,
  )
}

// The entry for a dataset URL, as the address or a load names it.
export function collectionEntryFor(
  collection: DatasetCollection,
  datasetUrl: string | null | undefined,
): DatasetCollectionEntry | undefined {
  const url = datasetUrl?.trim()

  if (url === undefined || url === '') {
    return undefined
  }

  const key = trimTrailingSlashes(url)
  return collection.datasets.find((entry) => trimTrailingSlashes(entry.url) === key)
}

export interface CollectionGroup {
  // Undefined for entries without a group.
  readonly name?: string
  readonly datasets: readonly DatasetCollectionEntry[]
}

// Entries grouped in the order each group first appears. Entries without a
// group form their own run between groups, so a list without groups stays as
// one run in file order.
export function collectionGroups(
  collection: DatasetCollection,
): readonly CollectionGroup[] {
  const groups: { name?: string; datasets: DatasetCollectionEntry[] }[] = []
  const byName = new Map<string, { name?: string; datasets: DatasetCollectionEntry[] }>()

  for (const entry of collection.datasets) {
    if (entry.group === undefined) {
      const last = groups.at(-1)

      if (last !== undefined && last.name === undefined) {
        last.datasets.push(entry)
      } else {
        groups.push({ datasets: [entry] })
      }

      continue
    }

    const existing = byName.get(entry.group)

    if (existing !== undefined) {
      existing.datasets.push(entry)
    } else {
      const group = { name: entry.group, datasets: [entry] }
      byName.set(entry.group, group)
      groups.push(group)
    }
  }

  return groups
}

export interface FetchDatasetCollectionOptions {
  readonly fetchImpl?: typeof fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

// Fetches and parses a collection. Like a manifest, it is read with
// `cache: no-cache`, so edits show on the next load.
export async function fetchDatasetCollection(
  url: string,
  {
    fetchImpl = fetch,
    signal,
    timeoutMs = COLLECTION_FETCH_TIMEOUT_MS,
  }: FetchDatasetCollectionOptions = {},
): Promise<DatasetCollection> {
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
  }
  const timeout = setTimeout(abort, timeoutMs)
  signal?.addEventListener('abort', abort, { once: true })

  try {
    let response: Response

    try {
      response = await fetchImpl(url, { signal: controller.signal, cache: 'no-cache' })
    } catch (error) {
      if (signal?.aborted === true) throw error

      throw new DatasetCollectionError(
        url,
        controller.signal.aborted
          ? `the file did not answer within ${(timeoutMs / 1000).toLocaleString()} s.`
          : 'the file could not be read. Check the URL and that the host allows browser reads (CORS).',
        { cause: error },
      )
    }

    if (!response.ok) {
      throw new DatasetCollectionError(url, `the file answered HTTP ${response.status}.`)
    }

    let json: unknown

    try {
      json = await response.json()
    } catch (error) {
      throw new DatasetCollectionError(url, 'the file is not JSON.', { cause: error })
    }

    return parseDatasetCollection(json, url)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

function collectionLabel(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'Collection'
  } catch {
    return 'Collection'
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
