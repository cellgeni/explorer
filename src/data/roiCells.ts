import { datasetFileLabelFor, datasetFileUrlFor } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import type { RoiSelectionInput } from './roiSelection'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { DatasetRangeValidator } from './datasetOverview'
import type { DatasetCell, XeniumDataset } from '../datasets/xeniumDataset'

export const ROI_CELL_EXPORT_LIMIT = 50_000

// An ROI's cells, marked when the reader stopped at its limit with more
// inside. Readers that return every cell, as the AnnData platforms do, leave
// it unmarked however many there are.
export type RoiCells = readonly DatasetCell[] & { readonly stoppedAtLimit?: true }

export function roiCellsStoppedAtLimit(cells: RoiCells): boolean {
  return cells.stoppedAtLimit === true
}

// The first `limit` of `cells`, read with a limit one higher: one more cell
// means the ROI holds more than were kept.
export function roiCellsWithin(cells: readonly DatasetCell[], limit: number): RoiCells {
  return cells.length > limit
    ? Object.assign(cells.slice(0, limit), { stoppedAtLimit: true as const })
    : cells
}

export interface LoadDatasetRoiCellsOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly limit?: number
}

export async function loadDatasetRoiCells(
  baseUrl: string,
  selection: RoiSelectionInput,
  options: LoadDatasetRoiCellsOptions = {},
): Promise<RoiCells> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

  await validateRangeSupport(datasetFileUrlFor(baseUrl, 'cells'), {
    label: datasetFileLabelFor(baseUrl, 'cells'),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  const limit = options.limit ?? ROI_CELL_EXPORT_LIMIT
  const cells = await dataset.cells(selection, { limit: limit + 1 })
  throwIfAborted(options.signal)

  return roiCellsWithin(cells, limit)
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
