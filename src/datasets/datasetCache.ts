// Datasets opened per URL, kept so that reopening one, or reading it again
// from another part of the viewer, reuses what it has read. A dataset in use
// is retained: the viewer retains the one it shows, and a collection preview
// the one it is reading. Of the rest, the few used last are kept and older
// ones are disposed, which ends their workers and lets their data go.
//
// Resources opened for a dataset's files outside the dataset object, such as
// gex.ts's matrix workers, are released through this registry once no
// viewer, preview or cache holds the dataset's URL (O19): see
// `onDatasetReleased` and src/data/datasetResources.ts.

import { sharedLoad, type SharedLoad } from '../utils/sharedLoad'

export interface DisposableDataset {
  // Ends the dataset's workers and drops what it holds. A dataset may be
  // read again afterwards, opening what it needs again.
  dispose?(): void
}

interface DatasetCacheEntry<T> {
  readonly url: string
  readonly load: SharedLoad<T>
}

const retainedUrls = new Map<string, number>()
const caches = new Set<{
  readonly released: (url: string) => void
  readonly delete: (matches: (key: string, url: string) => boolean) => void
  readonly addHeldUrls: (urls: Set<string>) => void
}>()
const releaseListeners = new Set<(url: string) => void>()

// Calls `listener` with each dataset URL that stops being held: no longer
// retained, with none of its datasets left in a cache. Returns what stops
// listening.
export function onDatasetReleased(listener: (url: string) => void): () => void {
  releaseListeners.add(listener)
  return () => {
    releaseListeners.delete(listener)
  }
}

// The dataset URLs held now: retained, or with a dataset in a cache, including
// one dropped while it may still be read.
export function heldDatasetUrls(): ReadonlySet<string> {
  const urls = new Set(retainedUrls.keys())

  for (const cache of caches) cache.addHeldUrls(urls)

  return urls
}

function notifyIfReleased(urls: Iterable<string>): void {
  if (releaseListeners.size === 0) return

  const held = heldDatasetUrls()

  for (const url of new Set(urls)) {
    if (held.has(url)) continue

    for (const listener of releaseListeners) listener(url)
  }
}

export function normalizeDatasetUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// Keeps every dataset opened for `baseUrl` until the returned release is
// called. Retaining the same URL twice needs two releases.
export function retainDataset(baseUrl: string): () => void {
  const url = normalizeDatasetUrl(baseUrl)
  let released = false
  retainedUrls.set(url, (retainedUrls.get(url) ?? 0) + 1)

  return () => {
    if (released) return
    released = true
    const count = (retainedUrls.get(url) ?? 1) - 1

    if (count > 0) {
      retainedUrls.set(url, count)
      return
    }

    retainedUrls.delete(url)

    for (const cache of caches) cache.released(url)

    notifyIfReleased([url])
  }
}

// Drops every dataset opened for `baseUrl`, from every cache, so the next
// read opens it again. One still in use is disposed once its URL is released.
export function dropDatasets(baseUrl: string): void {
  const url = normalizeDatasetUrl(baseUrl)

  for (const cache of caches) cache.delete((_key, entryUrl) => entryUrl === url)
}

function isRetained(url: string): boolean {
  return retainedUrls.has(url)
}

export class DatasetCache<T extends DisposableDataset> {
  // In order of last use, oldest first.
  private readonly entries = new Map<string, DatasetCacheEntry<T>>()
  // Entries dropped by `delete` while their URL was retained, so possibly
  // still being read. They are disposed once the URL is released.
  private readonly dropped = new Set<DatasetCacheEntry<T>>()

  constructor(
    // How many datasets that are not retained are kept for reopening.
    private readonly maxInactive: number,
  ) {
    caches.add(this)
  }

  // The dataset cached under `key`, else the one `create` opens. `baseUrl` is
  // the URL that retains it. A dataset that fails to open is not kept. The
  // opening is shared: it is cancelled only once every caller waiting on it
  // has cancelled (see sharedLoad), and the next caller opens it again.
  get(
    key: string,
    baseUrl: string,
    create: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const existing = this.entries.get(key)

    if (existing !== undefined && !existing.load.aborted) {
      this.entries.delete(key)
      this.entries.set(key, existing)
      return existing.load.wait(signal)
    }

    const entry = { url: normalizeDatasetUrl(baseUrl), load: sharedLoad(create) }
    entry.load.promise.catch(() => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key)
      }
    })
    this.entries.set(key, entry)
    this.evict()
    return entry.load.wait(signal)
  }

  // Drops the entries whose keys, or the URLs that retain them, `matches`, so
  // the next read opens them again.
  delete(matches: (key: string, url: string) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (!matches(key, entry.url)) continue

      this.entries.delete(key)
      this.dropped.add(entry)
    }

    this.evict()
  }

  addHeldUrls(urls: Set<string>): void {
    for (const entry of this.entries.values()) urls.add(entry.url)
    for (const entry of this.dropped) urls.add(entry.url)
  }

  // A URL no longer retained was in use until now, so its datasets count as
  // the ones used last.
  released(url: string): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.url !== url) continue

      this.entries.delete(key)
      this.entries.set(key, entry)
    }

    this.evict()
  }

  private evict(): void {
    const disposed: string[] = []

    for (const entry of this.dropped) {
      if (isRetained(entry.url)) continue

      this.dropped.delete(entry)
      disposeEntry(entry)
      disposed.push(entry.url)
    }

    const inactive = [...this.entries].filter(([, entry]) => !isRetained(entry.url))
    const excess = Math.max(0, inactive.length - this.maxInactive)

    for (const [key, entry] of inactive.slice(0, excess)) {
      this.entries.delete(key)
      disposeEntry(entry)
      disposed.push(entry.url)
    }

    notifyIfReleased(disposed)
  }
}

function disposeEntry<T extends DisposableDataset>(entry: DatasetCacheEntry<T>): void {
  entry.load.promise.then((dataset) => dataset.dispose?.()).catch(() => undefined)
}
