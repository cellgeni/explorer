import { readMerscopeTable, type MerscopeTableReader } from './merscopeTableReader'
import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  MerscopeTableWorkerRequest,
  MerscopeTableWorkerResponse,
} from '../workers/merscopeTableMessages'

// Reads MERSCOPE cell tables in a worker of its own: fetching, gunzipping,
// and parsing dense CSVs of up to 300 MB stay off the main thread. The worker
// exits once it has answered; an abort terminates it.

export type MerscopeTableWorkerLike = OneShotWorker<
  MerscopeTableWorkerRequest,
  MerscopeTableWorkerResponse
>

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
      : runWorkerOnce(
          workerFactory(),
          { type: 'read', files: options.files },
          {
            signal: options.signal,
            fallback: () => readMerscopeTable(options),
            errorName: 'MerscopeTableWorkerError',
            onMessage: (response) => {
              if (response.type === 'progress') {
                options.onProgress?.(response.message)
                return undefined
              }

              return response.type === 'table' ? { value: response.table } : response
            },
          },
        )
}

export const readMerscopeTableInWorker = merscopeTableWorkerReader()

function createDefaultMerscopeTableWorker(): MerscopeTableWorkerLike {
  return new Worker(new URL('../workers/merscopeTable.worker.ts', import.meta.url), {
    type: 'module',
  })
}
