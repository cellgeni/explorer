import { asyncBufferFromUrl } from 'hyparquet'
import { datasetFileLabelFor, datasetFileUrlFor } from './datasetFiles'
import {
  clearCellFeatureMatrixZarrCache,
  warmCellFeatureMatrixZarr,
  type CellFeatureMatrixZarrCapability,
} from './gex'
import {
  DEFAULT_PARQUET_FOOTER_CACHE_BYTES,
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from './persistentByteRangeCache'
import { assertHttpRangeSupport } from './rangeSupport'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { AsyncBuffer } from 'hyparquet'
import type { DatasetRangeValidator } from './datasetOverview'
import type { XeniumDataset } from '../datasets/xeniumDataset'

export interface WarmDatasetForRoiOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly warmMatrix?: (url: string) => Promise<CellFeatureMatrixZarrCapability | void>
  readonly onCellFeatureMatrixCapability?: (
    capability: CellFeatureMatrixZarrCapability,
  ) => void
  readonly prefetchParquetFooter?: (
    url: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>
  readonly signal?: AbortSignal
}

export interface WarmDatasetForRoiResult {
  readonly cellFeatureMatrix: CellFeatureMatrixZarrCapability | null
}

export async function warmDatasetForRoi(
  baseUrl: string,
  options: WarmDatasetForRoiOptions = {},
): Promise<WarmDatasetForRoiResult> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
  const warmMatrix = options.warmMatrix ?? warmCellFeatureMatrixZarr
  const cellsUrl = datasetFileUrlFor(baseUrl, 'cells')
  const boundariesUrl = datasetFileUrlFor(baseUrl, 'cellBoundaries')
  const matrixUrl = datasetFileUrlFor(baseUrl, 'cellFeatureMatrix')
  const datasetPromise =
    options.getDataset === undefined
      ? cachedXeniumDataset(baseUrl)
      : Promise.resolve(options.getDataset(baseUrl))

  clearCellFeatureMatrixZarrCache(matrixUrl)
  const matrixWarmup = warmMatrix(matrixUrl).then((capability) => {
    const normalizedCapability = capability ?? null

    if (normalizedCapability !== null) {
      options.onCellFeatureMatrixCapability?.(normalizedCapability)
    }

    return normalizedCapability
  })

  const [, , , cellFeatureMatrix] = await Promise.all([
    datasetPromise.then((dataset) => dataset.warm()),
    warmRangeReadableFile(
      cellsUrl,
      datasetFileLabelFor(baseUrl, 'cells'),
      validateRangeSupport,
      options,
    ),
    warmRangeReadableDatasetFile(
      matrixUrl,
      datasetFileLabelFor(baseUrl, 'cellFeatureMatrix'),
      validateRangeSupport,
      options,
    ),
    matrixWarmup,
    warmRangeReadableFile(
      boundariesUrl,
      datasetFileLabelFor(baseUrl, 'cellBoundaries'),
      validateRangeSupport,
      options,
    ).catch(noop),
  ])
  throwIfAborted(options.signal)

  return { cellFeatureMatrix }
}

async function warmRangeReadableDatasetFile(
  url: string,
  label: string,
  validateRangeSupport: DatasetRangeValidator,
  options: { readonly signal?: AbortSignal },
): Promise<void> {
  await validateRangeSupport(url, {
    label,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)
}

async function warmRangeReadableFile(
  url: string,
  label: string,
  validateRangeSupport: DatasetRangeValidator,
  options: {
    readonly prefetchParquetFooter?: (
      url: string,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<void>
    readonly signal?: AbortSignal
  },
): Promise<void> {
  await validateRangeSupport(url, {
    label,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)
  await (options.prefetchParquetFooter ?? prefetchParquetFooter)(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

async function prefetchParquetFooter(
  url: string,
  options: { readonly signal?: AbortSignal },
): Promise<void> {
  const file = await asyncBufferFromUrl({
    url,
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
  const cachedFile = cacheFooterByteRanges(file, {
    cache: defaultPersistentByteRangeCache(),
    url,
  }) as AsyncBuffer
  const start = Math.max(0, cachedFile.byteLength - DEFAULT_PARQUET_FOOTER_CACHE_BYTES)

  await cachedFile.slice(start, cachedFile.byteLength)
  throwIfAborted(options.signal)
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

  const error = new Error('Dataset warmup aborted.')
  error.name = 'AbortError'
  return error
}

function noop(): void {}
