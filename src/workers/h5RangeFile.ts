import type { RangeBlockCache, SyncRangeRead } from './rangeBlockCache'

// A remote HDF5 file in h5wasm's file system, read by range on demand, so
// h5wasm reads only the parts of a file a reader asks for. Emscripten's own
// `createLazyFile` is not used: it fetches the whole file when CORS hides
// `Accept-Ranges` (CELLxGENE's S3, GEO), aborts the wasm module on a failed
// request, and accepts a 200 reply to a range request as the range.

// The parts of Emscripten's FS this file uses. h5wasm exports FS untyped.
export interface RangeFileSystem {
  createFile(
    parent: string,
    name: string,
    properties: object,
    canRead: boolean,
    canWrite: boolean,
  ): EmscriptenFileNode
  unlink(path: string): void
  readonly ErrnoError: new (errno: number) => Error
}

interface EmscriptenFileNode {
  stream_ops: object
}

export interface MountedRangeFile {
  readonly path: string
  readonly cache: RangeBlockCache
  // The first read failure since the last call, which clears it. h5wasm does
  // not check HDF5's read status, so a dataset read over a failed range comes
  // back as uninitialised values (or a wasm trap, for strings); callers check
  // this after every h5wasm call. Unlink `path` to remove the file.
  takeError(): Error | null
}

// Emscripten's errno for EIO.
const EIO = 29

export function mountRangeFile(
  fs: RangeFileSystem,
  name: string,
  cache: RangeBlockCache,
): MountedRangeFile {
  const path = `/${name}`
  const node = fs.createFile('/', name, {}, true, false)
  let error: Error | null = null

  // MEMFS reads a file's size, for stat and seeks from the end, from here.
  Object.defineProperty(node, 'usedBytes', { get: () => cache.size })
  node.stream_ops = {
    ...node.stream_ops,
    read(
      _stream: unknown,
      buffer: Int8Array,
      offset: number,
      length: number,
      position: number,
    ): number {
      try {
        return cache.readInto(
          new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length),
          position,
        )
      } catch (cause) {
        error ??= cause instanceof Error ? cause : new Error(String(cause))
        // An ErrnoError reaches HDF5 as a failed read; anything else would
        // unwind through the wasm stack.
        throw new fs.ErrnoError(EIO)
      }
    },
  }

  return {
    path,
    cache,
    takeError() {
      const current = error
      error = null
      return current
    },
  }
}

export interface XhrRangeReadOptions {
  readonly timeoutMs?: number
  readonly attempts?: number
  readonly createRequest?: () => XMLHttpRequest
}

const DEFAULT_RANGE_TIMEOUT_MS = 120_000
const DEFAULT_RANGE_ATTEMPTS = 3

// Synchronous range requests, allowed for binary responses only in workers.
// A dropped connection or a timeout is retried at once; an HTTP error is not.
// Content-Range is often hidden by CORS, so a reply is checked by its status
// and length.
export function createXhrRangeRead(
  url: string,
  label: string,
  options: XhrRangeReadOptions = {},
): SyncRangeRead {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_RANGE_ATTEMPTS)
  const createRequest = options.createRequest ?? (() => new XMLHttpRequest())

  return (start, end) => {
    const range = `bytes ${start}-${end - 1}`
    let failure: unknown = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const request = createRequest()
      request.open('GET', url, false)
      request.responseType = 'arraybuffer'
      request.timeout = options.timeoutMs ?? DEFAULT_RANGE_TIMEOUT_MS
      request.setRequestHeader('Range', `bytes=${start}-${end - 1}`)

      try {
        request.send()
      } catch (cause) {
        failure = cause
        continue
      }

      if (request.status === 0) {
        failure = new Error(`${label} ${range} failed without an HTTP status.`)
        continue
      }

      if (request.status === 200) {
        throw new Error(`${label} ignored a range request (HTTP 200 for ${range}).`)
      }

      if (request.status !== 206) {
        throw new Error(`${label} returned HTTP ${request.status} for ${range}.`)
      }

      const body = request.response as ArrayBuffer | null
      const byteLength = body?.byteLength ?? 0

      if (body === null || byteLength !== end - start) {
        throw new Error(
          `${label} returned ${byteLength} bytes for ${range} (${end - start} expected).`,
        )
      }

      return new Uint8Array(body)
    }

    const reason = failure instanceof Error ? failure.message : String(failure)
    throw new Error(`${label} ${range} failed after ${attempts} attempts: ${reason}`)
  }
}

// The total size in a Content-Range header (`bytes 0-1023/4096`), or null
// when the header is missing, hidden by CORS, or gives no size.
export function contentRangeSize(header: string | null): number | null {
  const match = header === null ? null : /^bytes \d+-\d+\/(\d+)$/i.exec(header.trim())
  const size = match?.[1] === undefined ? Number.NaN : Number(match[1])

  return Number.isSafeInteger(size) ? size : null
}
