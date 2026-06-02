import { describe, expect, it, vi } from 'vitest'
import { micrometers } from './coords'
import { ROI_CELL_EXPORT_LIMIT, loadDatasetRoiCells } from './roiCells'
import type { XeniumDataset } from '../datasets/xeniumDataset'

const bbox = {
  minX: micrometers(1),
  maxX: micrometers(2),
  minY: micrometers(3),
  maxY: micrometers(4),
}

describe('dataset ROI cell loader', () => {
  it('validates range support and delegates to the dataset cell query', async () => {
    const validateRangeSupport = vi.fn(async () => undefined)
    const cells = vi.fn(async () => [])
    const getDataset = vi.fn(async () => ({ cells }) as unknown as XeniumDataset)

    await expect(
      loadDatasetRoiCells('https://example.test/xenium/', bbox, {
        getDataset,
        validateRangeSupport,
      }),
    ).resolves.toEqual([])

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cells.parquet',
      { label: 'cells.parquet' },
    )
    expect(getDataset).toHaveBeenCalledWith('https://example.test/xenium/')
    expect(cells).toHaveBeenCalledWith(bbox, { limit: ROI_CELL_EXPORT_LIMIT })
  })

  it('passes a custom ROI cell limit', async () => {
    const cells = vi.fn(async () => [])
    const getDataset = vi.fn(async () => ({ cells }) as unknown as XeniumDataset)

    await loadDatasetRoiCells('https://example.test/xenium/', bbox, {
      getDataset,
      limit: 250,
      validateRangeSupport: async () => undefined,
    })

    expect(cells).toHaveBeenCalledWith(bbox, { limit: 250 })
  })
})
