import { describe, expect, it, vi } from 'vitest'
import {
  ROI_GENE_STATS_CELL_LIMIT,
  loadDatasetRoiGeneStats,
  summarizeRoiGeneExpression,
} from './roiGeneStats'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import type { GexResult } from './gex'
import type { DatasetCell, XeniumDataset } from '../datasets/xeniumDataset'

describe('ROI gene stats', () => {
  it('summarizes top ROI genes by total expression', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(1, 2)
    const matrix: GexResult = {
      geneNames: ['Actb', 'Gad1', 'Slc17a7'],
      cells: new Map([
        [cellA, { geneNames: ['Actb', 'Gad1'], counts: [5, 2] }],
        [cellB, { geneNames: ['Actb', 'Slc17a7'], counts: [3, 7] }],
      ]),
    }

    expect(
      summarizeRoiGeneExpression(matrix, {
        cellCount: 2,
        sampledCellIds: [cellA, cellB],
        geneLimit: 2,
      }),
    ).toEqual({
      genes: [
        {
          gene: 'Actb',
          count: 8,
          detectedCells: 2,
          percentCells: 100,
          meanPerCell: 4,
          percentTotal: 47.05882352941176,
        },
        {
          gene: 'Slc17a7',
          count: 7,
          detectedCells: 1,
          percentCells: 50,
          meanPerCell: 3.5,
          percentTotal: 41.17647058823529,
        },
      ],
      cellCount: 2,
      sampledCellCount: 2,
      totalCount: 17,
      hitCellLimit: false,
    })
  })

  it('loads ROI gene stats from the cell-feature matrix for sampled cells', async () => {
    const cells = Array.from(
      { length: ROI_GENE_STATS_CELL_LIMIT + 1 },
      (_value, index): DatasetCell => ({
        id: intToCellId(1, index + 1),
        position: { x: micrometers(index), y: micrometers(index) },
        transcriptCount: 1,
      }),
    )
    const matrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map(
        cells
          .slice(0, ROI_GENE_STATS_CELL_LIMIT)
          .map((cell) => [cell.id, { geneNames: ['Actb'], counts: [1] }]),
      ),
    }
    const dataset = {
      matrix: vi.fn(async () => matrix),
    } as unknown as XeniumDataset
    const validateRangeSupport = vi.fn(async () => undefined)

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      validateRangeSupport,
    })

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      { label: 'cell_feature_matrix.zarr.zip' },
    )
    expect(dataset.matrix).toHaveBeenCalledWith(
      expect.arrayContaining([intToCellId(1, 1), intToCellId(1, 2)]),
    )
    expect(stats.sampledCellCount).toBe(ROI_GENE_STATS_CELL_LIMIT)
    expect(stats.cellCount).toBe(ROI_GENE_STATS_CELL_LIMIT + 1)
    expect(stats.hitCellLimit).toBe(true)
  })
})
