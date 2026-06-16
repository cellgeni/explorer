import { datasetFileUrl } from '../data/datasetFiles'
import type { CellId } from '../data/cellid'
import { normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget } from './visiumHdStrategy'
import type { VisiumHdSegmentedOutputPaths } from './visiumHdSegmentations'
import type { SpatialDataset, SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'

export type AnySpatialDataset = SpatialDataset<CellId> | SpatialDataset<SpatialElementId>

export type SpatialDatasetDetection =
  | {
      readonly platform: 'xenium'
      readonly baseUrl: string
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
}

export interface CachedSpatialDatasetOptions {
  readonly visiumHdMaxTwoMicrometerFilteredBarcodes?: number
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

const VISIUM_HD_TWO_MICROMETER_FILTERED_BARCODE_BUDGET_ENV =
  'VITE_VISIUM_HD_MAX_TWO_MICROMETER_FILTERED_BARCODES'
const DEFAULT_VISIUM_HD_MAX_TWO_MICROMETER_FILTERED_BARCODES =
  readDefaultTwoMicrometerFilteredBarcodeBudget()
const spatialDatasetCache = new Map<string, Promise<AnySpatialDataset>>()

export async function detectSpatialDataset(
  baseUrl: string,
  options: DetectSpatialDatasetOptions = {},
): Promise<SpatialDatasetDetection> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const checked: DatasetProbeResult[] = []
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
    options.visiumHdMaxTwoMicrometerFilteredBarcodes ??
    DEFAULT_VISIUM_HD_MAX_TWO_MICROMETER_FILTERED_BARCODES
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

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'HEAD',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
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

function readDefaultTwoMicrometerFilteredBarcodeBudget(): number | undefined {
  const rawBudget = import.meta.env[VISIUM_HD_TWO_MICROMETER_FILTERED_BARCODE_BUDGET_ENV]

  if (typeof rawBudget !== 'string' || rawBudget.trim() === '') {
    return undefined
  }

  return normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget(Number(rawBudget))
}
