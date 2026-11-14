import { readZipEntry, type ReadZipEntryOptions, type ZipEntry } from './zipArchive'
import type {
  ZipEntryWorkerRequest,
  ZipEntryWorkerResponse,
} from '../workers/zipEntryMessages'

// Reads a zip entry in a worker of its own, so fetching and inflating an
// entry of a few hundred MB stays off the main thread. The worker exits once
// it has answered; an abort terminates it.

export interface ZipEntryWorkerLike {
  onmessage: ((event: MessageEvent<ZipEntryWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ZipEntryWorkerRequest): void
  terminate(): void
}

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
      : readInWorker(workerFactory(), url, entry, options)
}

export const readZipEntryInWorker = zipEntryWorkerReader()

function readInWorker(
  worker: ZipEntryWorkerLike,
  url: string,
  entry: ZipEntry,
  options: ReadZipEntryOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const { signal } = options

  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
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
        options.onProgress?.(response.received, response.total)
        return
      }

      finish()

      if (response.type === 'entry') {
        resolve(new Uint8Array(response.bytes))
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'ZipEntryWorkerError'
      reject(error)
    }
    // The worker did not load or crashed: read on this thread instead.
    worker.onerror = (event) => {
      finish()
      event.preventDefault()
      resolve(readZipEntry(url, entry, options))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      worker.postMessage({ type: 'read', url, entry })
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}

function createDefaultZipEntryWorker(): ZipEntryWorkerLike {
  return new Worker(new URL('../workers/zipEntry.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Zip entry request aborted.')
  error.name = 'AbortError'
  return error
}
