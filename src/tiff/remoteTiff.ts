import { fromCustomClient } from 'geotiff'
import type {
  BaseClient,
  BaseResponse,
  BlockedSourceOptions,
  GeoTIFF,
  RemoteSourceOptions,
} from 'geotiff'
import { byteRangeFileVersion, responseValidator } from '../data/persistentByteRangeCache'
import { fetchWithRetry } from '../data/fetchRetry'

// The version of each file opened by openRemoteTiff (see
// byteRangeFileVersion), which its tiles are cached under.
const remoteTiffVersions = new WeakMap<GeoTIFF, string>()

// geotiff reads the header, each IFD, and each tag value that does not fit in
// its IFD's read with a request of its own. tifffile and Bio-Formats write an
// IFD's tag values right after it, so a shorter read is read on, and later
// reads inside it are answered from memory. The header's read takes in the
// first IFD and its values: Xenium's focus images keep 54 kB of tile offsets
// there. Another IFD's read takes in its own: 14 kB for level 1 of those
// images. Block-read formats (QPTIFF, SVS) ask for whole blocks of 64 KiB or
// more, which are sent as they are.
const HEADER_READ_AHEAD_BYTES = 64 * 1024
const READ_AHEAD_BYTES = 16 * 1024
// Reads kept per file, most recently used last.
const READ_AHEAD_WINDOWS = 8

// Opens a TIFF over HTTP Range requests, as geotiff's fromUrl does, and keeps
// the file's size and validator from the first response, the header read, so
// its tiles can be cached by version without a request of their own. geotiff
// hands the block options to its BlockedSource, though its type leaves them
// out.
export async function openRemoteTiff(
  url: string,
  options: RemoteSourceOptions & BlockedSourceOptions,
): Promise<GeoTIFF> {
  const client = new VersionedFetchClient(url)
  const tiff = await fromCustomClient(client, options)

  remoteTiffVersions.set(tiff, client.version ?? '')
  return tiff
}

// Empty for a file opened another way, such as from memory.
export function remoteTiffVersion(tiff: GeoTIFF): string {
  return remoteTiffVersions.get(tiff) ?? ''
}

interface ByteRange {
  readonly start: number
  // Exclusive.
  readonly end: number
}

interface ReadAheadWindow extends ByteRange {
  // The bytes read from `start`, fewer than asked at the end of the file;
  // null when the read failed or did not answer 206.
  readonly bytes: Promise<ReadAheadBytes | null>
}

interface ReadAheadBytes {
  readonly data: ArrayBuffer
  // The file size after the slash in Content-Range, or `*`.
  readonly total: string
}

// geotiff's fetch client, without credentials. It implements geotiff's
// client rather than extending it, so tests that mock geotiff can load it.
class VersionedFetchClient implements BaseClient {
  version: string | undefined
  private readonly windows: ReadAheadWindow[] = []
  private inFlight = 0

  constructor(readonly url: string) {}

  async request(options: RequestInit = {}): Promise<BaseResponse> {
    const range = requestedRange(options.headers)

    // A read with a signal is not shared, so that one caller's abort cannot
    // fail another's read.
    if (
      range === undefined ||
      options.signal != null ||
      range.end - range.start >= readAheadBytes(range)
    ) {
      return new FetchResponse(await this.sendAndRelease(options))
    }

    const window = this.windows.find(
      (candidate) => candidate.start <= range.start && range.end <= candidate.end,
    )

    if (window === undefined) {
      return this.readAhead(range, options)
    }

    this.windows.splice(this.windows.indexOf(window), 1)
    this.windows.push(window)

    // A window that failed, or ended before this range at the end of the
    // file, leaves the range to a read of its own.
    const bytes = await window.bytes
    const served = bytes === null ? undefined : servedRange(window, bytes, range)

    return served ?? new FetchResponse(await this.sendAndRelease(options))
  }

  private async readAhead(range: ByteRange, options: RequestInit): Promise<BaseResponse> {
    const end = range.start + readAheadBytes(range)
    const sent = this.send({
      ...options,
      headers: withRange(options.headers, range.start, end),
    })
    const read = sent.then(async ({ response, release }) => {
      try {
        return response.status === 206
          ? {
              data: await response.arrayBuffer(),
              total: contentRangeTotalText(response.headers),
            }
          : null
      } finally {
        release()
      }
    })
    // Other reads of the window read on their own if it fails; this one
    // reports the failure.
    const window: ReadAheadWindow = {
      start: range.start,
      end,
      bytes: read.catch(() => null),
    }
    const forget = () => {
      const index = this.windows.indexOf(window)

      if (index >= 0) {
        this.windows.splice(index, 1)
      }
    }

    this.windows.push(window)
    while (this.windows.length > READ_AHEAD_WINDOWS) {
      this.windows.shift()
    }

    try {
      const { response } = await sent

      // Another status goes to geotiff as it came, as without the
      // read-ahead: geotiff refuses a whole file and reports errors.
      if (response.status !== 206) {
        forget()
        return new FetchResponse(response)
      }

      const bytes = await read
      const served = bytes === null ? undefined : servedRange(window, bytes, range)

      return served ?? new FetchResponse(await this.sendAndRelease(options))
    } catch (cause) {
      forget()
      throw cause
    }
  }

