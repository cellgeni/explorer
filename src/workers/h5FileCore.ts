import {
  featureBarcodeMatrixH5Reader,
  type H5FileLike,
} from '../data/featureBarcodeMatrixH5'
import {
  createVisiumFeatureSliceCache,
  gexFromVisiumFeatureSliceLoadedH5,
  type H5FileLike as FeatureSliceH5FileLike,
  type VisiumFeatureSliceCache,
} from '../data/visiumFeatureSliceH5'
import { transferablesOf } from './h5FileTransfer'
import { gexPayloadTransferables, packGexResult } from './h5MatrixCellsPayload'
import {
  contentRangeSize,
  mountRangeFile,
  type MountedRangeFile,
  type RangeFileSystem,
} from './h5RangeFile'
import {
  RANGE_FIRST_FETCH_BYTES,
  RangeBlockCache,
  type SyncRangeRead,
} from './rangeBlockCache'
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

export interface H5FileHandlerOptions {
  // Synchronous range reads, which only a worker can make. Without them a URL
  // source is fetched whole.
  readonly createRangeRead?: (url: string, label: string) => SyncRangeRead
  readonly maxKeptMatrixBarcodes?: number
}

// A matrix reader indexes every barcode in a Map: about 283 MB for the 3.4
// million of a Visium HD 2 µm matrix. One with more barcodes than this is built
// again for each request, as the per-request workers before did, rather than
// kept for the session; the Xenium demo's 1.4 million are kept.
const MAX_KEPT_MATRIX_BARCODES = 2_000_000

interface OpenH5File {
  readonly h5wasm: H5wasm
  readonly fs: H5wasmFs
  readonly file: H5wasmFile
  readonly fileName: string
  // Set when the file is read by range. Its read errors are checked after
  // every h5wasm call, which returns uninitialised values for a failed read.
  readonly range: MountedRangeFile | null
}

interface H5wasmFs extends RangeFileSystem {
  writeFile(path: string, data: Uint8Array, options?: { readonly canOwn?: boolean }): void
}

type UrlSource = Extract<H5FileSource, { readonly kind: 'url' }>

type MatrixReader = ReturnType<typeof featureBarcodeMatrixH5Reader>

// Unique within a thread; the in-process handler shares h5wasm's file system
// with any other main-thread user.
let nextFileNumber = 1

export function createH5FileHandler(
  respond: H5FileResponder,
  options: H5FileHandlerOptions = {},
): H5FileHandler {
  let open: OpenH5File | null = null
  let matrixReader: MatrixReader | null = null
  let featureSlice: VisiumFeatureSliceCache | null = null
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

          const opened = await openSource(request.source, options)
          let tree: H5TreeGroup | null

          try {
            tree = request.tree ? h5TreeGroup(opened.h5wasm, opened.file) : null
            throwRangeError(opened)
          } catch (error) {
            closeH5File(opened)
            throw opened.range?.takeError() ?? error
          }

          open = opened
          respond({ id: request.id, ok: true, op: 'open', tree }, [])
          return
        }
        case 'read': {
          const current = expectOpen()
          const entity = current.file.get(request.path)

          if (!(entity instanceof current.h5wasm.Dataset)) {
            throw new Error(`H5 path ${request.path} is not a dataset.`)
          }

          const value = entity.value
          throwRangeError(current)
          respond({ id: request.id, ok: true, op: 'read', value }, transferablesOf(value))
          return
        }
        case 'matrix-cells': {
          const current = expectOpen()
          // Kept only once its reads are known to be good.
          const reader =
            matrixReader ??
            featureBarcodeMatrixH5Reader(current.file as unknown as H5FileLike)
          throwRangeError(current)
          matrixReader =
            reader.barcodeCount <=
            (options.maxKeptMatrixBarcodes ?? MAX_KEPT_MATRIX_BARCODES)
              ? reader
              : null
          const cells = packGexResult(reader(request.elementIds))
          throwRangeError(current)
          respond(
            { id: request.id, ok: true, op: 'matrix-cells', cells },
            gexPayloadTransferables(cells),
          )
          return
        }
        case 'feature-slice': {
          const current = expectOpen()
          // Its metadata and gene index, kept once known to be good.
          const slice =
            featureSlice ??
            createVisiumFeatureSliceCache(
              current.file as unknown as FeatureSliceH5FileLike,
            )
          throwRangeError(current)
          featureSlice = slice
          const cells = packGexResult(
            gexFromVisiumFeatureSliceLoadedH5(slice, request.targets, request.genes, {
              binSizeMicrometers: request.binSizeMicrometers,
            }),
          )
          throwRangeError(current)
          respond(
            { id: request.id, ok: true, op: 'feature-slice', cells },
            gexPayloadTransferables(cells),
          )
          return
        }
      }
    } catch (thrown) {
      // A failed range read explains whatever h5wasm threw after it.
      const cause = open?.range?.takeError() ?? thrown
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
      featureSlice = null

      if (current !== null) {
        closeH5File(current)
      }
    },
  }
}

