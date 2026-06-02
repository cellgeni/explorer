import type { BBox } from './coords'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { DatasetRangeValidator } from './datasetOverview'
import type { DatasetTranscript, XeniumDataset } from '../datasets/xeniumDataset'

export const ROI_TRANSCRIPT_EXPORT_LIMIT = 100_000
const DEFAULT_ROI_TRANSCRIPT_MIN_QV = 20

export interface LoadDatasetRoiTranscriptsOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly minQv?: number
}

export async function loadDatasetRoiTranscripts(
  baseUrl: string,
  bbox: BBox,
  options: LoadDatasetRoiTranscriptsOptions = {},
): Promise<readonly DatasetTranscript[]> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

  await validateRangeSupport(datasetFileUrl(baseUrl, 'transcripts.parquet'), {
    label: 'transcripts.parquet',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  const transcripts = await dataset.transcriptsInBbox(bbox, {
    limit: options.limit ?? ROI_TRANSCRIPT_EXPORT_LIMIT,
    minQv: options.minQv ?? DEFAULT_ROI_TRANSCRIPT_MIN_QV,
  })
  throwIfAborted(options.signal)

  return transcripts
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

  const error = new Error('ROI transcript request aborted.')
  error.name = 'AbortError'
  return error
}
