import {
  cellsOverviewFromColumns,
  notifyMissingCellOverviewColumns,
  readCellsOverview,
} from './hyparquetCells'
import type {
  CellOverviewPoint,
  CellsOverviewColumns,
  ReadCellsOverviewOptions,
} from './hyparquetCells'
import type {
  CellsOverviewWorkerRequest,
  CellsOverviewWorkerResponse,
} from '../workers/cellsOverviewMessages'

// Reads the cells.parquet overview in a worker of its own, so fetching and
// decoding the columns stay off the main thread. The main thread only turns
// the transferred columns into cells. The worker exits once it has answered;
// an abort terminates it, which cancels its requests.

export interface CellsOverviewWorkerLike {
  onmessage: ((event: MessageEvent<CellsOverviewWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: CellsOverviewWorkerRequest): void
  terminate(): void
}

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

  const columns = await readColumnsInWorker(
    workerFactory(),
    {
      url: options.url,
      includeCellIds: options.includeCellIds !== false,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    },
    options.signal,
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

function readColumnsInWorker(
  worker: CellsOverviewWorkerLike,
  request: CellsOverviewWorkerRequest,
  signal: AbortSignal | undefined,
): Promise<CellsOverviewColumns> {
  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<CellsOverviewColumns>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const handleAbort = () => {
      finish()
      reject(abortError(signal))
    }

    worker.onmessage = (event) => {
      finish()
      const response = event.data

      if (response.ok) {
        resolve(response.columns)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'CellsOverviewWorkerError'
      reject(error)
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'The cells.parquet overview worker failed.'))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      worker.postMessage(request)
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}

function createDefaultCellsOverviewWorker(): CellsOverviewWorkerLike {
  return new Worker(new URL('../workers/cellsOverview.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Cells overview request aborted.')
  error.name = 'AbortError'
  return error
}
