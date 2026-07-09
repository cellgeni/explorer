import { datasetFileUrl } from '../data/datasetFiles'
import { isOmeZarrImageUrl, omeZarrImageRootUrl } from '../zarr/omeZarrLoader'
import type { CellId } from '../data/cellid'
import type { VisiumHdSegmentedOutputPaths } from './visiumHdSegmentationModel'
import type { SpatialDataset, SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'
import type { H5adLoadProgressReporter } from './h5adDataset'

export type AnySpatialDataset = SpatialDataset<CellId> | SpatialDataset<SpatialElementId>

export type SpatialDatasetDetection =
  | {
      readonly platform: 'xenium'
      readonly baseUrl: string
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'h5ad'
      readonly baseUrl: string
      readonly h5adUrl: string
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'image'
      readonly baseUrl: string
      readonly imageUrl: string
      readonly imageKind?: 'tiff' | 'ndpi' | 'ome-zarr'
      readonly checked: readonly DatasetProbeResult[]
    }
  | {
      readonly platform: 'visium-hd'
      readonly baseUrl: string
      readonly bins: readonly VisiumHdBinDescriptor[]
      readonly segmentedScalefactorsPath?: string
      readonly segmentedOutputs?: VisiumHdSegmentedOutputPaths
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
const DATASET_PROBE_TIMEOUT_MS = 15_000

export async function detectSpatialDataset(
  baseUrl: string,
  options: DetectSpatialDatasetOptions = {},
): Promise<SpatialDatasetDetection> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const checked: DatasetProbeResult[] = []

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

  const xeniumManifest = await probeDatasetPath(
    normalizedBaseUrl,
    'experiment.xenium',
    options,
  )
  checked.push(xeniumManifest)

  if (xeniumManifest.ok) {
    return {
      platform: 'xenium',
      baseUrl: normalizedBaseUrl,
      checked,
    }
  }

  const zarrMetadataProbes = await probeZarrMetadata(normalizedBaseUrl, options)
  checked.push(...zarrMetadataProbes)
  const zarrMetadataProbe = zarrMetadataProbes.find((probe) => probe.ok)

  if (zarrMetadataProbe !== undefined) {
    return {
      platform: 'image',
      baseUrl: normalizedBaseUrl,
      imageUrl: datasetFileUrl(normalizedBaseUrl, zarrMetadataProbe.path),
      imageKind: 'ome-zarr',
      checked,
    }
  }

  const bins: VisiumHdBinDescriptor[] = []

  for (const bin of VISIUM_HD_BINS) {
    const tissuePositionsPath = `${bin.outputPath}/spatial/tissue_positions.parquet`
    const scalefactorsPath = `${bin.outputPath}/spatial/scalefactors_json.json`
    const matrixPath = `${bin.outputPath}/filtered_feature_bc_matrix.h5`
    const [positions, scalefactors, matrix] = await Promise.all([
      probeDatasetPath(normalizedBaseUrl, tissuePositionsPath, options),
      probeDatasetPath(normalizedBaseUrl, scalefactorsPath, options),
      probeDatasetPath(normalizedBaseUrl, matrixPath, options),
    ])
    checked.push(positions, scalefactors, matrix)

    if (positions.ok && scalefactors.ok && matrix.ok) {
      bins.push({
        binSizeMicrometers: bin.size,
        outputPath: bin.outputPath,
        tissuePositionsPath,
        scalefactorsPath,
        filteredMatrixH5Path: matrixPath,
      })
    }
  }

  const segmentedOutputProbes = await Promise.all(
    VISIUM_HD_SEGMENTED_OUTPUT_PROBES.map((probe) =>
      probeDatasetPath(normalizedBaseUrl, probe.path, options),
    ),
  )
  checked.push(...segmentedOutputProbes)
  const segmentedOutputs = segmentedOutputPathsFromProbes(segmentedOutputProbes)

  if (bins.length > 0) {
    return {
      platform: 'visium-hd',
      baseUrl: normalizedBaseUrl,
      bins,
      ...(segmentedOutputs.scalefactorsPath === undefined
        ? {}
        : { segmentedScalefactorsPath: segmentedOutputs.scalefactorsPath }),
      ...(hasSegmentedOutputPaths(segmentedOutputs) ? { segmentedOutputs } : {}),
      checked,
    }
  }

  return {
    platform: 'unknown',
    baseUrl: normalizedBaseUrl,
    checked,
  }
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

  if (detection.platform === 'image') {
    const { ImageOnlyDataset } = await import('./imageOnlyDataset')
    return new ImageOnlyDataset({ imageUrl: detection.imageUrl })
  }

  if (detection.platform === 'visium-hd') {
    const { VisiumHdDataset } = await import('./visiumHdDataset')
    return new VisiumHdDataset({
      baseUrl: detection.baseUrl,
      bins: detection.bins,
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
  const url = datasetFileUrl(baseUrl, path)
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
): string {
  return `${baseUrl}\nvisiumHd2umBudget=${visiumHdMaxTwoMicrometerFilteredBarcodes ?? ''}`
}
