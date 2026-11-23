import { firstUrlIn, insecureRequestAction } from './insecureRequest'
import { isWorkerStartError } from '../../workers/workerStartError'
import { APP_UPDATED_ACTION, isStaleChunkError } from './staleChunk'

export type LoadErrorCode =
  | 'network'
  | 'http'
  | 'range-not-supported'
  | 'size-limit'
  | 'unsupported'
  // Dataset detection (15.1-E): nothing at the address, credentials needed,
  // or no response at all (CORS or network).
  | 'not-found'
  | 'access-denied'
  | 'blocked'
  | 'parquet-decode'
  | 'manifest'
  | 'decode'
  // A lazily loaded part of the app is gone after a deploy (staleChunk.ts),
  // or a worker did not start (workerStartError.ts): both need a reload.
  | 'app-updated'
  | 'unknown'

export type LoadErrorSource =
  | 'Dataset overview'
  | 'Morphology image'
  | 'Image tiles'
  | 'Cell boundaries'
  | 'Nucleus boundaries'
  | 'Gene panel'
  | 'Annotations'
  | 'Embeddings'
  | 'ROI cells'
  | 'ROI genes'
  | 'ROI transcripts'
  | 'Transcripts'
  | 'Gene expression'
  | 'Magic lens'
  | 'Cell details'
  | 'Cell transcripts'
  | 'Dataset diagnostics'
  | 'Store structure'

export interface StructuredLoadError {
  readonly source: LoadErrorSource
  readonly code: LoadErrorCode
  readonly title: string
  readonly message: string
  readonly action: string
  readonly detail?: string
}

export function isStructuredLoadError(
  error: StructuredLoadError | null,
): error is StructuredLoadError {
  return error !== null
}

export function collectStructuredLoadErrors(
  states: readonly ErrorStateSummary[],
): readonly StructuredLoadError[] {
  return states.flatMap((state) =>
    state.status === 'error' && state.error !== undefined ? [state.error] : [],
  )
}

interface ErrorStateSummary {
  readonly status: string
  readonly error?: StructuredLoadError
}

export function formatStructuredError(error: StructuredLoadError): string {
  return `${error.title}: ${error.message}`
}

export interface LoadErrorContext {
  // The address being read, for errors that do not name one.
  readonly url?: string
  // The page's own address. Defaults to the current location.
  readonly pageUrl?: string
}

const SERVER_ERROR_ACTION =
  'The host failed to serve the file. Retry; if it keeps failing, check the server, gateway, or object store hosting the dataset.'
const ACCESS_DENIED_ACTION =
  'Make the files public, or open them through a public or presigned address.'
const RATE_LIMITED_ACTION =
  'The host is limiting how often it is read. Wait a minute, then reload.'

