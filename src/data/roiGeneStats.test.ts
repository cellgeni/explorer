import { describe, expect, it, vi } from 'vitest'
import {
  ROI_GENE_STATS_CELL_LIMIT,
  loadDatasetRoiGeneStats,
  summarizeRoiGeneExpression,
} from './roiGeneStats'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import type { GexResult } from './gex'
import type { DatasetCell } from '../datasets/xeniumDataset'

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
    }
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

  it('can use a contiguous head sample for low-latency previews', async () => {
    const cells = Array.from(
      { length: 5 },
      (_value, index): DatasetCell => ({
        id: intToCellId(1, index + 1),
        position: { x: micrometers(index), y: micrometers(index) },
        transcriptCount: 1,
      }),
    )
    const matrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map(
        cells.slice(0, 2).map((cell) => [cell.id, { geneNames: ['Actb'], counts: [1] }]),
      ),
    }
    const dataset = {
      matrix: vi.fn(async () => matrix),
    }

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      cellLimit: 2,
      getDataset: () => dataset,
      sampleStrategy: 'head',
      validateRangeSupport: vi.fn(async () => undefined),
    })

    expect(dataset.matrix).toHaveBeenCalledWith([intToCellId(1, 1), intToCellId(1, 2)])
    expect(stats.sampledCellCount).toBe(2)
    expect(stats.hitCellLimit).toBe(true)
  })

  it('uses row-hinted ROI cells when the dataset exposes a cell-aware matrix reader', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(1, 2)
    const cells: readonly DatasetCell[] = [
      {
        id: cellA,
        position: { x: micrometers(1), y: micrometers(2) },
        cellFeatureMatrixRow: 4,
      },
      {
        id: cellB,
        position: { x: micrometers(3), y: micrometers(4) },
        cellFeatureMatrixRow: 9,
      },
    ]
    const matrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map([
        [cellA, { geneNames: ['Actb'], counts: [2] }],
        [cellB, { geneNames: ['Actb'], counts: [3] }],
      ]),
    }
    const dataset = {
      matrix: vi.fn(async () => {
        throw new Error('global id map should not be used')
      }),
      matrixForCells: vi.fn(async () => matrix),
    }
    const validateRangeSupport = vi.fn(async () => undefined)

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      validateRangeSupport,
    })

    expect(dataset.matrixForCells).toHaveBeenCalledWith(cells)
    expect(dataset.matrix).not.toHaveBeenCalled()
    expect(stats.genes[0]).toMatchObject({ gene: 'Actb', count: 5 })
  })

  it('reports unsupported ROI gene stats when the matrix layout is unavailable', async () => {
    const cellId = intToCellId(1, 1)
    const cells: readonly DatasetCell[] = [
      {
        id: cellId,
        position: { x: micrometers(1), y: micrometers(2) },
      },
    ]
    const transcriptMatrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map([[cellId, { geneNames: ['Actb'], counts: [9] }]]),
    }
    const dataset = {
      matrix: vi.fn(async () => {
        throw new Error('cell_features/csc/indptr not found')
      }),
      transcriptsForCellIds: vi.fn(async () => transcriptMatrix),
    }
    const validateRangeSupport = vi.fn(async () => undefined)
    const readH5Matrix = vi.fn(async () => {
      throw new Error('cell_feature_matrix.h5 not found')
    })
    const onFallback = vi.fn()

    await expect(
      loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
        getDataset: () => dataset,
        onFallback,
        validateRangeSupport,
        readH5Matrix,
      }),
    ).rejects.toThrow(
      'ROI gene stats need native CSC arrays in cell_feature_matrix.zarr.zip or a readable cell_feature_matrix.h5 fallback',
    )

    expect(dataset.matrix).toHaveBeenCalledWith([cellId])
    expect(readH5Matrix).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.h5',
      [cellId],
      {},
    )
    expect(dataset.transcriptsForCellIds).not.toHaveBeenCalled()
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ROI genes',
        message: expect.stringContaining('switched to cell_feature_matrix.h5'),
        coalesceKey: 'roi-genes-h5:https://example.test/xenium',
      }),
    )
  })

  it('falls back to H5 matrix stats when the Zarr matrix layout is unavailable', async () => {
    const cellId = intToCellId(1, 1)
    const cells: readonly DatasetCell[] = [
      {
        id: cellId,
        position: { x: micrometers(1), y: micrometers(2) },
      },
    ]
    const h5Matrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map([[cellId, { geneNames: ['Actb'], counts: [11] }]]),
    }
    const dataset = {
      matrix: vi.fn(async () => {
        throw new Error('cell_features/csc/indptr not found')
      }),
      transcriptsForCellIds: vi.fn(async () => {
        throw new Error('transcripts should not be queried')
      }),
    }
    const validateRangeSupport = vi.fn(async () => undefined)
    const readH5Matrix = vi.fn(async () => h5Matrix)
    const onFallback = vi.fn()

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      onFallback,
      validateRangeSupport,
      readH5Matrix,
    })

    expect(readH5Matrix).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.h5',
      [cellId],
      {},
    )
    expect(dataset.transcriptsForCellIds).not.toHaveBeenCalled()
    expect(stats.genes[0]).toMatchObject({
      gene: 'Actb',
      count: 11,
      detectedCells: 1,
    })
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ROI genes',
        message: expect.stringContaining('switched to cell_feature_matrix.h5'),
        coalesceKey: 'roi-genes-h5:https://example.test/xenium',
      }),
    )
  })

  it('can explicitly fall back to transcript aggregation', async () => {
    const cellId = intToCellId(1, 1)
    const cells: readonly DatasetCell[] = [
      {
        id: cellId,
        position: { x: micrometers(1), y: micrometers(2) },
      },
    ]
    const transcriptMatrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map([[cellId, { geneNames: ['Actb'], counts: [9] }]]),
    }
    const dataset = {
      matrix: vi.fn(async () => {
        throw new Error('cell_features/csc/indptr not found')
      }),
      transcriptsForCellIds: vi.fn(async () => transcriptMatrix),
    }
    const validateRangeSupport = vi.fn(async () => undefined)
    const readH5Matrix = vi.fn(async () => {
      throw new Error('cell_feature_matrix.h5 not found')
    })
    const onFallback = vi.fn()

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      onFallback,
      validateRangeSupport,
      allowTranscriptFallback: true,
      readH5Matrix,
    })

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/transcripts.parquet',
      { label: 'transcripts.parquet' },
    )
    expect(dataset.transcriptsForCellIds).toHaveBeenCalledWith([cellId])
    expect(stats.genes[0]).toMatchObject({
      gene: 'Actb',
      count: 9,
      detectedCells: 1,
    })
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ROI genes',
        message: expect.stringContaining('switched to cell_feature_matrix.h5'),
        coalesceKey: 'roi-genes-h5:https://example.test/xenium',
      }),
    )
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ROI genes',
        message: expect.stringContaining('switched to transcript aggregation'),
        coalesceKey: 'roi-genes-transcripts:https://example.test/xenium',
      }),
    )
  })
})
