import { describe, expect, it } from 'vitest'
import {
  collectStructuredLoadErrors,
  createStructuredLoadError,
  formatStructuredError,
  isStructuredLoadError,
  readErrorMessage,
} from './loadErrorModel'

describe('loadErrorModel', () => {
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
