import { datasetFileUrl } from '../data/datasetFiles'
import type { CellId } from '../data/cellid'
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

const VISIUM_HD_BINS: readonly {
  readonly size: VisiumHdBinSizeMicrometers
  readonly outputPath: string
}[] = [
  { size: 2, outputPath: 'binned_outputs/square_002um' },
  { size: 8, outputPath: 'binned_outputs/square_008um' },
  { size: 16, outputPath: 'binned_outputs/square_016um' },
]

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

  const segmentedScalefactors = await probeDatasetPath(
    normalizedBaseUrl,
    'segmented_outputs/spatial/scalefactors_json.json',
    options,
  )
  checked.push(segmentedScalefactors)

  if (bins.length > 0) {
    return {
      platform: 'visium-hd',
      baseUrl: normalizedBaseUrl,
      bins,
      ...(segmentedScalefactors.ok
        ? { segmentedScalefactorsPath: segmentedScalefactors.path }
        : {}),
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
  options: DetectSpatialDatasetOptions = {},
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
    })
  }

  throw new Error('Unsupported spatial dataset layout.')
}

export function cachedSpatialDataset(baseUrl: string): Promise<AnySpatialDataset> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const existing = spatialDatasetCache.get(normalizedBaseUrl)

  if (existing !== undefined) {
    return existing
  }

  const promise = createSpatialDataset(normalizedBaseUrl).catch((error: unknown) => {
    if (spatialDatasetCache.get(normalizedBaseUrl) === promise) {
      spatialDatasetCache.delete(normalizedBaseUrl)
    }

    throw error
  })
  spatialDatasetCache.set(normalizedBaseUrl, promise)
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
