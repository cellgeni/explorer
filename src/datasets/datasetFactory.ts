import {
  datasetFileUrl,
  datasetManifestFor,
  setDatasetManifest,
} from '../data/datasetFiles'
import {
  folderListingMissing,
  readFolderListing,
  setFolderListing,
} from '../data/folderListing'
import { noteReadableResponse } from '../data/hostResponses'
import { datasetDetectionError } from './datasetDetectionError'
import { icechunkCompanionFileUrl, isIcechunkUrl } from '../zarr/icechunkUrl'
import { omeZarrImageRootUrl } from '../zarr/omeZarrLoader'
import { isOmeZarrImageUrl } from '../zarr/omeZarrUrl'
import { isQptiffUrl } from '../tiff/qptiff'
import { isSvsUrl } from '../tiff/svs'
import {
  DATASET_MANIFEST_FILE,
  DatasetManifestError,
  VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS,
  isDatasetManifestUrl,
  looksLikeDatasetManifest,
  manifestZchunkStoreUrl,
  parseDatasetManifest,
  resolveManifestPath,
  type DatasetManifest,
  type VisiumDatasetManifest,
  type VisiumHdDatasetManifest,
  type VisiumHdManifestSegmentedOutput,
} from './datasetManifest'
import {
  VISIUM_ANALYSIS_FILE_CANDIDATES,
  VISIUM_FILE_DEFAULTS,
  VISIUM_LEGACY_TISSUE_POSITIONS,
  VISIUM_OPTIONAL_FILES,
  type VisiumAnalysisFileKey,
} from './visiumFormat'
import { isSpatialDataRootMetadata } from './spatialDataCatalog'
import { ATERA_EXPERIMENT_FILE } from './ateraFormat'
import type { CellId } from '../data/cellid'
import type { VisiumHdSegmentedOutputPaths } from './visiumHdSegmentationModel'
import type { SpatialDataset, SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'
import type { H5adLoadProgressReporter } from './h5adDataset'
import type { SpatialDataSelection } from './spatialDataDataset'

export type AnySpatialDataset = SpatialDataset<CellId> | SpatialDataset<SpatialElementId>

export type SpatialDatasetDetection =
  | {
      readonly platform: 'xenium'
      readonly baseUrl: string
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'atera'
      readonly baseUrl: string
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'h5ad'
      readonly baseUrl: string
      // An .h5ad file, or with `source: 'icechunk'` an Icechunk repository
      // holding AnnData.
      readonly h5adUrl: string
      readonly source?: 'icechunk'
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'spatialdata'
      readonly baseUrl: string
      readonly spatialDataUrl: string
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'image'
      readonly baseUrl: string
      readonly imageUrl: string
      readonly imageKind?: 'tiff' | 'qptiff' | 'svs' | 'ndpi' | 'ome-zarr'
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'visium'
      readonly baseUrl: string
      readonly files: VisiumDetectedFiles
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'visium-hd'
      readonly baseUrl: string
      readonly bins: readonly VisiumHdBinDescriptor[]
      readonly segmentedScalefactorsPath?: string
      readonly segmentedOutputs?: VisiumHdSegmentedOutputPaths
      readonly manifest?: DatasetManifest
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'unknown'
      readonly baseUrl: string
      readonly checked: readonly DatasetProbeResult[]
    }

// Standard Visium files, as paths relative to the dataset (or manifest) root
// or absolute URLs.
export interface VisiumDetectedFiles {
  readonly tissuePositions: string
  readonly scalefactors: string
  readonly filteredMatrix: string
  readonly hiresImage?: string
  readonly lowresImage?: string
  // Analysis files a manifest names; others are searched for.
  readonly analysis?: Readonly<Partial<Record<VisiumAnalysisFileKey, string>>>
}

export interface DatasetProbeResult {
  readonly path: string
  readonly url: string
  readonly ok: boolean
  readonly status?: number
  readonly error?: string
}

export interface DetectSpatialDatasetOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface CreateSpatialDatasetOptions extends DetectSpatialDatasetOptions {
  readonly visiumHdMaxTwoMicrometerFilteredBarcodes?: number
  readonly onH5adLoadProgress?: H5adLoadProgressReporter
}

export interface CachedSpatialDatasetOptions {
  readonly visiumHdMaxTwoMicrometerFilteredBarcodes?: number
  readonly onH5adLoadProgress?: H5adLoadProgressReporter
}

const VISIUM_HD_BINS: readonly {
  readonly size: VisiumHdBinSizeMicrometers
  readonly outputPath: string
}[] = [
  { size: 2, outputPath: 'binned_outputs/square_002um' },
  { size: 8, outputPath: 'binned_outputs/square_008um' },
  { size: 16, outputPath: 'binned_outputs/square_016um' },
]

const VISIUM_HD_SEGMENTED_OUTPUT_PROBES = [
  {
    key: 'scalefactorsPath',
    path: 'segmented_outputs/spatial/scalefactors_json.json',
  },
  {
    key: 'filteredFeatureCellMatrixH5Path',
    path: 'segmented_outputs/filtered_feature_cell_matrix.h5',
  },
  {
    key: 'rawFeatureCellMatrixH5Path',
    path: 'segmented_outputs/raw_feature_cell_matrix.h5',
  },
  {
    key: 'cellSegmentationsGeojsonPath',
    path: 'segmented_outputs/cell_segmentations.geojson',
  },
  {
    key: 'nucleusSegmentationsGeojsonPath',
    path: 'segmented_outputs/nucleus_segmentations.geojson',
  },
  {
    key: 'nucleusInstanceMaskTiffPath',
    path: 'segmented_outputs/nucleus_instance_mask.tiff',
  },
  {
    key: 'graphclustAnnotatedCellSegmentationsGeojsonPath',
    path: 'segmented_outputs/graphclust_annotated_cell_segmentations.geojson',
  },
  {
    key: 'graphclustAnnotatedNucleusSegmentationsGeojsonPath',
    path: 'segmented_outputs/graphclust_annotated_nucleus_segmentations.geojson',
  },
] as const satisfies readonly {
  readonly key: keyof VisiumHdSegmentedOutputPaths
  readonly path: string
}[]

const spatialDatasetCache = new Map<string, Promise<AnySpatialDataset>>()
// Coordinate system, image, and unit choices per SpatialData store URL. Kept
// here so every caller that only knows the URL gets the matching instance.
const spatialDataSelections = new Map<string, SpatialDataSelection>()

export function setSpatialDataSelection(
  baseUrl: string,
  selection: SpatialDataSelection | undefined,
): void {
  const key = normalizeBaseUrl(baseUrl)

  if (selection === undefined || Object.keys(selection).length === 0) {
    spatialDataSelections.delete(key)
  } else {
    spatialDataSelections.set(key, selection)
  }

  // Drop instances built for earlier selections so their tables, label
  // traces, and chunk caches can be released.
  for (const cacheKey of spatialDatasetCache.keys()) {
    if (cacheKey.startsWith(`${key}\n`)) {
      spatialDatasetCache.delete(cacheKey)
    }
  }
}

// The viewer's selection, else the dataset manifest's `options`. A manifest
// only sets the starting view: any selection made since replaces it whole,
// because images and units belong to one coordinate system.
export function spatialDataSelectionFor(baseUrl: string): SpatialDataSelection {
  const key = normalizeBaseUrl(baseUrl)
  const manifest = datasetManifestFor(key)

  return (
    spatialDataSelections.get(key) ??
    (manifest?.platform === 'spatialdata' ? manifest.options : {})
  )
}
const DATASET_PROBE_TIMEOUT_MS = 15_000
// The folder index only saves requests, so a slow one is not waited for long.
const FOLDER_LISTING_TIMEOUT_MS = 5_000
// Probe error for a file the folder's index page does not list.
const NOT_LISTED = 'not in the folder listing'

export async function detectSpatialDataset(
  baseUrl: string,
  options: DetectSpatialDatasetOptions = {},
): Promise<SpatialDatasetDetection> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  try {
    const detection = await detectSpatialDatasetLayout(normalizedBaseUrl, options)
    setDatasetManifest(
      normalizedBaseUrl,
      detection.platform === 'unknown' ? undefined : detection.manifest,
    )
    return detection
  } catch (error) {
    if (error instanceof DatasetManifestError) {
      setDatasetManifest(normalizedBaseUrl, undefined)
    }

    throw error
  }
}

