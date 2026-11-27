import {
  collectionImageFor,
  datasetFileUrl,
  datasetImageFor,
  datasetManifestFor,
  setDatasetManifest,
} from '../data/datasetFiles'
import {
  folderListingFor,
  folderListingMissing,
  readFolderListing,
  setFolderListing,
} from '../data/folderListing'
import {
  fetchHead,
  likelyMissingFileError,
  noteReadableResponse,
} from '../data/hostResponses'
import { readZipDirectory, ZIP_METHOD_STORED } from '../data/zipArchive'
import { registerZipFolder, zipFolderFor, zipFolderRoot } from '../data/zipFolder'
import {
  DatasetAddressError,
  DatasetDetectionError,
  DatasetReaderError,
  PROBE_HIDDEN_ERROR,
  PROBE_NOT_LISTED,
  datasetDetectionError,
  isTimedOutProbe,
  isWebAddress,
  UnsupportedZipError,
} from './datasetDetectionError'
import { parseAnnDataSectionUrl, type AnnDataSectionRef } from './annDataSections'
import { icechunkCompanionFileUrl, isIcechunkUrl } from '../zarr/icechunkUrl'
import { omeZarrImageRootUrl } from '../zarr/omeZarrLoader'
import { isOmeZarrImageUrl } from '../zarr/omeZarrUrl'
import { isZarrZipUrl } from '../zarr/zarrZipUrl'
import { isQptiffUrl } from '../tiff/qptiff'
import { isSvsUrl } from '../tiff/svs'
import { folderFileUrl } from '../utils/folderUrl'
import {
  DATASET_MANIFEST_FILE,
  DatasetManifestError,
  VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS,
  isDatasetManifestUrl,
  looksLikeDatasetManifest,
  manifestZchunkStoreUrl,
  parseDatasetManifest,
  resolveManifestPath,
  type DatasetImageAttachment,
  type DatasetManifest,
  type H5adDatasetManifest,
  type MerscopeDatasetManifest,
  type VisiumDatasetManifest,
  type VisiumHdDatasetManifest,
  type VisiumHdManifestSegmentedOutput,
} from './datasetManifest'
import {
  isMexMatrixPath,
  mexSiblingPath,
  VISIUM_ANALYSIS_FILE_CANDIDATES,
  VISIUM_FILE_DEFAULTS,
  VISIUM_LEGACY_TISSUE_POSITIONS,
  VISIUM_MEX_FILE_DEFAULTS,
  VISIUM_MEX_LIST_FILES,
  VISIUM_OPTIONAL_FILES,
  type VisiumAnalysisFileKey,
} from './visiumFormat'
import { MERSCOPE_FILE_DEFAULTS } from './merscopeFormat'
import { isSpatialDataRootMetadata } from './spatialDataCatalog'
import { ATERA_EXPERIMENT_FILE, ATERA_FILE_DEFAULTS } from './ateraFormat'
import { visiumHdRequiredBinPaths } from './visiumHdStrategy'
import { DatasetCache, retainDataset } from './datasetCache'
import { DATASET_READER_NAMES, type DatasetReader } from './datasetReader'
import type { CellId } from '../data/cellid'
import type { VisiumHdSegmentedOutputPaths } from './visiumHdSegmentationModel'
import type { SpatialDataset, SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'
import type {
  AnnDataH5adDataset,
  AnnDataVisiumView,
  H5adLoadProgressReporter,
} from './h5adDataset'
import type { SpatialDataSelection } from './spatialDataDataset'
import { FetchTimeoutError, fetchWithRetry } from '../data/fetchRetry'

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
      // An .h5ad file, or a store holding AnnData: with `source: 'icechunk'`
      // an Icechunk repository, with `source: 'zarr'` a Zarr store.
      readonly h5adUrl: string
      readonly source?: 'icechunk' | 'zarr'
      // One section of the file (see annDataSections.ts): `baseUrl` is the
      // section's URL, and the file's dataset, opened from `fileUrl`, reads it.
      readonly section?: {
        readonly fileUrl: string
        readonly column: string
        readonly value: string
      }
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
      readonly platform: 'merscope'
      readonly baseUrl: string
      readonly files: MerscopeDetectedFiles
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
  // An .h5, or a MEX matrix.mtx when `filteredMatrixMex` is set.
  readonly filteredMatrix: string
  readonly filteredMatrixMex?: VisiumMexListPaths
  readonly hiresImage?: string
  readonly lowresImage?: string
  // Analysis files a manifest names; others are searched for.
  readonly analysis?: Readonly<Partial<Record<VisiumAnalysisFileKey, string>>>
}

// The barcode and feature lists of a MEX matrix.
export interface VisiumMexListPaths {
  readonly barcodes: string
  readonly features: string
}

// MERSCOPE files, as paths relative to the dataset (or manifest) root or
// absolute URLs.
export interface MerscopeDetectedFiles {
  readonly cellByGene: string
  readonly cellMetadata: string
  readonly cellBoundaries?: string
  // From the boundary probe's Content-Length, when the host sent one.
  readonly cellBoundariesByteLength?: number
  // The MERSCOPE Vizualizer zip, which holds the image pyramids.
  readonly vzg?: string
}

export interface DatasetProbeResult {
  readonly path: string
  readonly url: string
  readonly ok: boolean
  readonly status?: number
  readonly error?: string
  // The HEAD response's Content-Length, when asked for and present.
  readonly byteLength?: number
}

export interface DetectSpatialDatasetOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  // The reader chosen for the address, in place of detection
  // (detectWithReader).
  readonly reader?: DatasetReader
}

export interface CreateSpatialDatasetOptions extends DetectSpatialDatasetOptions {
  readonly onH5adLoadProgress?: H5adLoadProgressReporter
  // The detection the load already made, used instead of probing the
  // dataset again when it is of this URL (EXP-024). It is passed with each
  // load, so it never outlives one.
  readonly detection?: SpatialDatasetDetection
  // The SpatialData view to open, in place of the one set for the URL.
  readonly spatialDataSelection?: SpatialDataSelection
}

export interface CachedSpatialDatasetOptions {
  readonly onH5adLoadProgress?: H5adLoadProgressReporter
  readonly detection?: SpatialDatasetDetection
  // The view to open, in place of the one set for the URL: a load's, which
  // is set for the URL once it replaces the dataset on screen (EXP-002).
  readonly spatialDataSelection?: SpatialDataSelection
  readonly visiumView?: AnnDataVisiumView
  // The caller's cancel. Opening the dataset stops once every caller has
  // cancelled.
  readonly signal?: AbortSignal
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

// Besides the datasets in use, the few opened last are kept for reopening.
const MAX_INACTIVE_SPATIAL_DATASETS = 2
const spatialDatasetCache = new DatasetCache<AnySpatialDataset>(
  MAX_INACTIVE_SPATIAL_DATASETS,
)
// Coordinate system, image, and unit choices per SpatialData store URL, and
// the Visium library and off-tissue spots per AnnData URL: the view on
// screen. Kept here so every caller that only knows the URL gets the
// matching instance. A load sets its view once it replaces the dataset on
// screen, so the view on screen keeps answering until then.
const spatialDataSelections = new Map<string, SpatialDataSelection>()
const visiumViews = new Map<string, AnnDataVisiumView>()

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

