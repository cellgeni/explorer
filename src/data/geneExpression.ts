import { datasetFileUrl } from './datasetFiles'
import {
  formatGeneExpressionStageTiming,
  geneExpressionStageTiming,
  type GeneExpressionStageTiming,
} from './geneExpressionTiming'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { BBox } from './coords'
import type {
  GeneExpressionBatch,
  GeneExpressionQueryOptions,
} from '../datasets/xeniumDataset'
import type { DatasetRangeValidator } from './datasetOverview'

export interface LoadDatasetGeneExpressionOptions extends GeneExpressionQueryOptions {
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
}

export async function loadDatasetGeneExpression(
  baseUrl: string,
  bbox: BBox,
  genes: readonly string[],
  options: LoadDatasetGeneExpressionOptions = {},
): Promise<GeneExpressionBatch> {
  if (genes.length === 0) {
    return {
      cells: [],
      genes: [],
      maxCount: 0,
    }
  }

  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const stageTimings: GeneExpressionStageTiming[] = []
  const onStageTiming = (timing: GeneExpressionStageTiming) => {
    stageTimings.push(timing)
    options.onStageTiming?.(timing)
  }

  const rangeStartedAt = Date.now()
  await validateRangeSupport(datasetFileUrl(baseUrl, 'cell_feature_matrix.zarr.zip'), {
    label: 'cell_feature_matrix.zarr.zip',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  onStageTiming(
    geneExpressionStageTiming(
      'range-check',
      'Feature matrix Range check',
      rangeStartedAt,
      'cell_feature_matrix.zarr.zip',
    ),
  )
  throwIfAborted(options.signal)

  const datasetStartedAt = Date.now()
  const dataset = await cachedXeniumDataset(baseUrl)
  onStageTiming(
    geneExpressionStageTiming(
      'dataset-cache',
      'Cached dataset lookup',
      datasetStartedAt,
      baseUrl.replace(/\/+$/, ''),
    ),
  )
  throwIfAborted(options.signal)

  const batch = await dataset.geneExpression(bbox, genes, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.sampleStride === undefined ? {} : { sampleStride: options.sampleStride }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onStageTiming,
  })

  if (batch.timing === undefined) {
    return batch
  }

  return {
    ...batch,
    timing: {
      ...batch.timing,
      stageTimings,
      stageSummary: stageTimings.map(formatGeneExpressionStageTiming).join('; '),
    },
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

  const error = new Error('Gene expression request aborted.')
  error.name = 'AbortError'
  return error
}
