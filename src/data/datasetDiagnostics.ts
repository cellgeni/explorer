import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import type { RangeSupportFetcher } from './rangeSupport'

export type DatasetDiagnosticStatus = 'pass' | 'warning' | 'fail'

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
}

const REQUIRED_RANGE_FILES = [
  { id: 'cells-parquet', label: 'Overview cells', path: 'cells.parquet' },
]

const OPTIONAL_RANGE_FILES = [
  { id: 'cell-boundaries', label: 'Cell boundaries', path: 'cell_boundaries.parquet' },
  { id: 'transcripts', label: 'Transcripts', path: 'transcripts.parquet' },
  { id: 'feature-matrix', label: 'Feature matrix', path: 'cell_feature_matrix.zarr.zip' },
  { id: 'morphology', label: 'Morphology image', path: 'morphology.ome.tif' },
]

export async function runDatasetDiagnostics(
  baseUrl: string,
  options: DatasetDiagnosticsOptions = {},
): Promise<DatasetDiagnosticsReport> {
  const startedAt = new Date()
  const checks: DatasetDiagnosticCheck[] = []

  checks.push(await checkManifest(baseUrl, options))

  for (const file of REQUIRED_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, file, true, options))
  }

  for (const file of OPTIONAL_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, file, false, options))
  }

  return {
    baseUrl,
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