  // Drop instances built for other selections so their tables, label
  // traces, and chunk caches can be released.
  const shown = `\nspatialData=${JSON.stringify(spatialDataSelectionFor(key))}\n`
  spatialDatasetCache.delete(
    (cacheKey) => cacheKey.startsWith(`${key}\n`) && !cacheKey.includes(shown),
  )
}

// A Visium view is placed on the file's one read, so the instances of other
// views are kept.
export function setVisiumView(
  baseUrl: string,
  view: AnnDataVisiumView | undefined,
): void {
  const key = normalizeBaseUrl(baseUrl)

  if (view === undefined || Object.keys(view).length === 0) {
    visiumViews.delete(key)
  } else {
    visiumViews.set(key, view)
  }
}

export function visiumViewFor(baseUrl: string): AnnDataVisiumView {
  return visiumViews.get(normalizeBaseUrl(baseUrl)) ?? {}
}

// The viewer's selection (`selection`, else the one set for the URL), else
// the dataset manifest's `options`. A manifest only sets the starting view:
// any selection made since replaces it whole, because images and units
// belong to one coordinate system.
export function spatialDataSelectionFor(
  baseUrl: string,
  selection?: SpatialDataSelection,
): SpatialDataSelection {
  const key = normalizeBaseUrl(baseUrl)
  const chosen = selection ?? spatialDataSelections.get(key)
  const manifest = datasetManifestFor(key)

  return chosen !== undefined && Object.keys(chosen).length > 0
    ? chosen
    : manifest?.platform === 'spatialdata'
      ? manifest.options
      : {}
}
const DATASET_PROBE_TIMEOUT_MS = 15_000
// The folder index only saves requests, so a slow one is not waited for long.
const FOLDER_LISTING_TIMEOUT_MS = 5_000
// Probe error for a file the folder's index page does not list.
const NOT_LISTED = PROBE_NOT_LISTED

