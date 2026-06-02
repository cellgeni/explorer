import type { BBox } from './coords'
import { datasetFileUrl } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { DatasetRangeValidator } from './datasetOverview'
import type { DatasetCell, XeniumDataset } from '../datasets/xeniumDataset'

export const ROI_CELL_EXPORT_LIMIT = 50_000

export interface LoadDatasetRoiCellsOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly limit?: number
}

export async function loadDatasetRoiCells(
  baseUrl: string,
  bbox: BBox,
  options: LoadDatasetRoiCellsOptions = {},
): Promise<readonly DatasetCell[]> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

  await validateRangeSupport(datasetFileUrl(baseUrl, 'cells.parquet'), {
    label: 'cells.parquet',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  const cells = await dataset.cells(bbox, {
    limit: options.limit ?? ROI_CELL_EXPORT_LIMIT,
  })
  throwIfAborted(options.signal)

  return cells
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

  const error = new Error('ROI cell request aborted.')
  error.name = 'AbortError'
  return error
}
