// Dataset collection: a JSON file listing datasets to browse together, such
// as the sections of one study. The viewer opens it with `collection=<url>`
// and opens one dataset at a time, with sections registered to it shown
// beside it; each entry is anything `dataset=` opens (a dataset folder, file
// or store, or a dataset manifest). The format is described in
// docs/dataset-collections.md and public/schemas/explorer-collection.v1.json.

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
import { FetchTimeoutError, fetchWithRetry } from '../data/fetchRetry'

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
  'labelsFormat',
  'labelsCoordinates',
  'labelColumn',
  'coordinateSystem',
  'z',
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
  // A name the collection gives to registered coordinates: entries with the
  // same one put a point at the same place in each, so they can be shown
  // side by side with one view.
  readonly coordinateSystem?: string
  // The section's depth in its coordinate system, in the same units as its
  // cells (micrometres): serial sections with one stack in 3D. Every entry of
  // a coordinate system has one, or none does.
  readonly z?: number
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

  // Before the field check, as for manifests: a newer version's fields are
  // unknown here.
  if (json.version !== DATASET_COLLECTION_VERSION) {
    return fail(
      json.version === undefined
        ? `"version" is required; use ${DATASET_COLLECTION_VERSION}.`
        : `"version" ${JSON.stringify(json.version)} is not supported; this viewer reads version ${DATASET_COLLECTION_VERSION}.`,
    )
  }

  checkKeys(json, DATASET_COLLECTION_TOP_LEVEL_KEYS, '', fail)

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
  checkSectionDepths(datasets, fail)
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
    const coordinateSystem = optionalString(entry, 'coordinateSystem', prefix, fail)
    const z = optionalFiniteNumber(entry, 'z', prefix, fail)

    if (z !== undefined && coordinateSystem === undefined) {
      fail(
        `"${prefix}z" needs "${prefix}coordinateSystem": a depth places a section among the others registered to it.`,
      )
    }

    return {
      path,
      url,
      ...(name === undefined ? {} : { name }),
      ...(group === undefined ? {} : { group }),
      ...(image === undefined ? {} : { image }),
      ...(coordinateSystem === undefined ? {} : { coordinateSystem }),
      ...(z === undefined ? {} : { z }),
    }
  })
}

function optionalFiniteNumber(
  entry: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  fail: Fail,
): number | undefined {
  const value = entry[key]
  if (value === undefined) return undefined

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`"${prefix}${key}" must be a number.`)
  }

  return value
}

// A coordinate system's sections are stacked by depth, so a section without
// one would have no place in the stack: either all have one or none does.
function checkSectionDepths(
  datasets: readonly DatasetCollectionEntry[],
  fail: Fail,
): void {
  const firstWithDepth = new Map<string, number>()
  const firstWithout = new Map<string, number>()

  datasets.forEach((entry, index) => {
    if (entry.coordinateSystem === undefined) return

    const seen = entry.z === undefined ? firstWithout : firstWithDepth
    if (!seen.has(entry.coordinateSystem)) seen.set(entry.coordinateSystem, index)
  })

  for (const [system, withDepth] of firstWithDepth) {
    const without = firstWithout.get(system)

    if (without !== undefined) {
      fail(
        `"datasets[${without}]" has no "z", but "datasets[${withDepth}]" in coordinate system ${JSON.stringify(system)} has one; give every section of a coordinate system a "z", or none.`,
      )
    }
  }
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
      labelsFormat: entry.labelsFormat,
      labelsCoordinates: entry.labelsCoordinates,
      labelColumn: optionalString(entry, 'labelColumn', prefix, fail),
    },
    {
      image: `${prefix}image`,
      labels: `${prefix}labels`,
      coordinates: `${prefix}coordinates`,
      labelsFormat: `${prefix}labelsFormat`,
      labelsCoordinates: `${prefix}labelsCoordinates`,
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

  const key = entryUrlKey(url)
  return collection.datasets.find((entry) => entryUrlKey(entry.url) === key)
}

// Whether two addresses name one dataset, as the browser reads them.
export function sameDatasetUrl(a: string, b: string): boolean {
  return entryUrlKey(a) === entryUrlKey(b)
}

// An address as the browser reads it, so spellings of one address (a space
// or `%20`, a host in capitals) find one entry.
function entryUrlKey(url: string): string {
  const trimmed = trimTrailingSlashes(url.trim())

  try {
    return trimTrailingSlashes(new URL(trimmed).href)
  } catch {
    return trimmed
  }
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
  signal?.throwIfAborted()
  const timedOut = `the file did not answer within ${(timeoutMs / 1000).toLocaleString()} s.`
  let response: Response

  // Through fetchWithRetry (O7): an attempt that goes `timeoutMs` without
  // bytes, its body included, ends and is tried again.
  try {
    response = await fetchWithRetry(
      url,
      { cache: 'no-cache', ...(signal === undefined ? {} : { signal }) },
      { fetcher: fetchImpl, idleTimeoutMs: timeoutMs },
    )
  } catch (error) {
    if (signal?.aborted === true) throw error

    throw new DatasetCollectionError(
      url,
      error instanceof FetchTimeoutError
        ? timedOut
        : 'the file could not be read. Check the URL and that the host allows browser reads (CORS).',
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new DatasetCollectionError(url, `the file answered HTTP ${response.status}.`)
  }

  let text: string

  // The timeout covers the body too: a body that stalls or breaks off is
  // not a JSON error (EXP-214).
  try {
    text = await response.text()
  } catch (error) {
    if (signal?.aborted === true) throw error

    throw new DatasetCollectionError(
      url,
      error instanceof FetchTimeoutError
        ? timedOut
        : 'the file broke off before it was read whole. Check the network, then load it again.',
      { cause: error },
    )
  }

  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DatasetCollectionError(url, 'the file is not JSON.', { cause: error })
  }

  return parseDatasetCollection(json, url)
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