export async function detectSpatialDataset(
  baseUrl: string,
  options: DetectSpatialDatasetOptions = {},
): Promise<SpatialDatasetDetection> {
  // Before any request: an address without its https:// would otherwise be
  // requested from this page's host, or fail as a network error.
  if (!isWebAddress(baseUrl)) {
    throw new DatasetAddressError(baseUrl)
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  try {
    const detection = await detectSpatialDatasetLayout(normalizedBaseUrl, options)
    // A cancelled detection leaves the last one's registrations (EXP-206).
    options.signal?.throwIfAborted()
    setDatasetManifest(
      normalizedBaseUrl,
      detection.platform === 'unknown' ? undefined : detection.manifest,
    )
    const previous = datasetDetections.get(normalizedBaseUrl)

    // The same address opened with another reader: instances the other one
    // built are not reused.
    if (previous !== undefined && previous.platform !== detection.platform) {
      spatialDatasetCache.delete((key) => key.startsWith(`${normalizedBaseUrl}\n`))
    }

    if (detection.platform === 'unknown') {
      datasetDetections.delete(normalizedBaseUrl)
    } else {
      datasetDetections.set(normalizedBaseUrl, detection)
    }

    return detection
  } catch (error) {
    // A probe that failed because the caller aborted can surface as another
    // error, such as a manifest file that "is not readable".
    options.signal?.throwIfAborted()

    if (error instanceof DatasetManifestError) {
      setDatasetManifest(normalizedBaseUrl, undefined)
      datasetDetections.delete(normalizedBaseUrl)
    }

    throw error
  }
}

// The last detection of each URL that found a dataset. A dataset opened
// without a detection, such as by a Xenium load's first boundary read or a
// collection preview, takes it rather than probing the folder again
// (EXP-204). A later detection of the URL replaces it.
const datasetDetections = new Map<string, SpatialDatasetDetection>()

// For tests.
export function clearDatasetDetections(): void {
  datasetDetections.clear()
}

async function detectSpatialDatasetLayout(
  normalizedBaseUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<SpatialDatasetDetection> {
  const checked: DatasetProbeResult[] = []
  const section = parseAnnDataSectionUrl(normalizedBaseUrl)

  if (section !== null) {
    return detectAnnDataSection(normalizedBaseUrl, section, options)
  }

  if (options.reader !== undefined) {
    return detectWithReader(normalizedBaseUrl, options.reader, options, checked)
  }

  if (isDatasetManifestUrl(normalizedBaseUrl)) {
    const manifest = await readDatasetManifest(
      normalizedBaseUrl,
      'required',
      options,
      checked,
    )
    await registerManifestRoot(manifest, options)

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

  if (isZarrZipUrl(normalizedBaseUrl)) {
    return detectZarrZip(normalizedBaseUrl, options, checked)
  }

  if (isZarrImageOnlyUrl(normalizedBaseUrl)) {
    const zarrRootUrl = omeZarrImageRootUrl(normalizedBaseUrl)
    const probes = await Promise.all(
      zarrMetadataProbePaths(normalizedBaseUrl).map((path) =>
        probeDatasetPath(zarrRootUrl, path, options),
      ),
    )
    checked.push(...probes)

    const rootContent = await probeZarrRootContent(zarrRootUrl, probes, options)

    if (rootContent !== null) {
      checked.push(rootContent.probe)
      return zarrStoreDetection(
        normalizedBaseUrl,
        zarrRootUrl,
        rootContent.content,
        checked,
      )
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

  const manifestUrl = joinUrl(normalizedBaseUrl, DATASET_MANIFEST_FILE)
  const [readManifest, xeniumManifest, ateraManifest] = await Promise.all([
    readDatasetManifest(manifestUrl, 'optional', options, checked),
    probeDatasetPath(normalizedBaseUrl, 'experiment.xenium', options),
    probeDatasetPath(normalizedBaseUrl, ATERA_EXPERIMENT_FILE, options),
  ])
  // A manifest read that got no answer does not show the folder has none: one
  // an earlier detection of this folder found still holds (EXP-205).
  const manifest =
    readManifest ??
    (manifestUnanswered(checked.find((probe) => probe.url === manifestUrl))
      ? datasetManifestFor(normalizedBaseUrl)
      : undefined)

  if (manifest !== undefined) {
    if (normalizeBaseUrl(manifest.rootUrl) !== normalizedBaseUrl) {
      await registerManifestRoot(manifest, options)
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

  // A host that answered none of the first requests in time will not answer
  // the later stages either, each of which would wait out its own timeout.
  if (checked.every(isTimedOutProbe)) {
    return { platform: 'unknown', baseUrl: normalizedBaseUrl, checked }
  }

  const zarrMetadataProbes = await probeZarrMetadata(normalizedBaseUrl, options)
  checked.push(...zarrMetadataProbes)
  const zarrMetadataProbe = zarrMetadataProbes.find((probe) => probe.ok)
  const rootContent = await probeZarrRootContent(
    normalizedBaseUrl,
    zarrMetadataProbes,
    options,
  )

  if (rootContent !== null) {
    checked.push(rootContent.probe)
    return zarrStoreDetection(
      normalizedBaseUrl,
      normalizedBaseUrl,
      rootContent.content,
      checked,
    )
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

  // Standard Visium and MERSCOPE are probed together, after the Xenium,
  // Atera, and Zarr probes, so those datasets make no extra requests.
  const [visiumFiles, merscopeProbes] = await Promise.all([
    probeVisiumOutputs(normalizedBaseUrl, options, checked),
    probeMerscopeOutputs(normalizedBaseUrl, options),
  ])

  if (visiumFiles !== null) {
    return {
      platform: 'visium',
      baseUrl: normalizedBaseUrl,
      files: visiumFiles,
      checked,
    }
  }

  checked.push(...merscopeProbes.probes)

  if (merscopeProbes.files !== null) {
    return {
      platform: 'merscope',
      baseUrl: normalizedBaseUrl,
      files: merscopeProbes.files,
      checked,
    }
  }

  const { bins, segmentedOutputs } = await probeVisiumHdOutputs(
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

// A reader chosen for the address (the reader menu on the address field, or
// `reader=` in a link) in place of detection. Only that platform's files are
// looked for, under their standard names, and no dataset manifest is read, so
// a folder whose manifest or files route it elsewhere opens as chosen, and a
// file whose name hides its format opens as the chosen kind. When the files
// are not there the address is unknown, as an undetected one is, with the
// probes this reader made. A zip or Icechunk repository is still routed by
// what it holds, and refused when that is another platform.
async function detectWithReader(
  url: string,
  reader: DatasetReader,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const unknown: SpatialDatasetDetection = { platform: 'unknown', baseUrl: url, checked }
  const name = DATASET_READER_NAMES[reader]

  if (isDatasetManifestUrl(url)) {
    throw new DatasetReaderError(
      `${url} is a dataset manifest, which names its own platform, so the ${name} reader does not open it. Choose Detect automatically in the reader menu.`,
    )
  }

  if (isIcechunkUrl(url) || isZarrZipUrl(url)) {
    if (reader === 'xenium' && isZarrZipUrl(url)) {
      throw new UnsupportedZipError(
        `The Xenium reader cannot open a zip (${url}): only Atera runs are read from one. Unzip the run and host its folder.`,
      )
    }

    const detection = isIcechunkUrl(url)
      ? await detectIcechunkRepository(url, options, checked)
      : await detectZarrZip(url, options, checked)

    if (detection.platform !== 'unknown' && detection.platform !== reader) {
      throw new DatasetReaderError(
        `The ${name} reader cannot open ${url}: it holds ${detection.platform === 'image' ? 'an image' : `${DATASET_READER_NAMES[detection.platform]} data`}. Choose that reader, or Detect automatically.`,
      )
    }

    return detection
  }

  if (reader === 'h5ad' || reader === 'spatialdata' || reader === 'image') {
    return detectFileWithReader(url, reader, options, checked)
  }

  await registerFolderListing(url, options)

  if (reader === 'xenium' || reader === 'atera') {
    const probe = await probeDatasetPath(
      url,
      reader === 'xenium' ? 'experiment.xenium' : ATERA_EXPERIMENT_FILE,
      options,
    )
    checked.push(probe)
    return probe.ok ? { platform: reader, baseUrl: url, checked } : unknown
  }

  if (reader === 'visium') {
    const files = await probeVisiumOutputs(url, options, checked)
    return files === null ? unknown : { platform: 'visium', baseUrl: url, files, checked }
  }

  if (reader === 'merscope') {
    const { files, probes } = await probeMerscopeOutputs(url, options)
    checked.push(...probes)
    return files === null
      ? unknown
      : { platform: 'merscope', baseUrl: url, files, checked }
  }

  const { bins, segmentedOutputs } = await probeVisiumHdOutputs(url, options, checked)

  return bins.length === 0
    ? unknown
    : visiumHdDetection(url, bins, segmentedOutputs, undefined, checked)
}

// The readers of one file or store. A Zarr group (`zarr.json` or `.zgroup`)
// opens as AnnData Zarr or a SpatialData store, and one with OME-Zarr
// metadata (`zarr.json` or `.zattrs`) as an image, whatever its root
// attributes say; anything else that answers opens as an .h5ad file or a
// TIFF image.
async function detectFileWithReader(
  url: string,
  reader: 'h5ad' | 'spatialdata' | 'image',
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const unknown: SpatialDatasetDetection = { platform: 'unknown', baseUrl: url, checked }
  const storeUrl = normalizeBaseUrl(omeZarrImageRootUrl(url))
  const zarrMetadata = async (
    paths: readonly string[],
  ): Promise<DatasetProbeResult | undefined> => {
    const probes = await Promise.all(
      paths.map((path) => probeDatasetPath(storeUrl, path, options)),
    )
    checked.push(...probes)
    return probes.find((probe) => probe.ok)
  }
  const zarrGroup = () => zarrMetadata(['zarr.json', '.zgroup'])
  const file = async (): Promise<boolean> => {
    const probe = await probeDirectDatasetUrl(url, imagePathLabel(url), options)
    checked.push(probe)
    return probe.ok
  }

  if (reader === 'spatialdata') {
    return (await zarrGroup()) === undefined
      ? unknown
      : { platform: 'spatialdata', baseUrl: url, spatialDataUrl: storeUrl, checked }
  }

  if (reader === 'h5ad') {
    if (!isH5adUrl(url) && (await zarrGroup()) !== undefined) {
      return { platform: 'h5ad', baseUrl: url, h5adUrl: url, source: 'zarr', checked }
    }

    return (await file())
      ? { platform: 'h5ad', baseUrl: url, h5adUrl: url, checked }
      : unknown
  }

  if (!isTiffOrNdpiUrl(url)) {
    const group = await zarrMetadata(['zarr.json', '.zattrs'])

    if (group !== undefined) {
      // An OME-Zarr image is opened by a URL that names Zarr (openImagePyramid),
      // so a store whose name does not is opened by its metadata document.
      return {
        platform: 'image',
        baseUrl: url,
        imageUrl: isOmeZarrImageUrl(url) ? url : joinUrl(storeUrl, group.path),
        imageKind: 'ome-zarr',
        checked,
      }
    }
  }

  return (await file())
    ? {
        platform: 'image',
        baseUrl: url,
        imageUrl: url,
        imageKind: tiffImageKind(url),
        checked,
      }
    : unknown
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

// Routes a zipped Zarr store: SpatialData or an OME-Zarr image. A zip with no
// Zarr store may be a zipped Atera run folder; anything else throws, since a
// file URL has no folder to probe further.
async function detectZarrZip(
  url: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const zipProbe = await probeDirectDatasetUrl(url, 'store.zip', options)
  checked.push(zipProbe)

  if (!zipProbe.ok) {
    return { platform: 'unknown', baseUrl: url, checked }
  }

  // A zip that an earlier detection registered as a run folder is not opened
  // as a Zarr store again.
  if (zipFolderFor(url) !== undefined) {
    return detectZippedRun(url, '', options, checked)
  }

  const { openZippedZarrStore, ZarrZipRootError } = await import('../zarr/zarrZipStore')
  let zip: Awaited<ReturnType<typeof openZippedZarrStore>>

  try {
    zip = await openZippedZarrStore(
      url,
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    )
  } catch (error) {
    if (error instanceof ZarrZipRootError && error.stores === 'none') {
      return detectZippedRun(url, error.message, options, checked)
    }

    throw error
  }
  const rootPath = zip.entry('zarr.json') === undefined ? '.zattrs' : 'zarr.json'
  const rootBytes = await zip.store.get(`/${rootPath}`)
  const rootMetadata =
    rootBytes === undefined ? null : jsonOrNull(new TextDecoder().decode(rootBytes))
  const rootAttributes =
    objectOrNull(objectOrNull(rootMetadata)?.attributes) ??
    objectOrNull(rootMetadata) ??
    {}
  // Some writers leave the root attributes out. A zip lists its files, so a
  // root holding SpatialData element groups is recognised without them.
  const elementGroups = SPATIALDATA_ELEMENT_GROUPS.filter(
    (kind) =>
      zip.entry(`${kind}/.zgroup`) !== undefined ||
      zip.entry(`${kind}/zarr.json`) !== undefined,
  )
  const rootLabel = `${zip.root}${rootPath}`

  if (isSpatialDataRootMetadata(rootMetadata)) {
    checked.push({ path: `${rootLabel} in the zip (SpatialData)`, url, ok: true })
    return { platform: 'spatialdata', baseUrl: url, spatialDataUrl: url, checked }
  }

  if (
    elementGroups.length > 0 &&
    !('multiscales' in rootAttributes) &&
    !('ome' in rootAttributes) &&
    !('encoding-type' in rootAttributes)
  ) {
    checked.push({
      path: `${zip.root || '/'} in the zip (SpatialData ${elementGroups.join(', ')})`,
      url,
      ok: true,
    })
    return { platform: 'spatialdata', baseUrl: url, spatialDataUrl: url, checked }
  }

  if (isOmeZarrImageRootAttributes(rootAttributes)) {
    checked.push({ path: `${rootLabel} in the zip (OME-Zarr image)`, url, ok: true })
    return {
      platform: 'image',
      baseUrl: url,
      imageUrl: url,
      imageKind: 'ome-zarr',
      checked,
    }
  }

  throw new UnsupportedZipError(
    `The zip at ${url} holds a Zarr store (${rootLabel}) that is neither SpatialData nor an OME-Zarr image. Only those are read from a zip; unzip other stores and host them as folders.`,
  )
}

// An Atera run folder zipped whole, such as `<run>_outs.zip`, with
// experiment.spatial at the top of the zip or in a folder inside it. The zip
// is registered as a folder, so the run's files are read in place under
// `<zip url>/`.
async function detectZippedRun(
  url: string,
  noStoreMessage: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const root = await registerZippedRunFolder(url, options)

  if (root.atera === undefined) {
    throw new UnsupportedZipError(
      root.xenium === undefined
        ? `${noStoreMessage} Nor does it hold an Atera run (${ATERA_EXPERIMENT_FILE}). A zip can hold a SpatialData store, an OME-Zarr image, or an Atera run folder.`
        : `The zip at ${url} holds a Xenium run (${root.xenium}experiment.xenium). Only Atera runs can be opened from a zip; unzip the run and host its folder.`,
    )
  }

  checked.push({
    path: `${root.atera}${ATERA_EXPERIMENT_FILE} in the zip (Atera run)`,
    url,
    ok: true,
  })
  return { platform: 'atera', baseUrl: url, checked }
}

// Reads the zip's directory and, when it holds an Atera run, registers it as
// the run's folder. The matrix is read in parts, so a run whose matrix was
// compressed into the zip is refused here rather than failing later. A zip
// registered before is kept until the page reloads, as opened zip stores are.
async function registerZippedRunFolder(
  url: string,
  options: DetectSpatialDatasetOptions,
): Promise<{ readonly atera?: string; readonly xenium?: string }> {
  const registered = zipFolderFor(url)

  if (registered !== undefined) {
    // The same zip under a new query, such as a refreshed presigned URL, is
    // read with the new one from now on.
    if (registered.url !== url) {
      registerZipFolder({ ...registered, url }, options.fetcher)
    }

    return { atera: registered.root }
  }

  const directory = await readZipDirectory(url, {
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const atera = zipFolderRoot(directory.entries.keys(), ATERA_EXPERIMENT_FILE)

  if (atera === undefined) {
    const xenium = zipFolderRoot(directory.entries.keys(), 'experiment.xenium')
    return xenium === undefined ? {} : { xenium }
  }

  const matrix = directory.entries.get(`${atera}${ATERA_FILE_DEFAULTS.cellFeatureMatrix}`)

  if (matrix !== undefined && matrix.method !== ZIP_METHOD_STORED) {
    throw new Error(
      `The zip at ${url} holds an Atera run, but ${ATERA_FILE_DEFAULTS.cellFeatureMatrix} is compressed in it, so it cannot be read in parts. Zip the run folder without compression (zip -0 -r) or host it unzipped.`,
    )
  }

  registerZipFolder({ url, root: atera, directory }, options.fetcher)
  return { atera }
}

const SPATIALDATA_ELEMENT_GROUPS = [
  'images',
  'labels',
  'points',
  'shapes',
  'tables',
] as const

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
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

  return isOmeZarrImageRootAttributes(attrs) ? 'OME-Zarr image' : null
}

// An OME-Zarr image root: multiscales in v0.4 (`multiscales`) or v0.5
// (`ome.multiscales`) attributes, or a bioformats2raw series container.
function isOmeZarrImageRootAttributes(attrs: Readonly<Record<string, unknown>>): boolean {
  const ome = objectOrNull(attrs.ome)

  return (
    Array.isArray(attrs.multiscales) ||
    (ome !== null && ('multiscales' in ome || 'bioformats2raw.layout' in ome)) ||
    'bioformats2raw.layout' in attrs
  )
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
    const error = probeError(url, cause)

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

  if (!response.ok) {
    checked.push({ path, url, ok: false, status: response.status })

    if (mode === 'required') {
      throw new DatasetManifestError(url, `could not be read (HTTP ${response.status}).`)
    }

    return undefined
  }

  let text: string

  try {
    text = await response.text()
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)

    if (options.signal?.aborted === true) {
      throw cause
    }

    checked.push({ path, url, ok: false, status: response.status, error })

    if (mode === 'required') {
      throw new DatasetManifestError(url, `could not be read (${error}).`, { cause })
    }

    return undefined
  }

  checked.push({ path, url, ok: true, status: response.status })
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (cause) {
    // A page a host answers for any path is not a manifest, but a document
    // that opens as a JSON object is one with a syntax error (EXP-208).
    if (mode === 'required' || text.trimStart().startsWith('{')) {
      throw new DatasetManifestError(url, 'is not valid JSON.', { cause })
    }

    return undefined
  }

  if (mode === 'optional' && !looksLikeDatasetManifest(json)) {
    return undefined
  }

  return parseDatasetManifest(json, url)
}

// A manifest read that neither found the file nor showed it absent: no
// response, a timeout, a body that broke off, or a status such as 5xx or 429.
function manifestUnanswered(probe: DatasetProbeResult | undefined): boolean {
  return (
    probe !== undefined &&
    !probe.ok &&
    probe.error !== NOT_LISTED &&
    probe.status !== 403 &&
    probe.status !== 404 &&
    probe.status !== 410
  )
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
    const table = await detectManifestAnnData(manifest, options, checked)
    return { platform: 'h5ad', baseUrl, ...table, manifest, checked }
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
        isOmeZarrImageUrl(imageUrl) || isIcechunkUrl(imageUrl) || isZarrZipUrl(imageUrl)
          ? 'ome-zarr'
          : tiffImageKind(imageUrl),
      manifest,
      checked,
    }
  }

  if (manifest.platform === 'visium') {
    return detectVisiumFromManifest(baseUrl, manifest, options, checked)
  }

  if (manifest.platform === 'merscope') {
    return detectMerscopeFromManifest(baseUrl, manifest, options, checked)
  }

  return detectVisiumHdFromManifest(baseUrl, manifest, options, checked)
}

// `files.h5ad` names an .h5ad file, which must answer HEAD, or an AnnData Zarr
// store or Icechunk repository, whose root must hold AnnData.
async function detectManifestAnnData(
  manifest: H5adDatasetManifest,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<{ readonly h5adUrl: string; readonly source?: 'icechunk' | 'zarr' }> {
  const { path, url } = manifest.files.h5ad
  const invalid = (problem: string, cause?: unknown) =>
    new DatasetManifestError(
      manifest.url,
      `"files.h5ad" (${url}) ${problem}.`,
      cause === undefined ? undefined : { cause },
    )

  if (isIcechunkUrl(url)) {
    let detection: SpatialDatasetDetection

    try {
      detection = await detectIcechunkRepository(url, options, checked)
    } catch (error) {
      if (options.signal?.aborted === true) throw error
      throw invalid(
        `is not a readable Icechunk repository (${error instanceof Error ? error.message : String(error)})`,
        error,
      )
    }

    if (detection.platform !== 'h5ad') {
      throw invalid(
        `holds ${detection.platform === 'spatialdata' ? 'SpatialData' : 'an image'}, not AnnData`,
      )
    }

    return { h5adUrl: url, source: 'icechunk' }
  }

  if (!isH5adUrl(url)) {
    const probes = await probeZarrMetadata(url, options)
    checked.push(...probes)
    const root = await probeZarrRootContent(url, probes, options)

    if (root?.content === 'AnnData') {
      checked.push(root.probe)
      return { h5adUrl: url, source: 'zarr' }
    }

    if (root?.content === 'SpatialData') {
      throw invalid('is a SpatialData store; use platform "spatialdata"')
    }

    if (probes.some((probe) => probe.ok)) {
      throw invalid('is a Zarr store without AnnData at its root')
    }
    // No Zarr metadata: an .h5ad file under another name.
  }

  const probe = await probeDirectDatasetUrl(url, path, options)
  checked.push(probe)

  if (!probe.ok) {
    throw invalid(`is not readable (${probeFailure(probe)})`)
  }

  return { h5adUrl: url }
}

// Standard Visium output: positions (Space Ranger 2.0+ or 1.x name), scale
// factors, and the filtered matrix are required; tissue images are optional.
// Without the .h5, the MEX folder is probed, only once the other required
// files are found.
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

  if (tissuePositions === undefined || !found(VISIUM_FILE_DEFAULTS.scalefactors)) {
    return null
  }

  const matrix = found(VISIUM_FILE_DEFAULTS.filteredMatrix)
    ? { filteredMatrix: VISIUM_FILE_DEFAULTS.filteredMatrix }
    : await probeVisiumMexFolder(rootUrl, options, checked)

  if (matrix === null) {
    return null
  }

  return {
    tissuePositions,
    scalefactors: VISIUM_FILE_DEFAULTS.scalefactors,
    ...matrix,
    ...(found(VISIUM_FILE_DEFAULTS.hiresImage)
      ? { hiresImage: VISIUM_FILE_DEFAULTS.hiresImage }
      : {}),
    ...(found(VISIUM_FILE_DEFAULTS.lowresImage)
      ? { lowresImage: VISIUM_FILE_DEFAULTS.lowresImage }
      : {}),
  }
}

async function probeVisiumMexFolder(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<Pick<VisiumDetectedFiles, 'filteredMatrix' | 'filteredMatrixMex'> | null> {
  const paths = Object.values(VISIUM_MEX_FILE_DEFAULTS)
  const probes = await Promise.all(
    paths.map((path) => probeDatasetPath(rootUrl, path, options)),
  )
  checked.push(...probes)

  return probes.every((probe) => probe.ok)
    ? {
        filteredMatrix: VISIUM_MEX_FILE_DEFAULTS.filteredMatrix,
        filteredMatrixMex: {
          barcodes: VISIUM_MEX_FILE_DEFAULTS.filteredMatrixBarcodes,
          features: VISIUM_MEX_FILE_DEFAULTS.filteredMatrixFeatures,
        },
      }
    : null
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
  // A named list file must exist; otherwise the list named like the matrix
  // (features.tsv, then Cell Ranger 2's genes.tsv) is used.
  const mexList = async (
    role: (typeof VISIUM_MEX_LIST_FILES)[number],
    matrixPath: string,
  ): Promise<string> => {
    const named = files[role]?.path
    const candidates =
      named !== undefined
        ? [named]
        : (role === 'filteredMatrixBarcodes'
            ? [mexSiblingPath(matrixPath, 'barcodes')]
            : [
                mexSiblingPath(matrixPath, 'features'),
                mexSiblingPath(matrixPath, 'genes'),
              ]
          ).filter((path): path is string => path !== null)

    if (candidates.length === 0) {
      throw new DatasetManifestError(
        manifest.url,
        `"files.filteredMatrix" (${matrixPath}) is not named like matrix.mtx. Name its list in "files.${role}".`,
      )
    }

    for (const path of candidates) {
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
      `no ${candidates.join(' or ')} under ${rootUrl}. Name the file in "files.${role}".`,
    )
  }
  const mexFiles = async (
    matrixPath: string,
  ): Promise<Pick<VisiumDetectedFiles, 'filteredMatrix' | 'filteredMatrixMex'>> => {
    const [barcodes, features] = await Promise.all([
      mexList('filteredMatrixBarcodes', matrixPath),
      mexList('filteredMatrixFeatures', matrixPath),
    ])
    return { filteredMatrix: matrixPath, filteredMatrixMex: { barcodes, features } }
  }
  // A matrix is MEX when it is a .mtx file or the manifest names its lists.
  // Without a name, the .h5 is tried, then the MEX folder.
  const filteredMatrixFiles = async (): Promise<
    Pick<VisiumDetectedFiles, 'filteredMatrix' | 'filteredMatrixMex'>
  > => {
    const listsNamed = VISIUM_MEX_LIST_FILES.some((role) => files[role] !== undefined)
    const filteredMatrix = await requireFile('filteredMatrix', [
      ...(listsNamed ? [] : [VISIUM_FILE_DEFAULTS.filteredMatrix]),
      VISIUM_MEX_FILE_DEFAULTS.filteredMatrix,
    ])

    return listsNamed || isMexMatrixPath(filteredMatrix)
      ? mexFiles(filteredMatrix)
      : { filteredMatrix }
  }
  const [tissuePositions, scalefactors, matrixFiles, hiresImage, lowresImage] =
    await Promise.all([
      requireFile('tissuePositions', [
        VISIUM_FILE_DEFAULTS.tissuePositions,
        VISIUM_LEGACY_TISSUE_POSITIONS,
      ]),
      requireFile('scalefactors', [VISIUM_FILE_DEFAULTS.scalefactors]),
      filteredMatrixFiles(),
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
      ...matrixFiles,
      ...(hiresImage === undefined ? {} : { hiresImage }),
      ...(lowresImage === undefined ? {} : { lowresImage }),
      ...(Object.keys(analysis).length === 0 ? {} : { analysis }),
    },
    manifest,
    checked,
  }
}

// MERSCOPE output: cell_by_gene.csv and cell_metadata.csv are required; the
// boundary file is optional.
async function probeMerscopeOutputs(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<{
  readonly files: MerscopeDetectedFiles | null
  readonly probes: readonly DatasetProbeResult[]
}> {
  const [cellByGene, cellMetadata, cellBoundaries] = await Promise.all([
    probeDatasetPath(rootUrl, MERSCOPE_FILE_DEFAULTS.cellByGene, options),
    probeDatasetPath(rootUrl, MERSCOPE_FILE_DEFAULTS.cellMetadata, options),
    probeDirectDatasetUrl(
      joinUrl(rootUrl, MERSCOPE_FILE_DEFAULTS.cellBoundaries),
      MERSCOPE_FILE_DEFAULTS.cellBoundaries,
      options,
      { byteLength: true },
    ),
  ])

  return {
    files:
      cellByGene.ok && cellMetadata.ok
        ? {
            cellByGene: cellByGene.path,
            cellMetadata: cellMetadata.path,
            ...merscopeBoundaryFile(cellBoundaries),
            ...listedVzgFile(rootUrl),
          }
        : null,
    probes: [cellByGene, cellMetadata, cellBoundaries],
  }
}

// Files the manifest names must exist; the others fall back to the
// instrument's names, and missing boundaries are left out.
async function detectMerscopeFromManifest(
  baseUrl: string,
  manifest: MerscopeDatasetManifest,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<SpatialDatasetDetection> {
  const { files, rootUrl } = manifest
  const probe = async (role: keyof typeof MERSCOPE_FILE_DEFAULTS) => {
    const named = files[role]?.path
    const path = named ?? MERSCOPE_FILE_DEFAULTS[role]
    const result = await probeDirectDatasetUrl(
      resolveManifestPath(rootUrl, path),
      path,
      options,
      { byteLength: role === 'cellBoundaries' },
    )
    checked.push(result)

    if (!result.ok && named !== undefined) {
      throw new DatasetManifestError(
        manifest.url,
        `"files.${role}" (${result.url}) is not readable (${probeFailure(result)}).`,
      )
    }

    return result
  }
  const [cellByGene, cellMetadata, cellBoundaries] = await Promise.all([
    probe('cellByGene'),
    probe('cellMetadata'),
    probe('cellBoundaries'),
  ])
  const namedVzg = files.vzg

  if (namedVzg !== undefined) {
    const result = await probeDirectDatasetUrl(namedVzg.url, namedVzg.path, options)
    checked.push(result)

    if (!result.ok) {
      throw new DatasetManifestError(
        manifest.url,
        `"files.vzg" (${result.url}) is not readable (${probeFailure(result)}).`,
      )
    }
  }

  for (const [role, result] of [
    ['cellByGene', cellByGene],
    ['cellMetadata', cellMetadata],
  ] as const) {
    if (!result.ok) {
      throw new DatasetManifestError(
        manifest.url,
        `no ${MERSCOPE_FILE_DEFAULTS[role]} under ${rootUrl}. Name the file in "files.${role}".`,
      )
    }
  }

  return {
    platform: 'merscope',
    baseUrl,
    files: {
      cellByGene: cellByGene.path,
      cellMetadata: cellMetadata.path,
      ...merscopeBoundaryFile(cellBoundaries),
      ...(namedVzg === undefined ? listedVzgFile(rootUrl) : { vzg: namedVzg.path }),
    },
    manifest,
    checked,
  }
}

// The run's .vzg, when the folder's index page lists exactly one. Its name
// carries the run and region, so it cannot be probed for.
function listedVzgFile(rootUrl: string): Pick<MerscopeDetectedFiles, 'vzg'> {
  const names = Array.from(folderListingFor(rootUrl)?.names ?? []).filter((name) =>
    /\.vzg$/i.test(name),
  )

  return names.length === 1 && names[0] !== undefined ? { vzg: names[0] } : {}
}

function merscopeBoundaryFile(
  probe: DatasetProbeResult,
): Pick<MerscopeDetectedFiles, 'cellBoundaries' | 'cellBoundariesByteLength'> {
  return probe.ok
    ? {
        cellBoundaries: probe.path,
        ...(probe.byteLength === undefined
          ? {}
          : { cellBoundariesByteLength: probe.byteLength }),
      }
    : {}
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
  // Probed alongside the bins, and listed after them.
  const segmentedProbe =
    manifest.segmentedOutputs === undefined
      ? probeVisiumHdSegmentedOutputs(rootUrl, options)
      : undefined
  // A bin error is thrown first; the probe's own error then goes unread.
  segmentedProbe?.catch(() => undefined)
  let bins: VisiumHdBinDescriptor[]

  if (manifest.bins === undefined) {
    const probed = await probeVisiumHdBins(rootUrl, options)
    checked.push(...probed.probes)
    bins = probed.bins

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
          visiumHdRequiredBinPaths(descriptor).map((path) =>
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

  let segmentedOutputs: VisiumHdSegmentedOutputPaths

  if (manifest.segmentedOutputs === undefined) {
    const segmented = await (segmentedProbe ??
      probeVisiumHdSegmentedOutputs(rootUrl, options))
    checked.push(...segmented.probes)
    segmentedOutputs = segmented.outputs
  } else {
    segmentedOutputs = segmentedOutputPathsFromManifest(manifest.segmentedOutputs)
  }

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

// Standard Space Ranger tiers under `rootUrl` that have positions (for 2 µm,
// filtered barcodes), scalefactors, and a filtered matrix. Every tier is
// probed at once; a tier at a time took a round of requests each (O11 in the
// optimization pass). The probes come back a tier at a time, in that order.
async function probeVisiumHdBins(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<{
  readonly bins: VisiumHdBinDescriptor[]
  readonly probes: DatasetProbeResult[]
}> {
  const tiers = await Promise.all(
    VISIUM_HD_BINS.map(async (bin) => {
      const descriptor = visiumHdBinDescriptor(bin.size, bin.outputPath)
      const probes = await Promise.all(
        visiumHdRequiredBinPaths(descriptor).map((path) =>
          probeDatasetPath(rootUrl, path, options),
        ),
      )
      return { descriptor, probes }
    }),
  )

  return {
    bins: tiers
      .filter((tier) => tier.probes.every((probe) => probe.ok))
      .map((tier) => tier.descriptor),
    probes: tiers.flatMap((tier) => tier.probes),
  }
}

// The bins and the segmented outputs, probed together; their probes are
// listed bins first.
async function probeVisiumHdOutputs(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
  checked: DatasetProbeResult[],
): Promise<{
  readonly bins: VisiumHdBinDescriptor[]
  readonly segmentedOutputs: VisiumHdSegmentedOutputPaths
}> {
  const [bins, segmented] = await Promise.all([
    probeVisiumHdBins(rootUrl, options),
    probeVisiumHdSegmentedOutputs(rootUrl, options),
  ])
  checked.push(...bins.probes, ...segmented.probes)
  return { bins: bins.bins, segmentedOutputs: segmented.outputs }
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
): Promise<{
  readonly outputs: VisiumHdSegmentedOutputPaths
  readonly probes: DatasetProbeResult[]
}> {
  const probes = await Promise.all(
    VISIUM_HD_SEGMENTED_OUTPUT_PROBES.map((probe) =>
      probeDatasetPath(rootUrl, probe.path, options),
    ),
  )
  return { outputs: segmentedOutputPathsFromProbes(probes), probes }
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

// A section is detected as its file is, then read through the file's dataset.
async function detectAnnDataSection(
  url: string,
  { fileUrl, column, value }: AnnDataSectionRef,
  options: DetectSpatialDatasetOptions,
): Promise<SpatialDatasetDetection> {
  if (value === null) {
    throw new DatasetDetectionError(
      'unsupported',
      `#obs.${column} names this file split into sections by obs column "${column}": open it as a collection (collection= in the address), or name one section with #obs.${column}=<value>.`,
      [],
    )
  }

  const file = await detectSpatialDatasetLayout(normalizeBaseUrl(fileUrl), options)

  if (file.platform === 'unknown') {
    return { ...file, baseUrl: url }
  }

  if (file.platform !== 'h5ad') {
    throw new DatasetDetectionError(
      'unsupported',
      `#obs.${column}=${value} names a section of an AnnData table, but this file opens as ${file.platform}, which has no obs columns.`,
      file.checked,
    )
  }

  return {
    ...file,
    baseUrl: url,
    section: { fileUrl: file.baseUrl, column, value },
  }
}

export async function createSpatialDataset(
  baseUrl: string,
  options: CreateSpatialDatasetOptions = {},
): Promise<AnySpatialDataset> {
  const detection =
    detectionOf(baseUrl, options.detection) ??
    detectionOf(baseUrl, datasetDetections.get(normalizeBaseUrl(baseUrl))) ??
    (await detectSpatialDataset(baseUrl, options))

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
    const image = datasetImageFor(detection.baseUrl)

    return new AnnDataH5adDataset({
      url: detection.h5adUrl,
      ...(image === undefined
        ? {}
        : {
            image: {
              url: image.url,
              coordinates: image.coordinates,
              ...(image.labels === undefined ? {} : { labelsUrl: image.labels.url }),
              ...(image.labelsFormat === undefined
                ? {}
                : { labelsFormat: image.labelsFormat }),
              ...(image.labelsCoordinates === undefined
                ? {}
                : { labelsCoordinates: image.labelsCoordinates }),
              ...(image.labelColumn === undefined
                ? {}
                : { labelColumn: image.labelColumn }),
            },
          }),
      ...(detection.source === 'icechunk' ? { icechunk: true } : {}),
      ...(detection.source === 'zarr' ? { zarr: true } : {}),
      ...(detection.section === undefined
        ? {}
        : { section: sectionSource(detection.section, options) }),
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.onH5adLoadProgress === undefined
        ? {}
        : { onProgress: options.onH5adLoadProgress }),
    })
  }

  if (detection.platform === 'spatialdata') {
    const { SpatialDataDataset } = await import('./spatialDataDataset')
    return new SpatialDataDataset({
      ...spatialDataSelectionFor(baseUrl, options.spatialDataSelection),
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
        ...(files.filteredMatrixMex === undefined
          ? {}
          : {
              filteredMatrixMex: {
                barcodes: fileUrl(files.filteredMatrixMex.barcodes),
                features: fileUrl(files.filteredMatrixMex.features),
              },
            }),
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

  if (detection.platform === 'merscope') {
    const { MerscopeDataset } = await import('./merscopeDataset')
    const { files } = detection
    const fileUrl = (path: string) => datasetFileUrl(detection.baseUrl, path)

    return new MerscopeDataset({
      baseUrl: detection.baseUrl,
      files: {
        cellByGene: fileUrl(files.cellByGene),
        cellMetadata: fileUrl(files.cellMetadata),
        ...(files.cellBoundaries === undefined
          ? {}
          : { cellBoundaries: fileUrl(files.cellBoundaries) }),
        ...(files.vzg === undefined ? {} : { vzg: fileUrl(files.vzg) }),
      },
      ...(files.cellBoundariesByteLength === undefined
        ? {}
        : { cellBoundariesByteLength: files.cellBoundariesByteLength }),
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
    })
  }

  throw datasetDetectionError(detection.checked)
}

// A section reads its file through the file's cached dataset, so the file's
// sections, and the file opened on its own, share one read. The file is
// retained while a section holds it.
function sectionSource(
  { fileUrl, column, value }: { fileUrl: string; column: string; value: string },
  options: CreateSpatialDatasetOptions,
) {
  return {
    column,
    value,
    holdFile: (signal: AbortSignal) => {
      const release = retainDataset(fileUrl)
      return {
        dataset: cachedSpatialDataset(fileUrl, {
          ...(options.onH5adLoadProgress === undefined
            ? {}
            : { onH5adLoadProgress: options.onH5adLoadProgress }),
          signal,
        }),
        release,
      }
    },
  }
}

export function cachedSpatialDataset(
  baseUrl: string,
  options: CachedSpatialDatasetOptions = {},
): Promise<AnySpatialDataset> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const spatialDataSelection = spatialDataSelectionFor(
    normalizedBaseUrl,
    options.spatialDataSelection,
  )
  const visiumView = options.visiumView ?? visiumViewFor(normalizedBaseUrl)
  const cacheKey = spatialDatasetCacheKey(
    normalizedBaseUrl,
    spatialDataSelection,
    collectionImageFor(normalizedBaseUrl),
  )
  const dataset = spatialDatasetCache.get(
    cacheKey,
    normalizedBaseUrl,
    (signal) =>
      createSpatialDataset(normalizedBaseUrl, {
        ...(options.onH5adLoadProgress === undefined
          ? {}
          : { onH5adLoadProgress: options.onH5adLoadProgress }),
        ...(options.detection === undefined ? {} : { detection: options.detection }),
        spatialDataSelection,
        signal,
      }),
    options.signal,
  )

  return Object.keys(visiumView).length === 0
    ? dataset
    : dataset.then((opened) =>
        hasVisiumViews(opened) ? opened.visiumViewDataset(visiumView) : opened,
      )
}

function hasVisiumViews(
  dataset: AnySpatialDataset,
): dataset is AnySpatialDataset & Pick<AnnDataH5adDataset, 'visiumViewDataset'> {
  return typeof (dataset as Partial<AnnDataH5adDataset>).visiumViewDataset === 'function'
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
  // Records the response's Content-Length.
  { byteLength: withByteLength = false }: { readonly byteLength?: boolean } = {},
): Promise<DatasetProbeResult> {
  if (folderListingMissing(url) !== undefined) {
    return { path, url, ok: false, error: NOT_LISTED }
  }

  try {
    const fetcher = options.fetcher ?? fetch
    const response = await fetchWithTimeout(
      (input, init) => fetchHead(fetcher, String(input), init),
      url,
      {},
      options.signal,
      DATASET_PROBE_TIMEOUT_MS,
    )
    noteReadableResponse(url, response.status)
    const byteLength = Number(response.headers.get('Content-Length') ?? Number.NaN)

    return {
      path,
      url,
      ok: response.ok,
      status: response.status,
      ...(withByteLength && response.ok && Number.isFinite(byteLength) && byteLength > 0
        ? { byteLength }
        : {}),
    }
  } catch (cause) {
    if (options.signal?.aborted === true) {
      throw cause
    }

    return { path, url, ok: false, error: probeError(url, cause) }
  }
}

// A failed fetch on a host that hides its error responses is a likely missing
// file, which detection counts as not found.
function probeError(url: string, cause: unknown): string {
  return likelyMissingFileError(url, url, cause) === undefined
    ? cause instanceof Error
      ? cause.message
      : String(cause)
    : PROBE_HIDDEN_ERROR
}

// A Zarr group is a SpatialData store when its root attributes carry
// `spatialdata_attrs`; plain OME-Zarr images do not.
type ZarrStoreContent = 'SpatialData' | 'AnnData'

// Reads the root metadata the probes found and names the store's content when
// it is SpatialData or AnnData. Other Zarr roots are taken as OME-Zarr images.
// AnnData before 0.8 wrote no root attributes, so a `.zarr` store without them
// is AnnData when obs is a dataframe.
async function probeZarrRootContent(
  rootUrl: string,
  metadataProbes: readonly DatasetProbeResult[],
  options: DetectSpatialDatasetOptions,
): Promise<{
  readonly content: ZarrStoreContent
  readonly probe: DatasetProbeResult
} | null> {
  let rootAttributes = false

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
      const metadata: unknown = response.ok ? await response.json() : null
      const content = metadata === null ? null : zarrStoreContent(metadata)

      if (content !== null) {
        return {
          content,
          probe: {
            path: `${probe.path} (${content})`,
            url,
            ok: true,
            status: response.status,
          },
        }
      }

      rootAttributes ||=
        probe.path !== '.zattrs' || Object.keys(objectOrNull(metadata) ?? {}).length > 0
    } catch {
      // Unreadable or non-JSON metadata names no content.
    }
  }

  return rootAttributes || !/\.zarr\/*$/i.test(new URL(rootUrl).pathname)
    ? null
    : probeLegacyAnnDataRoot(rootUrl, options)
}

async function probeLegacyAnnDataRoot(
  rootUrl: string,
  options: DetectSpatialDatasetOptions,
): Promise<{
  readonly content: ZarrStoreContent
  readonly probe: DatasetProbeResult
} | null> {
  const path = 'obs/.zattrs'
  const url = joinUrl(rootUrl, path)

  try {
    const response = await fetchWithTimeout(
      options.fetcher ?? fetch,
      url,
      {},
      options.signal,
      DATASET_PROBE_TIMEOUT_MS,
    )

    noteReadableResponse(url, response.status)
    const attrs = response.ok ? objectOrNull(await response.json()) : null

    return attrs?.['encoding-type'] === 'dataframe'
      ? {
          content: 'AnnData',
          probe: { path: `${path} (AnnData)`, url, ok: true, status: response.status },
        }
      : null
  } catch {
    return null
  }
}

// `metadata` is a v3 zarr.json or a v2 .zattrs.
function zarrStoreContent(metadata: unknown): ZarrStoreContent | null {
  if (isSpatialDataRootMetadata(metadata)) {
    return 'SpatialData'
  }

  const attrs = objectOrNull(objectOrNull(metadata)?.attributes) ?? objectOrNull(metadata)
  return attrs?.['encoding-type'] === 'anndata' ? 'AnnData' : null
}

function zarrStoreDetection(
  baseUrl: string,
  storeUrl: string,
  content: ZarrStoreContent,
  checked: readonly DatasetProbeResult[],
): SpatialDatasetDetection {
  return content === 'SpatialData'
    ? { platform: 'spatialdata', baseUrl, spatialDataUrl: storeUrl, checked }
    : { platform: 'h5ad', baseUrl, h5adUrl: storeUrl, source: 'zarr', checked }
}

// A detection request, sent once: a probe that goes `timeoutMs` without bytes,
// its body included, has timed out (fetchWithRetry, O7). Probes are not tried
// again, so a host without CORS is reported as soon as it fails.
async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const sent = signal === undefined ? init : { ...init, signal }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetcher(input, sent)
  }

  try {
    return await fetchWithRetry(input, sent, {
      fetcher,
      idleTimeoutMs: timeoutMs,
      attempts: 1,
    })
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      throw new Error(`Request timed out after ${timeoutMs.toLocaleString()} ms.`, {
        cause: error,
      })
    }

    throw error
  }
}

// Reads and registers the folder's index page, so detection and the readers
// skip the files it does not list. Clears the folder's listing when the host
// serves none.
// A manifest's root is a folder, or a zipped Atera run read as one.
async function registerManifestRoot(
  manifest: DatasetManifest,
  options: DetectSpatialDatasetOptions,
): Promise<void> {
  if (!isZarrZipUrl(manifest.rootUrl)) {
    await registerFolderListing(manifest.rootUrl, options)
    return
  }

  const root =
    manifest.platform === 'atera'
      ? await registerZippedRunFolder(manifest.rootUrl, options)
      : {}

  if (root.atera === undefined) {
    throw new DatasetManifestError(
      manifest.url,
      `"root" is a zip (${manifest.rootUrl}), which can only be the root of an "atera" manifest whose zip holds an Atera run (${ATERA_EXPERIMENT_FILE}).`,
    )
  }
}

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

// A detection made for `baseUrl`, registered as detectSpatialDataset would
// register it; undefined for one of another URL.
function detectionOf(
  baseUrl: string,
  detection: SpatialDatasetDetection | undefined,
): SpatialDatasetDetection | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  if (
    detection === undefined ||
    normalizeBaseUrl(detection.baseUrl) !== normalizedBaseUrl
  ) {
    return undefined
  }

  setDatasetManifest(
    normalizedBaseUrl,
    detection.platform === 'unknown' ? undefined : detection.manifest,
  )
  return detection
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// Detection probes the folder as given, not through a manifest registered by
// an earlier detection of the same URL.
function joinUrl(baseUrl: string, path: string): string {
  return folderFileUrl(baseUrl, path)
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
  spatialDataSelection: SpatialDataSelection | undefined,
  image: DatasetImageAttachment | undefined,
): string {
  return `${baseUrl}\nspatialData=${JSON.stringify(spatialDataSelection ?? {})}\nimage=${image === undefined ? '' : `${image.url} ${image.coordinates} ${image.labels?.url ?? ''} ${image.labelsFormat ?? ''} ${image.labelsCoordinates ?? ''} ${image.labelColumn ?? ''}`}`
}
