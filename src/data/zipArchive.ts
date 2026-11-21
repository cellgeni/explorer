// Reads single entries from a large zip over HTTP: the central directory
// from the archive's tail (ZIP64 too), then one entry's bytes in one ranged
// request, streamed through DecompressionStream when deflated. Ranges skip
// the HTTP cache: Chromium serialises requests that share a URL's cache
// entry, and every file of a zipped run is one URL. Used for
// MERSCOPE `.vzg` archives (11-23 GB), whose image pyramids are deflated
// entries of up to a few hundred MB. A deflate stream cannot be read from the
// middle, so an entry is always read whole.

import { fetchHead } from './hostResponses'
import { responseValidator } from './persistentByteRangeCache'

export interface ZipEntry {
  readonly name: string
  // 0 stored, 8 deflated.
  readonly method: number
  readonly compressedSize: number
  readonly size: number
  readonly localHeaderOffset: number
}

export interface ZipDirectory {
  readonly url: string
  readonly byteLength: number
  // The archive's ETag or Last-Modified from HEAD, when readable.
  readonly validator?: string
  readonly entries: ReadonlyMap<string, ZipEntry>
}

export interface ZipReadOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export class ZipArchiveError extends Error {
  constructor(url: string, message: string) {
    super(`${zipName(url)}: ${message}`)
    this.name = 'ZipArchiveError'
  }
}

const EOCD_SIGNATURE = 0x06054b50
const EOCD_SIZE = 22
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_LOCATOR_SIZE = 20
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const LOCAL_HEADER_SIZE = 30
const ZIP64_EXTRA_ID = 0x0001
// The end of central directory record follows a comment of up to 64 KiB.
const TAIL_BYTES = EOCD_SIZE + 0xffff + ZIP64_LOCATOR_SIZE
// Room read past an entry's name for a local extra field, which may differ
// from the central directory's.
const LOCAL_EXTRA_ALLOWANCE = 1024

export const ZIP_METHOD_STORED = 0
export const ZIP_METHOD_DEFLATED = 8

// Lists the archive's entries. Needs the size from HEAD, because hosts such
// as EBI hide Content-Range from scripts.
export async function readZipDirectory(
  url: string,
  options: ZipReadOptions = {},
): Promise<ZipDirectory> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const head = await fetchHead(
    fetcher,
    url,
    options.signal === undefined ? {} : { signal: options.signal },
  )

  if (!head.ok) {
    throw new ZipArchiveError(url, `HEAD returned HTTP ${head.status}.`)
  }

  const byteLength = Number(head.headers.get('Content-Length'))

  if (!Number.isFinite(byteLength) || byteLength < EOCD_SIZE) {
    throw new ZipArchiveError(url, 'the host did not send the file size.')
  }

  const tailStart = Math.max(0, byteLength - TAIL_BYTES)
  const tail = await readRange(url, tailStart, byteLength, fetcher, options.signal)
  const tailView = view(tail)
  let eocd = -1

  // The record is the one whose comment ends the file; a comment can hold the
  // signature too. Failing that, as for a zip with bytes appended, the last
  // signature is taken.
  for (let offset = tail.length - EOCD_SIZE; offset >= 0; offset -= 1) {
    if (tailView.getUint32(offset, true) !== EOCD_SIGNATURE) {
      continue
    }

    if (eocd < 0) {
      eocd = offset
    }

    if (offset + EOCD_SIZE + tailView.getUint16(offset + 20, true) === tail.length) {
      eocd = offset
      break
    }
  }

  if (eocd < 0) {
    throw new ZipArchiveError(url, 'is not a zip (no end of central directory).')
  }

  let entryCount = tailView.getUint16(eocd + 10, true)
  let directorySize = tailView.getUint32(eocd + 12, true)
  let directoryOffset = tailView.getUint32(eocd + 16, true)
  const locator = eocd - ZIP64_LOCATOR_SIZE

  if (locator >= 0 && tailView.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) {
    const zip64Offset = readUint64(tailView, locator + 8)
    const record =
      zip64Offset >= tailStart
        ? tail.subarray(zip64Offset - tailStart, zip64Offset - tailStart + 56)
        : await readRange(url, zip64Offset, zip64Offset + 56, fetcher, options.signal)
    const recordView = view(record)

    if (recordView.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
      throw new ZipArchiveError(url, 'has a damaged ZIP64 end of central directory.')
    }

    entryCount = readUint64(recordView, 32)
    directorySize = readUint64(recordView, 40)
    directoryOffset = readUint64(recordView, 48)
  }

  const directory =
    directoryOffset >= tailStart
      ? tail.subarray(
          directoryOffset - tailStart,
          directoryOffset - tailStart + directorySize,
        )
      : await readRange(
          url,
          directoryOffset,
          directoryOffset + directorySize,
          fetcher,
          options.signal,
        )

  const validator = responseValidator(head.headers)

  return {
    url,
    byteLength,
    ...(validator === undefined ? {} : { validator }),
    entries: parseCentralDirectory(url, directory, entryCount),
  }
}