  private async sendAndRelease(options: RequestInit): Promise<Response> {
    const { response, release } = await this.send(options)

    release()
    return response
  }

  // Chromium lets one request at a time use a URL's HTTP cache entry, until
  // its body has arrived, so Range reads of one file sent together wait for
  // each other. A read sent while another of the file is on its way skips
  // the cache, as tile reads do; reads one after another keep it, so a
  // reopened file's header can come from the cache. The caller releases the
  // read once its body has arrived.
  private async send(
    options: RequestInit,
  ): Promise<{ readonly response: Response; readonly release: () => void }> {
    const init: RequestInit =
      this.inFlight > 0 ? { ...options, cache: 'no-store' } : options
    let released = false
    const release = () => {
      if (!released) {
        released = true
        this.inFlight -= 1
      }
    }

    this.inFlight += 1

    try {
      const response = await fetchWithRetry(this.url, init)

      if (this.version === undefined && response.status === 206) {
        this.version = byteRangeFileVersion(
          contentRangeTotal(response.headers),
          responseValidator(response.headers),
        )
      }

      return { response, release }
    } catch (cause) {
      release()
      throw cause
    }
  }
}

class FetchResponse implements BaseResponse {
  constructor(private readonly response: Response) {}

  get ok(): boolean {
    return this.response.ok
  }

  get status(): number {
    return this.response.status
  }

  getHeader(name: string): string | undefined {
    return this.response.headers.get(name) ?? undefined
  }

  getData(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer()
  }
}

// A range answered from a read-ahead window, as a 206 response would.
class MemoryResponse implements BaseResponse {
  readonly ok = true
  readonly status = 206

  constructor(
    private readonly data: ArrayBuffer,
    private readonly contentRange: string,
  ) {}

  getHeader(name: string): string | undefined {
    return name.toLowerCase() === 'content-range' ? this.contentRange : undefined
  }

  getData(): Promise<ArrayBuffer> {
    return Promise.resolve(this.data)
  }
}

function readAheadBytes(range: ByteRange): number {
  return range.start === 0 ? HEADER_READ_AHEAD_BYTES : READ_AHEAD_BYTES
}

// Undefined unless the window's bytes hold the range, or hold its start and
// reach the end of the file, where a host would also answer short. A host
// that answered short elsewhere leaves the range to a read of its own.
function servedRange(
  window: ReadAheadWindow,
  bytes: ReadAheadBytes,
  range: ByteRange,
): MemoryResponse | undefined {
  const start = range.start - window.start
  const received = bytes.data.byteLength
  const atFileEnd = bytes.total === String(window.start + received)
  const end = Math.min(range.end - window.start, received)

  if (start >= end || (end < range.end - window.start && !atFileEnd)) {
    return undefined
  }

  return new MemoryResponse(
    bytes.data.slice(start, end),
    `bytes ${range.start.toString()}-${(window.start + end - 1).toString()}/${bytes.total}`,
  )
}

// The single range `bytes=a-b` a request asks for, as geotiff writes it.
function requestedRange(headers: HeadersInit | undefined): ByteRange | undefined {
  const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(headers).get('range') ?? '')

  if (match === null) {
    return undefined
  }

  const start = Number(match[1])
  const end = Number(match[2]) + 1

  return end > start ? { start, end } : undefined
}

// The headers with the Range header replaced by `start` to `end`
// (exclusive).
function withRange(
  headers: HeadersInit | undefined,
  start: number,
  end: number,
): Record<string, string> {
  const record = Object.fromEntries(
    [...new Headers(headers).entries()].filter(([name]) => name !== 'range'),
  )

  return { ...record, Range: `bytes=${start.toString()}-${(end - 1).toString()}` }
}

// The text after the slash in Content-Range: the file size, or `*` when
// unknown or hidden by CORS.
function contentRangeTotalText(headers: Headers): string {
  return contentRangeTotal(headers)?.toString() ?? '*'
}

// The file size a 206 response gives after the slash in Content-Range;
// undefined when it is `*` or CORS hides the header.
function contentRangeTotal(headers: Headers): number | undefined {
  const match = /\/(\d+)\s*$/.exec(headers.get('content-range') ?? '')
  return match === null ? undefined : Number(match[1])
}
