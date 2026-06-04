import { describe, expect, it, vi } from 'vitest'
import { runDatasetDiagnostics, summarizeDatasetDiagnostics } from './datasetDiagnostics'

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
})
