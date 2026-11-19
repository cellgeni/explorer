import type { SpatialDataShapes } from './spatialDataShapes'
import {
  readVectorSegmentation,
  type ReadVectorSegmentationOptions,
} from './vectorSegmentation'
import type {
  VectorSegmentationWorkerRequest,
  VectorSegmentationWorkerResponse,
} from '../workers/vectorSegmentationMessages'

// Reads a polygon segmentation in a worker of its own, so parsing a file of
// hundreds of megabytes and building the shape columns stay off the main
// thread. The worker fetches a URL itself or reads the picked file, and exits
// once it has answered; an abort terminates it.

export interface VectorSegmentationWorkerLike {
  onmessage: ((event: MessageEvent<VectorSegmentationWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: VectorSegmentationWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export type VectorSegmentationWorkerFactory = () => VectorSegmentationWorkerLike

export type VectorSegmentationReader = (
  options: ReadVectorSegmentationOptions,
) => Promise<SpatialDataShapes>

// Reads on this thread where there is no Worker (Vitest's jsdom), with a
// custom fetcher or compressors, and when the worker fails to run.
export function vectorSegmentationWorkerReader(
  workerFactory: VectorSegmentationWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultVectorSegmentationWorker,
): VectorSegmentationReader {
  return (options) =>
    workerFactory === null ||
    options.fetcher !== undefined ||
    options.compressors !== undefined
      ? readVectorSegmentation(options)
      : readInWorker(workerFactory(), options)
}

export const readVectorSegmentationInWorker = vectorSegmentationWorkerReader()

function readInWorker(
  worker: VectorSegmentationWorkerLike,
  options: ReadVectorSegmentationOptions,
): Promise<SpatialDataShapes> {
  const { signal } = options

  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<SpatialDataShapes>((resolve, reject) => {
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
        options.onProgress?.(response.shapeCount)
        return
      }

      finish()

      if (response.type === 'shapes') {
        resolve(response.shapes)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'VectorSegmentationWorkerError'
      reject(error)
    }
    // The worker did not load or crashed: read on this thread instead.
    worker.onerror = (event) => {
      finish()
      event.preventDefault()
      resolve(readVectorSegmentation(options))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      worker.postMessage({
        type: 'read',
        file: options.file,
        format: options.format,
        micrometersPerUnit: options.micrometersPerUnit,
      })
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}

function createDefaultVectorSegmentationWorker(): VectorSegmentationWorkerLike {
  return new Worker(new URL('../workers/vectorSegmentation.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Segmentation read aborted.')
  error.name = 'AbortError'
  return error
}
