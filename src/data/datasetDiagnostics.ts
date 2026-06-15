import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import {
  detectSpatialDataset,
  type SpatialDatasetDetection,
} from '../datasets/datasetFactory'
import type { Platform } from '../datasets/spatialDataset'
import type { RangeSupportFetcher } from './rangeSupport'

export type DatasetDiagnosticStatus = 'pass' | 'warning' | 'fail'
export type DatasetDiagnosticPlatform = Platform | 'unknown'

export interface DatasetDiagnosticCheck {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly required: boolean
  readonly status: DatasetDiagnosticStatus
  readonly message: string
  readonly durationMs: number
}

export interface DatasetDiagnosticsReport {
  readonly baseUrl: string
  readonly platform: DatasetDiagnosticPlatform
  readonly startedAt: string
  readonly completedAt: string
  readonly checks: readonly DatasetDiagnosticCheck[]
}

export interface DatasetDiagnosticsOptions {
  readonly fetcher?: RangeSupportFetcher
  readonly signal?: AbortSignal
  readonly rangeValidator?: (
    url: string,
    options: {
      readonly fetcher?: RangeSupportFetcher
      readonly label?: string
      readonly signal?: AbortSignal
    },
  ) => Promise<void>
  readonly detectDataset?: (
    baseUrl: string,
    options: {
      readonly fetcher?: RangeSupportFetcher
      readonly signal?: AbortSignal
    },
  ) => Promise<SpatialDatasetDetection>
}

const XENIUM_REQUIRED_RANGE_FILES = [
  { id: 'cells-parquet', label: 'Overview cells', path: 'cells.parquet' },
] as const

const XENIUM_OPTIONAL_RANGE_FILES = [
  { id: 'cell-boundaries', label: 'Cell boundaries', path: 'cell_boundaries.parquet' },
  { id: 'transcripts', label: 'Transcripts', path: 'transcripts.parquet' },
  {
    id: 'transcripts-zarr',
    label: 'Transcript native LOD',
    path: 'transcripts.zarr.zip',
  },
  { id: 'feature-matrix', label: 'Feature matrix', path: 'cell_feature_matrix.zarr.zip' },
  { id: 'morphology', label: 'Morphology image', path: 'morphology.ome.tif' },
] as const

const VISIUM_HD_ROOT_RANGE_FILES = [
  { id: 'visium-hd-feature-slice', label: 'Feature Slice H5', path: 'feature_slice.h5' },
  {
    id: 'visium-hd-barcode-mappings',
    label: 'Barcode mappings',
    path: 'barcode_mappings.parquet',
  },
] as const

