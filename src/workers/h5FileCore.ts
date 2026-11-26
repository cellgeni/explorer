import {
  featureBarcodeMatrixH5Reader,
  type H5FileLike,
} from '../data/featureBarcodeMatrixH5'
import {
  createVisiumFeatureSliceCache,
  gexFromVisiumFeatureSliceLoadedH5,
  readVisiumFeatureSliceMetadata,
  type H5FileLike as FeatureSliceH5FileLike,
  type VisiumFeatureSliceCache,
} from '../data/visiumFeatureSliceH5'
import { transferablesOf } from './h5FileTransfer'
import { previewH5Dataset, walkH5Structure } from './h5StructureCore'
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
import {
  H5_RANGE_UNSUPPORTED_ERROR,
  type H5FileRangeStats,
  type H5FileSlice,
  type H5FileSource,
  type H5FileWorkerRequest,
  type H5FileWorkerResponse,
  type H5TreeAttrs,
  type H5TreeGroup,
  type H5TreeNode,
} from './h5FileMessages'
import { fetchWithRetry } from '../data/fetchRetry'

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
            tree = request.tree
              ? h5TreeGroup(opened.h5wasm, opened.file, h5TreeScope(request.treePaths))
              : null
            throwRangeError(opened)
          } catch (error) {
            closeH5File(opened)
            throw opened.range?.takeError() ?? error
          }

          open = opened
          respond(
            { id: request.id, ok: true, op: 'open', tree, range: rangeStats(opened) },
            [],
          )
          return
        }
        case 'read': {
          const current = expectOpen()
          const entity = current.file.get(request.path)

          if (!(entity instanceof current.h5wasm.Dataset)) {
            throw new Error(`H5 path ${request.path} is not a dataset.`)
          }

          const value =
            request.slice === undefined
              ? entity.value
              : entity.slice(h5wasmRanges(request.slice))
          throwRangeError(current)
          respond({ id: request.id, ok: true, op: 'read', value }, transferablesOf(value))
          return
        }
        case 'tree': {
          const current = expectOpen()
          const tree = h5TreeGroup(
            current.h5wasm,
            current.file,
            h5TreeScope(request.paths),
          )
          throwRangeError(current)
          respond({ id: request.id, ok: true, op: 'tree', tree }, [])
          return
        }
        case 'structure': {
          const current = expectOpen()
          const structure = walkH5Structure(
            current.h5wasm,
            current.file,
            request.rootName,
            {
              ...(request.maxNodes === undefined ? {} : { maxNodes: request.maxNodes }),
              onProgress: (count) => {
                respond({ id: request.id, ok: true, op: 'progress', count }, [])
              },
              check: () => {
                throwRangeError(current)
              },
            },
          )
          respond({ id: request.id, ok: true, op: 'structure', structure }, [])
          return
        }
        case 'preview': {
          const current = expectOpen()
          const entity = current.file.get(request.path)
          throwRangeError(current)

          if (!(entity instanceof current.h5wasm.Dataset)) {
            throw new Error(`H5 path ${request.path} is not a dataset.`)
          }

          const preview = previewH5Dataset(await current.h5wasm.ready, entity, () => {
            throwRangeError(current)
          })
          respond({ id: request.id, ok: true, op: 'preview', preview }, [])
          return
        }
        case 'stats': {
          respond(
            { id: request.id, ok: true, op: 'stats', range: rangeStats(expectOpen()) },
            [],
          )
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
        case 'feature-slice-metadata': {
          const current = expectOpen()
          const metadata =
            featureSlice?.metadata ??
            readVisiumFeatureSliceMetadata(
              current.file as unknown as FeatureSliceH5FileLike,
            )
          throwRangeError(current)
          respond(
            { id: request.id, ok: true, op: 'feature-slice-metadata', metadata },
            [],
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

function rangeStats(open: OpenH5File): H5FileRangeStats | null {
  return open.range === null
    ? null
    : { size: open.range.cache.size, ...open.range.cache.stats() }
}

// h5wasm takes `[]` for a whole dimension.
function h5wasmRanges(slice: H5FileSlice): ([] | [number, number])[] {
  return slice.map((range) => (range === null ? [] : [range[0], range[1]]))
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

  if (options.createRangeRead === undefined) {
    if (source.rangeOnly === true) {
      throw rangeUnsupportedError(`${source.label} cannot be read by range here.`)
    }

    return openH5File(await fetchWholeFile(source))
  }

  return openUrlByRange(source, options.createRangeRead)
}

function rangeUnsupportedError(message: string): Error {
  const error = new Error(message)
  error.name = H5_RANGE_UNSUPPORTED_ERROR
  return error
}

async function fetchWholeFile(source: UrlSource): Promise<Uint8Array> {
  const response = await fetchWithRetry(source.url)

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
  const response = await fetchWithRetry(source.url, {
    headers: { Range: `bytes=0-${RANGE_FIRST_FETCH_BYTES - 1}` },
  })

  if (!response.ok) {
    throw new Error(`${source.label} returned HTTP ${response.status}.`)
  }

  // A server that ignores Range sends the whole file.
  if (response.status !== 206) {
    if (source.rangeOnly === true) {
      await response.body?.cancel().catch(() => undefined)
      throw rangeUnsupportedError(
        `${source.label} ignored a range request (HTTP ${response.status}).`,
      )
    }

    return openH5File(new Uint8Array(await response.arrayBuffer()))
  }

  const head = new Uint8Array(await response.arrayBuffer())
  const size =
    contentRangeSize(response.headers.get('content-range')) ??
    (await headContentLength(source.url))

  // HDF5 needs the file's size, so a file of unknown size is read whole.
  if (size === null) {
    if (source.rangeOnly === true) {
      throw rangeUnsupportedError(`${source.label} did not give its size.`)
    }

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

// The children a walk visits below a group: by name, each with its own scope.
// Null visits every child, and theirs.
type H5TreeScope = ReadonlyMap<string, H5TreeScope> | null

type H5TreeScopeBuilder = Map<string, H5TreeScopeBuilder | null>

function h5TreeScope(paths: readonly string[] | undefined): H5TreeScope {
  if (paths === undefined) {
    return null
  }

  const root: H5TreeScopeBuilder = new Map()

  for (const path of paths) {
    const parts = path.split('/').filter((part) => part.length > 0)
    let scope = root

    for (const [index, part] of parts.entries()) {
      const child = scope.get(part)

      if (index === parts.length - 1) {
        scope.set(part, null)
        break
      }

      // A path below one walked whole adds nothing.
      if (child === null) {
        break
      }

      const next: H5TreeScopeBuilder = child ?? new Map()
      scope.set(part, next)
      scope = next
    }
  }

  return root
}

function h5TreeGroup(
  h5wasm: H5wasm,
  group: H5wasmGroup,
  scope: H5TreeScope = null,
): H5TreeGroup {
  const children: (readonly [string, H5TreeNode])[] = []

  for (const name of group.keys()) {
    if (scope !== null && !scope.has(name)) {
      continue
    }

    const child = h5TreeNode(h5wasm, group.get(name), scope?.get(name) ?? null)

    if (child !== null) {
      children.push([name, child])
    }
  }

  return { kind: 'group', attrs: h5TreeAttrs(group), children }
}

// Links, committed datatypes and references are left out, as the readers only
// walk groups and datasets.
function h5TreeNode(
  h5wasm: H5wasm,
  entity: unknown,
  scope: H5TreeScope,
): H5TreeNode | null {
  if (entity instanceof h5wasm.Group) {
    return h5TreeGroup(h5wasm, entity, scope)
  }

  if (entity instanceof h5wasm.Dataset) {
    const metadata = datasetMetadata(entity)
    return {
      kind: 'dataset',
      attrs: h5TreeAttrs(entity),
      shape: metadata?.shape ?? null,
      itemSize: metadata?.size ?? null,
    }
  }

  return null
}

function datasetMetadata(
  dataset: H5wasmDataset,
): { readonly shape: readonly number[] | null; readonly size: number } | null {
  try {
    return dataset.metadata
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
