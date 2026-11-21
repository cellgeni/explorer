// Loads a cell's transcript z distribution: from transcripts.zarr.zip inside
// the cell's outline, from transcripts.parquet by cell ID through the Xenium
// dataset, or from the selected genes of a per-gene output (Atera). The types
// and summaries these share with the dataset readers are in
// cellTranscripts.ts, which imports no dataset.

import { datasetFileLabelFor, datasetFileUrlFor } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { loadTranscriptZarrViewport } from './transcriptZarr'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import {
  CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  normalizeMinQv,
  normalizePositiveInteger,
  summarizeCellTranscriptZDistribution,
  summarizeTranscriptPointZDistribution,
  type CellTranscriptZDistribution,
} from './cellTranscripts'
import type { CellId } from './cellid'
import { micrometers, type BBox, type DataPoint } from './coords'
import type { DatasetRangeValidator } from './datasetOverview'
import type { PerGeneTranscriptReader } from './roiTranscripts'
import type { XeniumDataset } from '../datasets/xeniumDataset'
import { throwIfAborted } from '../utils/abort'

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
    const url = datasetFileUrlFor(baseUrl, 'transcriptsZarr')

    await validateRangeSupport(url, {
      label: datasetFileLabelFor(baseUrl, 'transcriptsZarr'),
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

export interface LoadPerGeneCellTranscriptDistributionOptions {
  readonly featureNames: readonly string[]
  readonly boundaryPolygon: readonly DataPoint[]
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly minQv?: number
  readonly binCount?: number
}

// A cell's z distribution from a dataset that stores transcripts per gene
// (Atera): the selected genes' transcripts inside the cell outline. Every
// gene would mean reading every row of the tiles the cell touches. With no
// genes selected, nothing is read and the distribution is empty.
export async function loadPerGeneCellTranscriptDistribution(
  readTranscripts: PerGeneTranscriptReader,
  options: LoadPerGeneCellTranscriptDistributionOptions,
): Promise<CellTranscriptZDistribution> {
  const limit = normalizePositiveInteger(
    options.limit,
    CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  )
  const minQv = normalizeMinQv(options.minQv)
  const binCount = normalizePositiveInteger(
    options.binCount,
    CELL_TRANSCRIPT_DISTRIBUTION_BIN_COUNT,
  )
  const { boundaryPolygon, featureNames } = options

  if (featureNames.length === 0) {
    return {
      ...summarizeTranscriptPointZDistribution([], {
        hitTranscriptLimit: false,
        minQv,
        binCount,
      }),
      featureNames,
    }
  }

  const result = await readTranscripts(polygonBbox(boundaryPolygon), {
    featureNames,
    pointLimit: limit,
    groupLimit: 1,
    minQv,
    contains: (point) => pointInPolygon(point, boundaryPolygon),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  return {
    ...summarizeTranscriptPointZDistribution(result.points, {
      hitTranscriptLimit: result.hitPointLimit,
      minQv,
      binCount,
    }),
    featureNames,
  }
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
      current.x +
      ((point.y - current.y) * (previous.x - current.x)) / (previous.y - current.y)

    if (intersectionX >= point.x) {
      inside = !inside
    }
  }

  return inside
}
