import {
  readZipEntry,
  ZIP_METHOD_DEFLATED,
  ZIP_METHOD_STORED,
  type ZipDirectory,
  type ZipEntry,
} from './zipArchive'

// A dataset folder shipped as one zip, such as an Atera run's `outs` folder
// zipped whole, read in place. Once detection registers the zip, the URL
// `<zip url>/<path>` names the file `<path>` of the folder inside it, and
// fetch answers it from byte ranges of the zip: readers, probes, and
// diagnostics open the run as they would the unzipped folder.
//
// Only the main thread's fetch is wrapped (installZipFolderFetch). Readers
// that fetch from workers (DuckDB, the H5 and Parquet workers) would still
// ask the host for `<zip url>/<path>`, so only Atera runs, whose files are all
// read on the main thread, are opened from a zip.
//
// A stored (uncompressed) entry is one run of bytes in the zip, so any range
// of it is one range request. A deflated entry can only be inflated from its
// start: it is answered whole, and ranges of it are served only when it is
// small enough to inflate whole.

export interface ZipFolder {
  // The zip's URL; files in it are addressed under `${url}/`.
  readonly url: string
  // Folder inside the zip that holds the dataset, with a trailing slash;
  // empty when the dataset is at the top of the zip.
  readonly root: string
  readonly directory: ZipDirectory
}

export class ZipFolderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipFolderError'
  }
}

// Largest deflated entry inflated whole to answer a range of it.
const MAX_INFLATED_RANGE_BYTES = 32 * 1024 * 1024
// Inflated entries kept for later ranges, per zip.
const INFLATED_ENTRY_CACHE_SIZE = 4
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const LOCAL_HEADER_SIZE = 30
// Folders macOS adds when it zips a folder; never part of the dataset.
const IGNORED_ZIP_FOLDER = '__MACOSX/'

interface RegisteredZipFolder extends ZipFolder {
  // `origin + pathname` of the zip, plus '/'.
  readonly prefix: string
  // Reads the zip itself; the page's fetch when none was given.
  readonly fetcher: typeof fetch
  // Where each entry's data starts, from its local header.
  readonly dataStarts: Map<string, Promise<number>>
  readonly inflated: Map<string, Promise<Uint8Array<ArrayBuffer>>>
}

interface ZipFolderFile {
  readonly folder: RegisteredZipFolder
  // The file's path in the dataset folder, decoded.
  readonly path: string
  readonly entry: ZipEntry | undefined
}

const zipFolders = new Map<string, RegisteredZipFolder>()
let installed = false

// Registers the zip so `${folder.url}/<path>` is read from it. Registering
// the same zip again replaces it.
export function registerZipFolder(folder: ZipFolder, fetcher?: typeof fetch): void {
  const prefix = `${urlPath(folder.url) ?? folder.url}/`

  zipFolders.set(prefix, {
    ...folder,
    prefix,
    fetcher: fetcher ?? ((input, init) => globalThis.fetch(input, init)),
    dataStarts: new Map(),
    inflated: new Map(),
  })
}

export function zipFolderFor(url: string): ZipFolder | undefined {
  return zipFolders.get(`${urlPath(url) ?? url}/`)
}

export function clearZipFolders(): void {
  zipFolders.clear()
}

// The shallowest folder in the zip holding `fileName`, with a trailing slash
// ('' for the top of the zip), or undefined when no folder holds it.
export function zipFolderRoot(
  names: Iterable<string>,
  fileName: string,
): string | undefined {
  let root: string | undefined

  for (const name of names) {
    if (name.startsWith(IGNORED_ZIP_FOLDER)) {
      continue
    }

    const slash = name.lastIndexOf('/')

    if (name.slice(slash + 1) !== fileName) {
      continue
    }

    const folder = name.slice(0, slash + 1)

    if (root === undefined || depth(folder) < depth(root)) {
      root = folder
    }
  }

  return root
}

// Wraps the page's fetch once, so every main-thread reader can open files in
// a registered zip folder. Other URLs go to the page's fetch untouched.
export function installZipFolderFetch(): void {
  if (installed) {
    return
  }

  installed = true
  globalThis.fetch = withZipFolders(globalThis.fetch.bind(globalThis))
}

// A fetch that answers URLs in registered zip folders from the zip, and
// passes every other request to `fetcher`.
export function withZipFolders(fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const file = zipFolders.size === 0 ? undefined : zipFolderFile(input)
    return file === undefined
      ? fetcher(input, init)
      : fetchZipFolderFile(file, input, init)
  }
}

function zipFolderFile(input: RequestInfo | URL): ZipFolderFile | undefined {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = urlPath(url)

  if (path === undefined) {
    return undefined
  }

  for (const folder of zipFolders.values()) {
    const encodedPath = zipFolderFilePath(folder, url, path)

    if (encodedPath === undefined) {
      continue
    }

    let filePath: string

    try {
      filePath = decodeURIComponent(encodedPath)
    } catch {
      filePath = encodedPath
    }

    return {
      folder,
      path: filePath,
      entry:
        filePath === ''
          ? undefined
          : folder.directory.entries.get(folder.root + filePath),
    }
  }

  return undefined
}

