import type { DatasetProbeResult } from './datasetFactory'

// Why detection found no dataset it can read (plan 15.1-E). Probes that show
// a file is absent rule it out: a 404, a 403 as buckets that deny listing send
// for missing files, a file missing from the folder listing, or a failed fetch
// on a host that hides its error responses. When every probe rules its file
// out, the kind is not-found; otherwise the probes left open name the cause:
// - access-denied: the host asked for credentials (401);
// - server-error: the host failed (5xx);
// - refused: the host answered with another client error, such as 400, 405
//   or 429 (15.5-B; these were reported as blocked);
// - timeout: no answer before the probe timeout;
// - blocked: no response at all, which in a browser is a CORS block or a
//   network failure;
// - unsupported: some files were readable but form no layout the app knows.
export type DatasetDetectionErrorKind =
  | 'not-found'
  | 'access-denied'
  | 'blocked'
  | 'timeout'
  | 'server-error'
  | 'refused'
  | 'unsupported'

// Probe errors detection records without a status.
export const PROBE_NOT_LISTED = 'not in the folder listing'
// A fetch that failed without a response on a host that has answered other
// requests readably, never with an error status: the host hides its error
// responses (src/data/hostResponses.ts), so the file is most likely missing.
export const PROBE_HIDDEN_ERROR = 'no readable response, most likely missing'

const TIMED_OUT = /^Request timed out\b/

export function isTimedOutProbe(probe: DatasetProbeResult): boolean {
  return probe.status === undefined && TIMED_OUT.test(probe.error ?? '')
}

export const DATASET_DETECTION_ERROR_NAME = 'DatasetDetectionError'

export class DatasetDetectionError extends Error {
  readonly kind: DatasetDetectionErrorKind
  readonly checked: readonly DatasetProbeResult[]

  constructor(
    kind: DatasetDetectionErrorKind,
    message: string,
    checked: readonly DatasetProbeResult[],
  ) {
    super(message)
    this.name = DATASET_DETECTION_ERROR_NAME
    this.kind = kind
    this.checked = checked
  }
}

// Detection reads http and https addresses, and paths on the viewer's own
// host ("/data/sample.h5ad", "./run-1"). An address pasted without its scheme
// ("data.example.org/run-1") is neither.
export function isWebAddress(address: string): boolean {
  if (/^\.{0,2}\//.test(address)) return true

  try {
    const { protocol } = new URL(address)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export const DATASET_ADDRESS_ERROR_NAME = 'DatasetAddressError'

export class DatasetAddressError extends Error {
  constructor(address: string) {
    super(
      `"${address}" is not a web address: it does not start with https:// or http://, or with / for a path on this site.`,
    )
    this.name = DATASET_ADDRESS_ERROR_NAME
  }
}

const LISTED_FILE_LIMIT = 5

export function classifyDatasetDetection(
  checked: readonly DatasetProbeResult[],
): DatasetDetectionErrorKind {
  if (checked.length === 0 || checked.some((probe) => probe.ok)) return 'unsupported'

  const open = openProbes(checked)

  if (open.length === 0) return 'not-found'

  const statuses = open.flatMap((probe) =>
    probe.status === undefined ? [] : [probe.status],
  )

  if (statuses.some((status) => status === 401)) return 'access-denied'
  if (statuses.length > 0) {
    return statuses.every((status) => status >= 500) ? 'server-error' : 'refused'
  }

  return open.every(isTimedOutProbe) ? 'timeout' : 'blocked'
}

// The probes that leave their file's presence open.
function openProbes(checked: readonly DatasetProbeResult[]): DatasetProbeResult[] {
  return checked.filter(
    (probe) =>
      probe.status !== 403 &&
      probe.status !== 404 &&
      probe.error !== PROBE_NOT_LISTED &&
      probe.error !== PROBE_HIDDEN_ERROR,
  )
}

// The error thrown when detection returns no platform.
export function datasetDetectionError(
  checked: readonly DatasetProbeResult[],
): DatasetDetectionError {
  const kind = classifyDatasetDetection(checked)
  return new DatasetDetectionError(kind, detectionMessage(kind, checked), checked)
}

function detectionMessage(
  kind: DatasetDetectionErrorKind,
  checked: readonly DatasetProbeResult[],
): string {
  const open = openProbes(checked)
  // "for 3 of the 32 expected files", or "for the expected files"
  const share =
    open.length < checked.length
      ? `${open.length.toLocaleString()} of the ${checked.length.toLocaleString()} expected files`
      : 'the expected files'

  switch (kind) {
    case 'not-found':
      return `None of the ${checked.length.toLocaleString()} expected files were found at this address.`
    case 'access-denied':
      return 'The host asked for credentials, which the browser cannot send here.'
    case 'blocked':
      return open.length < checked.length
        ? `The browser got no response for ${share}, so they may be there. The host may not allow cross-origin requests (CORS) for them, or the network dropped them.`
        : 'The browser got no response. The host may not allow cross-origin requests (CORS), or the network is down.'
    case 'timeout': {
      const timeoutMs = /after ([\d,]+) ms/.exec(open[0]?.error ?? '')?.[1]
      const seconds =
        timeoutMs === undefined ? undefined : Number(timeoutMs.replace(/,/g, '')) / 1000
      return `The host did not answer the requests for ${share} ${seconds === undefined ? 'in time' : `within ${seconds.toLocaleString()} s`}.`
    }
    case 'server-error':
      return `The host returned server errors for ${share} (${listStatuses(open)}).`
    case 'refused':
      return `The host refused the requests for ${share} (${listStatuses(open)}).`
    case 'unsupported': {
      const found = checked.filter((probe) => probe.ok).map((probe) => probe.path)
      return found.length === 0
        ? 'No supported dataset layout was found.'
        : `Found ${listFiles(found)}, but not a dataset layout the app reads.`
    }
  }
}

// "HTTP 405" or "HTTP 400 and 429"
function listStatuses(checked: readonly DatasetProbeResult[]): string {
  const statuses = [
    ...new Set(
      checked.flatMap((probe) => (probe.status === undefined ? [] : [probe.status])),
    ),
  ].sort((left, right) => left - right)
  const last = statuses.pop()
  return statuses.length === 0
    ? `HTTP ${String(last)}`
    : `HTTP ${statuses.join(', ')} and ${String(last)}`
}

// "a, b and 3 more"
function listFiles(paths: readonly string[]): string {
  const shown = paths.slice(0, LISTED_FILE_LIMIT).join(', ')
  const rest = paths.length - LISTED_FILE_LIMIT
  return rest > 0 ? `${shown} and ${rest.toLocaleString()} more` : shown
}
