import { useCallback, useEffect, useRef, useState } from 'react'
import { urlWithoutCredentials } from '../../utils/urlCredentials'

// Recently opened datasets (plan 15.3-A), newest first, kept in
// this browser's localStorage. Storage can be missing or refuse, which only
// means the list is not remembered.

export const RECENT_DATASETS_KEY = 'explorer.recentDatasets'
export const MAX_RECENT_DATASETS = 8

export interface RecentDataset {
  readonly url: string
  readonly name: string
  // A key of PLATFORM_NAMES, such as 'xenium'.
  readonly platform?: string
  // The address carried a signature or token, left out of `url`, so the
  // dataset reopens only from its full address (EXP-026).
  readonly signed?: boolean
}

function isRecentDataset(value: unknown): value is RecentDataset {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.url === 'string' &&
    entry.url.trim() !== '' &&
    typeof entry.name === 'string' &&
    (entry.platform === undefined || typeof entry.platform === 'string') &&
    (entry.signed === undefined || typeof entry.signed === 'boolean')
  )
}

// The entry as kept in storage: an address that carries a credential keeps
// no query string, since a presigned URL's other parameters are part of its
// signature, and is marked as signed.
export function recentDatasetEntry(dataset: RecentDataset): RecentDataset {
  const { url, signed } = urlWithoutCredentials(dataset.url)
  return signed ? { ...dataset, url, signed: true } : dataset
}

export function readRecentDatasets(
  storage: Pick<Storage, 'getItem'> | null,
): readonly RecentDataset[] {
  return readStoredRecentDatasets(storage) ?? []
}

// Null when there is no storage or it cannot be read. Entries are read as
// they are now stored, so a signed address kept whole before EXP-026 shows
// no signature (EXP-329).
function readStoredRecentDatasets(
  storage: Pick<Storage, 'getItem'> | null,
): readonly RecentDataset[] | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(RECENT_DATASETS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? storedEntries(parsed.filter(isRecentDataset)).slice(0, MAX_RECENT_DATASETS)
      : []
  } catch {
    return null
  }
}

// Each entry without credentials, once per address. Two addresses of one
// dataset, signed and not, keep the place of the first and stay openable
// (EXP-234).
function storedEntries(entries: readonly RecentDataset[]): readonly RecentDataset[] {
  const kept: RecentDataset[] = []

  for (const entry of entries.map(recentDatasetEntry)) {
    const index = kept.findIndex((known) => known.url === entry.url)
    const known = kept[index]

    if (known === undefined) {
      kept.push(entry)
    } else if (known.signed === true && entry.signed !== true) {
      kept[index] = {
        url: known.url,
        name: known.name,
        ...(known.platform === undefined ? {} : { platform: known.platform }),
      }
    }
  }

  return kept
}

// Writes the stored list back as it is read, when that differs: a signed
// address saved before EXP-026 then leaves storage when the app first runs,
// not when eight newer entries push it out.
function tidyStoredRecentDatasets(storage: Storage | null): void {
  const stored = readStoredRecentDatasets(storage)
  if (stored === null) return
  try {
    const raw = storage?.getItem(RECENT_DATASETS_KEY) ?? null
    if (raw !== null && raw !== JSON.stringify(stored)) {
      writeRecentDatasets(storage, stored)
    }
  } catch {
    // Not remembered.
  }
}

export function writeRecentDatasets(
  storage: Pick<Storage, 'setItem'> | null,
  recent: readonly RecentDataset[],
): void {
  try {
    storage?.setItem(RECENT_DATASETS_KEY, JSON.stringify(recent))
  } catch {
    // Not remembered.
  }
}

// Puts the dataset first, replacing an older entry for the same URL, and
// keeps at most MAX_RECENT_DATASETS. A dataset opened by a signed address
// that the list has without a signature stays openable from it.
export function withRecentDataset(
  recent: readonly RecentDataset[],
  dataset: RecentDataset,
): readonly RecentDataset[] {
  const openable =
    dataset.signed === true &&
    recent.some((entry) => entry.url === dataset.url && entry.signed !== true)
  const first: RecentDataset = openable
    ? {
        url: dataset.url,
        name: dataset.name,
        ...(dataset.platform === undefined ? {} : { platform: dataset.platform }),
      }
    : dataset

  return [first, ...recent.filter((entry) => entry.url !== dataset.url)].slice(
    0,
    MAX_RECENT_DATASETS,
  )
}

export function withoutRecentDataset(
  recent: readonly RecentDataset[],
  url: string,
): readonly RecentDataset[] {
  return recent.filter((entry) => entry.url !== url)
}

export function localStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export interface RecentDatasetsStore {
  readonly recent: readonly RecentDataset[]
  readonly add: (dataset: RecentDataset) => void
  readonly remove: (url: string) => void
}

export function useRecentDatasets(
  storage: Storage | null = localStorageOrNull(),
): RecentDatasetsStore {
  // The storage the list was first read from, so the callbacks stay stable.
  const [store] = useState(() => storage)
  const [recent, setRecent] = useState(() => readRecentDatasets(store))
  const recentRef = useRef(recent)

  useEffect(() => {
    tidyStoredRecentDatasets(store)
  }, [store])

  // `change` returns null when there is nothing to change.
  const update = useCallback(
    (change: (current: readonly RecentDataset[]) => readonly RecentDataset[] | null) => {
      // Another tab may have changed the list since this one read it; without
      // storage the list lasts as long as the page.
      const stored = readStoredRecentDatasets(store)
      const next = change(stored ?? recentRef.current)
      if (next === null) {
        // Nothing to change in storage, but the list shown here may be behind
        // it: × on an entry another tab removed takes it off (EXP-329).
        if (stored !== null && !sameRecentDatasets(stored, recentRef.current)) {
          recentRef.current = stored
          setRecent(stored)
        }
        return
      }
      recentRef.current = next
      writeRecentDatasets(store, next)
      setRecent(next)
    },
    [store],
  )
  const add = useCallback(
    (added: RecentDataset) => {
      const dataset = recentDatasetEntry(added)
      update((current) => {
        const first = current[0]
        return first !== undefined &&
          first.url === dataset.url &&
          first.name === dataset.name &&
          first.platform === dataset.platform &&
          first.signed === dataset.signed
          ? null
          : withRecentDataset(current, dataset)
      })
    },
    [update],
  )
  const remove = useCallback(
    (url: string) => {
      update((current) =>
        current.some((entry) => entry.url === url)
          ? withoutRecentDataset(current, url)
          : null,
      )
    },
    [update],
  )

  return { recent, add, remove }
}

function sameRecentDatasets(
  first: readonly RecentDataset[],
  second: readonly RecentDataset[],
): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}
