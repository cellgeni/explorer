import { aggregateGex, gexFromCellFeatureMatrixH5 } from './gex'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
import type { CellId } from './cellid'
import type { DatasetRangeValidator } from './datasetOverview'
import type { CellFeatureMatrixReadOptions, GexResult } from './gex'
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

export type RoiGeneStatsSampleStrategy = 'stratified' | 'head'

interface RoiGeneStatsDataset {
  matrix(ids: readonly CellId[]): Promise<GexResult>
  matrixForCells?(cells: readonly DatasetCell[]): Promise<GexResult>
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
  readonly sampleStrategy?: RoiGeneStatsSampleStrategy
  readonly allowTranscriptFallback?: boolean
  readonly onFallback?: FallbackNotifier
  readonly readH5Matrix?: (
    url: string,
    cellIds: readonly CellId[],
    options?: CellFeatureMatrixReadOptions,
  ) => Promise<GexResult>
}

export async function loadDatasetRoiGeneStats(
  baseUrl: string,
  cells: readonly DatasetCell[],
  options: LoadDatasetRoiGeneStatsOptions = {},
): Promise<RoiGeneStats> {
  const cellLimit = normalizeLimit(options.cellLimit, ROI_GENE_STATS_CELL_LIMIT)
  const sampledCells = sampleRoiCells(
    cells,
    cellLimit,
    options.sampleStrategy ?? 'stratified',
  )

  if (sampledCells.length === 0) {
    return emptyRoiGeneStats(cells.length)
  }

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  const sampledCellIds = sampledCells.map((cell) => cell.id)
  const matrix = await loadRoiGeneStatsMatrix(baseUrl, dataset, sampledCells, {
    validateRangeSupport: options.validateRangeSupport ?? assertHttpRangeSupport,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    allowTranscriptFallback: options.allowTranscriptFallback ?? false,
    onFallback: options.onFallback,
    readH5Matrix: options.readH5Matrix ?? gexFromCellFeatureMatrixH5,
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
  cells: readonly DatasetCell[],
  options: {
    readonly validateRangeSupport: DatasetRangeValidator
    readonly signal?: AbortSignal
    readonly allowTranscriptFallback: boolean
    readonly onFallback: FallbackNotifier | undefined
    readonly readH5Matrix: (
      url: string,
      cellIds: readonly CellId[],
      options?: CellFeatureMatrixReadOptions,
    ) => Promise<GexResult>
  },
): Promise<GexResult> {
  let matrixError: unknown
  const cellIds = cells.map((cell) => cell.id)

  try {
    const [matrix] = await Promise.all([
      dataset.matrixForCells === undefined
        ? dataset.matrix(cellIds)
        : dataset.matrixForCells(cells),
      options
        .validateRangeSupport(datasetFileUrl(baseUrl, 'cell_feature_matrix.zarr.zip'), {
          label: 'cell_feature_matrix.zarr.zip',
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
        .then(() => {
          throwIfAborted(options.signal)
        }),
    ])

    return matrix
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    matrixError = error
    notifyFallback(options.onFallback, {
      source: 'ROI genes',
      message:
        'ROI gene stats could not use the native Zarr cell-feature matrix, so the app switched to cell_feature_matrix.h5.',
      action:
        'ROI gene summaries can continue, but the H5 compatibility path may be slower.',
      detail: error instanceof Error ? error.message : String(error),
      coalesceKey: `roi-genes-h5:${baseUrl}`,
    })
  }

  try {
    return await options.readH5Matrix(
      datasetFileUrl(baseUrl, 'cell_feature_matrix.h5'),
      cellIds,
      options.signal === undefined ? {} : { signal: options.signal },
    )
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    if (!options.allowTranscriptFallback || dataset.transcriptsForCellIds === undefined) {
      throw unsupportedRoiGeneStatsError(matrixError, error)
    }

    notifyFallback(options.onFallback, {
      source: 'ROI genes',
      message:
        'ROI gene stats could not use the Zarr or H5 cell-feature matrix, so the app switched to transcript aggregation.',
      action:
        'This fallback is intended for explicit compatibility paths and may be slower than matrix-backed summaries.',
      detail: error instanceof Error ? error.message : String(error),
      coalesceKey: `roi-genes-transcripts:${baseUrl}`,
    })
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
  strategy: RoiGeneStatsSampleStrategy,
): readonly DatasetCell[] {
  if (cells.length <= cellLimit) {
    return cells
  }

  if (strategy === 'head') {
    return cells.slice(0, cellLimit)
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

function unsupportedRoiGeneStatsError(zarrCause: unknown, h5Cause: unknown): Error {
  const message =
    'ROI gene stats need native CSC arrays in cell_feature_matrix.zarr.zip or a readable cell_feature_matrix.h5 fallback. ' +
    'The available matrix sources could not provide per-cell sparse counts, and transcripts.parquet is too large for the interactive ROI gene panel.'
  const error = new Error(message, {
    cause: { zarr: zarrCause, h5: h5Cause },
  })
  error.name = 'UnsupportedRoiGeneStatsMatrixError'
  return error
}
