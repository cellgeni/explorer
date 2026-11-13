import {
  featureBarcodeMatrixH5Reader,
  type H5FileLike,
} from '../data/featureBarcodeMatrixH5'
import { transferablesOf } from './h5FileTransfer'
import { gexPayloadTransferables, packGexResult } from './h5MatrixCellsPayload'
import type {
  H5FileSource,
  H5FileWorkerRequest,
  H5FileWorkerResponse,
  H5TreeAttrs,
  H5TreeGroup,
  H5TreeNode,
} from './h5FileMessages'

// The H5 file worker's handler. It also runs on the main thread where there is
// no Worker (Vitest's jsdom), through `createInProcessH5FileWorker`.

type H5wasm = typeof import('h5wasm').default
type H5wasmFile = InstanceType<H5wasm['File']>
type H5wasmGroup = InstanceType<H5wasm['Group']>
type H5wasmDataset = InstanceType<H5wasm['Dataset']>

export type H5FileResponder = (
  response: H5FileWorkerResponse,
  transfer: Transferable[],
) => void

export interface H5FileHandler {
  handle(request: H5FileWorkerRequest): Promise<void>
  close(): void
}

interface OpenH5File {
  readonly h5wasm: H5wasm
  readonly fs: H5wasmFs
  readonly file: H5wasmFile
  readonly fileName: string
}

interface H5wasmFs {
  writeFile(path: string, data: Uint8Array): void
  unlink(path: string): void
}

type MatrixReader = ReturnType<typeof featureBarcodeMatrixH5Reader>

// Unique within a thread; the in-process handler shares h5wasm's file system
// with any other main-thread user.
let nextFileNumber = 1

export function createH5FileHandler(respond: H5FileResponder): H5FileHandler {
  let open: OpenH5File | null = null
  let matrixReader: MatrixReader | null = null
  // Requests run one at a time, in order, so a read sent right after `open`
  // waits for the file.
  let queue: Promise<void> = Promise.resolve()

  const expectOpen = (): OpenH5File => {
    if (open === null) {
      throw new Error('The H5 file is not open.')
    }

    return open
  }

  const processRequest = async (request: H5FileWorkerRequest): Promise<void> => {
    try {
      switch (request.op) {
        case 'open': {
          if (open !== null) {
            throw new Error('The H5 file worker already holds a file.')
          }

          open = await openH5File(await sourceBytes(request.source))
          respond(
            {
              id: request.id,
              ok: true,
              op: 'open',
              tree: request.tree ? h5TreeGroup(open.h5wasm, open.file) : null,
            },
            [],
          )
          return
        }
        case 'read': {
          const { h5wasm, file } = expectOpen()
          const entity = file.get(request.path)

          if (!(entity instanceof h5wasm.Dataset)) {
            throw new Error(`H5 path ${request.path} is not a dataset.`)
          }

          const value = entity.value
          respond({ id: request.id, ok: true, op: 'read', value }, transferablesOf(value))
          return
        }
        case 'matrix-cells': {
          matrixReader ??= featureBarcodeMatrixH5Reader(
            expectOpen().file as unknown as H5FileLike,
          )
          const cells = packGexResult(matrixReader(request.elementIds))
          respond(
            { id: request.id, ok: true, op: 'matrix-cells', cells },
            gexPayloadTransferables(cells),
          )
          return
        }
      }
    } catch (cause) {
      respond(
        {
          id: request.id,
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
          ...(cause instanceof Error && cause.name.length > 0
            ? { errorName: cause.name }
            : {}),
        },
        [],
      )
    }
  }

  return {
    handle(request) {
      const run = queue.then(() => processRequest(request))
      queue = run
      return run
    },
    close() {
      const current = open
      open = null
      matrixReader = null

      if (current === null) {
        return
      }

      try {
        current.file.close()
      } catch {
        // Closing is best effort; the file system entry is removed below.
      }

      try {
        current.fs.unlink(current.fileName)
      } catch {
        // The entry is gone already.
      }
    },
  }
}

async function sourceBytes(source: H5FileSource): Promise<Uint8Array> {
  if (source.kind === 'bytes') {
    return source.bytes
  }

  const response = await fetch(source.url)

  if (!response.ok) {
    throw new Error(`${source.label} returned HTTP ${response.status}.`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

async function openH5File(bytes: Uint8Array): Promise<OpenH5File> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fs = FS as unknown as H5wasmFs
  const fileName = `/h5-file-${nextFileNumber}.h5`
  nextFileNumber += 1

  fs.writeFile(fileName, bytes)

  try {
    const file = new h5wasm.File(fileName, 'r')

    // h5wasm returns a file with a negative ID, rather than throwing, when
    // HDF5 cannot open the bytes.
    if (file.file_id < 0n) {
      throw new Error('The file is not a readable HDF5 file.')
    }

    return { h5wasm, fs, file, fileName }
  } catch (error) {
    try {
      fs.unlink(fileName)
    } catch {
      // The open error is more useful than a cleanup failure.
    }

    throw error
  }
}

function h5TreeGroup(h5wasm: H5wasm, group: H5wasmGroup): H5TreeGroup {
  const children: (readonly [string, H5TreeNode])[] = []

  for (const name of group.keys()) {
    const child = h5TreeNode(h5wasm, group.get(name))

    if (child !== null) {
      children.push([name, child])
    }
  }

  return { kind: 'group', attrs: h5TreeAttrs(group), children }
}

// Links, committed datatypes and references are left out, as the readers only
// walk groups and datasets.
function h5TreeNode(h5wasm: H5wasm, entity: unknown): H5TreeNode | null {
  if (entity instanceof h5wasm.Group) {
    return h5TreeGroup(h5wasm, entity)
  }

  if (entity instanceof h5wasm.Dataset) {
    return { kind: 'dataset', attrs: h5TreeAttrs(entity), shape: datasetShape(entity) }
  }

  return null
}

function datasetShape(dataset: H5wasmDataset): readonly number[] | null {
  try {
    return dataset.shape
  } catch {
    return null
  }
}

// An attribute h5wasm cannot read (an unsupported dtype) is left out, as the
// main-thread reader only met it when it asked for that attribute.
function h5TreeAttrs(entity: H5wasmGroup | H5wasmDataset): H5TreeAttrs {
  const attrs: (readonly [string, unknown])[] = []
  let records: Record<string, { readonly value: unknown }>

  try {
    records = entity.attrs
  } catch {
    return attrs
  }

  for (const [name, attribute] of Object.entries(records)) {
    try {
      attrs.push([name, attribute.value])
    } catch {
      // Skipped; see above.
    }
  }

  return attrs
}
