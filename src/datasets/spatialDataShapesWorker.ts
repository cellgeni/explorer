import { asyncBufferFromUrl } from 'hyparquet'
import type { AsyncBuffer } from 'hyparquet'
import {
  readSpatialDataShapes,
  type ReadSpatialDataShapesOptions,
  type SpatialDataShapes,
  type SpatialDataShapesReader,
} from './spatialDataShapes'
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

export interface SpatialDataShapesWorkerLike {
  onmessage: ((event: MessageEvent<SpatialDataShapesWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: SpatialDataShapesWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

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
            fetch: options.fetcher,
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
  const { file, signal } = options

  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<SpatialDataShapes>((resolve, reject) => {
    let finished = false
    const finish = () => {
      finished = true
      signal?.removeEventListener('abort', handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const handleAbort = () => {
      finish()
      reject(abortError(signal))
    }
    // Zipped entries and fetched ranges come back in buffers of their own,
    // so each slice is transferred rather than copied.
    const sendSlice = (file: AsyncBuffer, id: number, start: number, end: number) => {
      Promise.resolve()
        .then(() => file.slice(start, end))
        .then(
          (bytes) => {
            if (!finished) {
              worker.postMessage({ type: 'slice', id, bytes }, [bytes])
            }
          },
          (cause: unknown) => {
            if (!finished) {
              worker.postMessage({
                type: 'slice-error',
                id,
                error: cause instanceof Error ? cause.message : String(cause),
              })
            }
          },
        )
    }

    worker.onmessage = (event) => {
      const response = event.data

      if (response.type === 'slice') {
        if (file !== undefined) {
          sendSlice(file, response.id, response.start, response.end)
        }

        return
      }

      finish()

      if (response.type === 'shapes') {
        resolve(response.shapes)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'SpatialDataShapesWorkerError'
      reject(error)
    }
    // The worker did not load or crashed: read on this thread instead.
    worker.onerror = (event) => {
      finish()
      event.preventDefault()
      resolve(readSpatialDataShapes(options))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      const layout = {
        ...(options.idColumn === undefined ? {} : { idColumn: options.idColumn }),
        ...(options.planeColumn === undefined
          ? {}
          : { planeColumn: options.planeColumn }),
        ...(options.wholeFile === undefined ? {} : { wholeFile: options.wholeFile }),
      }
      worker.postMessage({
        type: 'read',
        source,
        affine: options.affine,
        ...(Object.keys(layout).length === 0 ? {} : { layout }),
      })
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}

function createDefaultSpatialDataShapesWorker(): SpatialDataShapesWorkerLike {
  return new Worker(new URL('../workers/spatialDataShapes.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('SpatialData shapes request aborted.')
  error.name = 'AbortError'
  return error
}
