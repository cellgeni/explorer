import { describe, expect, it, vi } from 'vitest'
import {
  ROI_GENE_STATS_CELL_LIMIT,
  RoiGeneStatsH5FallbackSkippedError,
  loadDatasetRoiGeneStats,
  summarizeRoiGeneExpression,
} from './roiGeneStats'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import type { GexResult } from './gex'
import type { DatasetCell } from '../datasets/spatialDataset'

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

  it('sums stored negative values but detects only positive ones', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(1, 2)
    const matrix: GexResult = {
      geneNames: ['Actb', 'Gad1'],
      cells: new Map([
        [cellA, { geneNames: ['Actb', 'Gad1'], counts: [2, -1] }],
        [cellB, { geneNames: ['Gad1'], counts: [3] }],
      ]),
    }

    const stats = summarizeRoiGeneExpression(matrix, {
      cellCount: 2,
      sampledCellIds: [cellA, cellB],
    })

    expect(stats.genes.find(({ gene }) => gene === 'Gad1')).toMatchObject({
      count: 2,
      detectedCells: 1,
      percentCells: 50,
      meanPerCell: 1,
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
    const cells = Array.from({ length: 5 }, (_value, index): DatasetCell => ({
      id: intToCellId(1, index + 1),
      position: { x: micrometers(index), y: micrometers(index) },
      transcriptCount: 1,
    }))
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

  it('range-reads the H5 matrix after a Range probe of it', async () => {
    const cellId = intToCellId(1, 1)
    const cells: readonly DatasetCell[] = [
      { id: cellId, position: { x: micrometers(1), y: micrometers(2) } },
    ]
    const dataset = {
      matrix: vi.fn(async (): Promise<GexResult> => {
        throw new Error('cell_features/csc/indptr not found')
      }),
    }
    const validateRangeSupport = vi.fn(async () => undefined)
    const readH5Matrix = vi.fn(async (): Promise<GexResult> => ({
      geneNames: ['Actb'],
      cells: new Map([[cellId, { geneNames: ['Actb'], counts: [6] }]]),
    }))
    const onFallback = vi.fn()

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      onFallback,
      validateRangeSupport,
      h5Fallback: 'range-read',
      readH5Matrix,
    })

    expect(validateRangeSupport).toHaveBeenLastCalledWith(
      'https://example.test/xenium/cell_feature_matrix.h5',
      { label: 'cell_feature_matrix.h5' },
    )
    expect(readH5Matrix).toHaveBeenCalledTimes(1)
    expect(stats.genes[0]).toMatchObject({ gene: 'Actb', count: 6 })
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('switched to cell_feature_matrix.h5'),
      }),
    )
  })

  it('stops at the Zarr matrix when the H5 matrix cannot be range-read', async () => {
    const cellId = intToCellId(1, 1)
    const cells: readonly DatasetCell[] = [
      {
        id: cellId,
        position: { x: micrometers(1), y: micrometers(2) },
        cellFeatureMatrixRow: 0,
      },
    ]
    const zarrError = new Error(
      'cell_feature_matrix.zarr.zip does not expose cell-major csc/indptr, csc/indices, and csc/data arrays.',
    )
    const rangeError = new Error(
      'cell_feature_matrix.h5 cannot be range-read. Expected HTTP 206 for Range: bytes=0-0, received HTTP 200.',
    )
    const dataset = {
      matrix: vi.fn(async (): Promise<GexResult> => {
        throw new Error('matrixForCells should be used')
      }),
      matrixForCells: vi.fn(async (): Promise<GexResult> => {
        throw zarrError
      }),
      transcriptsForCellIds: vi.fn(async (): Promise<GexResult> => {
        throw new Error('transcripts should not be queried')
      }),
    }
    const validateRangeSupport = vi.fn(async (url: string) => {
      if (url.endsWith('.h5')) {
        throw rangeError
      }
    })
    const readH5Matrix = vi.fn(async (): Promise<GexResult> => {
      throw new Error('cell_feature_matrix.h5 should not be read')
    })
    const onFallback = vi.fn()

    const result = loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      onFallback,
      validateRangeSupport,
      h5Fallback: 'range-read',
      allowTranscriptFallback: true,
      readH5Matrix,
    })

    await expect(result).rejects.toBeInstanceOf(RoiGeneStatsH5FallbackSkippedError)
    await expect(result).rejects.toMatchObject({
      cause: { zarr: zarrError, h5: rangeError },
    })
    expect(dataset.matrixForCells).toHaveBeenCalledWith(cells)
    expect(readH5Matrix).not.toHaveBeenCalled()
    expect(dataset.transcriptsForCellIds).not.toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('reads the Zarr matrix without probing the H5 matrix', async () => {
    const cellId = intToCellId(1, 1)
    const cells: readonly DatasetCell[] = [
      {
        id: cellId,
        position: { x: micrometers(1), y: micrometers(2) },
      },
    ]
    const zarrMatrix: GexResult = {
      geneNames: ['Actb'],
      cells: new Map([[cellId, { geneNames: ['Actb'], counts: [4] }]]),
    }
    const dataset = { matrix: vi.fn(async () => zarrMatrix) }
    const validateRangeSupport = vi.fn(async () => undefined)
    const readH5Matrix = vi.fn(async (): Promise<GexResult> => {
      throw new Error('cell_feature_matrix.h5 should not be read')
    })
    const onFallback = vi.fn()

    const stats = await loadDatasetRoiGeneStats('https://example.test/xenium', cells, {
      getDataset: () => dataset,
      onFallback,
      validateRangeSupport,
      h5Fallback: 'range-read',
      readH5Matrix,
    })

    expect(stats.genes[0]).toMatchObject({ gene: 'Actb', count: 4, detectedCells: 1 })
    expect(validateRangeSupport).toHaveBeenCalledTimes(1)
    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      expect.anything(),
    )
    expect(readH5Matrix).not.toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
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
