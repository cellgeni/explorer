export type LoadErrorCode =
  | 'network'
  | 'http'
  | 'range-not-supported'
  | 'size-limit'
  | 'unsupported'
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

export function createStructuredLoadError(
  source: LoadErrorSource,
  error: unknown,
): StructuredLoadError {
  const message = readErrorMessage(error)
  const normalizedMessage = message.toLowerCase()
  const detail = readErrorDetail(error)

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

  const httpStatus = /\bhttp\s+(\d{3})\b/i.exec(message)?.[1]

  if (httpStatus !== undefined) {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: `HTTP ${httpStatus} response`,
        message,
        action: 'Check the dataset URL and object permissions.',
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
          'Generate and host a companion DATASET.h5ad.json kerchunk reference next to the oversized H5AD file.',
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

function readErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name === 'Error') {
    return undefined
  }

  return error.name
}
