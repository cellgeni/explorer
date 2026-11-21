import type { SpatialDataShapes } from './spatialDataShapes'
import {
  readVectorSegmentation,
  type ReadVectorSegmentationOptions,
} from './vectorSegmentation'
import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  VectorSegmentationWorkerRequest,
  VectorSegmentationWorkerResponse,
} from '../workers/vectorSegmentationMessages'

// Reads a polygon segmentation in a worker of its own, so parsing a file of
// hundreds of megabytes and building the shape columns stay off the main
// thread. The worker fetches a URL itself or reads the picked file, and exits
// once it has answered; an abort terminates it.

export type VectorSegmentationWorkerLike = OneShotWorker<
  VectorSegmentationWorkerRequest,
  VectorSegmentationWorkerResponse
>

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
      : runWorkerOnce(
          workerFactory(),
          {
            type: 'read',
            file: options.file,
            format: options.format,
            micrometersPerUnit: options.micrometersPerUnit,
          },
          {
            signal: options.signal,
            fallback: () => readVectorSegmentation(options),
            errorName: 'VectorSegmentationWorkerError',
            onMessage: (response) => {
              if (response.type === 'progress') {
                options.onProgress?.(response.shapeCount)
                return undefined
              }

              return response.type === 'shapes' ? { value: response.shapes } : response
            },
          },
        )
}

export const readVectorSegmentationInWorker = vectorSegmentationWorkerReader()

function createDefaultVectorSegmentationWorker(): VectorSegmentationWorkerLike {
  return new Worker(new URL('../workers/vectorSegmentation.worker.ts', import.meta.url), {
    type: 'module',
  })
}
