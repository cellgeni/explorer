import type { MerscopeTable } from './merscopeFormat'
import {
  readMerscopeTable,
  type MerscopeTableReader,
  type ReadMerscopeTableOptions,
} from './merscopeTableReader'
import type {
  MerscopeTableWorkerRequest,
  MerscopeTableWorkerResponse,
} from '../workers/merscopeTableMessages'

// Reads MERSCOPE cell tables in a worker of its own: fetching, gunzipping,
// and parsing dense CSVs of up to 300 MB stay off the main thread. The worker
// exits once it has answered; an abort terminates it.

export interface MerscopeTableWorkerLike {
  onmessage: ((event: MessageEvent<MerscopeTableWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: MerscopeTableWorkerRequest): void
  terminate(): void
}

export type MerscopeTableWorkerFactory = () => MerscopeTableWorkerLike

// Reads on this thread where there is no Worker (Vitest's jsdom), with a
// custom fetcher, and when the worker fails to run.
export function merscopeTableWorkerReader(
  workerFactory: MerscopeTableWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultMerscopeTableWorker,
): MerscopeTableReader {
  return (options) =>
    workerFactory === null || options.fetcher !== undefined
      ? readMerscopeTable(options)
      : readInWorker(workerFactory(), options)
}

export const readMerscopeTableInWorker = merscopeTableWorkerReader()

function readInWorker(
  worker: MerscopeTableWorkerLike,
  options: ReadMerscopeTableOptions,
): Promise<MerscopeTable> {
  const { signal } = options

  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<MerscopeTable>((resolve, reject) => {
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
      const response = event.data

      if (response.type === 'progress') {
        options.onProgress?.(response.message)
        return
      }

      finish()

      if (response.type === 'table') {
        resolve(response.table)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'MerscopeTableWorkerError'
      reject(error)
    }
    // The worker did not load or crashed: read on this thread instead.
    worker.onerror = (event) => {
      finish()
      event.preventDefault()
      resolve(readMerscopeTable(options))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      worker.postMessage({ type: 'read', files: options.files })
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}

function createDefaultMerscopeTableWorker(): MerscopeTableWorkerLike {
  return new Worker(new URL('../workers/merscopeTable.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('MERSCOPE table request aborted.')
  error.name = 'AbortError'
  return error
}
