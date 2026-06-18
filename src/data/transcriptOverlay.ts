import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
import {
  loadTranscriptZarrAggregates,
  loadTranscriptZarrViewport,
} from './transcriptZarr'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { CellId } from './cellid'
import type { BBox, DataPoint } from './coords'
import type { DatasetRangeValidator } from './datasetOverview'
import type { XeniumDataset } from '../datasets/xeniumDataset'

export const TRANSCRIPT_EXACT_RENDER_LIMIT = 100_000
export const MIN_TRANSCRIPT_EXACT_RENDER_LIMIT = 1
export const MAX_TRANSCRIPT_EXACT_RENDER_LIMIT = 1_000_000
export const TRANSCRIPT_GROUP_LIMIT = 18
export const TRANSCRIPT_METADATA_ENRICH_TIMEOUT_MS = 1_500

export type TranscriptDetailMode = 'auto' | 'density' | 'exact'
export type TranscriptFeatureFilterMode = 'all' | 'selected'
export type TranscriptCellAssignment = 'known' | 'unassigned' | 'unavailable'

export interface TranscriptCapabilities {
  readonly rawParquet: boolean
  readonly nativeZarr: boolean
  readonly rawParquetError?: string
  readonly nativeZarrError?: string
}

export interface TranscriptPoint {
  readonly id: string
  readonly transcriptId?: string
  readonly cellId: CellId | null
  readonly cellAssignment?: TranscriptCellAssignment
  readonly featureName: string
  readonly fovName: string | null
  readonly position: DataPoint
  readonly zLocation?: number
  readonly qv: number
  readonly overlapsNucleus?: boolean
  readonly isGene?: boolean
  readonly nucleusDistance?: number
}

export interface TranscriptGroupSummary {
  readonly featureName: string
  readonly fovName: string | null
  readonly count: number
  readonly meanQv?: number
}

export interface TranscriptAggregateBin {
  readonly id: string
  readonly source?: 'cell-summary' | 'native-zarr'
  readonly glyphType?: 'density' | 'feature-circle'
  readonly level: number
  readonly binX: number
  readonly binY: number
  readonly position: DataPoint
  readonly radiusMicrometers: number
  readonly binSizeMicrometers?: number
  readonly count: number
  readonly binTotalCount?: number
  readonly selectedGeneCount?: number
  readonly omittedFeatureCount?: number
  readonly omittedTranscriptCount?: number
  readonly topFeatures?: readonly TranscriptAggregateFeatureSummary[]
  readonly featureName?: string
  readonly fovName?: string
  readonly meanQv?: number
}

export interface TranscriptAggregateFeatureSummary {
  readonly featureName: string
  readonly count: number
}

export interface TranscriptLodLevel {
  readonly level: number
  readonly gridSizeMicrometers: number
  readonly gridKeys: readonly string[]
  readonly transcriptCounts: readonly number[]
}

export interface TranscriptViewportEstimate {
  readonly source: 'cell-summary' | 'native-zarr' | 'raw-count'
  readonly count: number
}

export type TranscriptLayerDataState =
  | {
      readonly kind: 'exact'
      readonly points: readonly TranscriptPoint[]
      readonly groups: readonly TranscriptGroupSummary[]
    }
  | {
      readonly kind: 'aggregate'
      readonly bins: readonly TranscriptAggregateBin[]
      readonly level: TranscriptLodLevel
    }

export interface TranscriptViewportResult {
  readonly points: readonly TranscriptPoint[]
  readonly groups: readonly TranscriptGroupSummary[]
  readonly hitPointLimit: boolean
}

export interface TranscriptAggregateResult {
  readonly bins: readonly TranscriptAggregateBin[]
  readonly level: TranscriptLodLevel
  readonly source: 'native-zarr'
  readonly selectedFeatureNames: readonly string[]
  readonly scaleMax?: number
}

export interface TranscriptViewportOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly pointLimit?: number
  readonly groupLimit?: number
  readonly minQv?: number
  readonly geneOnly?: boolean
  readonly featureNames?: readonly string[]
  readonly metadataEnrichmentTimeoutMs?: number
  readonly onFallback?: FallbackNotifier
}

export interface TranscriptCapabilityOptions {
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
}

export interface TranscriptAggregateOptions {
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly mode?: 'density'
  readonly featureNames?: readonly string[]
  readonly maxBins?: number
}

export type TranscriptLodPlan =
  | {
      readonly kind: 'exact'
      readonly mode: 'exact'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
    }
  | {
      readonly kind: 'native-zarr'
      readonly mode: 'density'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
      readonly message: string
    }
  | {
      readonly kind: 'waiting'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
      readonly message: string
    }
  | {
      readonly kind: 'unavailable'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
      readonly message: string
    }

