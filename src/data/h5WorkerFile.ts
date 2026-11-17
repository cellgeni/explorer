import { transferablesOf } from '../workers/h5FileTransfer'
import { unpackGexResult } from '../workers/h5MatrixCellsPayload'
import type { SharedLoad } from '../utils/sharedLoad'
import type { GexResult } from './gexTypes'
import type {
  H5FileFeatureSliceTarget,
  H5FileRangeStats,
  H5FileSlice,
  H5FileSource,
  H5FileWorkerRequest,
  H5FileWorkerResponse,
  H5TreeGroup,
  H5TreeNode,
} from '../workers/h5FileMessages'
import type { H5FileHandler, H5FileHandlerOptions } from '../workers/h5FileCore'

// An HDF5 file opened with h5wasm in its own worker, so copying it into
// h5wasm's file system and decoding its datasets stay off the main thread.
// Each file has a worker; terminating it frees the file and h5wasm's heap,
// which cannot shrink.

export interface H5WorkerLike {
  onmessage: ((event: MessageEvent<H5FileWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: H5FileWorkerRequest, transfer: Transferable[]): void
  terminate(): void
}

export type H5WorkerFactory = () => H5WorkerLike

export interface OpenH5WorkerFileOptions {
  // Return the file's groups, datasets and attributes as `tree`.
  readonly tree?: boolean
  // Walk only these paths and the groups above them (see `H5FileOpenRequest`).
  readonly treePaths?: readonly string[]
  readonly signal?: AbortSignal
  readonly workerFactory?: H5WorkerFactory
}

export interface OpenH5WorkerFileFromUrlOptions extends OpenH5WorkerFileOptions {
  // Fail with an error named `H5_RANGE_UNSUPPORTED_ERROR`, rather than read the
  // file whole, when the server does not answer range requests.
  readonly rangeOnly?: boolean
}

export interface H5WorkerFileReadOptions {
  // A hyperslab of a numeric dataset rather than its whole value.
  readonly slice?: H5FileSlice
  readonly signal?: AbortSignal
}

export interface H5WorkerFile {
  readonly tree: H5TreeGroup | null
  // The file's size and the range reads that opened it; null unless it is
  // read by range.
  readonly range: H5FileRangeStats | null
  // A dataset's whole value: a typed array, strings, or a scalar; or a slice.
  read(path: string, options?: H5WorkerFileReadOptions): Promise<unknown>
  // The range reads made so far; null unless the file is read by range.
  rangeStats(): Promise<H5FileRangeStats | null>
  // Rows of a 10x feature-barcode matrix (`/matrix`) by barcode.
  matrixCells<ElementId extends string>(
    elementIds: readonly ElementId[],
    signal?: AbortSignal,
  ): Promise<GexResult<ElementId>>
  // Selected genes of a Visium HD feature_slice.h5 for bins of one size.
  featureSlice<ElementId extends string>(
    targets: readonly (H5FileFeatureSliceTarget & { readonly id: ElementId })[],
    genes: readonly string[],
    binSizeMicrometers: number,
    signal?: AbortSignal,
  ): Promise<GexResult<ElementId>>
  close(): void
}

type H5FileWorkerSuccess = Extract<H5FileWorkerResponse, { readonly ok: true }>

// The node at a slash-separated path below `group`, or undefined.
export function h5TreeNodeAt(group: H5TreeGroup, path: string): H5TreeNode | undefined {
  let current: H5TreeNode | undefined = group

  for (const part of path.split('/')) {
    if (part.length === 0) {
      continue
    }

    current =
      current?.kind === 'group'
        ? current.children.find(([name]) => name === part)?.[1]
        : undefined
  }

  return current
}

// Closes `file` and removes it from a cache of files kept open per URL, so the
// next read opens the file in a new worker. A read that fails partway, such as
// a range request, can leave h5wasm's module in a bad state.
export function dropSharedH5WorkerFile(
  cache: Map<string, SharedLoad<H5WorkerFile>>,
  url: string,
  file: H5WorkerFile,
): void {
  const entry = cache.get(url)

  if (entry !== undefined) {
    void entry.promise.then((cached) => {
      if (cached === file && cache.get(url) === entry) {
        cache.delete(url)
      }
    })
  }

  file.close()
}

// Terminates a worker whose file is no longer referenced, for readers such as
// an H5AD dataset that have no close step.
const workerRegistry =
  typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<H5WorkerConnection>((connection) => {
        connection.terminate()
      })

// `bytes` is transferred to the worker, so it is unusable afterwards.
export function openH5WorkerFile(
  bytes: Uint8Array,
  options: OpenH5WorkerFileOptions = {},
): Promise<H5WorkerFile> {
  return openH5WorkerFileFromSource({ kind: 'bytes', bytes }, options)
}

// The worker reads the file itself, by range when the server allows it, so
// h5wasm fetches only what is read. An abort during the open terminates the
// worker, which cancels the download. `label` names the file in an HTTP error.
export function openH5WorkerFileFromUrl(
  url: string,
  label: string,
  options: OpenH5WorkerFileFromUrlOptions = {},
): Promise<H5WorkerFile> {
  return openH5WorkerFileFromSource(
    {
      kind: 'url',
      url,
      label,
      ...(options.rangeOnly === true ? { rangeOnly: true } : {}),
    },
    options,
  )
}

async function openH5WorkerFileFromSource(
  source: H5FileSource,
  options: OpenH5WorkerFileOptions,
): Promise<H5WorkerFile> {
  const connection = new H5WorkerConnection(
    (options.workerFactory ?? createDefaultH5Worker)(),
  )

  try {
    const response = await connection.request(
      (id) => ({
        id,
        op: 'open',
        source,
        tree: options.tree === true,
        ...(options.treePaths === undefined ? {} : { treePaths: options.treePaths }),
      }),
      source.kind === 'bytes' ? transferablesOf(source.bytes) : [],
      options.signal,
    )

    if (response.op !== 'open') {
      throw new Error('The H5 file worker answered an open with another reply.')
    }

    return createH5WorkerFile(connection, response.tree, response.range)
  } catch (error) {
    connection.terminate()
    throw error
  }
}

function createH5WorkerFile(
  connection: H5WorkerConnection,
  tree: H5TreeGroup | null,
  range: H5FileRangeStats | null,
): H5WorkerFile {
  const file: H5WorkerFile = {
    tree,
    range,
    async read(path, options = {}) {
      const response = await connection.request(
        (id) => ({
          id,
          op: 'read',
          path,
          ...(options.slice === undefined ? {} : { slice: options.slice }),
        }),
        [],
        options.signal,
      )
      return response.op === 'read' ? response.value : undefined
    },
    async rangeStats() {
      const response = await connection.request((id) => ({ id, op: 'stats' }), [])
      return response.op === 'stats' ? response.range : null
    },
    async matrixCells(elementIds, signal) {
      const response = await connection.request(
        (id) => ({ id, op: 'matrix-cells', elementIds: [...elementIds] }),
        [],
        signal,
      )

      if (response.op !== 'matrix-cells') {
        throw new Error('The H5 file worker answered a matrix read with another reply.')
      }

      return unpackGexResult(response.cells)
    },
    async featureSlice(targets, genes, binSizeMicrometers, signal) {
      const response = await connection.request(
        (id) => ({
          id,
          op: 'feature-slice',
          targets: targets.map((target) => ({
            id: target.id,
            row: target.row,
            col: target.col,
          })),
          genes: [...genes],
          binSizeMicrometers,
        }),
        [],
        signal,
      )

      if (response.op !== 'feature-slice') {
        throw new Error(
          'The H5 file worker answered a Feature Slice read with another reply.',
        )
      }

      return unpackGexResult(response.cells)
    },
    close() {
      workerRegistry?.unregister(file)
      connection.terminate()
    },
  }

  workerRegistry?.register(file, connection, file)
  return file
}

interface QueuedRequest {
  readonly message: (id: number) => H5FileWorkerRequest
  readonly transfer: Transferable[]
  readonly resolve: (response: H5FileWorkerSuccess) => void
  readonly reject: (error: Error) => void
}

// Holds no reference to the file object, so the registry above can collect it.
// Requests go to the worker one at a time. Its reads block, by range on a
// remote file, so a request still waiting here can be cancelled, and a viewer
// that moves on does not leave the reads it no longer wants ahead of its next.
class H5WorkerConnection {
  private readonly worker: H5WorkerLike
  private readonly waiting: QueuedRequest[] = []
  // `request` is null once its caller has stopped waiting for the reply.
  private sent: { readonly id: number; request: QueuedRequest | null } | null = null
  private nextRequestId = 1
  private failure: Error | null = null