export async function runDatasetDiagnostics(
  baseUrl: string,
  options: DatasetDiagnosticsOptions = {},
): Promise<DatasetDiagnosticsReport> {
  const startedAt = new Date()
  const checks: DatasetDiagnosticCheck[] = []
  const detectionStartedAt = Date.now()
  const detection = await (options.detectDataset ?? detectSpatialDataset)(baseUrl, {
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  checks.push(detectionDiagnosticCheck(detection, detectionStartedAt))

  if (detection.platform === 'visium-hd') {
    checks.push(...(await runVisiumHdDiagnostics(detection, options)))

    return {
      baseUrl,
      platform: detection.platform,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  if (detection.platform === 'unknown') {
    return {
      baseUrl,
      platform: 'unknown',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  checks.push(await checkManifest(baseUrl, options))

  for (const file of XENIUM_REQUIRED_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, file, true, options))
  }

  for (const file of XENIUM_OPTIONAL_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, file, false, options))
  }

  return {
    baseUrl,
    platform: detection.platform,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    checks,
  }
}

export function summarizeDatasetDiagnostics(report: DatasetDiagnosticsReport): string {
  const failed = report.checks.filter((check) => check.status === 'fail').length
  const warnings = report.checks.filter((check) => check.status === 'warning').length

  if (failed > 0) {
    return `${failed} failed, ${warnings} warnings`
  }

  if (warnings > 0) {
    return `${warnings} warnings`
  }

  return 'All checks passed'
}

async function checkManifest(
  baseUrl: string,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrl(baseUrl, 'experiment.xenium')
  const startedAt = Date.now()

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (!response.ok) {
      return diagnosticCheck({
        id: 'experiment-manifest',
        label: 'Experiment manifest',
        url,
        required: true,
        status: 'fail',
        message: `HTTP ${response.status}`,
        startedAt,
      })
    }

    return diagnosticCheck({
      id: 'experiment-manifest',
      label: 'Experiment manifest',
      url,
      required: true,
      status: 'pass',
      message: 'Readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: 'experiment-manifest',
      label: 'Experiment manifest',
      url,
      required: true,
      status: 'fail',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

async function runVisiumHdDiagnostics(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'visium-hd' }>,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const checks: DatasetDiagnosticCheck[] = []

  for (const bin of detection.bins) {
    const suffix = `${bin.binSizeMicrometers}um`

    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-positions`,
          label: `Visium HD ${suffix} positions`,
          path: bin.tissuePositionsPath,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkReadableFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-scalefactors`,
          label: `Visium HD ${suffix} scalefactors`,
          path: bin.scalefactorsPath,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-matrix`,
          label: `Visium HD ${suffix} filtered matrix`,
          path: bin.filteredMatrixH5Path,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-tissue-hires`,
          label: `Visium HD ${suffix} high-res tissue image`,
          path: `${bin.outputPath}/spatial/tissue_hires_image.png`,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-tissue-lowres`,
          label: `Visium HD ${suffix} low-res tissue image`,
          path: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
        },
        false,
        options,
      ),
    )
  }

  for (const file of VISIUM_HD_ROOT_RANGE_FILES) {
    checks.push(await checkRangeFile(detection.baseUrl, file, false, options))
  }

  if (detection.segmentedScalefactorsPath !== undefined) {
    checks.push(
      await checkReadableFile(
        detection.baseUrl,
        {
          id: 'visium-hd-segmented-scalefactors',
          label: 'Visium HD segmented scalefactors',
          path: detection.segmentedScalefactorsPath,
        },
        false,
        options,
      ),
    )
  }

  return checks
}

async function checkRangeFile(
  baseUrl: string,
  file: { readonly id: string; readonly label: string; readonly path: string },
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrl(baseUrl, file.path)
  const startedAt = Date.now()

  try {
    await (options.rangeValidator ?? assertHttpRangeSupport)(url, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      label: file.label,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: 'pass',
      message: 'Byte-range readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

async function checkReadableFile(
  baseUrl: string,
  file: { readonly id: string; readonly label: string; readonly path: string },
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrl(baseUrl, file.path)
  const startedAt = Date.now()

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: 'pass',
      message: 'Readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

function diagnosticCheck(options: {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly required: boolean
  readonly status: DatasetDiagnosticStatus
  readonly message: string
  readonly startedAt: number
}): DatasetDiagnosticCheck {
  return {
    id: options.id,
    label: options.label,
    url: options.url,
    required: options.required,
    status: options.status,
    message: options.message,
    durationMs: Math.max(0, Date.now() - options.startedAt),
  }
}

function detectionDiagnosticCheck(
  detection: SpatialDatasetDetection,
  startedAt: number,
): DatasetDiagnosticCheck {
  const label = 'Dataset layout'

  if (detection.platform === 'unknown') {
    return diagnosticCheck({
      id: 'dataset-layout',
      label,
      url: detection.baseUrl,
      required: true,
      status: 'fail',
      message: 'Unsupported dataset layout',
      startedAt,
    })
  }

  return diagnosticCheck({
    id: 'dataset-layout',
    label,
    url: detection.baseUrl,
    required: true,
    status: 'pass',
    message:
      detection.platform === 'visium-hd'
        ? `Detected Visium HD (${detection.bins
            .map((bin) => `${bin.binSizeMicrometers} µm`)
            .join(', ')})`
        : 'Detected Xenium',
    startedAt,
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
