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

export function clearHostResponses(): void {
  originResponses.clear()
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
