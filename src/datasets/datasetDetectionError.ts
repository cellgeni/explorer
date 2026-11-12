import type { DatasetProbeResult } from './datasetFactory'

// Why detection found no dataset it can read (UNIFIED_PLAN.md, 15.1-E):
// - not-found: every file answered 404, or 403 as buckets that deny listing
//   do for missing files, or was missing from the folder listing;
// - access-denied: the host asked for credentials (401);
// - blocked: no response at all, which in a browser is a CORS block or a
//   network failure;
// - server-error: the host failed (5xx);
// - refused: the host answered with another client error, such as 400, 405
//   or 429 (15.5-B; these were reported as blocked);
// - unsupported: some files were readable but form no layout the app knows.
export type DatasetDetectionErrorKind =
  | 'not-found'
  | 'access-denied'
  | 'blocked'
  | 'server-error'
  | 'refused'
  | 'unsupported'

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

const LISTED_FILE_LIMIT = 5

export function classifyDatasetDetection(
  checked: readonly DatasetProbeResult[],
): DatasetDetectionErrorKind {
  if (checked.length === 0 || checked.some((probe) => probe.ok)) return 'unsupported'

  const statuses = checked.flatMap((probe) =>
    probe.status === undefined ? [] : [probe.status],
  )

  if (statuses.some((status) => status === 401)) return 'access-denied'
  if (statuses.length > 0 && statuses.every((status) => status >= 500)) {
    return 'server-error'
  }
  if (statuses.some((status) => status === 403 || status === 404)) return 'not-found'
  if (statuses.length > 0) return 'refused'
  // Without any status every request failed before a response arrived. Files
  // that a folder listing ruled out were never requested.
  return checked.every((probe) => probe.error === 'not in the folder listing')
    ? 'not-found'
    : 'blocked'
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
  switch (kind) {
    case 'not-found':
      return `None of the ${checked.length.toLocaleString()} expected files were found at this address.`
    case 'access-denied':
      return 'The host asked for credentials, which the browser cannot send here.'
    case 'blocked':
      return 'The browser got no response. The host may not allow cross-origin requests (CORS), or the network is down.'
    case 'server-error':
      return 'The host returned server errors for the expected files.'
    case 'refused':
      return `The host refused the requests for the expected files (${listStatuses(checked)}).`
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
