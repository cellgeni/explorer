import type { TranscriptPoint } from './transcriptOverlay'

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
  // The genes counted, when only some are (Atera counts the selected genes);
  // absent when every feature in the cell is counted.
  readonly featureNames?: readonly string[]
}

// Transcripts' z positions, such as a Xenium dataset's DatasetTranscript rows.
export function summarizeCellTranscriptZDistribution(
  transcripts: readonly { readonly zLocation: number | undefined }[],
  options: {
    readonly binCount?: number
    readonly hitTranscriptLimit?: boolean
    readonly minQv?: number
  } = {},
): CellTranscriptZDistribution {
  return summarizeZValues(
    transcripts.map((transcript) => transcript.zLocation),
    {
      transcriptCount: transcripts.length,
      missingZCount: transcripts.filter(
        (transcript) =>
          transcript.zLocation === undefined || !Number.isFinite(transcript.zLocation),
      ).length,
      hitTranscriptLimit: options.hitTranscriptLimit ?? false,
      minQv: normalizeMinQv(options.minQv),
      binCount: normalizePositiveInteger(
        options.binCount,
        CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
      ),
    },
  )
}

export function summarizeTranscriptPointZDistribution(
  points: readonly TranscriptPoint[],
  options: {
    readonly hitTranscriptLimit: boolean
    readonly minQv: number
    readonly binCount: number
  },
): CellTranscriptZDistribution {
  const missingZCount = points.filter(
    (point) => point.zLocation === undefined || !Number.isFinite(point.zLocation),
  ).length

  return summarizeZValues(
    points.map((point) => point.zLocation),
    {
      transcriptCount: points.length,
      missingZCount,
      hitTranscriptLimit: options.hitTranscriptLimit,
      minQv: options.minQv,
      binCount: options.binCount,
    },
  )
}

function summarizeZValues(
  values: readonly (number | undefined)[],
  options: {
    readonly transcriptCount: number
    readonly missingZCount: number
    readonly hitTranscriptLimit: boolean
    readonly minQv: number
    readonly binCount: number
  },
): CellTranscriptZDistribution {
  const zValues = values.filter(
    (zLocation): zLocation is number =>
      zLocation !== undefined && Number.isFinite(zLocation),
  )

  if (zValues.length === 0) {
    return {
      bins: [],
      transcriptCount: options.transcriptCount,
      zCount: 0,
      missingZCount: options.missingZCount,
      maxBinCount: 0,
      hitTranscriptLimit: options.hitTranscriptLimit,
      minQv: options.minQv,
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
      transcriptCount: options.transcriptCount,
      zCount: zValues.length,
      missingZCount: options.missingZCount,
      minZ,
      maxZ,
      maxBinCount: zValues.length,
      hitTranscriptLimit: options.hitTranscriptLimit,
      minQv: options.minQv,
    }
  }

  const binCount = options.binCount
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
    transcriptCount: options.transcriptCount,
    zCount: zValues.length,
    missingZCount: options.missingZCount,
    minZ,
    maxZ,
    maxBinCount,
    hitTranscriptLimit: options.hitTranscriptLimit,
    minQv: options.minQv,
  }
}

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeMinQv(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_CELL_TRANSCRIPT_MIN_QV
  }

  return value
}
