import { transferablesOf } from '../workers/h5FileTransfer'
import { unpackGexResult } from '../workers/h5MatrixCellsPayload'
import type { GexResult } from './gexTypes'
import type {
  H5FileSource,
  H5FileWorkerRequest,
  H5FileWorkerResponse,
  H5TreeGroup,
  H5TreeNode,
} from '../workers/h5FileMessages'
import type { H5FileHandler } from '../workers/h5FileCore'

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
  readonly signal?: AbortSignal
  readonly workerFactory?: H5WorkerFactory
}

export interface H5WorkerFile {
  readonly tree: H5TreeGroup | null
  // A dataset's whole value: a typed array, strings, or a scalar.
  read(path: string): Promise<unknown>
  // Rows of a 10x feature-barcode matrix (`/matrix`) by barcode.
  matrixCells<ElementId extends string>(
    elementIds: readonly ElementId[],
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

// The worker fetches the whole file itself; an abort terminates it, which
// cancels the download. `label` names the file in an HTTP error.
export function openH5WorkerFileFromUrl(
  url: string,
  label: string,
  options: OpenH5WorkerFileOptions = {},
): Promise<H5WorkerFile> {
  return openH5WorkerFileFromSource({ kind: 'url', url, label }, options)
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
      (id) => ({ id, op: 'open', source, tree: options.tree === true }),
      source.kind === 'bytes' ? transferablesOf(source.bytes) : [],
      options.signal,
    )
    return createH5WorkerFile(connection, response.op === 'open' ? response.tree : null)
  } catch (error) {
    connection.terminate()
    throw error
  }
}

function createH5WorkerFile(
  connection: H5WorkerConnection,
  tree: H5TreeGroup | null,
): H5WorkerFile {
  const file: H5WorkerFile = {
    tree,
    async read(path) {
      const response = await connection.request((id) => ({ id, op: 'read', path }), [])
      return response.op === 'read' ? response.value : undefined
    },
    async matrixCells(elementIds) {
      const response = await connection.request(
        (id) => ({ id, op: 'matrix-cells', elementIds: [...elementIds] }),
        [],
      )

      if (response.op !== 'matrix-cells') {
        throw new Error('The H5 file worker answered a matrix read with another reply.')
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

// Holds no reference to the file object, so the registry above can collect it.
class H5WorkerConnection {
  private readonly worker: H5WorkerLike
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (response: H5FileWorkerSuccess) => void
      readonly reject: (error: Error) => void
    }
  >()
  private nextRequestId = 1
  private failure: Error | null = null

  constructor(worker: H5WorkerLike) {
    this.worker = worker
    worker.onmessage = (event) => {
      const response = event.data
      const entry = this.pending.get(response.id)

      if (entry === undefined) {
        return
      }

      this.pending.delete(response.id)

      if (response.ok) {
        entry.resolve(response)
        return
      }

      const error = new Error(response.error)
      error.name = response.errorName ?? 'H5FileWorkerError'
      entry.reject(error)
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

    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise<H5FileWorkerSuccess>((resolve, reject) => {
      const handleAbort = () => {
        if (signal !== undefined && this.pending.delete(id)) {
          reject(abortError(signal))
        }
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', handleAbort)
      }

      this.pending.set(id, {
        resolve: (response) => {
          cleanup()
          resolve(response)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      })
      signal?.addEventListener('abort', handleAbort, { once: true })

      try {
        this.worker.postMessage(message(id), transfer)
      } catch (cause) {
        this.pending.delete(id)
        cleanup()
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  terminate(): void {
    this.fail(new Error('The H5 file was closed.'))
    this.worker.terminate()
  }

  private fail(error: Error): void {
    this.failure ??= error

    for (const entry of this.pending.values()) {
      entry.reject(error)
    }

    this.pending.clear()
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
export function createInProcessH5Worker(): H5WorkerLike {
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
        }),
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
