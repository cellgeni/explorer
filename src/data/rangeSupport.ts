import { fileNotListedError } from './folderListing'
import { likelyMissingFileError, noteReadableResponse } from './hostResponses'
import { waitForSharedLoad, type SharedLoad } from '../utils/sharedLoad'

export type RangeSupportFetcher = typeof fetch

export interface AssertHttpRangeSupportOptions {
  readonly fetcher?: RangeSupportFetcher
  readonly label?: string
  readonly signal?: AbortSignal
}

const RANGE_PROBE_HEADER = 'bytes=0-0'
const rangeSupportCache = new Map<string, SharedLoad<void>>()

export async function assertHttpRangeSupport(
  url: string,
  options: AssertHttpRangeSupportOptions = {},
): Promise<void> {
  throwIfAborted(options.signal)

  if (options.fetcher !== undefined) {
    await assertHttpRangeSupportUncached(url, options)
    return
  }

  // Callers share one probe per file. It is cancelled only when they all
  // cancel, so one caller's cancel cannot fail the others (15.5-E).
  await waitForSharedLoad(
    rangeSupportCache,
    rangeSupportCacheKey(url, options.label),
    (signal) => assertHttpRangeSupportUncached(url, { ...options, signal }),
    options.signal,
  )
}

async function assertHttpRangeSupportUncached(
  url: string,
  options: AssertHttpRangeSupportOptions,
): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const notListed = fileNotListedError(readTargetLabel(options.label), url)

  if (notListed !== undefined) {
    throw notListed
  }

  let response: Response

  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        Range: RANGE_PROBE_HEADER,
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause
    }

    throw (
      likelyMissingFileError(readTargetLabel(options.label), url, cause) ??
      new Error(
        `${readTargetLabel(options.label)} cannot be range-read. The Range probe failed before an HTTP response was available. Confirm CORS allows GET and the Range request header for ${url}.`,
        { cause },
      )
    )
  }

  noteReadableResponse(url, response.status)

  const failedResponse = failedResponseMessage(
    readTargetLabel(options.label),
    url,
    response.status,
  )

  if (failedResponse !== undefined) {
    throw new Error(failedResponse)
  }

  // HTTP 206 shows the host honored the Range header. Content-Range is not
  // required: hosts that do not list it in Access-Control-Expose-Headers
  // (such as ftp.ebi.ac.uk) hide it from the browser, and the app's readers
  // take file sizes from Content-Length, which CORS always exposes.
  if (response.status !== 206) {
    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. Expected HTTP 206 for Range: ${RANGE_PROBE_HEADER}, received HTTP ${response.status}. Configure the host to honor byte-range GET requests for ${url}.`,
    )
  }
}

// A 404, a 403 from buckets that deny listing, or a 5xx means the file could not
// be fetched at all, so the host's Range support was never tested. The wording
// keeps "Range probe received HTTP <status>" so createStructuredLoadError can
// classify it.
function failedResponseMessage(
  label: string,
  url: string,
  status: number,
): string | undefined {
  const received = `The Range probe received HTTP ${status} for ${url}.`

  if (status === 404) {
    return `${label} was not found. ${received} Check that the file exists at this path.`
  }

  if (status === 403) {
    return `${label} could not be read. ${received} The file is missing (buckets that deny listing return 403 for missing keys) or not publicly readable.`
  }

  if (status >= 500 && status <= 599) {
    return `${label} could not be read. ${received} The host returned a server error, so Range support was not tested.`
  }

  return undefined
}

function rangeSupportCacheKey(url: string, label: string | undefined): string {
  return `${url}\n${label ?? ''}`
}

function readTargetLabel(label: string | undefined): string {
  return label ?? 'Dataset file'
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('HTTP Range support probe aborted.')
  error.name = 'AbortError'
  return error
}
