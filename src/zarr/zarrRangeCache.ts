import {
  byteRangeFileVersion,
  fetchByteRangeWithCache,
  responseValidator,
  ZARR_RANGE_CACHE_NAMESPACE,
  type PersistentByteRangeCache,
} from '../data/persistentByteRangeCache'

// A Zarr store's range reads over HTTP, a sharded array's indexes and inner
// chunks, in the persistent byte-range cache. They skip Chromium's HTTP cache
// (see createZarrFetchStore), so without this every load reads them again,
// while whole chunk files come from the HTTP cache on a host that sends
// validators. zarrita asks for a shard's size with a HEAD before it reads the
// shard's index, and that reply's size and validator version the shard's
// ranges, as a zip's HEAD versions its ranges. Ranges of a file this store
// has not sent a HEAD for are not cached.
export class ZarrRangeCache {
  private readonly versions = new Map<string, string>()

  constructor(private readonly cache: PersistentByteRangeCache) {}

  noteHead(url: string, response: Response): void {
    const length = Number(response.headers.get('content-length') ?? Number.NaN)

    if (response.ok && Number.isSafeInteger(length) && length >= 0) {
      this.versions.set(
        url,
        byteRangeFileVersion(length, responseValidator(response.headers)),
      )
    }
  }

  async fetchRange(
    request: Request,
    send: (request: Request) => Promise<Response>,
  ): Promise<Response> {
    const version = this.versions.get(request.url)
    const bounds = byteRangeBounds(request.headers.get('Range'))

    if (request.method !== 'GET' || version === undefined || bounds === null) {
      return send(request)
    }

    // A reply other than the range, such as a missing chunk's 404, goes to
    // zarrita as it came.
    let unexpected: Response | undefined

    try {
      const bytes = await fetchByteRangeWithCache({
        cache: this.cache,
        namespace: ZARR_RANGE_CACHE_NAMESPACE,
        url: request.url,
        version,
        start: bounds.start,
        end: bounds.end,
        signal: request.signal,
        fetchRange: async () => {
          const response = await send(request)

          if (response.status !== 206) {
            unexpected = response
            throw new Error(`HTTP ${response.status} for a range of ${request.url}`)
          }

          return new Uint8Array(await response.arrayBuffer())
        },
      })

      // Response takes bytes over an ArrayBuffer, which slice() gives.
      return new Response(bytes.slice(), { status: 206 })
    } catch (error) {
      if (unexpected !== undefined) {
        return unexpected
      }

      throw error
    }
  }
}

// `bytes=start-last` as [start, end). zarrita sends no other form here: it
// reads a shard's index from the size a HEAD gave it.
function byteRangeBounds(
  header: string | null,
): { readonly start: number; readonly end: number } | null {
  const match = /^bytes=(\d+)-(\d+)$/.exec(header ?? '')

  if (match === null) {
    return null
  }

  const start = Number(match[1])
  const end = Number(match[2]) + 1
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start
    ? { start, end }
    : null
}
