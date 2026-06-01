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
  })

  const dataset = await cachedXeniumDataset(baseUrl)

  return dataset.geneExpression(bbox, genes, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  })
}
