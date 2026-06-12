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
    expect(geneExpression).toHaveBeenCalledWith(
      bbox,
      ['Gad1'],
      expect.objectContaining({
        limit: 25,
        onStageTiming: expect.any(Function) as (timing: unknown) => void,
      }),
    )
  })

  it('reports stage timings and preserves them on timed batches', async () => {
    const batch = {
      cells: [],
      genes: ['Gad1'],
      maxCount: 0,
      timing: {
        viewportCellsMs: 3,
        matrixReadMs: 5,
        scoreCellsMs: 1,
        totalMs: 10,
      },
    }
    const geneExpression = vi.fn(async (_bbox, _genes, options) => {
      options?.onStageTiming?.({
        stage: 'viewport-cells',
        label: 'Viewport cell query',
        durationMs: 3,
        detail: '2 cells',
      })

      return batch
    })
    const validateRangeSupport = vi.fn(async () => undefined)
    const onStageTiming = vi.fn()

    vi.mocked(cachedXeniumDataset).mockResolvedValue({
      geneExpression,
    } as unknown as XeniumDataset)

    const result = await loadDatasetGeneExpression(
      'https://example.test/xenium/',
      bbox,
      ['Gad1'],
      {
        onStageTiming,
        validateRangeSupport,
      },
    )

    expect(onStageTiming).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'range-check' }),
    )
    expect(onStageTiming).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'dataset-cache' }),
    )
    expect(onStageTiming).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'viewport-cells', durationMs: 3 }),
    )
    expect(result.timing?.stageSummary).toContain('Feature matrix Range check')
    expect(result.timing?.stageSummary).toContain('Viewport cell query 3 ms')
    expect(result.timing?.stageTimings).toHaveLength(3)
  })
})
