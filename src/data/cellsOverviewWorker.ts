import {
  cellsOverviewFromColumns,
  notifyMissingCellOverviewColumns,
  readCellsOverview,
} from './hyparquetCells'
import type { CellOverviewPoint, ReadCellsOverviewOptions } from './hyparquetCells'
import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  CellsOverviewWorkerRequest,
  CellsOverviewWorkerResponse,
} from '../workers/cellsOverviewMessages'

// Reads the cells.parquet overview in a worker of its own, so fetching and
// decoding the columns stay off the main thread. The main thread only turns
// the transferred columns into cells. The worker exits once it has answered;
// an abort terminates it, which cancels its requests.

export type CellsOverviewWorkerLike = OneShotWorker<
  CellsOverviewWorkerRequest,
  CellsOverviewWorkerResponse
>

export type CellsOverviewWorkerFactory = () => CellsOverviewWorkerLike

export interface ReadCellsOverviewInWorkerOptions extends ReadCellsOverviewOptions {
  readonly workerFactory?: CellsOverviewWorkerFactory
}

// Reads on this thread where there is no Worker (Vitest's jsdom), and when an
// option cannot be sent to a worker: a file, a fetcher, a reader, compressors
// or a byte-range cache.
export async function readCellsOverviewInWorker(
  options: ReadCellsOverviewInWorkerOptions,
): Promise<readonly CellOverviewPoint[]> {
  const workerFactory =
    options.workerFactory ??
    (typeof Worker === 'undefined' ? null : createDefaultCellsOverviewWorker)

  if (workerFactory === null || options.url === undefined || !workerCanRead(options)) {
    return readCellsOverview(options)
  }

  const columns = await runWorkerOnce(
    workerFactory(),
    {
      url: options.url,
      includeCellIds: options.includeCellIds !== false,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    },
    {
      signal: options.signal,
      errorName: 'CellsOverviewWorkerError',
      failureMessage: 'The cells.parquet overview worker failed.',
      onMessage: (response) => (response.ok ? { value: response.columns } : response),
    },
  )
  notifyMissingCellOverviewColumns(columns.missingColumns, options.onFallback)
  return cellsOverviewFromColumns(columns)
}

function workerCanRead(options: ReadCellsOverviewOptions): boolean {
  return (
    options.file === undefined &&
    options.fetcher === undefined &&
    options.readColumns === undefined &&
    options.compressors === undefined &&
    options.loadCompressors === undefined &&
    options.byteRangeCache === undefined
  )
}

function createDefaultCellsOverviewWorker(): CellsOverviewWorkerLike {
  return new Worker(new URL('../workers/cellsOverview.worker.ts', import.meta.url), {
    type: 'module',
  })
}
