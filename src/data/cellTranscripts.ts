import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { CellId } from './cellid'
import type { DatasetRangeValidator } from './datasetOverview'
import type { DatasetTranscript, XeniumDataset } from '../datasets/xeniumDataset'

export const CELL_TRANSCRIPT_DISTRIBUTION_LIMIT = 100_000
export const CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT = 16
export const DEFAULT_CELL_TRANSCRIPT_MIN_QV = 20

export interface CellTranscriptZBin {
  readonly minZ: number
  readonly maxZ: number
  readonly count: number
  readonly percent: number
}

export interface CellTranscriptZDistribution {
  readonly bins: readonly CellTranscriptZBin[]
  readonly transcriptCount: number
  readonly zCount: number
  readonly missingZCount: number
  readonly minZ?: number
  readonly maxZ?: number
  readonly maxBinCount: number
  readonly hitTranscriptLimit: boolean
  readonly minQv: number
}

export interface LoadDatasetCellTranscriptDistributionOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly minQv?: number
  readonly binCount?: number
}

export async function loadDatasetCellTranscriptDistribution(
  baseUrl: string,
  cellId: CellId,
  options: LoadDatasetCellTranscriptDistributionOptions = {},
): Promise<CellTranscriptZDistribution> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

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

  const limit = normalizePositiveInteger(
    options.limit,
    CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  )
  const minQv = normalizeMinQv(options.minQv)
  const transcripts = await dataset.transcriptsForCellId(cellId, {
    limit,
    minQv,
  })
  throwIfAborted(options.signal)

  return summarizeCellTranscriptZDistribution(transcripts, {
    hitTranscriptLimit: transcripts.length >= limit,
    minQv,
    ...(options.binCount === undefined ? {} : { binCount: options.binCount }),
  })
}

export function summarizeCellTranscriptZDistribution(
  transcripts: readonly DatasetTranscript[],
  options: {
    readonly binCount?: number
    readonly hitTranscriptLimit?: boolean
    readonly minQv?: number
  } = {},
): CellTranscriptZDistribution {
  const zValues: number[] = []

  for (const transcript of transcripts) {
    const zLocation = transcript.zLocation

    if (zLocation !== undefined && Number.isFinite(zLocation)) {
      zValues.push(zLocation)
    }
  }

  if (zValues.length === 0) {
    return {
      bins: [],
      transcriptCount: transcripts.length,
      zCount: 0,
      missingZCount: transcripts.length,
      maxBinCount: 0,
      hitTranscriptLimit: options.hitTranscriptLimit ?? false,
      minQv: normalizeMinQv(options.minQv),
    }
  }

  let minZ = zValues[0] ?? 0
  let maxZ = zValues[0] ?? 0

  for (let index = 1; index < zValues.length; index += 1) {
    const zLocation = zValues[index] ?? 0

    minZ = Math.min(minZ, zLocation)
    maxZ = Math.max(maxZ, zLocation)
  }

  if (minZ === maxZ) {
    return {
      bins: [
        {
          minZ,
          maxZ,
          count: zValues.length,
          percent: 100,
        },
      ],
      transcriptCount: transcripts.length,
      zCount: zValues.length,
      missingZCount: transcripts.length - zValues.length,
      minZ,
      maxZ,
      maxBinCount: zValues.length,
      hitTranscriptLimit: options.hitTranscriptLimit ?? false,
      minQv: normalizeMinQv(options.minQv),
    }
  }

  const binCount = normalizePositiveInteger(
    options.binCount,
    CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  )
  const binSize = (maxZ - minZ) / binCount
  const counts = Array.from({ length: binCount }, () => 0)

  for (const zLocation of zValues) {
    const rawIndex = Math.floor((zLocation - minZ) / binSize)
    const binIndex = Math.max(0, Math.min(binCount - 1, rawIndex))

    counts[binIndex] = (counts[binIndex] ?? 0) + 1
  }

  let maxBinCount = 0
  const bins = counts.map((count, index): CellTranscriptZBin => {
    maxBinCount = Math.max(maxBinCount, count)
    return {
      minZ: minZ + binSize * index,
      maxZ: index === binCount - 1 ? maxZ : minZ + binSize * (index + 1),
      count,
      percent: (count / zValues.length) * 100,
    }
  })

  return {
    bins,
    transcriptCount: transcripts.length,
    zCount: zValues.length,
    missingZCount: transcripts.length - zValues.length,
    minZ,
    maxZ,
    maxBinCount,
    hitTranscriptLimit: options.hitTranscriptLimit ?? false,
    minQv: normalizeMinQv(options.minQv),
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

function normalizeMinQv(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_CELL_TRANSCRIPT_MIN_QV
  }

  return value
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

  const error = new Error('Cell transcript distribution request aborted.')
  error.name = 'AbortError'
  return error
}