export function parseCentralDirectory(
  url: string,
  directory: Uint8Array,
  entryCount: number,
): Map<string, ZipEntry> {
  const directoryView = view(directory)
  const decoder = new TextDecoder()
  const entries = new Map<string, ZipEntry>()
  let offset = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > directory.length ||
      directoryView.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE
    ) {
      throw new ZipArchiveError(url, `central directory entry ${index} is damaged.`)
    }

    const method = directoryView.getUint16(offset + 10, true)
    let compressedSize = directoryView.getUint32(offset + 20, true)
    let size = directoryView.getUint32(offset + 24, true)
    const nameLength = directoryView.getUint16(offset + 28, true)
    const extraLength = directoryView.getUint16(offset + 30, true)
    const commentLength = directoryView.getUint16(offset + 32, true)
    let localHeaderOffset = directoryView.getUint32(offset + 42, true)
    // Some Windows tools, such as PowerShell 5.1's Compress-Archive, write
    // backslashes between folders.
    const name = decoder
      .decode(directory.subarray(offset + 46, offset + 46 + nameLength))
      .replaceAll('\\', '/')
    let extra = offset + 46 + nameLength
    const extraEnd = extra + extraLength

    // The ZIP64 extra field holds, in order, only the values whose 32-bit
    // fields are saturated.
    while (extra + 4 <= extraEnd) {
      const id = directoryView.getUint16(extra, true)
      const length = directoryView.getUint16(extra + 2, true)

      if (id === ZIP64_EXTRA_ID) {
        let field = extra + 4

        if (size === 0xffffffff) {
          size = readUint64(directoryView, field)
          field += 8
        }

        if (compressedSize === 0xffffffff) {
          compressedSize = readUint64(directoryView, field)
          field += 8
        }

        if (localHeaderOffset === 0xffffffff) {
          localHeaderOffset = readUint64(directoryView, field)
        }
      }

      extra += 4 + length
    }

    if (!name.endsWith('/')) {
      entries.set(name, { name, method, compressedSize, size, localHeaderOffset })
    }

    offset = extraEnd + commentLength
  }

  return entries
}

export interface ReadZipEntryOptions extends ZipReadOptions {
  // Compressed bytes received so far, and the entry's compressed size.
  readonly onProgress?: (received: number, total: number) => void
}

