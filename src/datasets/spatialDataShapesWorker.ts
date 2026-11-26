import { asyncBufferFromUrl } from 'hyparquet'
import type { AsyncBuffer } from 'hyparquet'
import { retryingFetch } from '../data/fetchRetry'
import {
  readSpatialDataShapes,
  type ReadSpatialDataShapesOptions,
  type SpatialDataShapes,
  type SpatialDataShapesReader,
} from './spatialDataShapes'
import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  SpatialDataShapesSource,
  SpatialDataShapesWorkerRequest,
  SpatialDataShapesWorkerResponse,
} from '../workers/spatialDataShapesMessages'

// Reads SpatialData shapes in a worker of its own, so decoding the Parquet
// file and building the shape columns stay off the main thread. The worker
// fetches a plain URL itself; a file inside a zipped store, or one behind a
// custom fetcher, is read here and handed over slice by slice. The worker
// exits once it has answered; an abort terminates it.

export type SpatialDataShapesWorkerLike = OneShotWorker<
  SpatialDataShapesWorkerRequest,
  SpatialDataShapesWorkerResponse
>

export type SpatialDataShapesWorkerFactory = () => SpatialDataShapesWorkerLike

// Reads on this thread where there is no Worker (Vitest's jsdom), when
// compressors are given, for a whole-file read with a custom fetcher, and
// when the worker fails to run.
export function spatialDataShapesWorkerReader(
  workerFactory: SpatialDataShapesWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultSpatialDataShapesWorker,
): SpatialDataShapesReader {
  return async (options) => {
    if (
      workerFactory === null ||
      options.compressors !== undefined ||
      (options.wholeFile === true && options.fetcher !== undefined)
    ) {
      return readSpatialDataShapes(options)
    }

    const file =
      options.file ??
      (options.fetcher === undefined
        ? undefined
        : await asyncBufferFromUrl({
            url: options.url,
            fetch: retryingFetch({ fetcher: options.fetcher }),
            ...(options.signal === undefined
              ? {}
              : { requestInit: { signal: options.signal } }),
          }))
    const source: SpatialDataShapesSource =
      file === undefined
        ? { kind: 'url', url: options.url }
        : { kind: 'slices', url: options.url, byteLength: file.byteLength }

    return readInWorker(
      workerFactory(),
      source,
      file === undefined ? options : { ...options, file },
    )
  }
}

export const readSpatialDataShapesInWorker = spatialDataShapesWorkerReader()

function readInWorker(
  worker: SpatialDataShapesWorkerLike,
  source: SpatialDataShapesSource,
  options: ReadSpatialDataShapesOptions,
): Promise<SpatialDataShapes> {
  const { file } = options
  const layout = {
    ...(options.idColumn === undefined ? {} : { idColumn: options.idColumn }),
    ...(options.planeColumn === undefined ? {} : { planeColumn: options.planeColumn }),
    ...(options.wholeFile === undefined ? {} : { wholeFile: options.wholeFile }),
  }

  return runWorkerOnce(
    worker,
    {
      type: 'read',
      source,
      affine: options.affine,
      ...(Object.keys(layout).length === 0 ? {} : { layout }),
    },
    {
      signal: options.signal,
      fallback: () => readSpatialDataShapes(options),
      errorName: 'SpatialDataShapesWorkerError',
      onMessage: (response, send) => {
        if (response.type === 'slice') {
          if (file !== undefined) {
            sendSlice(file, response.id, response.start, response.end, send)
          }

          return undefined
        }

        return response.type === 'shapes' ? { value: response.shapes } : response
      },
    },
  )
}

// Zipped entries and fetched ranges come back in buffers of their own, so each
// slice is transferred rather than copied.
function sendSlice(
  file: AsyncBuffer,
  id: number,
  start: number,
  end: number,
  send: (message: SpatialDataShapesWorkerRequest, transfer?: Transferable[]) => void,
): void {
  Promise.resolve()
    .then(() => file.slice(start, end))
    .then(
      (bytes) => send({ type: 'slice', id, bytes }, [bytes]),
      (cause: unknown) =>
        send({
          type: 'slice-error',
          id,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
    )
}

function createDefaultSpatialDataShapesWorker(): SpatialDataShapesWorkerLike {
  return new Worker(new URL('../workers/spatialDataShapes.worker.ts', import.meta.url), {
    type: 'module',
  })
}