export function createStructuredLoadError(
  source: LoadErrorSource,
  error: unknown,
  context: LoadErrorContext = {},
): StructuredLoadError {
  const message = readErrorMessage(error)
  const normalizedMessage = message.toLowerCase()
  const detail = readErrorDetail(error)
  const rangeReadStatus = readRangeReadFailureStatus(normalizedMessage)
  const detection = readDatasetDetectionError(error)
  // Replaces the CORS advice when a read that got no response went from this
  // HTTPS page to a plain-http address (src/features/errors/insecureRequest.ts).
  const insecureAction = insecureRequestAction(
    detection?.checked[0]?.url ?? firstUrlIn(message) ?? context.url,
    context.pageUrl ?? currentPageUrl(),
  )

  if (detection !== null) {
    return datasetDetectionLoadError(source, message, detection, insecureAction)
  }

  // DatasetAddressError (src/datasets/datasetDetectionError.ts): nothing was
  // requested, so this comes before the network advice.
  if (error instanceof Error && error.name === 'DatasetAddressError') {
    return withOptionalDetail(
      {
        source,
        code: 'not-found',
        title: 'Not a web address',
        message,
        action:
          'Enter the full address, starting with https:// (or http:// for a server on this computer).',
      },
      detail,
    )
  }

  // Before the network advice: the browser reports a missing chunk as a
  // failed fetch, but the dataset is not at fault.
  if (isStaleChunkError(error)) {
    return withOptionalDetail(
      {
        source,
        code: 'app-updated',
        title: 'The app was updated',
        message,
        action: APP_UPDATED_ACTION,
      },
      detail,
    )
  }

  // Before the decode advice: every tile's worker fails the same way.
  if (isWorkerStartError(error)) {
    return withOptionalDetail(
      {
        source,
        code: 'app-updated',
        title: 'A background worker did not start',
        message,
        action:
          'Reload the page to start the workers again. If it keeps failing, check that the page is allowed to run workers.',
      },
      detail,
    )
  }

  if (rangeReadStatus === 403 || rangeReadStatus === 404) {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: 'File not found or not readable',
        message,
        action:
          rangeReadStatus === 403
            ? 'Check the file path and that the object is publicly readable. Buckets that deny listing return HTTP 403 for missing files.'
            : 'Check the file path, then reload.',
      },
      detail,
    )
  }

  // Thrown when the dataset folder's index page does not list the file
  // (src/data/folderListing.ts), and when a request failed without a response
  // on a host that hides its error responses (src/data/hostResponses.ts).
  if (error instanceof Error && error.name === 'FileNotListedError') {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: 'File not found',
        message,
        action: 'Check the file path, then reload.',
      },
      detail,
    )
  }

  // Thrown by Browse Store (src/zarr/zarrStructure.ts) when no metadata file
  // answers at the address.
  if (error instanceof Error && error.name === 'ZarrStructureNotFoundError') {
    return withOptionalDetail(
      {
        source,
        code: 'not-found',
        title: 'No Zarr store at this address',
        message,
        action:
          "Check that the address is the store's folder, the one holding zarr.json or .zgroup, and that its files are publicly readable. Buckets that deny listing answer HTTP 403 for missing files.",
      },
      detail,
    )
  }

  // Thrown when DuckDB cannot download one of its extensions
  // (src/data/duckdb.ts).
  if (error instanceof Error && error.name === 'DuckDbExtensionLoadError') {
    return withOptionalDetail(
      {
        source,
        code: 'network',
        title: 'DuckDB extension did not load',
        message,
        action:
          'DuckDB downloads its extensions from extensions.duckdb.org. Check that this network can reach it, then try again.',
      },
      detail,
    )
  }

  // Thrown by Browse File (src/data/parquetStructure.ts).
  if (error instanceof Error && error.name === 'ParquetFileNotFoundError') {
    return withOptionalDetail(
      {
        source,
        code: 'not-found',
        title: 'No Parquet file at this address',
        message,
        action:
          'Check the address and that the file is publicly readable. Buckets that deny listing answer HTTP 403 for missing files, and a dataset written as a folder of parts, such as SpatialData points, is browsed one part at a time.',
      },
      detail,
    )
  }

  if (error instanceof Error && error.name === 'NotParquetFileError') {
    return withOptionalDetail(
      {
        source,
        code: 'decode',
        title: 'Not a Parquet file',
        message,
        action:
          'Parquet files end with the bytes PAR1. Check that the address is the file itself, not a page about it.',
      },
      detail,
    )
  }

  if (error instanceof Error && error.name === 'LikelyMissingFileError') {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: 'File most likely missing',
        message,
        action:
          'Check that the file exists at this path. If it does, check the network connection and the CORS rules for this file on the host.',
      },
      detail,
    )
  }

  if (rangeReadStatus !== undefined && isServerErrorStatus(rangeReadStatus)) {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: 'Host server error',
        message,
        action: SERVER_ERROR_ACTION,
      },
      detail,
    )
  }

  // Thrown by detection for a dataset manifest (explorer.json) that cannot be
  // read or does not validate. Matched by name to keep this module free of
  // data-layer imports.
  if (error instanceof Error && error.name === 'DatasetManifestError') {
    return withOptionalDetail(
      {
        source,
        code: 'manifest',
        title: 'Dataset manifest is invalid',
        message,
        action:
          'Fix the field named in the message, or remove the manifest to load the dataset by its standard file names.',
      },
      detail,
    )
  }

  if (
    normalizedMessage.includes('cannot be range-read') ||
    normalizedMessage.includes('expected http 206')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'range-not-supported',
        title: 'Byte-range requests blocked',
        message,
        action:
          insecureAction !== undefined &&
          normalizedMessage.includes('before an http response')
            ? insecureAction
            : 'Configure the host to return HTTP 206 for Range requests.',
      },
      detail,
    )
  }

  if (isIncompleteZarrStoreError(error, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: 'Store objects missing or unreadable',
        message,
        action:
          'Check that every object in the store finished uploading and is publicly readable, then reload. Diagnose Dataset lists the missing chunks.',
      },
      detail,
    )
  }

  const httpStatus = /\bhttp\s+(\d{3})\b/i.exec(message)?.[1]

  if (httpStatus !== undefined) {
    return withOptionalDetail(
      { source, ...httpStatusError(Number(httpStatus)), message },
      detail,
    )
  }

  if (isTypeErrorLike(error) || isNetworkErrorMessage(normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'network',
        title: 'Network request failed',
        message,
        action: insecureAction ?? 'Check dataset URL, CORS, and network access.',
      },
      detail,
    )
  }

  if (isCellsParquetDecodeError(source, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'parquet-decode',
        title: 'cells.parquet decode failed',
        message: normalizedMessage.includes('unable to decode cells.parquet')
          ? message
          : `The overview cells.parquet file was reachable, but the browser Parquet reader could not decode it: ${message}.`,
        action:
          'Rewrite cells.parquet with a browser-compatible Parquet encoding or use an alternate overview reader for this dataset.',
      },
      detail,
    )
  }

  if (
    source === 'ROI genes' &&
    isUnsupportedRoiGeneStatsError(error, normalizedMessage)
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'ROI gene matrix unavailable',
        message,
        action:
          'Host a readable cell_feature_matrix.h5 for older XOA output; native CSC Zarr remains the fast path when available.',
      },
      detail,
    )
  }

  if (isSegmentationGeojsonBudgetError(error, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'Segmentation GeoJSON over budget',
        message,
        action:
          'Raise or remove the Visium HD segmentation GeoJSON budget, or provide a smaller segmentation source.',
      },
      detail,
    )
  }

  if (isFullFileMatrixBudgetError(error, normalizedMessage)) {
    if (isFeatureSliceBudgetError(error, normalizedMessage)) {
      return withOptionalDetail(
        {
          source,
          code: 'unsupported',
          title: 'Feature Slice H5 over budget',
          message,
          action:
            'Use the lazy-range Feature Slice H5 backend for hosted Visium HD selected-gene overlays, or lower the full-file budget scope.',
        },
        detail,
      )
    }

    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'Expression matrix over budget',
        message,
        action:
          'Use a smaller interactive matrix source or add a range-readable sparse matrix reader before enabling this expression overlay.',
      },
      detail,
    )
  }

  if (isSpatialDataConsolidatedMetadataError(error, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'SpatialData metadata not consolidated',
        message,
        action:
          'Re-write the store with consolidated Zarr metadata, for example sdata.write(path, consolidate_metadata=True) or zarr.consolidate_metadata(path).',
      },
      detail,
    )
  }

  if (isH5adAllGeneCscMatrixUnsupportedError(error, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'H5AD cell profile unavailable',
        message,
        action:
          'Use selected-gene expression for this H5AD, or write its /X as a row-major CSR or dense matrix for full selected-cell profiles.',
      },
      detail,
    )
  }

  if (isH5adDenseCellProfileOverBudgetError(error, normalizedMessage)) {
    const chunkedByGene = normalizedMessage.includes('chunked by gene')

    return withOptionalDetail(
      {
        source,
        code: 'size-limit',
        title: chunkedByGene
          ? 'Expression matrix chunked by gene'
          : 'Expression matrix chunks too large',
        message,
        action: `${
          chunkedByGene
            ? 'Colour cells by selected genes instead: each gene reads only its own chunks. '
            : ''
        }For cell profiles and ROI genes, rewrite /X in chunks of a few cells by every gene, such as adata.write_zarr(path, chunks=(1000, adata.n_vars)).`,
      },
      detail,
    )
  }

  if (isH5adReferenceUnavailableError(error, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'size-limit',
        title: 'H5AD reference file unavailable',
        message,
        action:
          'Host the H5AD file where it answers Range requests, or host a DATASET.h5ad.json reference or a DATASET.h5ad.icechunk repository next to it; scripts/make_h5ad_reference.py writes either.',
      },
      detail,
    )
  }

  if (isH5adFileSizeLimitError(error, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'size-limit',
        title: 'H5AD file too large',
        message,
        action:
          'The file was not loaded. Host it where it answers Range requests, or use an H5AD file of 300 MB or smaller.',
      },
      detail,
    )
  }

  if (
    normalizedMessage.includes('experiment.xenium') ||
    normalizedMessage.includes('no supported xenium ome-tiff')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'manifest',
        title: 'Dataset manifest is incomplete',
        message,
        action: 'Verify experiment.xenium lists the files needed by this layer.',
      },
      detail,
    )
  }

  if (normalizedMessage.includes('decode') || normalizedMessage.includes('tile')) {
    return withOptionalDetail(
      {
        source,
        code: 'decode',
        title: 'Image tile decode failed',
        message,
        action: 'Retry at this zoom level or disable the morphology image layer.',
      },
      detail,
    )
  }

  return withOptionalDetail(
    {
      source,
      code: 'unknown',
      title: 'Unexpected load error',
      message,
      action: 'Retry the request after checking the dataset URL.',
    },
    detail,
  )
}

