import { readZipEntry, type ReadZipEntryOptions, type ZipEntry } from './zipArchive'
import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  ZipEntryWorkerRequest,
  ZipEntryWorkerResponse,
} from '../workers/zipEntryMessages'

// Reads a zip entry in a worker of its own, so fetching and inflating an
// entry of a few hundred MB stays off the main thread. The worker exits once
// it has answered; an abort terminates it.

export type ZipEntryWorkerLike = OneShotWorker<
  ZipEntryWorkerRequest,
  ZipEntryWorkerResponse
>

export type ZipEntryWorkerFactory = () => ZipEntryWorkerLike

export type ZipEntryReader = (
  url: string,
  entry: ZipEntry,
  options?: ReadZipEntryOptions,
) => Promise<Uint8Array<ArrayBuffer>>

// Reads on this thread where there is no Worker (Vitest's jsdom), with a
// custom fetcher, and when the worker fails to run.
export function zipEntryWorkerReader(
  workerFactory: ZipEntryWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultZipEntryWorker,
): ZipEntryReader {
  return (url, entry, options = {}) =>
    workerFactory === null || options.fetcher !== undefined
      ? readZipEntry(url, entry, options)
      : runWorkerOnce(
          workerFactory(),
          { type: 'read', url, entry },
          {
            signal: options.signal,
            fallback: () => readZipEntry(url, entry, options),
            errorName: 'ZipEntryWorkerError',
            onMessage: (response) => {
              if (response.type === 'progress') {
                options.onProgress?.(response.received, response.total)
                return undefined
              }

              return response.type === 'entry'
                ? { value: new Uint8Array(response.bytes) }
                : response
            },
          },
        )
}

export const readZipEntryInWorker = zipEntryWorkerReader()

function createDefaultZipEntryWorker(): ZipEntryWorkerLike {
  return new Worker(new URL('../workers/zipEntry.worker.ts', import.meta.url), {
    type: 'module',
  })
}