async function detectSpatialDatasetLayout(
  normalizedBaseUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<SpatialDatasetDetection> {
  const checked: DatasetProbeResult[] = []

  if (isDatasetManifestUrl(normalizedBaseUrl)) {
    const manifest = await readDatasetManifest(
      normalizedBaseUrl,
      'required',
      options,
      checked,
    )
    await registerFolderListing(manifest.rootUrl, options)

    return detectFromManifest(normalizedBaseUrl, manifest, options, checked)
  }

  if (isH5adUrl(normalizedBaseUrl)) {
    const h5adProbe = await probeDirectDatasetUrl(
      normalizedBaseUrl,
      'dataset.h5ad',
      options,
    )
    checked.push(h5adProbe)

    return h5adProbe.ok
      ? {
          platform: 'h5ad',
          baseUrl: normalizedBaseUrl,
          h5adUrl: normalizedBaseUrl,
          checked,
        }
      : {
          platform: 'unknown',
          baseUrl: normalizedBaseUrl,
          checked,
        }
  }

  if (isIcechunkUrl(normalizedBaseUrl)) {
    return detectIcechunkRepository(normalizedBaseUrl, options, checked)
  }

  if (isZarrImageOnlyUrl(normalizedBaseUrl)) {
    const zarrRootUrl = omeZarrImageRootUrl(normalizedBaseUrl)
    const probes = await Promise.all(
      zarrMetadataProbePaths(normalizedBaseUrl).map((path) =>
        probeDatasetPath(zarrRootUrl, path, options),
      ),
    )
    checked.push(...probes)

    const spatialDataProbe = await probeSpatialDataRoot(zarrRootUrl, probes, options)

    if (spatialDataProbe !== null) {
      checked.push(spatialDataProbe)
      return {
        platform: 'spatialdata',
        baseUrl: normalizedBaseUrl,
        spatialDataUrl: zarrRootUrl,
        checked,
      }
    }

    return probes.some((probe) => probe.ok)
      ? {
          platform: 'image',
          baseUrl: normalizedBaseUrl,
          imageUrl: normalizedBaseUrl,
          imageKind: 'ome-zarr',
          checked,
        }
      : {
          platform: 'unknown',
          baseUrl: normalizedBaseUrl,
          checked,
        }
  }

  if (isImageOnlyUrl(normalizedBaseUrl)) {
    const imageProbe = await probeDirectDatasetUrl(
      normalizedBaseUrl,
      imagePathLabel(normalizedBaseUrl),
      options,
    )
    checked.push(imageProbe)

    return imageProbe.ok
      ? {
          platform: 'image',
          baseUrl: normalizedBaseUrl,
          imageUrl: normalizedBaseUrl,
          imageKind: tiffImageKind(normalizedBaseUrl),
          checked,
        }
      : {
          platform: 'unknown',
          baseUrl: normalizedBaseUrl,
          checked,
        }
  }

  await registerFolderListing(normalizedBaseUrl, options)

  const [manifest, xeniumManifest, ateraManifest] = await Promise.all([
    readDatasetManifest(
      joinUrl(normalizedBaseUrl, DATASET_MANIFEST_FILE),
      'optional',
      options,
      checked,
    ),
    probeDatasetPath(normalizedBaseUrl, 'experiment.xenium', options),
    probeDatasetPath(normalizedBaseUrl, ATERA_EXPERIMENT_FILE, options),
  ])

  if (manifest !== undefined) {
    if (normalizeBaseUrl(manifest.rootUrl) !== normalizedBaseUrl) {
      await registerFolderListing(manifest.rootUrl, options)
    }

    return detectFromManifest(normalizedBaseUrl, manifest, options, checked)
  }

  checked.push(xeniumManifest)

  if (xeniumManifest.ok) {
    return {
      platform: 'xenium',
      baseUrl: normalizedBaseUrl,
      checked,
    }
  }

  checked.push(ateraManifest)

  if (ateraManifest.ok) {
    return {
      platform: 'atera',
      baseUrl: normalizedBaseUrl,
      checked,
    }
  }

  const zarrMetadataProbes = await probeZarrMetadata(normalizedBaseUrl, options)
  checked.push(...zarrMetadataProbes)
  const zarrMetadataProbe = zarrMetadataProbes.find((probe) => probe.ok)
  const spatialDataProbe = await probeSpatialDataRoot(
    normalizedBaseUrl,
    zarrMetadataProbes,
    options,
  )

  if (spatialDataProbe !== null) {
    checked.push(spatialDataProbe)
    return {
      platform: 'spatialdata',
      baseUrl: normalizedBaseUrl,
      spatialDataUrl: normalizedBaseUrl,
      checked,
    }
  }

  if (zarrMetadataProbe !== undefined) {
    return {
      platform: 'image',
      baseUrl: normalizedBaseUrl,
      imageUrl: joinUrl(normalizedBaseUrl, zarrMetadataProbe.path),
      imageKind: 'ome-zarr',
      checked,
    }
  }

  const visiumFiles = await probeVisiumOutputs(normalizedBaseUrl, options, checked)

  if (visiumFiles !== null) {
    return {
      platform: 'visium',
      baseUrl: normalizedBaseUrl,
      files: visiumFiles,
      checked,
    }
  }

  const bins = await probeVisiumHdBins(normalizedBaseUrl, options, checked)
  const segmentedOutputs = await probeVisiumHdSegmentedOutputs(
    normalizedBaseUrl,
    options,
    checked,
  )

  if (bins.length > 0) {
    return visiumHdDetection(
      normalizedBaseUrl,
      bins,
      segmentedOutputs,
      undefined,
      checked,
    )
  }

  return {
    platform: 'unknown',
    baseUrl: normalizedBaseUrl,
    checked,
  }
}

// Routes an Icechunk repository by what its root group holds. Throws when the
// repository cannot be read or holds none of them, since an Icechunk URL names
// nothing else to fall back to. The dataset reuses the opened repository.
async function detectIcechunkRepository(
  url: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const { openIcechunkRepository } = await import('../zarr/icechunkStore')
  const repository = await openIcechunkRepository(url, {
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    virtualChunkUrl: icechunkCompanionFileUrl(url),
  })
  const content = icechunkRepositoryContent(repository)

  if (content === null) {
    throw new Error(
      `The Icechunk repository at ${url} holds no AnnData, SpatialData, or OME-Zarr image at its root.`,
    )
  }

  checked.push({ path: `Icechunk repository (${content})`, url, ok: true })

  if (content === 'AnnData') {
    return { platform: 'h5ad', baseUrl: url, h5adUrl: url, source: 'icechunk', checked }
  }

  if (content === 'SpatialData') {
    return { platform: 'spatialdata', baseUrl: url, spatialDataUrl: url, checked }
  }

  return {
    platform: 'image',
    baseUrl: url,
    imageUrl: url,
    imageKind: 'ome-zarr',
    checked,
  }
}

function icechunkRepositoryContent(repository: {
  readonly nodes: readonly { readonly path: string; readonly kind: string }[]
  readonly rootAttributes: Readonly<Record<string, unknown>>
}): 'AnnData' | 'SpatialData' | 'OME-Zarr image' | null {
  const attrs = repository.rootAttributes
  const isRootGroup = (name: string) =>
    repository.nodes.some((node) => node.path === name && node.kind === 'group')

  if (isSpatialDataRootMetadata({ attributes: attrs })) {
    return 'SpatialData'
  }

  // Older AnnData files have no root `encoding-type`.
  if (
    attrs['encoding-type'] === 'anndata' ||
    (isRootGroup('obs') && isRootGroup('var'))
  ) {
    return 'AnnData'
  }

  const ome = attrs.ome

  if (
    Array.isArray(attrs.multiscales) ||
    (typeof ome === 'object' && ome !== null && 'multiscales' in ome)
  ) {
    return 'OME-Zarr image'
  }

  return null
}

// Reads a dataset manifest. 'required' (a manifest URL was entered) throws on
// any failure; 'optional' (probing a folder) treats a missing, unreadable, or
// non-manifest document as no manifest, but still reports an invalid one.
async function readDatasetManifest(
  url: string,
  mode: 'required',
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<DatasetManifest>
async function readDatasetManifest(
  url: string,
  mode: 'optional',
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<DatasetManifest | undefined>
async function readDatasetManifest(
  url: string,
  mode: 'required' | 'optional',
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<DatasetManifest | undefined> {
  const path = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  const notListedIn = folderListingMissing(url)

  if (notListedIn !== undefined) {
    checked.push({ path, url, ok: false, error: NOT_LISTED })

    if (mode === 'required') {
      throw new DatasetManifestError(
        url,
        `is not in the folder listing of ${notListedIn.folderUrl}.`,
      )
    }

    return undefined
  }

  let response: Response

  try {
    response = await fetchWithTimeout(
      options.fetcher ?? fetch,
      url,
      { cache: 'no-cache' },
      options.signal,
      DATASET_PROBE_TIMEOUT_MS,
    )
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)

    if (options.signal?.aborted === true) {
      throw cause
    }

    checked.push({ path, url, ok: false, error })

    if (mode === 'required') {
      throw new DatasetManifestError(url, `could not be fetched (${error}).`, { cause })
    }

    return undefined
  }

  noteReadableResponse(url, response.status)
  checked.push({ path, url, ok: response.ok, status: response.status })

  if (!response.ok) {
    if (mode === 'required') {
      throw new DatasetManifestError(url, `could not be read (HTTP ${response.status}).`)
    }

    return undefined
  }

  let json: unknown

  try {
    json = JSON.parse(await response.text())
  } catch (cause) {
    if (mode === 'required') {
      throw new DatasetManifestError(url, 'is not valid JSON.', { cause })
    }

    return undefined
  }

  if (mode === 'optional' && !looksLikeDatasetManifest(json)) {
    return undefined
  }

  return parseDatasetManifest(json, url)
}

async function detectFromManifest(
  baseUrl: string,
  manifest: DatasetManifest,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  if (manifest.platform === 'xenium') {
    return { platform: 'xenium', baseUrl, manifest, checked }
  }

  if (manifest.platform === 'atera') {
    return { platform: 'atera', baseUrl, manifest, checked }
  }

  if (manifest.platform === 'h5ad') {
    const { path, url } = manifest.files.h5ad
    const probe = await probeDirectDatasetUrl(url, path, options)
    checked.push(probe)

    if (!probe.ok) {
      throw new DatasetManifestError(
        manifest.url,
        `"files.h5ad" (${url}) is not readable (${probeFailure(probe)}).`,
      )
    }

    return { platform: 'h5ad', baseUrl, h5adUrl: url, manifest, checked }
  }

  if (manifest.platform === 'spatialdata') {
    return {
      platform: 'spatialdata',
      baseUrl,
      spatialDataUrl: normalizeBaseUrl(omeZarrImageRootUrl(manifest.files.store.url)),
      manifest,
      checked,
    }
  }

  if (manifest.platform === 'image') {
    const imageUrl = manifest.files.image.url

    return {
      platform: 'image',
      baseUrl,
      imageUrl,
      imageKind:
        isOmeZarrImageUrl(imageUrl) || isIcechunkUrl(imageUrl)
          ? 'ome-zarr'
          : tiffImageKind(imageUrl),
      manifest,
      checked,
    }
  }

  if (manifest.platform === 'visium') {
    return detectVisiumFromManifest(baseUrl, manifest, options, checked)
  }

  return detectVisiumHdFromManifest(baseUrl, manifest, options, checked)
}

// Standard Visium output: positions (Space Ranger 2.0+ or 1.x name), scale
// factors, and the filtered matrix are required; tissue images are optional.
async function probeVisiumOutputs(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<VisiumDetectedFiles | null> {
  const paths = [
    VISIUM_FILE_DEFAULTS.tissuePositions,
    VISIUM_LEGACY_TISSUE_POSITIONS,
    VISIUM_FILE_DEFAULTS.scalefactors,
    VISIUM_FILE_DEFAULTS.filteredMatrix,
    VISIUM_FILE_DEFAULTS.hiresImage,
    VISIUM_FILE_DEFAULTS.lowresImage,
  ]
  const probes = await Promise.all(
    paths.map((path) => probeDatasetPath(rootUrl, path, options)),
  )
  checked.push(...probes)
  const found = (path: string) => probes.some((probe) => probe.path === path && probe.ok)
  const tissuePositions = [
    VISIUM_FILE_DEFAULTS.tissuePositions,
    VISIUM_LEGACY_TISSUE_POSITIONS,
  ].find(found)

  if (
    tissuePositions === undefined ||
    !found(VISIUM_FILE_DEFAULTS.scalefactors) ||
    !found(VISIUM_FILE_DEFAULTS.filteredMatrix)
  ) {
    return null
  }

  return {
    tissuePositions,
    scalefactors: VISIUM_FILE_DEFAULTS.scalefactors,
    filteredMatrix: VISIUM_FILE_DEFAULTS.filteredMatrix,
    ...(found(VISIUM_FILE_DEFAULTS.hiresImage)
      ? { hiresImage: VISIUM_FILE_DEFAULTS.hiresImage }
      : {}),
    ...(found(VISIUM_FILE_DEFAULTS.lowresImage)
      ? { lowresImage: VISIUM_FILE_DEFAULTS.lowresImage }
      : {}),
  }
}

// Files the manifest names must exist; the others fall back to the Space
// Ranger names, and a missing tissue image is left out.
async function detectVisiumFromManifest(
  baseUrl: string,
  manifest: VisiumDatasetManifest,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const { files, rootUrl } = manifest
  const probe = async (path: string) => {
    const result = await probeDirectDatasetUrl(
      resolveManifestPath(rootUrl, path),
      path,
      options,
    )
    checked.push(result)
    return result
  }
  const requireFile = async (
    role: 'tissuePositions' | 'scalefactors' | 'filteredMatrix',
    fallbacks: readonly string[],
  ): Promise<string> => {
    const named = files[role]?.path

    for (const path of named === undefined ? fallbacks : [named]) {
      const result = await probe(path)

      if (result.ok) {
        return path
      }

      if (named !== undefined) {
        throw new DatasetManifestError(
          manifest.url,
          `"files.${role}" (${result.url}) is not readable (${probeFailure(result)}).`,
        )
      }
    }

    throw new DatasetManifestError(
      manifest.url,
      `no ${fallbacks.join(' or ')} under ${rootUrl}. Name the file in "files.${role}".`,
    )
  }
  const optionalImage = async (
    role: 'hiresImage' | 'lowresImage',
  ): Promise<string | undefined> => {
    const named = files[role]?.path
    const result = await probe(named ?? VISIUM_FILE_DEFAULTS[role])

    if (!result.ok && named !== undefined) {
      throw new DatasetManifestError(
        manifest.url,
        `"files.${role}" (${result.url}) is not readable (${probeFailure(result)}).`,
      )
    }

    return result.ok ? (named ?? VISIUM_FILE_DEFAULTS[role]) : undefined
  }
  const [tissuePositions, scalefactors, filteredMatrix, hiresImage, lowresImage] =
    await Promise.all([
      requireFile('tissuePositions', [
        VISIUM_FILE_DEFAULTS.tissuePositions,
        VISIUM_LEGACY_TISSUE_POSITIONS,
      ]),
      requireFile('scalefactors', [VISIUM_FILE_DEFAULTS.scalefactors]),
      requireFile('filteredMatrix', [VISIUM_FILE_DEFAULTS.filteredMatrix]),
      optionalImage('hiresImage'),
      optionalImage('lowresImage'),
    ])
  const analysis: Partial<Record<VisiumAnalysisFileKey, string>> = {}

  for (const key of VISIUM_OPTIONAL_FILES) {
    const path = files[key]?.path

    if (path !== undefined) {
      analysis[key] = path
    }
  }

  return {
    platform: 'visium',
    baseUrl,
    files: {
      tissuePositions,
      scalefactors,
      filteredMatrix,
      ...(hiresImage === undefined ? {} : { hiresImage }),
      ...(lowresImage === undefined ? {} : { lowresImage }),
      ...(Object.keys(analysis).length === 0 ? {} : { analysis }),
    },
    manifest,
    checked,
  }
}

// Bin and segmented-output paths stay relative to the manifest root (or
// absolute), so labels match the manifest; readers resolve them through
// datasetFileUrl.
async function detectVisiumHdFromManifest(
  baseUrl: string,
  manifest: VisiumHdDatasetManifest,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const { rootUrl } = manifest
  let bins: VisiumHdBinDescriptor[]

  if (manifest.bins === undefined) {
    bins = await probeVisiumHdBins(rootUrl, options, checked)

    if (bins.length === 0) {
      throw new DatasetManifestError(
        manifest.url,
        `no complete binned_outputs/square_*um tier was found under ${rootUrl}. List the bins in "files.bins".`,
      )
    }
  } else {
    bins = await Promise.all(
      manifest.bins.map(async (bin) => {
        const descriptor = visiumHdBinDescriptor(bin.size, bin.path, {
          ...(bin.tissuePositions === undefined
            ? {}
            : { tissuePositionsPath: bin.tissuePositions }),
          ...(bin.scalefactors === undefined
            ? {}
            : { scalefactorsPath: bin.scalefactors }),
          ...(bin.filteredMatrix === undefined
            ? {}
            : { filteredMatrixH5Path: bin.filteredMatrix }),
        })
        const probes = await Promise.all(
          [
            descriptor.tissuePositionsPath,
            descriptor.scalefactorsPath,
            descriptor.filteredMatrixH5Path,
          ].map((path) =>
            probeDirectDatasetUrl(resolveManifestPath(rootUrl, path), path, options),
          ),
        )
        checked.push(...probes)
        const missing = probes.find((probe) => !probe.ok)

        if (missing !== undefined) {
          throw new DatasetManifestError(
            manifest.url,
            `the ${bin.size} µm bin is missing ${missing.path} (${probeFailure(missing)}).`,
          )
        }

        return descriptor
      }),
    )
    bins.sort((left, right) => left.binSizeMicrometers - right.binSizeMicrometers)
  }

  const segmentedOutputs =
    manifest.segmentedOutputs === undefined
      ? await probeVisiumHdSegmentedOutputs(rootUrl, options, checked)
      : segmentedOutputPathsFromManifest(manifest.segmentedOutputs)

  return visiumHdDetection(baseUrl, bins, segmentedOutputs, manifest, checked)
}

function visiumHdDetection(
  baseUrl: string,
  bins: readonly VisiumHdBinDescriptor[],
  segmentedOutputs: VisiumHdSegmentedOutputPaths,
  manifest: DatasetManifest | undefined,
  checked: readonly DatasetProbeResult[],
): SpatialDatasetDetection {
  return {
    platform: 'visium-hd',
    baseUrl,
    bins,
    ...(segmentedOutputs.scalefactorsPath === undefined
      ? {}
      : { segmentedScalefactorsPath: segmentedOutputs.scalefactorsPath }),
    ...(hasSegmentedOutputPaths(segmentedOutputs) ? { segmentedOutputs } : {}),
    ...(manifest === undefined ? {} : { manifest }),
    checked,
  }
}

// Standard Space Ranger tiers under `rootUrl` that have positions,
// scalefactors, and a filtered matrix.
async function probeVisiumHdBins(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<VisiumHdBinDescriptor[]> {
  const bins: VisiumHdBinDescriptor[] = []

  for (const bin of VISIUM_HD_BINS) {
    const descriptor = visiumHdBinDescriptor(bin.size, bin.outputPath)
    const [positions, scalefactors, matrix] = await Promise.all([
      probeDatasetPath(rootUrl, descriptor.tissuePositionsPath, options),
      probeDatasetPath(rootUrl, descriptor.scalefactorsPath, options),
      probeDatasetPath(rootUrl, descriptor.filteredMatrixH5Path, options),
    ])
    checked.push(positions, scalefactors, matrix)

    if (positions.ok && scalefactors.ok && matrix.ok) {
      bins.push(descriptor)
    }
  }

  return bins
}

function visiumHdBinDescriptor(
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
  outputPath: string,
  overrides: Partial<
    Pick<
      VisiumHdBinDescriptor,
      'tissuePositionsPath' | 'scalefactorsPath' | 'filteredMatrixH5Path'
    >
  > = {},
): VisiumHdBinDescriptor {
  return {
    binSizeMicrometers,
    outputPath,
    tissuePositionsPath:
      overrides.tissuePositionsPath ?? `${outputPath}/spatial/tissue_positions.parquet`,
    scalefactorsPath:
      overrides.scalefactorsPath ?? `${outputPath}/spatial/scalefactors_json.json`,
    filteredMatrixH5Path:
      overrides.filteredMatrixH5Path ?? `${outputPath}/filtered_feature_bc_matrix.h5`,
  }
}

async function probeVisiumHdSegmentedOutputs(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<VisiumHdSegmentedOutputPaths> {
  const probes = await Promise.all(
    VISIUM_HD_SEGMENTED_OUTPUT_PROBES.map((probe) =>
      probeDatasetPath(rootUrl, probe.path, options),
    ),
  )
  checked.push(...probes)
  return segmentedOutputPathsFromProbes(probes)
}

function segmentedOutputPathsFromManifest(
  outputs: Readonly<Partial<Record<VisiumHdManifestSegmentedOutput, string>>>,
): VisiumHdSegmentedOutputPaths {
  const paths: Partial<Record<keyof VisiumHdSegmentedOutputPaths, string>> = {}

  for (const [key, path] of Object.entries(outputs)) {
    if (path !== undefined && key in VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS) {
      paths[
        VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS[key as VisiumHdManifestSegmentedOutput]
      ] = path
    }
  }

  return paths
}

function probeFailure(probe: DatasetProbeResult): string {
  return probe.status === undefined
    ? (probe.error ?? 'request failed')
    : `HTTP ${probe.status}`
}

export async function createSpatialDataset(
  baseUrl: string,
  options: CreateSpatialDatasetOptions = {},
): Promise<AnySpatialDataset> {
  const detection = await detectSpatialDataset(baseUrl, options)

  if (detection.platform === 'xenium') {
    const { XeniumDataset } = await import('./xeniumDataset')
    return new XeniumDataset({ baseUrl: detection.baseUrl })
  }

  if (detection.platform === 'atera') {
    const { AteraDataset } = await import('./ateraDataset')
    const manifest =
      detection.manifest?.platform === 'atera' ? detection.manifest : undefined
    const files = Object.fromEntries(
      Object.entries(manifest?.files ?? {}).map(([role, file]) => [role, file.url]),
    )

    // Relative paths, including those in experiment.spatial, resolve against
    // the manifest root, as datasetFileUrl does for the other platforms.
    return new AteraDataset({
      baseUrl: manifest?.rootUrl ?? detection.baseUrl,
      files,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.onH5adLoadProgress === undefined
        ? {}
        : { onProgress: options.onH5adLoadProgress }),
    })
  }

  if (detection.platform === 'h5ad') {
    const { AnnDataH5adDataset } = await import('./h5adDataset')
    return new AnnDataH5adDataset({
      url: detection.h5adUrl,
      ...(detection.source === 'icechunk' ? { icechunk: true } : {}),
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.onH5adLoadProgress === undefined
        ? {}
        : { onProgress: options.onH5adLoadProgress }),
    })
  }

  if (detection.platform === 'spatialdata') {
    const { SpatialDataDataset } = await import('./spatialDataDataset')
    return new SpatialDataDataset({
      ...spatialDataSelectionFor(baseUrl),
      url: detection.spatialDataUrl,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.onH5adLoadProgress === undefined
        ? {}
        : { onProgress: options.onH5adLoadProgress }),
    })
  }

  if (detection.platform === 'image') {
    const { ImageOnlyDataset } = await import('./imageOnlyDataset')
    const zchunkStoreUrl = manifestZchunkStoreUrl(detection.manifest)

    return new ImageOnlyDataset({
      imageUrl: detection.imageUrl,
      ...(zchunkStoreUrl === undefined ? {} : { zchunkStoreUrl }),
    })
  }

  if (detection.platform === 'visium') {
    const { createVisiumDataset } = await import('./visiumDataset')
    const { files } = detection
    const fileUrl = (path: string) => datasetFileUrl(detection.baseUrl, path)
    const analysis: Partial<Record<VisiumAnalysisFileKey, readonly string[]>> = {}

    for (const key of VISIUM_OPTIONAL_FILES) {
      const named = files.analysis?.[key]
      analysis[key] = (
        named === undefined ? VISIUM_ANALYSIS_FILE_CANDIDATES[key] : [named]
      ).map(fileUrl)
    }

    return createVisiumDataset({
      baseUrl: detection.baseUrl,
      files: {
        tissuePositions: [fileUrl(files.tissuePositions)],
        scalefactors: fileUrl(files.scalefactors),
        filteredMatrix: fileUrl(files.filteredMatrix),
        images: {
          ...(files.hiresImage === undefined ? {} : { hires: fileUrl(files.hiresImage) }),
          ...(files.lowresImage === undefined
            ? {}
            : { lowres: fileUrl(files.lowresImage) }),
        },
        analysis,
      },
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.onH5adLoadProgress === undefined
        ? {}
        : { onProgress: options.onH5adLoadProgress }),
    })
  }

  if (detection.platform === 'visium-hd') {
    const { VisiumHdDataset } = await import('./visiumHdDataset')
    const manifest =
      detection.manifest?.platform === 'visium-hd' ? detection.manifest : undefined
    const featureSlice = manifest?.files.featureSlice
    const defaultBinSize = manifest?.options.binSize

    return new VisiumHdDataset({
      baseUrl: detection.baseUrl,
      bins: detection.bins,
      ...(featureSlice === undefined ? {} : { featureSliceH5Path: featureSlice.path }),
      ...(defaultBinSize === undefined
        ? {}
        : { defaultBinSizeMicrometers: defaultBinSize }),
      ...(detection.segmentedOutputs === undefined
        ? {}
        : { segmentedOutputs: detection.segmentedOutputs }),
      ...(options.visiumHdMaxTwoMicrometerFilteredBarcodes === undefined
        ? {}
        : {
            maxTwoMicrometerFilteredBarcodes:
              options.visiumHdMaxTwoMicrometerFilteredBarcodes,
          }),
    })
  }

  throw datasetDetectionError(detection.checked)
}

export function cachedSpatialDataset(
  baseUrl: string,
  options: CachedSpatialDatasetOptions = {},
): Promise<AnySpatialDataset> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const maxTwoMicrometerFilteredBarcodes =
    options.visiumHdMaxTwoMicrometerFilteredBarcodes
  const cacheKey = spatialDatasetCacheKey(
    normalizedBaseUrl,
    maxTwoMicrometerFilteredBarcodes,
    spatialDataSelectionFor(normalizedBaseUrl),
  )
  const existing = spatialDatasetCache.get(cacheKey)

  if (existing !== undefined) {
    return existing
  }

  const promise = createSpatialDataset(normalizedBaseUrl, {
    ...(maxTwoMicrometerFilteredBarcodes === undefined
      ? {}
      : {
          visiumHdMaxTwoMicrometerFilteredBarcodes: maxTwoMicrometerFilteredBarcodes,
        }),
    ...(options.onH5adLoadProgress === undefined
      ? {}
      : { onH5adLoadProgress: options.onH5adLoadProgress }),
  }).catch((error: unknown) => {
    if (spatialDatasetCache.get(cacheKey) === promise) {
      spatialDatasetCache.delete(cacheKey)
    }

    throw error
  })
  spatialDatasetCache.set(cacheKey, promise)
  return promise
}

async function probeDatasetPath(
  baseUrl: string,
  path: string,
  options: DetectSpatialDatasetOptions,
): Promise<DatasetProbeResult> {
  const url = joinUrl(baseUrl, path)
  return probeDirectDatasetUrl(url, path, options)
}

async function probeDirectDatasetUrl(
  url: string,
  path: string,
  options: DetectSpatialDatasetOptions,
): Promise<DatasetProbeResult> {
  if (folderListingMissing(url) !== undefined) {
    return { path, url, ok: false, error: NOT_LISTED }
  }

  try {
    const response = await fetchWithTimeout(
      options.fetcher ?? fetch,
      url,
      { method: 'HEAD' },
      options.signal,
      DATASET_PROBE_TIMEOUT_MS,
    )
    noteReadableResponse(url, response.status)

    return {
      path,
      url,
      ok: response.ok,
      status: response.status,
    }
  } catch (cause) {
    return {
      path,
      url,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

// A Zarr group is a SpatialData store when its root attributes carry
// `spatialdata_attrs`; plain OME-Zarr images do not.
async function probeSpatialDataRoot(
  rootUrl: string,
  metadataProbes: readonly DatasetProbeResult[],
  options: DetectSpatialDatasetOptions,
): Promise<DatasetProbeResult | null> {
  for (const probe of metadataProbes) {
    if (!probe.ok) {
      continue
    }

    const url = joinUrl(rootUrl, probe.path)

    try {
      const response = await fetchWithTimeout(
        options.fetcher ?? fetch,
        url,
        {},
        options.signal,
        DATASET_PROBE_TIMEOUT_MS,
      )

      noteReadableResponse(url, response.status)

      if (response.ok && isSpatialDataRootMetadata(await response.json())) {
        return {
          path: `${probe.path} (SpatialData)`,
          url,
          ok: true,
          status: response.status,
        }
      }
    } catch {
      // Unreadable or non-JSON metadata is not a SpatialData root.
    }
  }

  return null
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetcher(input, signal === undefined ? init : { ...init, signal })
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => {
    controller.abort(signal?.reason)
  }
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (signal?.aborted === true) {
    abortFromParent()
  } else {
    signal?.addEventListener('abort', abortFromParent, { once: true })
  }

  try {
    return await fetcher(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs.toLocaleString()} ms.`, {
        cause: error,
      })
    }

    throw error
  } finally {
    globalThis.clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromParent)
  }
}

// Reads and registers the folder's index page, so detection and the readers
// skip the files it does not list. Clears the folder's listing when the host
// serves none.
async function registerFolderListing(
  folderUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<void> {
  const fetcher = options.fetcher ?? fetch
  const listing = await readFolderListing(folderUrl, {
    fetcher: (input, init) =>
      fetchWithTimeout(
        fetcher,
        input,
        init ?? {},
        options.signal,
        FOLDER_LISTING_TIMEOUT_MS,
      ),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  setFolderListing(folderUrl, listing)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// Detection probes the folder as given, not through a manifest registered by
// an earlier detection of the same URL.
function joinUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function isH5adUrl(url: string): boolean {
  return /\.h5ad(?:$|[?#])/i.test(url)
}

export function isImageOnlyUrl(url: string): boolean {
  return isTiffOrNdpiUrl(url) || isZarrImageOnlyUrl(url)
}

function isTiffOrNdpiUrl(url: string): boolean {
  return /\.(?:(?:ome\.)?tiff?|qptiff?|svs|ndpi)(?:$|[?#])/i.test(url)
}

function tiffImageKind(url: string): 'tiff' | 'qptiff' | 'svs' | 'ndpi' {
  if (isQptiffUrl(url)) {
    return 'qptiff'
  }

  if (isSvsUrl(url)) {
    return 'svs'
  }

  return /\.ndpi(?:$|[?#])/i.test(url) ? 'ndpi' : 'tiff'
}

function isZarrImageOnlyUrl(url: string): boolean {
  return isOmeZarrImageUrl(url)
}

function zarrMetadataProbePaths(url: string): readonly string[] {
  const pathname = new URL(url).pathname

  if (/\/zarr\.json$/i.test(pathname)) {
    return ['zarr.json']
  }

  if (/\/\.zattrs$/i.test(pathname)) {
    return ['.zattrs']
  }

  return ['zarr.json', '.zattrs']
}

async function probeZarrMetadata(
  baseUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<readonly DatasetProbeResult[]> {
  return Promise.all(
    zarrMetadataProbePaths(baseUrl).map((path) =>
      probeDatasetPath(baseUrl, path, options),
    ),
  )
}

function imagePathLabel(url: string): string {
  const pathname = new URL(url).pathname
  return pathname.split('/').filter(Boolean).at(-1) ?? 'image'
}

function segmentedOutputPathsFromProbes(
  probes: readonly DatasetProbeResult[],
): VisiumHdSegmentedOutputPaths {
  const paths: Partial<Record<keyof VisiumHdSegmentedOutputPaths, string>> = {}

  for (const probe of probes) {
    if (!probe.ok) {
      continue
    }

    const descriptor = VISIUM_HD_SEGMENTED_OUTPUT_PROBES.find(
      (candidate) => candidate.path === probe.path,
    )

    if (descriptor !== undefined) {
      paths[descriptor.key] = probe.path
    }
  }

  return paths
}

function hasSegmentedOutputPaths(paths: VisiumHdSegmentedOutputPaths): boolean {
  return Object.values(paths).some((path) => path !== undefined)
}

function spatialDatasetCacheKey(
  baseUrl: string,
  visiumHdMaxTwoMicrometerFilteredBarcodes: number | undefined,
  spatialDataSelection: SpatialDataSelection | undefined,
): string {
  return `${baseUrl}\nvisiumHd2umBudget=${visiumHdMaxTwoMicrometerFilteredBarcodes ?? ''}\nspatialData=${JSON.stringify(spatialDataSelection ?? {})}`
}
