import { datasetFileUrl } from './datasetFiles'
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

  await validateRangeSupport(datasetFileUrl(baseUrl, 'cell_feature_matrix.zarr.zip'), {
    label: 'cell_feature_matrix.zarr.zip',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  const dataset = await cachedXeniumDataset(baseUrl)
  throwIfAborted(options.signal)

  return dataset.geneExpression(bbox, genes, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.sampleStride === undefined ? {} : { sampleStride: options.sampleStride }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
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
