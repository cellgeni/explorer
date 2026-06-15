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
