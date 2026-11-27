import {
  heldDatasetUrls,
  normalizeDatasetUrl,
  onDatasetReleased,
} from '../datasets/datasetCache'
import { datasetImageFor, datasetManifestFor } from './datasetFiles'
import type { SharedLoad } from '../utils/sharedLoad'

// Per-file caches kept across reads, outside the dataset objects: gex.ts's
// matrix workers and Zarr matrices, the Feature Slice files, transcript Zarr
// metadata and the TIFF loader's files. Each registers here, and when a
// dataset URL is no longer held (datasetCache.ts), its entries for the files
// that dataset could read, and that no dataset still held can, are released
// (O19). Files no dataset reads, such as an imported segmentation's image,
// stay until their cache's own limit drops them.

// Releases the entries of `cache`, keyed by file URL, as their datasets are
// released. `release` ends what an entry holds, such as its worker.
export function releaseWithDatasets<T>(
  cache: Map<string, T>,
  release: (value: T) => void = () => undefined,
): () => void {
  return onDatasetReleased((datasetUrl) => {
    let held: readonly string[] | null = null

    for (const [fileUrl, value] of [...cache]) {
      if (!datasetReadsFile(datasetUrl, fileUrl)) continue

      held ??= [...heldDatasetUrls()]

      if (held.some((heldUrl) => datasetReadsFile(heldUrl, fileUrl))) continue

      cache.delete(fileUrl)
      release(value)
    }
  })
}

// Closes an H5 file worker kept in a cache of shared opens, once it has
// opened; one that failed to open has nothing to close.
export function closeSharedFile(load: SharedLoad<{ close(): void }>): void {
  load.promise.then(
    (file) => {
      file.close()
    },
    () => undefined,
  )
}

// Whether the dataset at `datasetUrl` may read `fileUrl`: the dataset's own
// file, one under its folder or under its manifest's root, one its manifest
// names, or the image a collection or manifest pairs with it.
export function datasetReadsFile(datasetUrl: string, fileUrl: string): boolean {
  const url = normalizeDatasetUrl(datasetUrl)

  if (isAtOrUnder(fileUrl, url)) return true

  const manifest = datasetManifestFor(url)

  if (manifest !== undefined) {
    if (isAtOrUnder(fileUrl, normalizeDatasetUrl(manifest.rootUrl))) return true

    for (const file of Object.values(manifest.files) as unknown[]) {
      if (isManifestFile(file) && isAtOrUnder(fileUrl, file.url)) return true
    }
  }

  const image = datasetImageFor(url)

  return image !== undefined && isAtOrUnder(fileUrl, image.url)
}

// `fileUrl` is `url` itself, a file below it, or it with a query or fragment.
function isAtOrUnder(fileUrl: string, url: string): boolean {
  if (!fileUrl.startsWith(url)) return false

  const next = fileUrl.charAt(url.length)

  return next === '' || next === '/' || next === '?' || next === '#'
}

function isManifestFile(value: unknown): value is { readonly url: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly url?: unknown }).url === 'string'
  )
}