// A file's path in the zip's folder, still encoded, when `url` names one.
// Readers name files `${folder.url}/<path>`, which puts the path after the
// query of a zip URL that has one, such as a presigned URL.
function zipFolderFilePath(
  folder: RegisteredZipFolder,
  url: string,
  path: string,
): string | undefined {
  if (folder.url.includes('?') && url.startsWith(`${folder.url}/`)) {
    return url.slice(folder.url.length + 1)
  }

  return path.startsWith(folder.prefix) ? path.slice(folder.prefix.length) : undefined
}

async function fetchZipFolderFile(
  { folder, entry }: ZipFolderFile,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const request = input instanceof Request ? input : undefined
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const signal = init?.signal ?? request?.signal ?? undefined
  signal?.throwIfAborted()

  if (entry === undefined) {
    return new Response(null, { status: 404, statusText: 'Not Found' })
  }

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
  }

  if (entry.method !== ZIP_METHOD_STORED && entry.method !== ZIP_METHOD_DEFLATED) {
    throw new ZipFolderError(
      `${entryLabel(folder, entry)} uses zip compression method ${entry.method}; only stored and deflated files can be read from a zip.`,
    )
  }

  const stored = entry.method === ZIP_METHOD_STORED
  const headers = new Headers({
    'Accept-Ranges': stored ? 'bytes' : 'none',
    'Content-Type': 'application/octet-stream',
  })

  // A file in the zip changes only with the zip, so the zip's validator
  // versions its files in the byte-range cache.
  if (folder.directory.validator !== undefined) {
    headers.set('ETag', folder.directory.validator)
  }

  if (method === 'HEAD') {
    headers.set('Content-Length', String(entry.size))
    return new Response(null, { status: 200, headers })
  }

  const rangeHeader = new Headers(init?.headers ?? request?.headers).get('Range')
  const range = rangeHeader === null ? null : parseRange(rangeHeader, entry.size)

  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${entry.size}`)
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers,
    })
  }

  if (range === 'multiple') {
    throw new ZipFolderError(
      `${entryLabel(folder, entry)}: requests for several ranges at once cannot be read from a zip.`,
    )
  }

  if (!stored) {
    return range === null
      ? inflatedEntryResponse(folder, entry, headers, signal)
      : inflatedRangeResponse(folder, entry, range, headers, signal)
  }

  if (entry.size === 0) {
    headers.set('Content-Length', '0')
    return new Response(new Uint8Array(0), { status: 200, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? entry.size - 1
  const dataStart = await abortable(entryDataStart(folder, entry), signal)
  const body = await readZipRange(
    folder,
    entry,
    dataStart + start,
    dataStart + end,
    signal,
  )

  headers.set('Content-Length', String(end - start + 1))

  if (range === null) {
    return streamedResponse(body, { status: 200, headers }, signal)
  }

  headers.set('Content-Range', `bytes ${start}-${end}/${entry.size}`)
  return streamedResponse(
    body,
    { status: 206, statusText: 'Partial Content', headers },
    signal,
  )
}

// Chromium rejects a body read of a Response built from a stream with
// "TypeError: Failed to fetch" whenever the stream fails, cancels included,
// where a fetched Response rejects with the abort. Readers tell a cancelled
// read from a failed one by that error (a cancelled image tile is dropped, a
// failed one is reported), so a cancelled read of a file in a zip rejects with
// the abort, as it would from the host.
class AbortableResponse extends Response {
  readonly #signal: AbortSignal

  constructor(body: BodyInit, init: ResponseInit, signal: AbortSignal) {
    super(body, init)
    this.#signal = signal
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    return this.#read(super.arrayBuffer())
  }

  override blob(): Promise<Blob> {
    return this.#read(super.blob())
  }

  override json(): Promise<unknown> {
    return this.#read(super.json())
  }

  override text(): Promise<string> {
    return this.#read(super.text())
  }

  async #read<T>(read: Promise<T>): Promise<T> {
    try {
      return await read
    } catch (error) {
      throw this.#signal.aborted ? this.#signal.reason : error
    }
  }
}

function streamedResponse(
  body: ReadableStream<Uint8Array<ArrayBuffer>> | Uint8Array<ArrayBuffer>,
  init: ResponseInit,
  signal: AbortSignal | undefined,
): Response {
  return signal === undefined
    ? new Response(body, init)
    : new AbortableResponse(body, init, signal)
}

async function inflatedEntryResponse(
  folder: RegisteredZipFolder,
  entry: ZipEntry,
  headers: Headers,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (typeof DecompressionStream !== 'function') {
    throw new ZipFolderError(
      `${entryLabel(folder, entry)} is compressed, and this browser cannot inflate it.`,
    )
  }

  const dataStart = await abortable(entryDataStart(folder, entry), signal)
  const body =
    entry.compressedSize === 0
      ? new Uint8Array(0)
      : (
          await readZipRange(
            folder,
            entry,
            dataStart,
            dataStart + entry.compressedSize - 1,
            signal,
          )
        ).pipeThrough(new DecompressionStream('deflate-raw'))

  headers.set('Content-Length', String(entry.size))
  return streamedResponse(body, { status: 200, headers }, signal)
}

async function inflatedRangeResponse(
  folder: RegisteredZipFolder,
  entry: ZipEntry,
  { start, end }: ByteRange,
  headers: Headers,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (entry.size > MAX_INFLATED_RANGE_BYTES) {
    throw new ZipFolderError(
      `${entryLabel(folder, entry)} is compressed in the zip, so it cannot be read in parts. Zip the folder without compression (zip -0 -r) or host it unzipped.`,
    )
  }

  const bytes = await abortable(inflatedEntry(folder, entry), signal)
  headers.set('Content-Length', String(end - start + 1))
  headers.set('Content-Range', `bytes ${start}-${end}/${entry.size}`)
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  })
}

// Bytes `start`..`end` (inclusive) of the zip. The zip is one URL for every
// file in it, so the requests skip the HTTP cache: Chromium lets one request
// at a time use a URL's cache entry, which would queue reads of different
// files behind each other.
async function readZipRange(
  folder: RegisteredZipFolder,
  entry: ZipEntry,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  const response = await folder.fetcher(folder.url, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  })

  if (response.status === 206 && response.body !== null) {
    return response.body
  }

  await response.body?.cancel().catch(() => undefined)
  throw new ZipFolderError(
    response.ok
      ? `${zipName(folder.url)}: the host does not answer byte-range requests, so ${entry.name} cannot be read from the zip.`
      : `${entryLabel(folder, entry)} could not be read: HTTP ${response.status} for the zip.`,
  )
}

// The entry's data follows its local header, whose extra field may differ in
// length from the central directory's, so the header is read once.
function entryDataStart(folder: RegisteredZipFolder, entry: ZipEntry): Promise<number> {
  return cached(folder.dataStarts, entry.name, Number.POSITIVE_INFINITY, async () => {
    const response = await folder.fetcher(folder.url, {
      headers: {
        Range: `bytes=${entry.localHeaderOffset}-${entry.localHeaderOffset + LOCAL_HEADER_SIZE - 1}`,
      },
      cache: 'no-store',
    })

    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined)
      throw new ZipFolderError(
        response.ok
          ? `${zipName(folder.url)}: the host does not answer byte-range requests, so ${entry.name} cannot be read from the zip.`
          : `${entryLabel(folder, entry)} could not be read: HTTP ${response.status} for the zip.`,
      )
    }

    const header = new DataView(await response.arrayBuffer())

    if (
      header.byteLength < LOCAL_HEADER_SIZE ||
      header.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE
    ) {
      throw new ZipFolderError(`${entryLabel(folder, entry)} has no local header.`)
    }

    return (
      entry.localHeaderOffset +
      LOCAL_HEADER_SIZE +
      header.getUint16(26, true) +
      header.getUint16(28, true)
    )
  })
}

function inflatedEntry(
  folder: RegisteredZipFolder,
  entry: ZipEntry,
): Promise<Uint8Array<ArrayBuffer>> {
  return cached(folder.inflated, entry.name, INFLATED_ENTRY_CACHE_SIZE, () =>
    readZipEntry(folder.url, entry, { fetcher: folder.fetcher }),
  )
}

// Shared work is started without any caller's signal, so one caller's abort
// does not fail the others; each caller stops waiting on its own abort.
function cached<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  limit: number,
  load: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key)

  if (existing !== undefined) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }

  const promise = load()
  cache.set(key, promise)
  promise.catch(() => {
    if (cache.get(key) === promise) {
      cache.delete(key)
    }
  })

  while (cache.size > limit) {
    const oldest = cache.keys().next().value

    if (oldest === undefined) {
      break
    }

    cache.delete(oldest)
  }

  return promise
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise
  }

  signal.throwIfAborted()

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason)
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

interface ByteRange {
  readonly start: number
  // Inclusive.
  readonly end: number
}

// One `bytes=` range, clamped to the file as a host would. Null for a header
// a host would ignore.
function parseRange(
  header: string,
  size: number,
): ByteRange | 'unsatisfiable' | 'multiple' | null {
  const value = header.trim()

  if (!/^bytes=/i.test(value)) {
    return null
  }

  if (value.includes(',')) {
    return 'multiple'
  }

  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)$/i.exec(value)

  if (match === null || (match[1] === '' && match[2] === '')) {
    return null
  }

  if (match[1] === '') {
    const suffix = Number(match[2])
    return suffix === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(match[1])
  const end = match[2] === '' ? Number.POSITIVE_INFINITY : Number(match[2])

  if (end < start) {
    return null
  }

  return start >= size ? 'unsatisfiable' : { start, end: Math.min(end, size - 1) }
}

// The URL without query or fragment, or undefined when it is not absolute.
function urlPath(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

function depth(folder: string): number {
  return folder.split('/').length
}

function entryLabel(folder: ZipFolder, entry: ZipEntry): string {
  return `${entry.name.slice(folder.root.length)} in ${zipName(folder.url)}`
}

function zipName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? url)
  } catch {
    return url
  }
}