function isTypeErrorLike(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'TypeError'
  )
}

function isNetworkErrorMessage(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('load failed') ||
    normalizedMessage.includes('network request failed') ||
    normalizedMessage.includes('networkerror')
  )
}

function currentPageUrl(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.href
}

export function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Unknown dataset error'
}

// The status a Range probe (src/data/rangeSupport.ts) or TIFF Range read
// received. A 404, a 403 from buckets that deny listing, or a 5xx means the file
// was never served, so the host's Range support was not tested.
function readRangeReadFailureStatus(normalizedMessage: string): number | undefined {
  const status =
    /\b(?:range probe|expected http 206)\b.*\breceived (?:http )?(\d{3})\b/.exec(
      normalizedMessage,
    )?.[1]

  return status === undefined ? undefined : Number(status)
}

// For a failed read that names its HTTP status and that no reader explains.
function httpStatusError(
  status: number,
): Pick<StructuredLoadError, 'code' | 'title' | 'action'> {
  if (status === 401) {
    return { code: 'access-denied', title: 'Access denied', action: ACCESS_DENIED_ACTION }
  }

  if (status === 429) {
    return { code: 'http', title: 'Too many requests', action: RATE_LIMITED_ACTION }
  }

  return {
    code: 'http',
    title: `HTTP ${status} response`,
    action: isServerErrorStatus(status)
      ? SERVER_ERROR_ACTION
      : 'Check the dataset URL and object permissions.',
  }
}

