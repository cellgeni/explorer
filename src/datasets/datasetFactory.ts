import { datasetManifestFor, setDatasetManifest } from '../data/datasetFiles'
import { isOmeZarrImageUrl, omeZarrImageRootUrl } from '../zarr/omeZarrLoader'
import {
  DATASET_MANIFEST_FILE,
  DatasetManifestError,
  VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS,
  isDatasetManifestUrl,
  looksLikeDatasetManifest,
  parseDatasetManifest,
  resolveManifestPath,
  type DatasetManifest,
  type VisiumHdDatasetManifest,
  type VisiumHdManifestSegmentedOutput,
} from './datasetManifest'
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
      readonly h5adUrl: string
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
      readonly imageKind?: 'tiff' | 'ndpi' | 'ome-zarr'
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
          imageKind: isNdpiUrl(normalizedBaseUrl) ? 'ndpi' : 'tiff',
          checked,
        }
      : {
          platform: 'unknown',
          baseUrl: normalizedBaseUrl,
          checked,
        }
  }

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
      imageKind: isOmeZarrImageUrl(imageUrl)
        ? 'ome-zarr'
        : isNdpiUrl(imageUrl)
          ? 'ndpi'
          : 'tiff',
      manifest,
      checked,
    }
  }

  return detectVisiumHdFromManifest(baseUrl, manifest, options, checked)
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
    return new ImageOnlyDataset({ imageUrl: detection.imageUrl })
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

  throw new Error('Unsupported spatial dataset layout.')
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
  try {
    const response = await fetchWithTimeout(
      options.fetcher ?? fetch,
      url,
      { method: 'HEAD' },
      options.signal,
      DATASET_PROBE_TIMEOUT_MS,
    )

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
  return /\.(?:(?:ome\.)?tiff?|ndpi)(?:$|[?#])/i.test(url)
}

function isNdpiUrl(url: string): boolean {
  return /\.ndpi(?:$|[?#])/i.test(url)
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