function throwRangeError(open: OpenH5File): void {
  const error = open.range?.takeError()

  if (error) {
    throw error
  }
}

function closeH5File(open: OpenH5File): void {
  try {
    open.file.close()
  } catch {
    // Closing is best effort; the file system entry is removed below.
  }

  try {
    open.fs.unlink(open.fileName)
  } catch {
    // The entry is gone already.
  }
}

async function openSource(
  source: H5FileSource,
  options: H5FileHandlerOptions,
): Promise<OpenH5File> {
  if (source.kind === 'bytes') {
    return openH5File(source.bytes)
  }

  return options.createRangeRead === undefined
    ? openH5File(await fetchWholeFile(source))
    : openUrlByRange(source, options.createRangeRead)
}

async function fetchWholeFile(source: UrlSource): Promise<Uint8Array> {
  const response = await fetch(source.url)

  if (!response.ok) {
    throw new Error(`${source.label} returned HTTP ${response.status}.`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

// The first request reads the start of the file, where HDF5 keeps its
// superblock and root group, and tells whether the server answers ranges.
async function openUrlByRange(
  source: UrlSource,
  createRangeRead: (url: string, label: string) => SyncRangeRead,
): Promise<OpenH5File> {
  const response = await fetch(source.url, {
    headers: { Range: `bytes=0-${RANGE_FIRST_FETCH_BYTES - 1}` },
  })

  if (!response.ok) {
    throw new Error(`${source.label} returned HTTP ${response.status}.`)
  }

  const head = new Uint8Array(await response.arrayBuffer())

  // A server that ignores Range sends the whole file.
  if (response.status !== 206) {
    return openH5File(head)
  }

  const size =
    contentRangeSize(response.headers.get('content-range')) ??
    (await headContentLength(source.url))

  // HDF5 needs the file's size, so a file of unknown size is read whole.
  if (size === null) {
    return openH5File(await fetchWholeFile(source))
  }

  if (head.byteLength >= size) {
    return openH5File(head.subarray(0, size))
  }

  if (head.byteLength !== RANGE_FIRST_FETCH_BYTES) {
    throw new Error(
      `${source.label} returned ${head.byteLength} bytes for its first ${RANGE_FIRST_FETCH_BYTES}.`,
    )
  }

  const cache = new RangeBlockCache(size, createRangeRead(source.url, source.label), {
    head,
  })
  const { h5wasm, fs } = await loadH5wasm()
  const fileName = nextFileName()
  const range = mountRangeFile(fs, fileName.slice(1), cache)

  return openFileSystemEntry(h5wasm, fs, fileName, range)
}

// Content-Length is readable under CORS where Content-Range often is not.
async function headContentLength(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const size = Number(response.headers.get('content-length') ?? Number.NaN)

    return response.ok && Number.isSafeInteger(size) && size > 0 ? size : null
  } catch {
    return null
  }
}

async function loadH5wasm(): Promise<{ readonly h5wasm: H5wasm; readonly fs: H5wasmFs }> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  return { h5wasm, fs: FS as unknown as H5wasmFs }
}

function nextFileName(): string {
  const fileName = `/h5-file-${nextFileNumber}.h5`
  nextFileNumber += 1
  return fileName
}

async function openH5File(bytes: Uint8Array): Promise<OpenH5File> {
  const { h5wasm, fs } = await loadH5wasm()
  const fileName = nextFileName()

  // MEMFS keeps `bytes` rather than copying them; they were transferred here
  // or are not used again.
  fs.writeFile(fileName, bytes, { canOwn: true })
  return openFileSystemEntry(h5wasm, fs, fileName, null)
}

function openFileSystemEntry(
  h5wasm: H5wasm,
  fs: H5wasmFs,
  fileName: string,
  range: MountedRangeFile | null,
): OpenH5File {
  try {
    const file = new h5wasm.File(fileName, 'r')
    const rangeError = range?.takeError()

    if (rangeError) {
      throw rangeError
    }

    // h5wasm returns a file with a negative ID, rather than throwing, when
    // HDF5 cannot open the bytes.
    if (file.file_id < 0n) {
      throw new Error('The file is not a readable HDF5 file.')
    }

    return { h5wasm, fs, file, fileName, range }
  } catch (cause) {
    const error = range?.takeError() ?? cause
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