function isServerErrorStatus(status: number): boolean {
  return status >= 500 && status <= 599
}

function isUnsupportedRoiGeneStatsError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error && error.name === 'UnsupportedRoiGeneStatsMatrixError') ||
    normalizedMessage.includes('native csc arrays in cell_feature_matrix.zarr.zip') ||
    normalizedMessage.includes('readable cell_feature_matrix.h5 fallback')
  )
}

function isFullFileMatrixBudgetError(error: unknown, normalizedMessage: string): boolean {
  return (
    (error instanceof Error && error.name === 'FullFileMatrixBudgetExceededError') ||
    (error instanceof Error &&
      error.name === 'FeatureSliceFullFileBudgetExceededError') ||
    normalizedMessage.includes('interactive full-file budget')
  )
}

function isSegmentationGeojsonBudgetError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error &&
      error.name === 'VisiumHdSegmentationGeojsonBudgetExceededError') ||
    (normalizedMessage.includes('segmentation geojson') &&
      normalizedMessage.includes('interactive full-file budget'))
  )
}

function isFeatureSliceBudgetError(error: unknown, normalizedMessage: string): boolean {
  return (
    (error instanceof Error &&
      error.name === 'FeatureSliceFullFileBudgetExceededError') ||
    normalizedMessage.includes('feature slice h5')
  )
}

function isIncompleteZarrStoreError(error: unknown, normalizedMessage: string): boolean {
  return (
    (error instanceof Error &&
      (error.name === 'ZarrChunkUnavailableError' ||
        error.name === 'SpatialDataIncompleteStoreError')) ||
    normalizedMessage.startsWith('spatialdata store is incomplete') ||
    /^zarr chunk .* could not be read \(http \d{3}\)/.test(normalizedMessage)
  )
}

function isSpatialDataConsolidatedMetadataError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error && error.name === 'SpatialDataConsolidatedMetadataError') ||
    (normalizedMessage.includes('spatialdata store') &&
      normalizedMessage.includes('consolidated zarr metadata'))
  )
}

function isH5adAllGeneCscMatrixUnsupportedError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error && error.name === 'H5adAllGeneCscMatrixUnsupportedError') ||
    (normalizedMessage.includes('h5ad csc matrices read lazily') &&
      normalizedMessage.includes('scanning the whole expression matrix'))
  )
}

function isH5adDenseCellProfileOverBudgetError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error && error.name === 'H5adDenseCellProfileOverBudgetError') ||
    (normalizedMessage.includes('anndata dense /x') &&
      normalizedMessage.includes("one cell's profile would read"))
  )
}

function isH5adFileSizeLimitError(error: unknown, normalizedMessage: string): boolean {
  return (
    (error instanceof Error && error.name === 'H5adFileSizeLimitExceededError') ||
    (normalizedMessage.includes('h5ad file') &&
      normalizedMessage.includes('browser load limit'))
  )
}

