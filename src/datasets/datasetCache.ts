// Datasets opened per URL, kept so that reopening one, or reading it again
// from another part of the viewer, reuses what it has read. A dataset in use
// is retained: the viewer retains the one it shows, and a collection preview
// the one it is reading. Of the rest, the few used last are kept and older
// ones are disposed, which ends their workers and lets their data go.

export interface DisposableDataset {
  // Ends the dataset's workers and drops what it holds. A dataset may be
  // read again afterwards, opening what it needs again.
  dispose?(): void
}

interface DatasetCacheEntry<T> {
  readonly url: string
  readonly promise: Promise<T>
}

const retainedUrls = new Map<string, number>()
const caches = new Set<{ readonly released: (url: string) => void }>()

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
  }
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
  // the URL that retains it. A dataset that fails to open is not kept.
  get(key: string, baseUrl: string, create: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key)

    if (existing !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, existing)
      return existing.promise
    }

    const promise = create().catch((error: unknown) => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key)
      }

      throw error
    })
    const entry = { url: normalizeDatasetUrl(baseUrl), promise }
    this.entries.set(key, entry)
    this.evict()
    return promise
  }

  // Drops the entries whose keys `matches`, so the next read opens them again.
  delete(matches: (key: string) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (!matches(key)) continue

      this.entries.delete(key)
      this.dropped.add(entry)
    }

    this.evict()
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
    for (const entry of this.dropped) {
      if (isRetained(entry.url)) continue

      this.dropped.delete(entry)
      disposeEntry(entry)
    }

    const inactive = [...this.entries].filter(([, entry]) => !isRetained(entry.url))
    const excess = Math.max(0, inactive.length - this.maxInactive)

    for (const [key, entry] of inactive.slice(0, excess)) {
      this.entries.delete(key)
      disposeEntry(entry)
    }
  }
}

function disposeEntry<T extends DisposableDataset>(entry: DatasetCacheEntry<T>): void {
  entry.promise.then((dataset) => dataset.dispose?.()).catch(() => undefined)
}
