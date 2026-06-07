import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { loadTranscriptZarrViewport } from './transcriptZarr'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { CellId } from './cellid'
import { micrometers, type BBox, type DataPoint } from './coords'
import type { DatasetRangeValidator } from './datasetOverview'
import type { TranscriptPoint } from './transcriptOverlay'
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
  readonly loadTranscriptViewport?: typeof loadTranscriptZarrViewport
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly minQv?: number
  readonly binCount?: number
  readonly bbox?: BBox
  readonly boundaryPolygon?: readonly DataPoint[]
  readonly allowSlowCellIdScan?: boolean
}

export async function loadDatasetCellTranscriptDistribution(
  baseUrl: string,
  cellId: CellId,
  options: LoadDatasetCellTranscriptDistributionOptions = {},
): Promise<CellTranscriptZDistribution> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const limit = normalizePositiveInteger(
    options.limit,
    CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  )
  const minQv = normalizeMinQv(options.minQv)
  const binCount = normalizePositiveInteger(
    options.binCount,
    CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  )

  if (options.boundaryPolygon !== undefined) {
    const boundaryPolygon = options.boundaryPolygon
    const bbox = options.bbox ?? polygonBbox(boundaryPolygon)
    const url = datasetFileUrl(baseUrl, 'transcripts.zarr.zip')

    await validateRangeSupport(url, {
      label: 'transcripts.zarr.zip',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    throwIfAborted(options.signal)

    const result = await (options.loadTranscriptViewport ?? loadTranscriptZarrViewport)(
      url,
      bbox,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        pointLimit: limit,
        groupLimit: 1,
        minQv,
        geneOnly: false,
      },
    )
    throwIfAborted(options.signal)

    return summarizeTranscriptPointZDistribution(
      result.points.filter((point) => pointInPolygon(point.position, boundaryPolygon)),
      {
        hitTranscriptLimit: result.hitPointLimit,
        minQv,
        binCount,
      },
    )
  }

  if (options.allowSlowCellIdScan !== true) {
    throw new Error(
      'Cell transcript z distribution needs a selected-cell boundary polygon. Cell-id scans over transcripts.parquet are disabled for interactive loading.',
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

  if (typeof dataset.cellTranscriptZDistributionForCellId === 'function') {
    const distribution = await dataset.cellTranscriptZDistributionForCellId(cellId, {
      limit,
      minQv,
      binCount,
      ...(options.bbox === undefined ? {} : { bbox: options.bbox }),
    })

    throwIfAborted(options.signal)
    return distribution
  }

  const transcripts = await dataset.transcriptsForCellId(cellId, { limit, minQv })
  throwIfAborted(options.signal)

  return summarizeCellTranscriptZDistribution(transcripts, {
    hitTranscriptLimit: transcripts.length >= limit,
    minQv,
    binCount,
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

function summarizeTranscriptPointZDistribution(
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

function polygonBbox(points: readonly DataPoint[]): BBox {
  if (points.length === 0) {
    throw new Error('Cell transcript z distribution needs a non-empty boundary polygon.')
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function pointInPolygon(point: DataPoint, polygon: readonly DataPoint[]): boolean {
  if (polygon.length < 3) {
    return false
  }

  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]

    if (current === undefined || previous === undefined) {
      continue
    }

    const crossesY =
      (current.y > point.y && previous.y <= point.y) ||
      (previous.y > point.y && current.y <= point.y)

    if (!crossesY) {
      continue
    }

    const intersectionX =
      current.x + ((point.y - current.y) * (previous.x - current.x)) /
        (previous.y - current.y)

    if (intersectionX >= point.x) {
      inside = !inside
    }
  }

  return inside
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
