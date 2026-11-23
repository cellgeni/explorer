import {
  DATASET_FILE_DEFAULTS,
  isAbsoluteUrl,
  manifestImageAttachment,
  manifestZchunkStoreUrl,
  type DatasetFileRole,
  type DatasetImageAttachment,
  type DatasetManifest,
  type DatasetManifestFile,
} from '../datasets/datasetManifest'
import { dropDatasets } from '../datasets/datasetCache'
import { folderFileUrl } from '../utils/folderUrl'
import type { DatasetCollection } from '../datasets/datasetCollection'

// Manifests found by detection, per dataset URL, and null where detection
// found none. Readers only receive the dataset URL, so they look up relocated
// files here.
const datasetManifests = new Map<string, DatasetManifest | null>()

export function setDatasetManifest(
  baseUrl: string,
  manifest: DatasetManifest | undefined,
): void {
  const key = datasetUrlKey(baseUrl)
  const previous = datasetManifests.get(key)
  const next = manifest ?? null
  datasetManifests.set(key, next)

  // A dataset opened under another manifest holds the files that one named,
  // and its readers would find the new ones here, so it is opened afresh.
  // The first detection of a URL is the one its dataset opens with.
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(next)) {
    dropDatasets(key)
  }
}

export function datasetManifestFor(baseUrl: string): DatasetManifest | undefined {
  return datasetManifests.get(datasetUrlKey(baseUrl)) ?? undefined
}

// Images that collections pair with their datasets, per dataset URL. A
// collection's are registered when it is read, before any of its datasets is
// opened, and stay registered so a dataset keeps its image (and its cells
// their placement) after the collection closes; a later collection listing
// the same dataset replaces them.
const datasetImages = new Map<string, DatasetImageAttachment>()

export function registerCollectionImages(collection: DatasetCollection): void {
  for (const entry of collection.datasets) {
    const key = datasetUrlKey(entry.url)

    if (entry.image === undefined) {
      datasetImages.delete(key)
    } else {
      datasetImages.set(key, entry.image)
    }
  }
}

// The image a collection pairs with the dataset, else the one its H5AD
// manifest names. The manifest is known once detection has read it.
export function datasetImageFor(baseUrl: string): DatasetImageAttachment | undefined {
  return (
    collectionImageFor(baseUrl) ?? manifestImageAttachment(datasetManifestFor(baseUrl))
  )
}

// Only the collection's: the manifest belongs to the URL, so a dataset
// instance cached by URL already has its image.
export function collectionImageFor(baseUrl: string): DatasetImageAttachment | undefined {
  return datasetImages.get(datasetUrlKey(baseUrl))
}

// For tests.
export function clearDatasetImages(): void {
  datasetImages.clear()
}

// URL of a file inside a dataset. Relative paths resolve against the
// manifest's root when the dataset has one; absolute URLs pass through.
export function datasetFileUrl(baseUrl: string, path: string): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  const rootUrl = datasetManifestFor(baseUrl)?.rootUrl ?? baseUrl
  return folderFileUrl(rootUrl, path)
}

// URL of a standard dataset file, following the manifest when it relocates it.
export function datasetFileUrlFor(baseUrl: string, role: DatasetFileRole): string {
  return (
    manifestFileFor(baseUrl, role)?.url ??
    datasetFileUrl(baseUrl, DATASET_FILE_DEFAULTS[role])
  )
}

// Name to show for a standard dataset file in messages: the manifest path when
// the manifest relocates it, else the standard name.
export function datasetFileLabelFor(baseUrl: string, role: DatasetFileRole): string {
  return manifestFileFor(baseUrl, role)?.path ?? DATASET_FILE_DEFAULTS[role]
}

// A Xenium file that has no standard name (morphology image, projections),
// when the manifest provides one.
export function xeniumManifestFileFor(
  baseUrl: string,
  key: 'morphology' | 'umap' | 'tsne',
): DatasetManifestFile | undefined {
  const manifest = datasetManifestFor(baseUrl)
  return manifest?.platform === 'xenium' ? manifest.files[key] : undefined
}

// `.zchunkstore` sidecar for the dataset's TIFF image, when the manifest
// names one.
export function zchunkStoreUrlFor(baseUrl: string): string | undefined {
  return manifestZchunkStoreUrl(datasetManifestFor(baseUrl))
}

function manifestFileFor(
  baseUrl: string,
  role: DatasetFileRole,
): DatasetManifestFile | undefined {
  const manifest = datasetManifestFor(baseUrl)

  if (manifest?.platform === 'xenium' || manifest?.platform === 'visium-hd') {
    const files: Readonly<Partial<Record<string, DatasetManifestFile>>> = manifest.files
    return files[role]
  }

  return undefined
}

function datasetUrlKey(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}
