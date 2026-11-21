import { readFeatureBarcodeMex, type FeatureBarcodeMexReader } from './featureBarcodeMex'
import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  FeatureBarcodeMexWorkerRequest,
  FeatureBarcodeMexWorkerResponse,
} from '../workers/featureBarcodeMexMessages'

// Reads a MEX feature-barcode matrix in a worker of its own: inflating and
// parsing millions of text entries stays off the main thread. The worker exits
// once it has answered; an abort terminates it.

export type FeatureBarcodeMexWorkerLike = OneShotWorker<
  FeatureBarcodeMexWorkerRequest,
  FeatureBarcodeMexWorkerResponse
>

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
      : runWorkerOnce(
          workerFactory(),
          { type: 'read', urls: options.urls },
          {
            signal: options.signal,
            fallback: () => readFeatureBarcodeMex(options),
            errorName: 'FeatureBarcodeMexWorkerError',
            onMessage: (response) => {
              if (response.type === 'progress') {
                options.onProgress?.(response.message)
                return undefined
              }

              return response.type === 'matrix' ? { value: response.matrix } : response
            },
          },
        )
}

export const readFeatureBarcodeMexInWorker = featureBarcodeMexWorkerReader()

function createDefaultFeatureBarcodeMexWorker(): FeatureBarcodeMexWorkerLike {
  return new Worker(new URL('../workers/featureBarcodeMex.worker.ts', import.meta.url), {
    type: 'module',
  })
}
