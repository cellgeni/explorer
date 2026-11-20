import { describe, expect, it, vi } from 'vitest'
import { micrometers } from './coords'
import {
  ROI_CELL_EXPORT_LIMIT,
  loadDatasetRoiCells,
  roiCellsStoppedAtLimit,
} from './roiCells'
import type { RoiSelection } from './roiSelection'
import type { DatasetCell, XeniumDataset } from '../datasets/xeniumDataset'

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
    // One over the limit, to tell a full ROI from one with more inside.
    expect(cells).toHaveBeenCalledWith(bbox, { limit: ROI_CELL_EXPORT_LIMIT + 1 })
  })

  it('passes a custom ROI cell limit', async () => {
    const cells = vi.fn(async () => [])
    const getDataset = vi.fn(async () => ({ cells }) as unknown as XeniumDataset)

    await loadDatasetRoiCells('https://example.test/xenium/', bbox, {
      getDataset,
      limit: 250,
      validateRangeSupport: async () => undefined,
    })

    expect(cells).toHaveBeenCalledWith(bbox, { limit: 251 })
  })

  it('marks the cells cut short only when more lie inside than the limit', async () => {
    const cell = (index: number) =>
      ({
        id: `cell-${index}`,
        position: { x: micrometers(index), y: micrometers(0) },
      }) as unknown as DatasetCell
    const load = (count: number) =>
      loadDatasetRoiCells('https://example.test/xenium/', bbox, {
        getDataset: async () =>
          ({
            cells: async (_selection: unknown, { limit }: { limit: number }) =>
              Array.from({ length: Math.min(count, limit) }, (_, index) => cell(index)),
          }) as unknown as XeniumDataset,
        limit: 3,
        validateRangeSupport: async () => undefined,
      })

    const full = await load(3)
    expect(full.map(({ id }) => id)).toEqual(['cell-0', 'cell-1', 'cell-2'])
    expect(roiCellsStoppedAtLimit(full)).toBe(false)

    const more = await load(10)
    expect(more.map(({ id }) => id)).toEqual(['cell-0', 'cell-1', 'cell-2'])
    expect(roiCellsStoppedAtLimit(more)).toBe(true)
  })

  it('delegates lasso ROI selections to the dataset cell query', async () => {
    const cells = vi.fn(async () => [])
    const getDataset = vi.fn(async () => ({ cells }) as unknown as XeniumDataset)
    const selection: RoiSelection = {
      kind: 'lasso',
      bbox,
      points: [
        { x: micrometers(1), y: micrometers(3) },
        { x: micrometers(2), y: micrometers(3) },
        { x: micrometers(2), y: micrometers(4) },
      ],
    }

    await loadDatasetRoiCells('https://example.test/xenium/', selection, {
      getDataset,
      validateRangeSupport: async () => undefined,
    })

    expect(cells).toHaveBeenCalledWith(selection, { limit: ROI_CELL_EXPORT_LIMIT + 1 })
  })
})
