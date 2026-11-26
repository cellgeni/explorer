import { ZipFileStore } from '@zarrita/storage'
import { fetchHead } from '../data/hostResponses'
import { fetchWithRetry } from '../data/fetchRetry'
import { ZipArchiveError } from '../data/zipArchive'
import {
  byteRangeFileVersion,
  defaultPersistentByteRangeCache,
  fetchByteRangeWithCache,
  responseValidator,
  ZARR_ZIP_CACHE_NAMESPACE,
  type PersistentByteRangeCache,
} from '../data/persistentByteRangeCache'

// Zipped Zarr stores read over HTTP byte ranges. Ranges go through the
// persistent byte-range cache, so reopening a dataset reuses the zip central
// directory and chunks already fetched.
export function cachedZipFileStoreFromUrl(url: string): ZipFileStore {
  return new ZipFileStore(
    new CachedHttpRangeReader(url, defaultPersistentByteRangeCache()),
  )
}

export interface ZipStoreWithEntries {
  readonly store: ZipFileStore
  // Every entry path in the zip, without a leading slash.
  readonly entryNames: readonly string[]
}

// Opens a zipped store and lists its entries, for stores without consolidated
// metadata whose layout has to be discovered from the zip directory.
export async function cachedZipFileStoreWithEntries(
  url: string,
  fetcher?: typeof fetch,
): Promise<ZipStoreWithEntries> {
  let entryNames: readonly string[] = []
  const store = new ZipFileStore(
    new CachedHttpRangeReader(url, defaultPersistentByteRangeCache(), fetcher),
    {
      transformEntries: (entries) => {
        entryNames = Object.keys(entries)
        return entries
      },
    },
  )

  // Any lookup waits for the central directory, which fills entryNames.
  await store.has('/.zgroup')
  return { store, entryNames }
}

interface ZipFileHead {
  readonly byteLength: number
  // The zip's version in the byte-range cache, from the same HEAD response.
  readonly version: string
}

export class CachedHttpRangeReader {
  private head: ZipFileHead | undefined

  constructor(
    readonly url: string,
    private readonly cache: PersistentByteRangeCache | null,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async getLength(): Promise<number> {
    return (await this.readHead()).byteLength
  }

  async read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
    if (size === 0) {
      return new Uint8Array(0)
    }

    // unzipit reads the length before any range, so this makes no request.
    const { byteLength, version } = await this.readHead()
    const bytes = await fetchByteRangeWithCache({
      cache: this.cache,
      namespace: ZARR_ZIP_CACHE_NAMESPACE,
      url: this.url,
      version,
      start: offset,
      end: offset + size,
      fileByteLength: byteLength,
      fetchRange: async () => {
        // Chromium's HTTP cache lets one Range request to a URL through at a
        // time, so without no-store every read of the zip (image tiles, table
        // chunks, shapes) waits behind the one in flight. The persistent
        // cache above keeps the ranges instead.
        const response = await fetchWithRetry(
          this.url,
          {
            cache: 'no-store',
            headers: {
              Range: `bytes=${offset}-${offset + size - 1}`,
            },
          },
          { fetcher: this.fetcher },
        )

        return readRangeBody(this.url, response, offset, size)
      },
    })

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy
  }

  private async readHead(): Promise<ZipFileHead> {
    if (this.head !== undefined) {
      return this.head
    }

    // fetchHead reads the first byte instead on hosts that answer GET but not
    // HEAD, such as GET-only CORS buckets and presigned URLs.
    const response = await fetchHead(this.fetcher, this.url)

    if (!response.ok) {
      throw new ZipArchiveError(this.url, `HEAD returned HTTP ${response.status}.`)
    }

    const length = response.headers.get('content-length')
    const byteLength = length === null ? Number.NaN : Number(length)

    // Without the size the zip's directory, at its end, cannot be found.
    if (!Number.isFinite(byteLength) || byteLength <= 0) {
      throw new ZipArchiveError(this.url, 'the host did not send the file size.')
    }

    this.head = {
      byteLength,
      version: byteRangeFileVersion(byteLength, responseValidator(response.headers)),
    }
    return this.head
  }
}

// The bytes of a 206 reply to `bytes=offset-(offset+size-1)`. A host that
// ignores Range answers 200 with the whole zip, so anything but 206 is
// refused unread. Content-Range and Content-Length are checked when CORS
// exposes them, and the body is read only up to `size` bytes, so a reply
// longer than asked for is cancelled rather than downloaded.
async function readRangeBody(
  url: string,
  response: Response,
  offset: number,
  size: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const range = `bytes ${offset}-${offset + size - 1}`
  const refuse = async (reason: string): Promise<never> => {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`failed http request ${url}, ${reason}`)
  }

  if (response.status !== 206) {
    return refuse(
      response.status === 200
        ? `the host ignored the range request (HTTP 200 for ${range})`
        : `status: ${response.status} for ${range}: ${response.statusText}`,
    )
  }

  const contentRange = response.headers.get('Content-Range')
  const returned =
    contentRange === null ? null : /^bytes (\d+)-(\d+)\//i.exec(contentRange.trim())

  if (
    contentRange !== null &&
    (returned === null ||
      Number(returned[1]) !== offset ||
      Number(returned[2]) !== offset + size - 1)
  ) {
    return refuse(`Content-Range ${contentRange} does not match ${range}`)
  }

  const contentLength = response.headers.get('Content-Length')

  if (contentLength !== null && Number(contentLength) !== size) {
    return refuse(`${contentLength} bytes returned for ${range} (${size} expected)`)
  }

  if (response.body === null) {
    return refuse(`no body returned for ${range}`)
  }

  const bytes = new Uint8Array(size)
  const reader = response.body.getReader()
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break

    if (received + value.byteLength > size) {
      await reader.cancel().catch(() => undefined)
      throw new Error(
        `failed http request ${url}, more than ${size} bytes returned for ${range}`,
      )
    }

    bytes.set(value, received)
    received += value.byteLength
  }

  if (received !== size) {
    throw new Error(
      `failed http request ${url}, ${received} bytes returned for ${range} (${size} expected)`,
    )
  }

  return bytes
}