function isH5adReferenceUnavailableError(
  error: unknown,
  normalizedMessage: string,
): boolean {
  return (
    (error instanceof Error && error.name === 'H5adReferenceFileUnavailableError') ||
    (normalizedMessage.includes('h5ad file') &&
      normalizedMessage.includes('kerchunk reference file'))
  )
}

function isCellsParquetDecodeError(
  source: LoadErrorSource,
  normalizedMessage: string,
): boolean {
  if (source !== 'Dataset overview') {
    return false
  }

  return (
    normalizedMessage.includes('unable to decode cells.parquet') ||
    normalizedMessage.includes('offset is outside the bounds of the dataview') ||
    normalizedMessage.includes('out of bounds access') ||
    normalizedMessage.includes('invalid typed array length')
  )
}

function withOptionalDetail(
  error: Omit<StructuredLoadError, 'detail'>,
  detail: string | undefined,
): StructuredLoadError {
  return detail === undefined ? error : { ...error, detail }
}

interface DatasetDetectionErrorSummary {
  readonly kind: string
  readonly checked: readonly {
    readonly path: string
    readonly url?: string
    readonly ok: boolean
    readonly status?: number
    readonly error?: string
  }[]
}

// DatasetDetectionError (src/datasets/datasetDetectionError.ts), matched by
// name to keep this module free of data-layer imports.
function readDatasetDetectionError(error: unknown): DatasetDetectionErrorSummary | null {
  if (!(error instanceof Error) || error.name !== 'DatasetDetectionError') {
    return null
  }

  const { kind, checked } = error as Error & Partial<DatasetDetectionErrorSummary>
  return typeof kind === 'string' && Array.isArray(checked) ? { kind, checked } : null
}

// The detail names the first few files checked; Run Diagnostics shows all.
const CHECKED_FILES_LISTED = 6

const DATASET_DETECTION_ERRORS: Record<
  string,
  { readonly code: LoadErrorCode; readonly title: string; readonly action: string }
> = {
  'not-found': {
    code: 'not-found',
    title: 'Dataset not found',
    action:
      'Check the address. If the files are there, check that they are publicly readable: buckets that deny listing answer HTTP 403 for missing files.',
  },
  'access-denied': {
    code: 'access-denied',
    title: 'Access denied',
    action: ACCESS_DENIED_ACTION,
  },
  blocked: {
    code: 'blocked',
    title: 'Request blocked',
    action:
      "Check the network connection, then the host's CORS rules: they must allow GET and HEAD with Range from this site. Run Diagnostics shows each request.",
  },
  timeout: {
    code: 'network',
    title: 'Host not responding',
    action:
      'Check the address and the network connection, then load again. Run Diagnostics shows each request.',
  },
  'server-error': {
    code: 'http',
    title: 'Host server error',
    action: SERVER_ERROR_ACTION,
  },
  refused: {
    code: 'http',
    title: 'Request refused',
    action:
      'Check the address. HTTP 429 means too many requests: wait, then load again. Run Diagnostics shows each request.',
  },
  unsupported: {
    code: 'unsupported',
    title: 'Unsupported dataset layout',
    action:
      'Open the dataset folder or its main file, or add an explorer.json manifest that names the files.',
  },
}

function datasetDetectionLoadError(
  source: LoadErrorSource,
  message: string,
  detection: DatasetDetectionErrorSummary,
  insecureAction: string | undefined,
): StructuredLoadError {
  const {
    code,
    title,
    action: defaultAction,
  } = DATASET_DETECTION_ERRORS[detection.kind] ?? DATASET_DETECTION_ERRORS.unsupported!
  const action =
    detection.kind === 'blocked' && insecureAction !== undefined
      ? insecureAction
      : defaultAction
  const listed = detection.checked.slice(0, CHECKED_FILES_LISTED)
  const unlisted = detection.checked.length - listed.length
  const detail = listed
    .map((probe) => {
      const outcome = probe.ok
        ? 'found'
        : probe.status !== undefined
          ? `HTTP ${probe.status}`
          : (probe.error ?? 'no response')
      return `${probe.path}: ${outcome}`
    })
    .join('; ')
  const more = unlisted > 0 ? `; and ${unlisted.toLocaleString()} more` : ''

  return withOptionalDetail(
    { source, code, title, message, action },
    detail === '' ? undefined : `Checked ${detail}${more}`,
  )
}

function readErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name === 'Error') {
    return undefined
  }

  return error.name
}
