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
  | 'unknown'

export type LoadErrorSource =
  | 'Dataset overview'
  | 'Morphology image'
  | 'Image tiles'
  | 'Cell boundaries'
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

const SERVER_ERROR_ACTION =
  'The host failed to serve the file. Retry; if it keeps failing, check the server, gateway, or object store hosting the dataset.'

export function createStructuredLoadError(
  source: LoadErrorSource,
  error: unknown,
): StructuredLoadError {
  const message = readErrorMessage(error)
  const normalizedMessage = message.toLowerCase()
  const detail = readErrorDetail(error)
  const rangeReadStatus = readRangeReadFailureStatus(normalizedMessage)
  const detection = readDatasetDetectionError(error)

  if (detection !== null) {
    return datasetDetectionLoadError(source, message, detection)
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
  // read or does not validate. Matched by name to keep this module import-free.
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
        action: 'Configure the host to return HTTP 206 for Range requests.',
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
      {
        source,
        code: 'http',
        title: `HTTP ${httpStatus} response`,
        message,
        action: isServerErrorStatus(Number(httpStatus))
          ? SERVER_ERROR_ACTION
          : 'Check the dataset URL and object permissions.',
      },
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
        action: 'Check dataset URL, CORS, and network access.',
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
          'Use selected-gene expression for this H5AD, or provide a row-major CSR/dense matrix reference for full selected-cell profiles.',
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
          'Host a DATASET.h5ad.json reference or a DATASET.h5ad.icechunk repository next to the oversized H5AD file; scripts/make_h5ad_reference.py writes either.',
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
          'The file was not loaded. Use an H5AD file of 300 MB or smaller, or add a lazy H5AD reader before opening larger files.',
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
    (normalizedMessage.includes('h5ad reference-backed csc matrices') &&
      normalizedMessage.includes('scanning the whole expression matrix'))
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
    readonly ok: boolean
    readonly status?: number
    readonly error?: string
  }[]
}

// DatasetDetectionError (src/datasets/datasetDetectionError.ts), matched by
// name to keep this module import-free.
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
    action: 'Make the files public, or open them through a public or presigned address.',
  },
  blocked: {
    code: 'blocked',
    title: 'Request blocked',
    action:
      "Check the network connection, then the host's CORS rules: they must allow GET and HEAD with Range from this site. Run Diagnostics shows each request.",
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
): StructuredLoadError {
  const { code, title, action } =
    DATASET_DETECTION_ERRORS[detection.kind] ?? DATASET_DETECTION_ERRORS.unsupported!
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
