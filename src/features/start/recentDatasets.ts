import { useCallback, useRef, useState } from 'react'

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
}

function isRecentDataset(value: unknown): value is RecentDataset {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.url === 'string' &&
    entry.url.trim() !== '' &&
    typeof entry.name === 'string' &&
    (entry.platform === undefined || typeof entry.platform === 'string')
  )
}

export function readRecentDatasets(
  storage: Pick<Storage, 'getItem'> | null,
): readonly RecentDataset[] {
  return readStoredRecentDatasets(storage) ?? []
}

// Null when there is no storage or it cannot be read.
function readStoredRecentDatasets(
  storage: Pick<Storage, 'getItem'> | null,
): readonly RecentDataset[] | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(RECENT_DATASETS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(isRecentDataset).slice(0, MAX_RECENT_DATASETS)
      : []
  } catch {
    return null
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
// keeps at most MAX_RECENT_DATASETS.
export function withRecentDataset(
  recent: readonly RecentDataset[],
  dataset: RecentDataset,
): readonly RecentDataset[] {
  return [dataset, ...recent.filter((entry) => entry.url !== dataset.url)].slice(
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

  // `change` returns null when there is nothing to change.
  const update = useCallback(
    (change: (current: readonly RecentDataset[]) => readonly RecentDataset[] | null) => {
      // Another tab may have changed the list since this one read it; without
      // storage the list lasts as long as the page.
      const next = change(readStoredRecentDatasets(store) ?? recentRef.current)
      if (next === null) return
      recentRef.current = next
      writeRecentDatasets(store, next)
      setRecent(next)
    },
    [store],
  )
  const add = useCallback(
    (dataset: RecentDataset) => {
      update((current) => {
        const first = current[0]
        return first !== undefined &&
          first.url === dataset.url &&
          first.name === dataset.name &&
          first.platform === dataset.platform
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
