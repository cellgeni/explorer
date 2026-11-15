import {
  readFeatureBarcodeMex,
  type FeatureBarcodeMexReader,
  type ReadFeatureBarcodeMexOptions,
} from './featureBarcodeMex'
import type { FeatureBarcodeMatrix } from './visiumDataset'
import type {
  FeatureBarcodeMexWorkerRequest,
  FeatureBarcodeMexWorkerResponse,
} from '../workers/featureBarcodeMexMessages'

// Reads a MEX feature-barcode matrix in a worker of its own: inflating and
// parsing millions of text entries stays off the main thread. The worker exits
// once it has answered; an abort terminates it.

export interface FeatureBarcodeMexWorkerLike {
  onmessage: ((event: MessageEvent<FeatureBarcodeMexWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: FeatureBarcodeMexWorkerRequest): void
  terminate(): void
}

export type FeatureBarcodeMexWorkerFactory = () => FeatureBarcodeMexWorkerLike

// Reads on this thread where there is no Worker (Vitest's jsdom), with a
// custom fetcher, and when the worker fails to run.
export function featureBarcodeMexWorkerReader(
  workerFactory: FeatureBarcodeMexWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultFeatureBarcodeMexWorker,
): FeatureBarcodeMexReader {
  return (options) =>
    workerFactory === null || options.fetcher !== undefined
      ? readFeatureBarcodeMex(options)
      : readInWorker(workerFactory(), options)
}

export const readFeatureBarcodeMexInWorker = featureBarcodeMexWorkerReader()

function readInWorker(
  worker: FeatureBarcodeMexWorkerLike,
  options: ReadFeatureBarcodeMexOptions,
): Promise<FeatureBarcodeMatrix> {
  const { signal } = options

  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<FeatureBarcodeMatrix>((resolve, reject) => {
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

      if (response.type === 'matrix') {
        resolve(response.matrix)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'FeatureBarcodeMexWorkerError'
      reject(error)
    }
    // The worker did not load or crashed: read on this thread instead.
    worker.onerror = (event) => {
      finish()
      event.preventDefault()
      resolve(readFeatureBarcodeMex(options))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      worker.postMessage({ type: 'read', urls: options.urls })
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}

function createDefaultFeatureBarcodeMexWorker(): FeatureBarcodeMexWorkerLike {
  return new Worker(new URL('../workers/featureBarcodeMex.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('MEX matrix request aborted.')
  error.name = 'AbortError'
  return error
}
