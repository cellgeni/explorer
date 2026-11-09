import { describe, expect, it } from 'vitest'
import { assertHttpRangeSupport } from '../../data/rangeSupport'
import {
  collectStructuredLoadErrors,
  createStructuredLoadError,
  formatStructuredError,
  isStructuredLoadError,
  readErrorMessage,
} from './loadErrorModel'

describe('loadErrorModel', () => {
  it('classifies dataset manifest errors before the HTTP status they mention', () => {
    const error = Object.assign(
      new Error('explorer.json: could not be read (HTTP 500).'),
      { name: 'DatasetManifestError' },
    )

    expect(createStructuredLoadError('Dataset overview', error)).toMatchObject({
      code: 'manifest',
      title: 'Dataset manifest is invalid',
      message: 'explorer.json: could not be read (HTTP 500).',
    })
  })

  it('explains incomplete Zarr stores instead of the downstream decode error', () => {
    const chunkError = Object.assign(
      new Error(
        'Zarr chunk tables/table/var/_index/0 could not be read (HTTP 404). String arrays have no fill value, so the store is incomplete.',
      ),
      { name: 'ZarrChunkUnavailableError' },
    )
    const incomplete = Object.assign(
      new Error(
        'SpatialData store is incomplete: 1 chunk is missing (tables/table/obsm/spatial/0/0). The read then failed with: boom',
      ),
      { name: 'SpatialDataIncompleteStoreError' },
    )

    for (const error of [chunkError, incomplete]) {
      expect(createStructuredLoadError('Dataset overview', error)).toMatchObject({
        code: 'http',
        title: 'Store objects missing or unreadable',
        message: error.message,
      })
    }
  })

  it('classifies common dataset load failures', () => {
    expect(
      createStructuredLoadError(
        'Dataset overview',
        new Error('cells.parquet cannot be range-read: expected HTTP 206'),
      ),
    ).toMatchObject({
      code: 'range-not-supported',
      title: 'Byte-range requests blocked',
    })
    expect(createStructuredLoadError('Annotations', new Error('HTTP 404'))).toMatchObject(
      {
        code: 'http',
        title: 'HTTP 404 response',
      },
    )
    expect(
      createStructuredLoadError('Morphology image', new TypeError('Failed to fetch')),
    ).toMatchObject({
      code: 'network',
      detail: 'TypeError',
    })
    expect(
      createStructuredLoadError(
        'Dataset overview',
        new Error('Offset is outside the bounds of the DataView'),
      ),
    ).toMatchObject({
      code: 'parquet-decode',
      title: 'cells.parquet decode failed',
    })
    expect(
      createStructuredLoadError(
        'Dataset overview',
        new RangeError('Out of bounds access'),
      ),
    ).toMatchObject({
      code: 'parquet-decode',
      title: 'cells.parquet decode failed',
      detail: 'RangeError',
    })
  })

  it('classifies a range-probed 404 or 403 as a missing file, not blocked Range', async () => {
    const notFound = await rangeProbeError(404)
    const forbidden = await rangeProbeError(403)

    expect(createStructuredLoadError('Dataset overview', notFound)).toMatchObject({
      code: 'http',
      title: 'File not found or not readable',
      message: readErrorMessage(notFound),
      action: 'Check the file path, then reload.',
    })
    expect(createStructuredLoadError('Dataset overview', forbidden)).toMatchObject({
      code: 'http',
      title: 'File not found or not readable',
      message: readErrorMessage(forbidden),
      action:
        'Check the file path and that the object is publicly readable. Buckets that deny listing return HTTP 403 for missing files.',
    })

    // Earlier probe wording and the TIFF tile reader still say "Expected HTTP 206".
    for (const message of [
      'cells-renamed.parquet cannot be range-read. Expected HTTP 206 for Range: bytes=0-0, received HTTP 404. Configure the host to honor byte-range GET requests for https://example.test/xenium/cells-renamed.parquet.',
      'Expected HTTP 206 for TIFF Range request, received 404.',
    ]) {
      expect(
        createStructuredLoadError('Morphology image', new Error(message)),
      ).toMatchObject({ code: 'http', title: 'File not found or not readable' })
    }
  })

  it('classifies a range-probed 5xx as a host server error, not blocked Range', async () => {
    const serverErrorAction =
      'The host failed to serve the file. Retry; if it keeps failing, check the server, gateway, or object store hosting the dataset.'

    for (const error of [
      await rangeProbeError(500),
      await rangeProbeError(503),
      new Error('Expected HTTP 206 for TIFF Range request, received 502.'),
    ]) {
      expect(createStructuredLoadError('Dataset overview', error)).toMatchObject({
        code: 'http',
        title: 'Host server error',
        message: readErrorMessage(error),
        action: serverErrorAction,
      })
    }
    expect(createStructuredLoadError('Annotations', new Error('HTTP 503'))).toMatchObject(
      {
        code: 'http',
        title: 'HTTP 503 response',
        action: serverErrorAction,
      },
    )
  })

  it('keeps range-not-supported for hosts that ignore or hide Range responses', async () => {
    const ignoredRange = await rangeProbeError(200)
    const hiddenContentRange = await rangeProbeError(206)

    for (const error of [ignoredRange, hiddenContentRange]) {
      expect(createStructuredLoadError('Dataset overview', error)).toMatchObject({
        code: 'range-not-supported',
        title: 'Byte-range requests blocked',
        message: readErrorMessage(error),
      })
    }
    expect(readErrorMessage(ignoredRange)).toContain('received HTTP 200')
    expect(readErrorMessage(hiddenContentRange)).toContain(
      'Content-Range was not exposed',
    )
  })

  it('classifies specialized manifest, decode, and unsupported matrix errors', () => {
    const unsupported = new Error('native CSC arrays in cell_feature_matrix.zarr.zip')
    unsupported.name = 'UnsupportedRoiGeneStatsMatrixError'

    expect(createStructuredLoadError('ROI genes', unsupported)).toMatchObject({
      code: 'unsupported',
      title: 'ROI gene matrix unavailable',
      detail: 'UnsupportedRoiGeneStatsMatrixError',
    })
    const overBudget = new Error(
      'Feature-barcode H5 matrix is 121.6 MB, exceeding the interactive full-file budget of 64.0 MB.',
    )
    overBudget.name = 'FullFileMatrixBudgetExceededError'

    expect(createStructuredLoadError('Gene expression', overBudget)).toMatchObject({
      code: 'unsupported',
      title: 'Expression matrix over budget',
      detail: 'FullFileMatrixBudgetExceededError',
    })
    const featureSliceOverBudget = new Error(
      'Feature Slice H5 is 503.2 MB, exceeding the interactive full-file budget of 128.0 MB.',
    )
    featureSliceOverBudget.name = 'FeatureSliceFullFileBudgetExceededError'

    expect(
      createStructuredLoadError('Gene expression', featureSliceOverBudget),
    ).toMatchObject({
      code: 'unsupported',
      title: 'Feature Slice H5 over budget',
      detail: 'FeatureSliceFullFileBudgetExceededError',
      action:
        'Use the lazy-range Feature Slice H5 backend for hosted Visium HD selected-gene overlays, or lower the full-file budget scope.',
    })
    const segmentationOverBudget = new Error(
      'Visium HD segmentation GeoJSON is 65.0 MB, exceeding the interactive full-file budget of 64.0 MB.',
    )
    segmentationOverBudget.name = 'VisiumHdSegmentationGeojsonBudgetExceededError'

    expect(
      createStructuredLoadError('Cell boundaries', segmentationOverBudget),
    ).toMatchObject({
      code: 'unsupported',
      title: 'Segmentation GeoJSON over budget',
      detail: 'VisiumHdSegmentationGeojsonBudgetExceededError',
      action:
        'Raise or remove the Visium HD segmentation GeoJSON budget, or provide a smaller segmentation source.',
    })
    const h5adOverLimit = new Error(
      'H5AD file is 350.0 MB, exceeding the browser load limit of 300.0 MB.',
    )
    h5adOverLimit.name = 'H5adFileSizeLimitExceededError'

    expect(createStructuredLoadError('Dataset overview', h5adOverLimit)).toMatchObject({
      code: 'size-limit',
      title: 'H5AD file too large',
      detail: 'H5adFileSizeLimitExceededError',
      action:
        'The file was not loaded. Use an H5AD file of 300 MB or smaller, or add a lazy H5AD reader before opening larger files.',
    })
    const h5adReferenceUnavailable = new Error(
      'H5AD file is 350.0 MB, exceeding the browser load limit of 300.0 MB, and no readable kerchunk reference file was found at https://example.test/data.h5ad.json.',
    )
    h5adReferenceUnavailable.name = 'H5adReferenceFileUnavailableError'

    expect(
      createStructuredLoadError('Dataset overview', h5adReferenceUnavailable),
    ).toMatchObject({
      code: 'size-limit',
      title: 'H5AD reference file unavailable',
      detail: 'H5adReferenceFileUnavailableError',
      action:
        'Generate and host a companion DATASET.h5ad.json kerchunk reference next to the oversized H5AD file.',
    })
    const h5adCscCellProfileUnavailable = new Error(
      'H5AD reference-backed CSC matrices cannot load all genes for selected cells without scanning the whole expression matrix (1,000 cells x 20,000 genes).',
    )
    h5adCscCellProfileUnavailable.name = 'H5adAllGeneCscMatrixUnsupportedError'

    expect(
      createStructuredLoadError('Cell details', h5adCscCellProfileUnavailable),
    ).toMatchObject({
      code: 'unsupported',
      title: 'H5AD cell profile unavailable',
      detail: 'H5adAllGeneCscMatrixUnsupportedError',
      action:
        'Use selected-gene expression for this H5AD, or provide a row-major CSR/dense matrix reference for full selected-cell profiles.',
    })
    expect(
      createStructuredLoadError(
        'Morphology image',
        new Error('experiment.xenium missing morphology.ome.tif'),
      ),
    ).toMatchObject({ code: 'manifest' })
    expect(
      createStructuredLoadError('Image tiles', new Error('tile decode failed')),
    ).toMatchObject({
      code: 'decode',
    })
  })

  it('formats, collects, and reads structured errors', () => {
    const error = createStructuredLoadError('Dataset diagnostics', 'plain failure')

    expect(error).toMatchObject({
      code: 'unknown',
      message: 'Unknown dataset error',
    })
    expect(isStructuredLoadError(error)).toBe(true)
    expect(isStructuredLoadError(null)).toBe(false)
    expect(formatStructuredError(error)).toBe(
      'Unexpected load error: Unknown dataset error',
    )
    expect(
      collectStructuredLoadErrors([{ status: 'idle' }, { status: 'error', error }]),
    ).toEqual([error])
    expect(readErrorMessage(new Error('specific'))).toBe('specific')
    expect(readErrorMessage({})).toBe('Unknown dataset error')
  })
})

// Runs the real Range probe against a stub response without Content-Range, so
// these tests break if its wording drifts from the classifier.
async function rangeProbeError(status: number): Promise<unknown> {
  return assertHttpRangeSupport('https://example.test/xenium/cells-renamed.parquet', {
    fetcher: async () => new Response(null, { status }),
    label: 'cells-renamed.parquet',
  }).then(
    () => new Error(`Range probe unexpectedly passed for HTTP ${status}`),
    (error: unknown) => error,
  )
}
