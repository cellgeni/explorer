import { describe, expect, it, vi } from 'vitest'
import { warmDatasetForRoi } from './datasetWarmup'
import type { XeniumDataset } from '../datasets/xeniumDataset'

describe('dataset ROI warmup', () => {
  it('warms DuckDB, range probes, parquet footers, and zarr matrix metadata', async () => {
    const warm = vi.fn(async () => undefined)
    const getDataset = vi.fn(async () => ({ warm }) as unknown as XeniumDataset)
    const validateRangeSupport = vi.fn(async () => undefined)
    const warmMatrix = vi.fn(async () => undefined)
    const prefetchParquetFooter = vi.fn(async () => undefined)

    await warmDatasetForRoi('https://example.test/xenium/', {
      getDataset,
      prefetchParquetFooter,
      validateRangeSupport,
      warmMatrix,
    })

    expect(getDataset).toHaveBeenCalledWith('https://example.test/xenium/')
    expect(warm).toHaveBeenCalledOnce()
    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cells.parquet',
      { label: 'cells.parquet' },
    )
    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_boundaries.parquet',
      { label: 'cell_boundaries.parquet' },
    )
    expect(prefetchParquetFooter).toHaveBeenCalledWith(
      'https://example.test/xenium/cells.parquet',
      {},
    )
    expect(prefetchParquetFooter).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_boundaries.parquet',
      {},
    )
    expect(warmMatrix).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
    )
  })

  it('keeps required warmups successful when boundary footer warmup fails', async () => {
    const warm = vi.fn(async () => undefined)
    const getDataset = vi.fn(async () => ({ warm }) as unknown as XeniumDataset)
    const validateRangeSupport = vi.fn(async () => undefined)
    const warmMatrix = vi.fn(async () => undefined)
    const prefetchParquetFooter = vi
      .fn(async () => undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('missing boundaries'))

    await expect(
      warmDatasetForRoi('https://example.test/xenium/', {
        getDataset,
        prefetchParquetFooter,
        validateRangeSupport,
        warmMatrix,
      }),
    ).resolves.toBeUndefined()
  })
})