export interface TranscriptLodPlanningInput {
  readonly viewState: { readonly zoom: number }
}

export interface TranscriptLodPlanningOptions {
  readonly detailMode: TranscriptDetailMode
  readonly visibleTranscriptEstimate: number
  readonly exactLimit?: number
  readonly hasRawParquet: boolean
  readonly hasNativeZarr: boolean
  readonly hasSelectedFeatureFilter?: boolean
}

export async function loadDatasetTranscriptCapabilities(
  baseUrl: string,
  options: TranscriptCapabilityOptions = {},
): Promise<TranscriptCapabilities> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const rawParquet = await probeTranscriptFile(
    datasetFileUrl(baseUrl, 'transcripts.parquet'),
    'transcripts.parquet',
    validateRangeSupport,
    options.signal,
  )
  const nativeZarr = await probeTranscriptFile(
    datasetFileUrl(baseUrl, 'transcripts.zarr.zip'),
    'transcripts.zarr.zip',
    validateRangeSupport,
    options.signal,
  )
  throwIfAborted(options.signal)

  return {
    rawParquet: rawParquet.ok,
    nativeZarr: nativeZarr.ok,
    ...(rawParquet.ok ? {} : { rawParquetError: rawParquet.error }),
    ...(nativeZarr.ok ? {} : { nativeZarrError: nativeZarr.error }),
  }
}

