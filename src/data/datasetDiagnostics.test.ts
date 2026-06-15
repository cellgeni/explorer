import { describe, expect, it, vi } from 'vitest'
import { runDatasetDiagnostics, summarizeDatasetDiagnostics } from './datasetDiagnostics'
import type { SpatialDatasetDetection } from '../datasets/datasetFactory'

describe('runDatasetDiagnostics', () => {
  it('checks required manifest and byte-range files', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const rangeValidator = vi.fn(async () => undefined)

    const report = await runDatasetDiagnostics('https://example.test/output', {
      fetcher,
      rangeValidator,
    })

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/output/experiment.xenium',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/output/cells.parquet',
      expect.objectContaining({ label: 'Overview cells' }),
    )
    expect(summarizeDatasetDiagnostics(report)).toBe('All checks passed')
  })

  it('treats optional file misses as warnings', async () => {
    const report = await runDatasetDiagnostics('https://example.test/output', {
      fetcher: vi.fn(async () => new Response('{}', { status: 200 })),
      rangeValidator: vi.fn(async (url: string) => {
        if (url.endsWith('cell_boundaries.parquet')) {
          throw new Error('HTTP 404')
        }
      }),
    })

    expect(report.checks.find((check) => check.id === 'cell-boundaries')?.status).toBe(
      'warning',
    )
    expect(summarizeDatasetDiagnostics(report)).toContain('warnings')
  })

  it('checks Visium HD binned outputs instead of Xenium files', async () => {
    const detection: SpatialDatasetDetection = {
      platform: 'visium-hd',
      baseUrl: 'https://example.test/visium',
      segmentedScalefactorsPath: 'segmented_outputs/spatial/scalefactors_json.json',
      bins: [
        {
          binSizeMicrometers: 16,
          outputPath: 'binned_outputs/square_016um',
          tissuePositionsPath:
            'binned_outputs/square_016um/spatial/tissue_positions.parquet',
          scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
          filteredMatrixH5Path:
            'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
        },
      ],
      checked: [],
    }
    const detectDataset = vi.fn(async () => detection)
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const rangeValidator = vi.fn(async () => undefined)

    const report = await runDatasetDiagnostics('https://example.test/visium', {
      detectDataset,
      fetcher,
      rangeValidator,
    })

    expect(report.platform).toBe('visium-hd')
    expect(report.checks.find((check) => check.id === 'dataset-layout')).toMatchObject({
      status: 'pass',
      message: 'Detected Visium HD (16 µm)',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/spatial/scalefactors_json.json',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/spatial/scalefactors_json.json',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/spatial/tissue_positions.parquet',
      expect.objectContaining({ label: 'Visium HD 16um positions' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      expect.objectContaining({ label: 'Visium HD 16um filtered matrix' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/feature_slice.h5',
      expect.objectContaining({ label: 'Feature Slice H5' }),
    )
    expect(fetcher).not.toHaveBeenCalledWith(
      'https://example.test/visium/experiment.xenium',
      expect.anything(),
    )
  })
})