  constructor(worker: H5WorkerLike) {
    this.worker = worker
    worker.onmessage = (event) => {
      const response = event.data
      const sent = this.sent

      if (sent === null || sent.id !== response.id) {
        return
      }

      this.sent = null

      if (response.ok) {
        sent.request?.resolve(response)
      } else {
        const error = new Error(response.error)
        error.name = response.errorName ?? 'H5FileWorkerError'
        sent.request?.reject(error)
      }

      this.sendNext()
    }
    worker.onerror = (event) => {
      this.fail(new Error(event.message || 'The H5 file worker failed.'))
    }
  }

  request(
    message: (id: number) => H5FileWorkerRequest,
    transfer: Transferable[],
    signal?: AbortSignal,
  ): Promise<H5FileWorkerSuccess> {
    if (this.failure !== null) {
      return Promise.reject(this.failure)
    }

    if (signal?.aborted === true) {
      return Promise.reject(abortError(signal))
    }

    return new Promise<H5FileWorkerSuccess>((resolve, reject) => {
      const handleAbort = () => {
        const index = this.waiting.indexOf(request)

        if (index >= 0) {
          this.waiting.splice(index, 1)
        } else if (this.sent?.request === request) {
          // The worker finishes it; the next request waits for that.
          this.sent.request = null
        } else {
          return
        }

        request.reject(abortError(signal as AbortSignal))
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', handleAbort)
      }
      const request: QueuedRequest = {
        message,
        transfer,
        resolve: (response) => {
          cleanup()
          resolve(response)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
      this.waiting.push(request)
      this.sendNext()
    })
  }

  terminate(): void {
    this.fail(new Error('The H5 file was closed.'))
    this.worker.terminate()
  }

  private sendNext(): void {
    if (this.sent !== null || this.failure !== null) {
      return
    }

    const request = this.waiting.shift()

    if (request === undefined) {
      return
    }

    const id = this.nextRequestId
    this.nextRequestId += 1
    this.sent = { id, request }

    try {
      this.worker.postMessage(request.message(id), request.transfer)
    } catch (cause) {
      this.sent = null
      request.reject(cause instanceof Error ? cause : new Error(String(cause)))
      this.sendNext()
    }
  }

  private fail(error: Error): void {
    this.failure ??= error
    const sent = this.sent?.request ?? null
    this.sent = null
    sent?.reject(error)

    for (const request of this.waiting.splice(0)) {
      request.reject(error)
    }
  }
}

function createDefaultH5Worker(): H5WorkerLike {
  if (typeof Worker === 'undefined') {
    return createInProcessH5Worker()
  }

  return new Worker(new URL('../workers/h5File.worker.ts', import.meta.url), {
    type: 'module',
  })
}

// Runs the worker's handler on this thread, for environments without Worker.
// Tests pass `createRangeRead` to read a URL by range as the worker does.
export function createInProcessH5Worker(
  handlerOptions: H5FileHandlerOptions = {},
): H5WorkerLike {
  let handler: Promise<H5FileHandler> | null = null
  let terminated = false
  const worker: H5WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      handler ??= import('../workers/h5FileCore').then(({ createH5FileHandler }) =>
        createH5FileHandler((response) => {
          if (!terminated) {
            worker.onmessage?.({ data: response } as MessageEvent<H5FileWorkerResponse>)
          }
        }, handlerOptions),
      )
      void handler.then((current) => (terminated ? undefined : current.handle(message)))
    },
    terminate() {
      terminated = true
      void handler?.then((current) => {
        current.close()
      })
    },
  }

  return worker
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('H5 file request aborted.')
  error.name = 'AbortError'
  return error
}
