import { datasetFileUrl } from '../data/datasetFiles'
import type { VisiumHdSegmentationIndex } from './visiumHdSegmentationIndex'
import {
  assertSegmentationGeojsonWithinBudget,
  createVisiumHdSegmentationIndexParser,
  type VisiumHdSegmentationIndexParserOptions,
  type VisiumHdSegmentationKind,
  type VisiumHdSegmentationScalefactors,
} from './visiumHdSegmentations'
import type {
  VisiumHdSegmentationIndexWorkerRequest,
  VisiumHdSegmentationIndexWorkerResponse,
} from '../workers/visiumHdSegmentationIndexMessages'
import { abortError, throwIfAborted } from '../utils/abort'

// Reads a Visium HD segmentation GeoJSON into a segmentation index. This
// thread fetches the file, so custom fetchers and the full-file budget apply,
// and hands the body to a worker of its own chunk by chunk; the worker parses
// the features and sends back the columns. The worker exits once it has
// answered; an abort terminates it and cancels the body.

export interface ReadVisiumHdSegmentationIndexOptions {
  readonly path: string
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly kind: VisiumHdSegmentationKind
  readonly maxFullFileBytes?: number
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export type VisiumHdSegmentationIndexReader = (
  baseUrl: string,
  options: ReadVisiumHdSegmentationIndexOptions,
) => Promise<VisiumHdSegmentationIndex>

export interface VisiumHdSegmentationIndexWorkerLike {
  onmessage:
    ((event: MessageEvent<VisiumHdSegmentationIndexWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(
    message: VisiumHdSegmentationIndexWorkerRequest,
    transfer?: Transferable[],
  ): void
  terminate(): void
}

export type VisiumHdSegmentationIndexWorkerFactory =
  () => VisiumHdSegmentationIndexWorkerLike

// Parses on this thread where there is no Worker (Vitest's jsdom), and when
// the worker fails to run.
export function visiumHdSegmentationIndexReader(
  workerFactory: VisiumHdSegmentationIndexWorkerFactory | null = typeof Worker ===
  'undefined'
    ? null
    : createDefaultVisiumHdSegmentationIndexWorker,
): VisiumHdSegmentationIndexReader {
  return async (baseUrl, options) => {
    const url = datasetFileUrl(baseUrl, options.path)
    const fetcher = options.fetcher ?? fetch
    const parserOptions: VisiumHdSegmentationIndexParserOptions = {
      kind: options.kind,
      scalefactors: { micronsPerPixel: options.scalefactors.micronsPerPixel },
    }
    const readOnThisThread = async () =>
      parseOnThisThread(
        await fetchSegmentationGeojson(url, fetcher, options.signal),
        parserOptions,
        options.signal,
      )

    if (options.maxFullFileBytes !== undefined) {
      await assertSegmentationGeojsonWithinBudget(
        url,
        options.maxFullFileBytes,
        fetcher,
        options.signal,
      )
    }

    if (workerFactory === null) {
      return readOnThisThread()
    }

    // Fetched before the worker starts, so a failed request leaves none behind.
    const body = await fetchSegmentationGeojson(url, fetcher, options.signal)

    return parseInWorker(
      workerFactory(),
      body,
      parserOptions,
      options.signal,
      readOnThisThread,
    )
  }
}

export const readVisiumHdSegmentationIndexInWorker = visiumHdSegmentationIndexReader()

async function fetchSegmentationGeojson(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<ReadableStream<Uint8Array>> {
  throwIfAborted(signal)
  const response = await fetcher(url, signal === undefined ? {} : { signal })

  if (!response.ok) {
    throw new Error(
      `Unable to read Visium HD segmentation GeoJSON at ${url}: HTTP ${response.status}`,
    )
  }

  if (response.body === null) {
    throw new Error(`Visium HD segmentation GeoJSON at ${url} has no body.`)
  }

  return response.body
}

async function parseOnThisThread(
  body: ReadableStream<Uint8Array>,
  options: VisiumHdSegmentationIndexParserOptions,
  signal: AbortSignal | undefined,
): Promise<VisiumHdSegmentationIndex> {
  const parser = createVisiumHdSegmentationIndexParser(options)
  const reader = body.getReader()

  try {
    for (;;) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()

      if (done) {
        return parser.finish()
      }

      parser.push(value)
    }
  } catch (cause) {
    // Stops the download.
    await reader.cancel().catch(() => undefined)
    throw cause
  }
}

function parseInWorker(
  worker: VisiumHdSegmentationIndexWorkerLike,
  body: ReadableStream<Uint8Array>,
  options: VisiumHdSegmentationIndexParserOptions,
  signal: AbortSignal | undefined,
  readOnThisThread: () => Promise<VisiumHdSegmentationIndex>,
): Promise<VisiumHdSegmentationIndex> {
  const reader = body.getReader()

  return new Promise<VisiumHdSegmentationIndex>((resolve, reject) => {
    let finished = false
    const finish = () => {
      finished = true
      signal?.removeEventListener('abort', handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      reader.cancel().catch(() => undefined)
    }
    const handleAbort = () => {
      finish()
      reject(abortError(signal))
    }

    worker.onmessage = (event) => {
      const response = event.data
      finish()

      if (response.type === 'index') {
        resolve(response.index)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'VisiumHdSegmentationIndexWorkerError'
      reject(error)
    }
    // The worker did not load or crashed: read on this thread instead.
    worker.onerror = (event) => {
      finish()
      event.preventDefault()
      resolve(readOnThisThread())
    }

    if (signal?.aborted === true) {
      handleAbort()
      return
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    const sendBody = async () => {
      worker.postMessage({ type: 'start', options })

      for (;;) {
        const { done, value } = await reader.read()

        if (finished) {
          return
        }

        if (done) {
          worker.postMessage({ type: 'end' })
          return
        }

        const bytes = transferableBytes(value)
        worker.postMessage({ type: 'chunk', bytes }, [bytes])
      }
    }

    sendBody().catch((cause: unknown) => {
      if (!finished) {
        finish()
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  })
}

// The chunk's own buffer when the chunk fills it, otherwise a copy, so
// transferring never detaches bytes outside the chunk.
function transferableBytes(chunk: Uint8Array): ArrayBuffer {
  if (
    chunk.buffer instanceof ArrayBuffer &&
    chunk.byteOffset === 0 &&
    chunk.byteLength === chunk.buffer.byteLength
  ) {
    return chunk.buffer
  }

  return chunk.slice().buffer
}

function createDefaultVisiumHdSegmentationIndexWorker(): VisiumHdSegmentationIndexWorkerLike {
  return new Worker(
    new URL('../workers/visiumHdSegmentationIndex.worker.ts', import.meta.url),
    { type: 'module' },
  )
}
