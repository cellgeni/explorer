import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { loadTranscriptZarrViewport } from './transcriptZarr'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { CellId } from './cellid'
import type { BBox, DataPoint } from './coords'
import type { DatasetRangeValidator } from './datasetOverview'
import type { XeniumDataset } from '../datasets/xeniumDataset'

export const TRANSCRIPT_EXACT_RENDER_LIMIT = 50_000
export const MIN_TRANSCRIPT_EXACT_RENDER_LIMIT = 1
export const MAX_TRANSCRIPT_EXACT_RENDER_LIMIT = 1_000_000
export const TRANSCRIPT_GROUP_LIMIT = 18
export const TRANSCRIPT_EXACT_MIN_ZOOM = 1.2

export type TranscriptDetailMode = 'auto' | 'density' | 'bins' | 'exact'
export type TranscriptFeatureFilterMode = 'all' | 'selected'

export interface TranscriptCapabilities {
  readonly rawParquet: boolean
  readonly nativeZarr: boolean
  readonly rawParquetError?: string
  readonly nativeZarrError?: string
}

export interface TranscriptPoint {
  readonly id: string
  readonly cellId: CellId | null
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
  readonly level: number
  readonly binX: number
  readonly binY: number
  readonly position: DataPoint
  readonly radiusMicrometers: number
  readonly count: number
  readonly featureName?: string
  readonly fovName?: string
  readonly meanQv?: number
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

export interface TranscriptViewportOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly pointLimit?: number
  readonly groupLimit?: number
  readonly minQv?: number
  readonly geneOnly?: boolean
  readonly featureNames?: readonly string[]
}

export interface TranscriptCapabilityOptions {
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
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
      readonly mode: 'density' | 'bins'
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
  }

  throwIfAborted(options.signal)

  if (hasNativeZarr) {
    return loadTranscriptZarrViewport(zarrUrl, bbox, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      pointLimit,
      groupLimit: options.groupLimit ?? TRANSCRIPT_GROUP_LIMIT,
      minQv: options.minQv ?? 20,
      geneOnly: options.geneOnly ?? true,
      featureNames: options.featureNames ?? [],
    })
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

export function planTranscriptLod(
  input: TranscriptLodPlanningInput,
  options: TranscriptLodPlanningOptions,
): TranscriptLodPlan {
  const exactLimit = normalizeTranscriptExactPointLimit(options.exactLimit)
  const visibleTranscriptEstimate = Math.max(
    0,
    Math.floor(options.visibleTranscriptEstimate),
  )

  if (options.hasSelectedFeatureFilter === false) {
    return {
      kind: 'waiting',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'Select genes or switch the transcript feature filter to All.',
    }
  }

  if (!options.hasRawParquet && !options.hasNativeZarr) {
    return {
      kind: 'unavailable',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'No range-readable transcript output was detected for this dataset.',
    }
  }

  if (options.detailMode === 'density' || options.detailMode === 'bins') {
    return options.hasNativeZarr
      ? {
          kind: 'native-zarr',
          mode: options.detailMode,
          visibleTranscriptEstimate,
          exactLimit,
          message:
            'Use the official Xenium transcripts.zarr.zip density/grid pyramid for this view.',
        }
      : {
          kind: 'unavailable',
          visibleTranscriptEstimate,
          exactLimit,
          message:
            'Density and bin modes need the official transcripts.zarr.zip LOD output.',
        }
  }

  if (options.hasNativeZarr && options.detailMode === 'auto') {
    return {
      kind: 'native-zarr',
      mode: 'density',
      visibleTranscriptEstimate,
      exactLimit,
      message:
        'Using the official Xenium transcript density/grid LOD is the right overview path.',
    }
  }

  if (!options.hasRawParquet) {
    return {
      kind: 'unavailable',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'Exact transcript rendering needs range-readable transcripts.parquet.',
    }
  }

  if (
    visibleTranscriptEstimate <= exactLimit &&
    (options.detailMode === 'exact' || input.viewState.zoom >= TRANSCRIPT_EXACT_MIN_ZOOM)
  ) {
    return {
      kind: 'exact',
      mode: 'exact',
      visibleTranscriptEstimate,
      exactLimit,
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
