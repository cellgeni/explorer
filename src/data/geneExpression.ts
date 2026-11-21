import { datasetFileLabelFor, datasetFileUrlFor } from './datasetFiles'
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
} from '../datasets/spatialDataset'
import type { DatasetRangeValidator } from './datasetOverview'
import { throwIfAborted } from '../utils/abort'

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
      elements: [],
      genes: [],
      population: 'all',
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
  await validateRangeSupport(datasetFileUrlFor(baseUrl, 'cellFeatureMatrix'), {
    label: datasetFileLabelFor(baseUrl, 'cellFeatureMatrix'),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  onStageTiming(
    geneExpressionStageTiming(
      'range-check',
      'Feature matrix Range check',
      rangeStartedAt,
      datasetFileLabelFor(baseUrl, 'cellFeatureMatrix'),
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