export async function loadDatasetTranscriptViewport(
  baseUrl: string,
  bbox: BBox,
  options: TranscriptViewportOptions = {},
): Promise<TranscriptViewportResult> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const pointLimit = normalizeTranscriptExactPointLimit(options.pointLimit)
  const zarrUrl = datasetFileUrl(baseUrl, 'transcripts.zarr.zip')
  let hasNativeZarr = false

  try {
    await validateRangeSupport(zarrUrl, {
      label: 'transcripts.zarr.zip',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    hasNativeZarr = true
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    notifyFallback(options.onFallback, {
      source: 'Transcripts',
      message:
        'transcripts.zarr.zip was not available for exact transcript loading, so the app switched to raw transcripts.parquet.',
      action:
        'Exact transcripts can still load at close zooms, but raw Parquet scans may be slower.',
      detail: error instanceof Error ? error.message : String(error),
      coalesceKey: `transcript-exact-raw-parquet:${baseUrl}`,
    })
  }

  throwIfAborted(options.signal)

  if (hasNativeZarr) {
    const nativeResult = await loadTranscriptZarrViewport(zarrUrl, bbox, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      pointLimit,
      groupLimit: options.groupLimit ?? TRANSCRIPT_GROUP_LIMIT,
      minQv: options.minQv ?? 20,
      geneOnly: options.geneOnly ?? true,
      featureNames: options.featureNames ?? [],
    })

    throwIfAborted(options.signal)

    return transcriptResultWithMetadataDeadline(
      nativeResult,
      enrichNativeTranscriptViewportFromParquet(baseUrl, bbox, nativeResult, {
        ...options,
        pointLimit,
      }),
      options.signal,
      options.metadataEnrichmentTimeoutMs ?? TRANSCRIPT_METADATA_ENRICH_TIMEOUT_MS,
      options.onFallback,
      baseUrl,
    )
  }

  await validateRangeSupport(datasetFileUrl(baseUrl, 'transcripts.parquet'), {
    label: 'transcripts.parquet',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumTranscriptDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  return dataset.transcriptsForViewport(bbox, {
    pointLimit,
    groupLimit: options.groupLimit ?? TRANSCRIPT_GROUP_LIMIT,
    minQv: options.minQv ?? 20,
    geneOnly: options.geneOnly ?? true,
    featureNames: options.featureNames ?? [],
  })
}

export function mergeTranscriptPointMetadata(
  nativePoints: readonly TranscriptPoint[],
  parquetPoints: readonly TranscriptPoint[],
): readonly TranscriptPoint[] {
  if (nativePoints.length === 0 || parquetPoints.length === 0) {
    return nativePoints
  }

  const parquetPointByKey = new Map<string, TranscriptPoint>()

  for (const point of parquetPoints) {
    parquetPointByKey.set(transcriptPointMetadataKey(point), point)
  }

  return nativePoints.map((point) => {
    const parquetPoint = parquetPointByKey.get(transcriptPointMetadataKey(point))

    if (parquetPoint === undefined) {
      return point
    }

    return {
      ...point,
      transcriptId: point.transcriptId ?? parquetPoint.transcriptId ?? parquetPoint.id,
      cellId: parquetPoint.cellId,
      cellAssignment:
        parquetPoint.cellAssignment ??
        (parquetPoint.cellId === null ? 'unassigned' : 'known'),
      ...(parquetPoint.overlapsNucleus === undefined
        ? {}
        : { overlapsNucleus: parquetPoint.overlapsNucleus }),
      ...(parquetPoint.nucleusDistance === undefined
        ? {}
        : { nucleusDistance: parquetPoint.nucleusDistance }),
      ...(parquetPoint.isGene === undefined ? {} : { isGene: parquetPoint.isGene }),
    }
  })
}

async function enrichNativeTranscriptViewportFromParquet(
  baseUrl: string,
  bbox: BBox,
  nativeResult: TranscriptViewportResult,
  options: TranscriptViewportOptions & { readonly pointLimit: number },
): Promise<TranscriptViewportResult> {
  if (nativeResult.points.length === 0) {
    return nativeResult
  }

  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

  try {
    await validateRangeSupport(datasetFileUrl(baseUrl, 'transcripts.parquet'), {
      label: 'transcripts.parquet',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    throwIfAborted(options.signal)

    const dataset =
      options.getDataset === undefined
        ? await cachedXeniumTranscriptDataset(baseUrl)
        : await options.getDataset(baseUrl)
    throwIfAborted(options.signal)

    const parquetResult = await dataset.transcriptsForViewport(bbox, {
      pointLimit: options.pointLimit,
      groupLimit: options.groupLimit ?? TRANSCRIPT_GROUP_LIMIT,
      minQv: options.minQv ?? 20,
      geneOnly: options.geneOnly ?? true,
      featureNames: options.featureNames ?? [],
    })
    throwIfAborted(options.signal)

    return {
      ...nativeResult,
      points: mergeTranscriptPointMetadata(nativeResult.points, parquetResult.points),
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    notifyFallback(options.onFallback, {
      source: 'Transcripts',
      message:
        'Transcript points loaded from native Zarr, but Parquet metadata enrichment failed.',
      action:
        'Transcript hover remains available; cell assignment and nucleus fields may be unavailable for those points.',
      detail: error instanceof Error ? error.message : String(error),
      coalesceKey: `transcript-metadata-enrichment:${baseUrl}`,
    })
    return nativeResult
  }
}

export async function loadDatasetTranscriptAggregates(
  baseUrl: string,
  bbox: BBox,
  options: TranscriptAggregateOptions = {},
): Promise<TranscriptAggregateResult> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const zarrUrl = datasetFileUrl(baseUrl, 'transcripts.zarr.zip')

  await validateRangeSupport(zarrUrl, {
    label: 'transcripts.zarr.zip',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  return loadTranscriptZarrAggregates(zarrUrl, bbox, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    mode: options.mode ?? 'density',
    featureNames: options.featureNames ?? [],
    ...(options.maxBins === undefined ? {} : { maxBins: options.maxBins }),
  })
}

export function planTranscriptLod(
  _input: TranscriptLodPlanningInput,
  options: TranscriptLodPlanningOptions,
): TranscriptLodPlan {
  const exactLimit = normalizeTranscriptExactPointLimit(options.exactLimit)
  const visibleTranscriptEstimate = Math.max(
    0,
    Math.floor(options.visibleTranscriptEstimate),
  )

  if (!options.hasRawParquet && !options.hasNativeZarr) {
    return {
      kind: 'unavailable',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'No range-readable transcript output was detected for this dataset.',
    }
  }

  if (options.detailMode === 'density') {
    return options.hasNativeZarr
      ? {
          kind: 'native-zarr',
          mode: 'density',
          visibleTranscriptEstimate,
          exactLimit,
          message:
            'Use the official Xenium transcripts.zarr.zip density/grid pyramid for this view.',
        }
      : {
          kind: 'unavailable',
          visibleTranscriptEstimate,
          exactLimit,
          message: 'Density mode needs the official transcripts.zarr.zip LOD output.',
        }
  }

  const hasExactSource = options.hasRawParquet || options.hasNativeZarr
  const hasSelectedFeatureFilter = options.hasSelectedFeatureFilter !== false

  if (
    hasExactSource &&
    hasSelectedFeatureFilter &&
    visibleTranscriptEstimate <= exactLimit
  ) {
    return {
      kind: 'exact',
      mode: 'exact',
      visibleTranscriptEstimate,
      exactLimit,
    }
  }

  if (options.detailMode === 'auto' && options.hasNativeZarr) {
    return {
      kind: 'native-zarr',
      mode: 'density',
      visibleTranscriptEstimate,
      exactLimit,
      message:
        'Using the official Xenium transcript density/grid LOD is the right overview path.',
    }
  }

  if (!hasSelectedFeatureFilter) {
    return {
      kind: 'waiting',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'Select genes or switch the transcript feature filter to All.',
    }
  }

  if (!hasExactSource) {
    return {
      kind: 'unavailable',
      visibleTranscriptEstimate,
      exactLimit,
      message:
        'Exact transcript rendering needs range-readable transcripts.zarr.zip or transcripts.parquet.',
    }
  }

  return {
    kind: 'waiting',
    visibleTranscriptEstimate,
    exactLimit,
    message:
      visibleTranscriptEstimate > exactLimit
        ? `Zoom or filter below ${exactLimit.toLocaleString()} visible transcripts for exact rendering.`
        : 'Zoom closer for exact transcript rendering.',
  }
}

export function normalizeTranscriptExactPointLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return TRANSCRIPT_EXACT_RENDER_LIMIT
  }

  return Math.max(
    MIN_TRANSCRIPT_EXACT_RENDER_LIMIT,
    Math.min(MAX_TRANSCRIPT_EXACT_RENDER_LIMIT, Math.round(value)),
  )
}

export function transcriptViewportRequestKey(
  baseUrl: string,
  bbox: BBox,
  options: {
    readonly minQv: number
    readonly geneOnly: boolean
    readonly featureNames: readonly string[]
    readonly pointLimit: number
  },
): string {
  return [
    baseUrl,
    bbox.minX.toFixed(1),
    bbox.minY.toFixed(1),
    bbox.maxX.toFixed(1),
    bbox.maxY.toFixed(1),
    options.minQv,
    options.geneOnly ? 'gene' : 'all',
    options.pointLimit,
    [...options.featureNames].sort((a, b) => a.localeCompare(b)).join(','),
  ].join('|')
}

export function transcriptAggregateRequestKey(
  baseUrl: string,
  bbox: BBox,
  options: {
    readonly mode: 'density'
    readonly featureNames: readonly string[]
    readonly maxBins: number
  },
): string {
  return [
    baseUrl,
    'aggregate',
    bbox.minX.toFixed(1),
    bbox.minY.toFixed(1),
    bbox.maxX.toFixed(1),
    bbox.maxY.toFixed(1),
    options.mode,
    options.maxBins,
    [...options.featureNames].sort((a, b) => a.localeCompare(b)).join(','),
  ].join('|')
}

function transcriptPointMetadataKey(point: TranscriptPoint): string {
  return `${point.fovName ?? ''}\u0000${point.transcriptId ?? point.id}`
}

function transcriptResultWithMetadataDeadline(
  nativeResult: TranscriptViewportResult,
  enrichment: Promise<TranscriptViewportResult>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  onFallback: FallbackNotifier | undefined,
  baseUrl: string,
): Promise<TranscriptViewportResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    notifyTranscriptMetadataFallback(
      onFallback,
      baseUrl,
      'Metadata enrichment was disabled.',
    )
    return Promise.resolve(nativeResult)
  }

  if (signal?.aborted) {
    return Promise.reject(abortError(signal))
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
    }

    const settleWithNative = () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      notifyTranscriptMetadataFallback(
        onFallback,
        baseUrl,
        `Metadata enrichment exceeded ${timeoutMs.toLocaleString()} ms.`,
      )
      resolve(nativeResult)
    }

    const settleWithResult = (result: TranscriptViewportResult) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(result)
    }

    const settleWithError = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (isAbortError(error)) {
        reject(error)
        return
      }

      notifyTranscriptMetadataFallback(
        onFallback,
        baseUrl,
        error instanceof Error ? error.message : String(error),
      )
      resolve(nativeResult)
    }

    const handleAbort = () => settleWithError(abortError(signal as AbortSignal))
    const timeout = globalThis.setTimeout(settleWithNative, timeoutMs)

    signal?.addEventListener('abort', handleAbort, { once: true })
    enrichment.then(settleWithResult, settleWithError)
  })
}

function notifyTranscriptMetadataFallback(
  onFallback: FallbackNotifier | undefined,
  baseUrl: string,
  detail: string,
): void {
  notifyFallback(onFallback, {
    source: 'Transcripts',
    message:
      'Transcript points loaded from native Zarr without Parquet assignment metadata.',
    action:
      'Transcript hover remains available; cell assignment and nucleus fields may be unavailable for those points.',
    detail,
    coalesceKey: `transcript-metadata-enrichment:${baseUrl}`,
  })
}

async function probeTranscriptFile(
  url: string,
  label: string,
  validateRangeSupport: DatasetRangeValidator,
  signal: AbortSignal | undefined,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  try {
    await validateRangeSupport(url, {
      label,
      ...(signal === undefined ? {} : { signal }),
    })
    throwIfAborted(signal)
    return { ok: true }
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause
    }

    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Transcript overlay request aborted.')
  error.name = 'AbortError'
  return error
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}
