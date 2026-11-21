// Loads a dataset's transcripts: what it has, the points in a view, and
// density bins. Points come from transcripts.zarr.zip, with the Parquet rows'
// cell assignment added, else from transcripts.parquet through the Xenium
// dataset. The types and plans these share with the dataset readers are in
// transcriptOverlay.ts, which imports no dataset.

import { datasetFileLabelFor, datasetFileUrlFor } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
import {
  TRANSCRIPT_GROUP_LIMIT,
  normalizeTranscriptExactPointLimit,
  type TranscriptAggregateResult,
  type TranscriptCapabilities,
  type TranscriptPoint,
  type TranscriptViewportResult,
} from './transcriptOverlay'
import {
  loadTranscriptZarrAggregates,
  loadTranscriptZarrGridCounts,
  loadTranscriptZarrViewport,
} from './transcriptZarr'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { BBox } from './coords'
import type { DatasetRangeValidator } from './datasetOverview'
import type { XeniumDataset } from '../datasets/xeniumDataset'
import { abortError, isAbortError, throwIfAborted } from '../utils/abort'

export const TRANSCRIPT_METADATA_ENRICH_TIMEOUT_MS = 1_500

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
  // Native Zarr tiles read, 0 to 1. The Parquet path does not report it.
  readonly onProgress?: (fraction: number) => void
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
  // Per-gene outputs (Atera) count transcripts at this QV or above; Xenium
  // density counts every transcript.
  readonly minQv?: number
}

export async function loadDatasetTranscriptCapabilities(
  baseUrl: string,
  options: TranscriptCapabilityOptions = {},
): Promise<TranscriptCapabilities> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const rawParquet = await probeTranscriptFile(
    datasetFileUrlFor(baseUrl, 'transcripts'),
    datasetFileLabelFor(baseUrl, 'transcripts'),
    validateRangeSupport,
    options.signal,
  )
  const zarrUrl = datasetFileUrlFor(baseUrl, 'transcriptsZarr')
  const nativeZarr = await probeTranscriptFile(
    zarrUrl,
    datasetFileLabelFor(baseUrl, 'transcriptsZarr'),
    validateRangeSupport,
    options.signal,
  )
  // The density and exact reads need the same metadata, which is cached, so
  // reading it here makes them no slower.
  const gridCounts = nativeZarr.ok
    ? await probeTranscriptZarrGridCounts(zarrUrl, options.signal)
    : {}
  throwIfAborted(options.signal)

  return {
    rawParquet: rawParquet.ok,
    nativeZarr: nativeZarr.ok,
    ...(rawParquet.ok ? {} : { rawParquetError: rawParquet.error }),
    ...(nativeZarr.ok ? {} : { nativeZarrError: nativeZarr.error }),
    ...gridCounts,
  }
}

async function probeTranscriptZarrGridCounts(
  url: string,
  signal: AbortSignal | undefined,
): Promise<
  Pick<TranscriptCapabilities, 'nativeZarrGridCounts' | 'nativeZarrGridCountsError'>
> {
  try {
    const level = await loadTranscriptZarrGridCounts(
      url,
      signal === undefined ? {} : { signal },
    )

    return level === null
      ? { nativeZarrGridCountsError: 'transcripts.zarr.zip has no level-0 grid counts.' }
      : { nativeZarrGridCounts: level }
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause
    }

    return {
      nativeZarrGridCountsError: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

export async function loadDatasetTranscriptViewport(
  baseUrl: string,
  bbox: BBox,
  options: TranscriptViewportOptions = {},
): Promise<TranscriptViewportResult> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const pointLimit = normalizeTranscriptExactPointLimit(options.pointLimit)
  const zarrUrl = datasetFileUrlFor(baseUrl, 'transcriptsZarr')
  let hasNativeZarr = false

  try {
    await validateRangeSupport(zarrUrl, {
      label: datasetFileLabelFor(baseUrl, 'transcriptsZarr'),
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
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
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

  await validateRangeSupport(datasetFileUrlFor(baseUrl, 'transcripts'), {
    label: datasetFileLabelFor(baseUrl, 'transcripts'),
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

    // The Zarr holds only the low 32 bits of the file's transcript_id.
    return {
      ...point,
      transcriptId: parquetPoint.transcriptId ?? point.transcriptId ?? parquetPoint.id,
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
    await validateRangeSupport(datasetFileUrlFor(baseUrl, 'transcripts'), {
      label: datasetFileLabelFor(baseUrl, 'transcripts'),
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
  const zarrUrl = datasetFileUrlFor(baseUrl, 'transcriptsZarr')

  await validateRangeSupport(zarrUrl, {
    label: datasetFileLabelFor(baseUrl, 'transcriptsZarr'),
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

// Pairs a Zarr point with its transcripts.parquet row. The Zarr's `id` holds
// the low 32 bits of `transcript_id` and the index of the field of view, and
// the high 32 bits are 0x10000 plus that index (XOA 1.7 and 3.x), so the field
// of view and the low 32 bits name one transcript.
function transcriptPointMetadataKey(point: TranscriptPoint): string {
  return `${point.fovName ?? ''}\u0000${transcriptIdLow32(point.transcriptId ?? point.id)}`
}

function transcriptIdLow32(id: string): string {
  return /^\d+$/.test(id) ? (BigInt(id) & 0xffff_ffffn).toString() : id
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
