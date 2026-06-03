import { aggregateGex } from './gex'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { CellId } from './cellid'
import type { DatasetRangeValidator } from './datasetOverview'
import type { GexResult } from './gex'
import type { DatasetCell } from '../datasets/xeniumDataset'

export const ROI_GENE_STATS_CELL_LIMIT = 10_000
export const ROI_GENE_STATS_GENE_LIMIT = 10

export interface RoiGeneStat {
  readonly gene: string
  readonly count: number
  readonly detectedCells: number
  readonly percentCells: number
  readonly meanPerCell: number
  readonly percentTotal: number
}

export interface RoiGeneStats {
  readonly genes: readonly RoiGeneStat[]
  readonly cellCount: number
  readonly sampledCellCount: number
  readonly totalCount: number
  readonly hitCellLimit: boolean
}

interface RoiGeneStatsDataset {
  matrix(ids: readonly CellId[]): Promise<GexResult>
  transcriptsForCellIds?(cellIds: readonly CellId[], minQv?: number): Promise<GexResult>
}

export interface LoadDatasetRoiGeneStatsOptions {
  readonly getDataset?: (
    baseUrl: string,
  ) => RoiGeneStatsDataset | Promise<RoiGeneStatsDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly cellLimit?: number
  readonly geneLimit?: number
  readonly allowTranscriptFallback?: boolean
}

export async function loadDatasetRoiGeneStats(
  baseUrl: string,
  cells: readonly DatasetCell[],
  options: LoadDatasetRoiGeneStatsOptions = {},
): Promise<RoiGeneStats> {
  const cellLimit = normalizeLimit(options.cellLimit, ROI_GENE_STATS_CELL_LIMIT)
  const sampledCells = sampleRoiCells(cells, cellLimit)

  if (sampledCells.length === 0) {
    return emptyRoiGeneStats(cells.length)
  }

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  const sampledCellIds = sampledCells.map((cell) => cell.id)
  const matrix = await loadRoiGeneStatsMatrix(baseUrl, dataset, sampledCellIds, {
    validateRangeSupport: options.validateRangeSupport ?? assertHttpRangeSupport,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    allowTranscriptFallback: options.allowTranscriptFallback ?? false,
  })
  throwIfAborted(options.signal)

  return summarizeRoiGeneExpression(matrix, {
    cellCount: cells.length,
    sampledCellIds,
    geneLimit: normalizeLimit(options.geneLimit, ROI_GENE_STATS_GENE_LIMIT),
  })
}

export function summarizeRoiGeneExpression(
  matrix: GexResult,
  options: {
    readonly cellCount: number
    readonly sampledCellIds: readonly CellId[]
    readonly geneLimit?: number
  },
): RoiGeneStats {
  const sampledCellCount = options.sampledCellIds.length
  const geneLimit = normalizeLimit(options.geneLimit, ROI_GENE_STATS_GENE_LIMIT)

  if (sampledCellCount === 0) {
    return emptyRoiGeneStats(options.cellCount)
  }

  const detectedCellCounts = new Map<string, number>()

  for (const cellId of options.sampledCellIds) {
    const cell = matrix.cells.get(cellId)

    if (cell === undefined) {
      continue
    }

    for (let index = 0; index < cell.geneNames.length; index += 1) {
      const gene = cell.geneNames[index]
      const count = cell.counts[index]

      if (gene === undefined || count === undefined || count <= 0) {
        continue
      }

      detectedCellCounts.set(gene, (detectedCellCounts.get(gene) ?? 0) + 1)
    }
  }

  const aggregatedGenes = aggregateGex(matrix.cells)
  let totalCount = 0

  for (const gene of aggregatedGenes) {
    totalCount += gene.count
  }

  return {
    genes: aggregatedGenes.slice(0, geneLimit).map(({ gene, count }) => ({
      gene,
      count,
      detectedCells: detectedCellCounts.get(gene) ?? 0,
      percentCells: ((detectedCellCounts.get(gene) ?? 0) / sampledCellCount) * 100,
      meanPerCell: count / sampledCellCount,
      percentTotal: totalCount === 0 ? 0 : (count / totalCount) * 100,
    })),
    cellCount: options.cellCount,
    sampledCellCount,
    totalCount,
    hitCellLimit: sampledCellCount < options.cellCount,
  }
}

async function loadRoiGeneStatsMatrix(
  baseUrl: string,
  dataset: RoiGeneStatsDataset,
  cellIds: readonly CellId[],
  options: {
    readonly validateRangeSupport: DatasetRangeValidator
    readonly signal?: AbortSignal
    readonly allowTranscriptFallback: boolean
  },
): Promise<GexResult> {
  try {
    await options.validateRangeSupport(
      datasetFileUrl(baseUrl, 'cell_feature_matrix.zarr.zip'),
      {
        label: 'cell_feature_matrix.zarr.zip',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    )
    throwIfAborted(options.signal)

    return await dataset.matrix(cellIds)
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    if (!options.allowTranscriptFallback || dataset.transcriptsForCellIds === undefined) {
      throw unsupportedRoiGeneStatsError(error)
    }
  }

  await options.validateRangeSupport(datasetFileUrl(baseUrl, 'transcripts.parquet'), {
    label: 'transcripts.parquet',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  return dataset.transcriptsForCellIds(cellIds)
}

function sampleRoiCells(
  cells: readonly DatasetCell[],
  cellLimit: number,
): readonly DatasetCell[] {
  if (cells.length <= cellLimit) {
    return cells
  }

  const sampledCells: DatasetCell[] = []
  const stride = cells.length / cellLimit

  for (let index = 0; index < cellLimit; index += 1) {
    const cell = cells[Math.floor(index * stride)]

    if (cell !== undefined) {
      sampledCells.push(cell)
    }
  }

  return sampledCells
}

function emptyRoiGeneStats(cellCount: number): RoiGeneStats {
  return {
    genes: [],
    cellCount,
    sampledCellCount: 0,
    totalCount: 0,
    hitCellLimit: false,
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.floor(value))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('ROI gene stats request aborted.')
  error.name = 'AbortError'
  return error
}

function unsupportedRoiGeneStatsError(cause: unknown): Error {
  const message =
    'ROI gene stats need a cell-major cell_feature_matrix reader. ' +
    'The available Zarr matrix could not provide per-cell sparse counts, and transcripts.parquet is too large for the interactive ROI gene panel.'
  const error = new Error(message, { cause })
  error.name = 'UnsupportedRoiGeneStatsMatrixError'
  return error
}
