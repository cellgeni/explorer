import { beforeEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from './coords'
import { loadDatasetGeneExpression } from './geneExpression'
import { cachedXeniumDataset } from './xeniumDatasetCache'
import type { XeniumDataset } from '../datasets/xeniumDataset'

vi.mock('./xeniumDatasetCache', () => ({
  cachedXeniumDataset: vi.fn(),
}))

const bbox = {
  minX: micrometers(0),
  maxX: micrometers(10),
  minY: micrometers(0),
  maxY: micrometers(20),
}

describe('dataset gene expression loader', () => {
  beforeEach(() => {
    vi.mocked(cachedXeniumDataset).mockReset()
  })

  it('returns an empty batch without I/O when no genes are selected', async () => {
    await expect(
      loadDatasetGeneExpression('https://example.test/xenium/', bbox, []),
    ).resolves.toEqual({
      cells: [],
      genes: [],
      maxCount: 0,
    })
    expect(cachedXeniumDataset).not.toHaveBeenCalled()
  })

  it('validates feature-matrix Range support before delegating to the cached dataset', async () => {
    const batch = { cells: [], genes: ['Gad1'], maxCount: 0 }
    const geneExpression = vi.fn(async () => batch)
    const validateRangeSupport = vi.fn(async () => undefined)

    vi.mocked(cachedXeniumDataset).mockResolvedValue({
      geneExpression,
    } as unknown as XeniumDataset)

    await expect(
      loadDatasetGeneExpression('https://example.test/xenium/', bbox, ['Gad1'], {
        limit: 25,
        validateRangeSupport,
      }),
    ).resolves.toBe(batch)

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      { label: 'cell_feature_matrix.zarr.zip' },
    )
    expect(geneExpression).toHaveBeenCalledWith(bbox, ['Gad1'], { limit: 25 })
  })
})