// One entry's uncompressed bytes, read in one request from its local header.
export async function readZipEntry(
  url: string,
  entry: ZipEntry,
  options: ReadZipEntryOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (entry.method !== ZIP_METHOD_STORED && entry.method !== ZIP_METHOD_DEFLATED) {
    throw new ZipArchiveError(
      url,
      `${entry.name} uses compression method ${entry.method}; only stored and deflated entries can be read.`,
    )
  }

  if (entry.method === ZIP_METHOD_DEFLATED && typeof DecompressionStream !== 'function') {
    throw new ZipArchiveError(url, 'this browser cannot inflate zip entries.')
  }

  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const requestRange = async (
    start: number,
    stop: number,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> => {
    const response = await fetcher(url, {
      cache: 'no-store',
      headers: { Range: `bytes=${start}-${stop - 1}` },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (response.status !== 206 || response.body === null) {
      await response.body?.cancel()
      throw new ZipArchiveError(
        url,
        response.ok
          ? 'the host does not answer byte-range requests.'
          : `${entry.name} returned HTTP ${response.status}.`,
      )
    }

    return response.body
  }
  const end =
    entry.localHeaderOffset +
    LOCAL_HEADER_SIZE +
    new TextEncoder().encode(entry.name).length +
    LOCAL_EXTRA_ALLOWANCE +
    entry.compressedSize
  let reader = (await requestRange(entry.localHeaderOffset, end)).getReader()
  const output = new Uint8Array(entry.size)
  let written = 0
  const write = (chunk: Uint8Array) => {
    if (written + chunk.length > output.length) {
      throw new ZipArchiveError(url, `${entry.name} is longer than its directory entry.`)
    }

    output.set(chunk, written)
    written += chunk.length
  }
  const inflater =
    entry.method === ZIP_METHOD_DEFLATED ? new DecompressionStream('deflate-raw') : null
  const inflaterWriter = inflater?.writable.getWriter()
  let drainError: unknown = null
  // Inflated chunks are copied out as they come. If that fails, the stream
  // is aborted so a write waiting on it settles.
  const drained =
    inflater === null
      ? Promise.resolve()
      : (async () => {
          const inflated = inflater.readable.getReader()

          for (;;) {
            const { done, value } = await inflated.read()

            if (done) {
              return
            }

            write(value)
          }
        })().catch((error: unknown) => {
          drainError = error
          void inflaterWriter?.abort(error).catch(() => undefined)
        })
  let header: Uint8Array<ArrayBuffer> | null = new Uint8Array(0)
  // Where the data starts, from the entry's local header, once read.
  let dataStart: number | undefined
  let streamed = 0
  let remaining = entry.compressedSize
  let received = 0

  // Reads the entry's bytes from `reader` until they or the response end.
  const consume = async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        return
      }

      streamed += value.length
      let chunk: Uint8Array<ArrayBuffer> = value

      // The local header's name and extra lengths say where the data starts.
      if (header !== null) {
        const joined = concat(header, chunk)

        if (joined.length < LOCAL_HEADER_SIZE) {
          header = joined
          continue
        }

        const headerView = view(joined)

        if (headerView.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
          throw new ZipArchiveError(url, `${entry.name} has no local header.`)
        }

        dataStart =
          LOCAL_HEADER_SIZE +
          headerView.getUint16(26, true) +
          headerView.getUint16(28, true)

        if (joined.length < dataStart) {
          header = joined
          continue
        }

        header = null
        chunk = joined.subarray(dataStart)
      }

      const data = chunk.subarray(0, remaining)
      remaining -= data.length
      received += data.length
      options.onProgress?.(received, entry.compressedSize)

      if (inflaterWriter === undefined) {
        write(data)
      } else if (data.length > 0) {
        await inflaterWriter.write(data)
      }

      if (remaining === 0) {
        await reader.cancel()
        return
      }
    }
  }

  try {
    await consume()

    // Writers that pad entries for alignment can write a local extra field
    // longer than LOCAL_EXTRA_ALLOWANCE, so the data runs past the range read.
    if (
      remaining > 0 &&
      dataStart !== undefined &&
      entry.localHeaderOffset + streamed === end
    ) {
      reader = (
        await requestRange(
          end,
          entry.localHeaderOffset + dataStart + entry.compressedSize,
        )
      ).getReader()
      await consume()
    }

    if (remaining > 0) {
      throw new ZipArchiveError(url, `${entry.name} ended early.`)
    }

    await inflaterWriter?.close()
    await drained
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    await inflaterWriter?.abort(error).catch(() => undefined)
    throw drainError ?? error
  }

  if (drainError !== null) {
    throw drainError
  }

  if (written !== entry.size) {
    throw new ZipArchiveError(
      url,
      `${entry.name} inflated to ${written.toLocaleString()} bytes, not ${entry.size.toLocaleString()}.`,
    )
  }

  return output
}

async function readRange(
  url: string,
  start: number,
  end: number,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const response = await fetcher(url, {
    cache: 'no-store',
    headers: { Range: `bytes=${start}-${end - 1}` },
    ...(signal === undefined ? {} : { signal }),
  })

  if (response.status !== 206) {
    await response.body?.cancel()
    throw new ZipArchiveError(
      url,
      response.ok
        ? 'the host does not answer byte-range requests.'
        : `bytes ${start}-${end - 1} returned HTTP ${response.status}.`,
    )
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.length !== end - start) {
    throw new ZipArchiveError(url, `bytes ${start}-${end - 1} came back short.`)
  }

  return bytes
}

function readUint64(data: DataView, offset: number): number {
  const value = data.getBigUint64(offset, true)

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('A zip offset is too large.')
  }

  return Number(value)
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function concat(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (left.length === 0) {
    return right
  }

  const joined = new Uint8Array(left.length + right.length)
  joined.set(left)
  joined.set(right, left.length)
  return joined
}

function zipName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? url)
  } catch {
    return url
  }
}
