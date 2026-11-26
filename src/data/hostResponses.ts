// A cross-origin request that fails without a response (`TypeError: Failed to
// fetch`) may be a network failure, a CORS rule, or an error response sent
// without CORS headers. Some hosts (Apache at ftp.ebi.ac.uk, for the
// BioImage Archive) add CORS headers only to successful responses, so the
// browser hides their 404s and a missing file looks like a network failure.
// Detection and Range probes record which origins have answered readably, so
// a later failure on such an origin can be reported as a likely missing file.

interface OriginResponses {
  // The origin has let the app read an error status, so it does send CORS
  // headers on errors and a failure there is not a hidden error response.
  readableError: boolean
}

const originResponses = new Map<string, OriginResponses>()
// Whether each origin answers HEAD readably, or only GET.
const originHeadSupport = new Map<string, 'head' | 'get'>()

export class LikelyMissingFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LikelyMissingFileError'
  }
}

export function noteReadableResponse(url: string, status: number): void {
  const origin = originOf(url)

  if (origin === undefined) {
    return
  }

  const record = originResponses.get(origin) ?? { readableError: false }
  record.readableError ||= status >= 400
  originResponses.set(origin, record)
}

// The error to report instead of `cause` when `cause` is a failed fetch on an
// origin that has answered readably but never with an error status.
export function likelyMissingFileError(
  label: string,
  url: string,
  cause: unknown,
): LikelyMissingFileError | undefined {
  const origin = originOf(url)
  const record = origin === undefined ? undefined : originResponses.get(origin)

  if (!isFailedFetch(cause) || record === undefined || record.readableError) {
    return undefined
  }

  return new LikelyMissingFileError(
    `${label} could not be read. The request for ${url} failed without a readable response, although other files on ${new URL(url).host} were readable, so the file is most likely missing. This host does not appear to send CORS headers with error responses, so the browser cannot report the HTTP status.`,
    { cause },
  )
}

// Whether `url`'s origin has answered readably but never with an error
// status, so that a failed fetch there is more likely an error response it
// hid than a network failure.
export function hidesErrorResponses(url: string): boolean {
  const origin = originOf(url)
  const record = origin === undefined ? undefined : originResponses.get(origin)

  return record !== undefined && !record.readableError
}

// A HEAD request for hosts whose CORS rules allow GET only (the
// azimuth-vitessce S3 bucket): they answer HEAD without CORS headers, so it
// fails like a network error. When HEAD fails on an origin where none has
// succeeded, a one-byte Range GET stands in, returned as a bodiless response
// whose Content-Length is the file's size from Content-Range. An origin that
// answers it is sent that GET from then on instead of HEAD.
export async function fetchHead(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const origin = originOf(url)
  const support = origin === undefined ? undefined : originHeadSupport.get(origin)

  if (support === 'get') {
    return fetchFirstByteAsHead(fetcher, url, init)
  }

  try {
    const response = await fetcher(url, { ...init, method: 'HEAD' })

    if (origin !== undefined) {
      originHeadSupport.set(origin, 'head')
    }

    return response
  } catch (cause) {
    // Read again: a HEAD sent alongside this one may have succeeded since.
    if (
      origin === undefined ||
      originHeadSupport.get(origin) === 'head' ||
      !isFailedFetch(cause) ||
      init.signal?.aborted === true
    ) {
      throw cause
    }

    let response: Response

    try {
      response = await fetchFirstByteAsHead(fetcher, url, init)
    } catch {
      throw cause
    }

    originHeadSupport.set(origin, 'get')
    return response
  }
}

async function fetchFirstByteAsHead(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const requestHeaders = new Headers(init.headers)
  requestHeaders.set('Range', 'bytes=0-0')
  const response = await fetcher(url, {
    ...init,
    method: 'GET',
    headers: requestHeaders,
    cache: 'no-store',
  })
  // A host that ignores Range sends the whole file.
  void response.body?.cancel().catch(() => undefined)

  const headers = new Headers(response.headers)
  const size = /\/(\d+)\s*$/.exec(response.headers.get('Content-Range') ?? '')?.[1]
  // An empty file has no first byte: 416 with `bytes */0`.
  const partial = response.status === 206 || (response.status === 416 && size === '0')

  if (partial) {
    if (size === undefined) {
      headers.delete('Content-Length')
    } else {
      headers.set('Content-Length', size)
    }
  }

  return new Response(null, {
    status: partial ? 200 : response.status,
    statusText: partial ? 'OK' : response.statusText,
    headers,
  })
}

export function clearHostResponses(): void {
  originResponses.clear()
  originHeadSupport.clear()
}

function isFailedFetch(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'TypeError'
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}
