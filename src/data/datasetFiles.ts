import {
  DATASET_FILE_DEFAULTS,
  isAbsoluteUrl,
  type DatasetFileRole,
  type DatasetManifest,
  type DatasetManifestFile,
} from '../datasets/datasetManifest'

// Manifests found by detection, per dataset URL. Readers only receive the
// dataset URL, so they look up relocated files here.
const datasetManifests = new Map<string, DatasetManifest>()

export function setDatasetManifest(
  baseUrl: string,
  manifest: DatasetManifest | undefined,
): void {
  const key = datasetUrlKey(baseUrl)

  if (manifest === undefined) {
    datasetManifests.delete(key)
  } else {
    datasetManifests.set(key, manifest)
  }
}

export function datasetManifestFor(baseUrl: string): DatasetManifest | undefined {
  return datasetManifests.get(datasetUrlKey(baseUrl))
}

// URL of a file inside a dataset. Relative paths resolve against the
// manifest's root when the dataset has one; absolute URLs pass through.
export function datasetFileUrl(baseUrl: string, path: string): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  const rootUrl = datasetManifestFor(baseUrl)?.rootUrl ?? baseUrl
  return `${rootUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
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
