import {
  collectionEntryFor,
  type DatasetCollection,
  type DatasetCollectionEntry,
} from '../../datasets/datasetCollection'

// Registered sections side by side: the open dataset and up to
// MAX_LINKED_SECTIONS more of the collection, in one coordinate system,
// sharing one view. The link names them with compare=.

// Four viewers at once: the open dataset and three panels, in a 2 by 2 grid.
export const MAX_LINKED_SECTIONS = 3

// Whether `entry` can be shown beside the open dataset: another entry in its
// coordinate system.
export function canShowBeside(
  openEntry: DatasetCollectionEntry | undefined,
  entry: DatasetCollectionEntry,
): boolean {
  return (
    openEntry?.coordinateSystem !== undefined &&
    entry !== openEntry &&
    entry.coordinateSystem === openEntry.coordinateSystem
  )
}

// The sections shown beside the open dataset: the compare= URLs that can be,
// in their order, up to the limit.
export function linkedSectionEntries(
  collection: DatasetCollection | null,
  openUrl: string | null,
  compareUrls: readonly string[],
): readonly DatasetCollectionEntry[] {
  if (collection === null || compareUrls.length === 0) return []

  const openEntry = collectionEntryFor(collection, openUrl)
  const entries: DatasetCollectionEntry[] = []

  for (const url of compareUrls) {
    const entry = collectionEntryFor(collection, url)

    if (
      entry !== undefined &&
      !entries.includes(entry) &&
      canShowBeside(openEntry, entry) &&
      entries.length < MAX_LINKED_SECTIONS
    ) {
      entries.push(entry)
    }
  }

  return entries
}

// Shows a section beside the open one, after the others, or stops showing it.
export function toggledCompareUrls(
  shown: readonly DatasetCollectionEntry[],
  entry: DatasetCollectionEntry,
): readonly string[] {
  const urls = shown.map((shownEntry) => shownEntry.url)

  return shown.includes(entry)
    ? urls.filter((url) => url !== entry.url)
    : [...urls, entry.url].slice(0, MAX_LINKED_SECTIONS)
}

// Whether opening `nextUrl` in place of the open dataset keeps the view: both
// are in one coordinate system, so the view shows the same place.
export function keepsViewOnOpening(
  collection: DatasetCollection | null,
  openUrl: string | null,
  nextUrl: string,
): boolean {
  if (collection === null) return false

  const openEntry = collectionEntryFor(collection, openUrl)
  const nextEntry = collectionEntryFor(collection, nextUrl)

  return nextEntry !== undefined && canShowBeside(openEntry, nextEntry)
}

// The sections beside `nextUrl` once it opens in place of the open dataset.
// Opening one of the panels swaps it with the open dataset, which takes its
// place; opening another section of the coordinate system keeps the panels;
// any other dataset has none.
export function compareUrlsAfterOpening(
  collection: DatasetCollection | null,
  openUrl: string | null,
  shown: readonly DatasetCollectionEntry[],
  nextUrl: string,
): readonly string[] {
  if (collection === null || openUrl === null) return []
  if (!keepsViewOnOpening(collection, openUrl, nextUrl)) return []

  const nextEntry = collectionEntryFor(collection, nextUrl)
  const openEntry = collectionEntryFor(collection, openUrl)

  return shown.map((entry) =>
    entry === nextEntry ? (openEntry?.url ?? openUrl) : entry.url,
  )
}
