import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { SpatialDatasetDetection } from '../../datasets/datasetFactory'
import {
  openPreviewSource,
  PREVIEW_MAX_CELLS,
  PREVIEW_MAX_WHOLE_FILE_BYTES,
  PreviewUnavailableError,
  type CollectionPreviewLoaders,
} from './collectionPreviewData'

const URL_A = 'https://example.test/a.zarr'

function point(x: number, y: number) {
  return { position: { x: micrometers(x), y: micrometers(y) }, transcriptCount: 0 }
}

function loaders(
  detection: Partial<SpatialDatasetDetection> & { readonly platform: string },
  overrides: Partial<CollectionPreviewLoaders> = {},
): CollectionPreviewLoaders {
  return {
    detectSpatialDataset: vi.fn(async () => ({
      baseUrl: URL_A,
      checked: [],
      ...detection,
    })) as unknown as CollectionPreviewLoaders['detectSpatialDataset'],
    getSpatialDataset: vi.fn(async () => {
      throw new Error('Unexpected dataset.')
    }),
    loadDatasetOverview: vi.fn(async () => {
      throw new Error('Unexpected overview.')
    }),
    loadGeneExpression: vi.fn(async () => {
      throw new Error('Unexpected expression.')
    }),
    fetchImpl: vi.fn(async () => new Response(null)),
    ...overrides,
  }
}

async function unavailableReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewUnavailableError)
    return (error as Error).message
  }

  throw new Error('Expected no preview.')
}

describe('openPreviewSource', () => {
  it('reads AnnData cells and scores through the dataset', async () => {
    const geneExpression = vi.fn(async () => ({
      genes: ['Aqp4', 'Gfap'],
      maxCount: 6,
      elements: [
        { id: 'a', position: { x: micrometers(0), y: micrometers(0) }, count: 2 },
        { id: 'b', position: { x: micrometers(10), y: micrometers(4) }, count: 6 },
      ],
    }))
    const dataset = {
      meta: vi.fn(),
      overview: vi.fn(async () => [point(0, 0), point(10, 4)]),
      geneExpression,
    }
    const source = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'h5ad', h5adUrl: URL_A, source: 'zarr' },
        { getSpatialDataset: vi.fn(async () => dataset as never) },
      ),
    )

    const cells = await source.cells()
    expect([...cells.positions]).toEqual([0, 0, 10, 4])
    expect(cells.bounds).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 4 })

    const scores = await source.scores(cells.bounds, ['Aqp4', 'Gfap'], 'mean')
    expect([...scores.scores]).toEqual([1, 3])
    expect(scores.maxScore).toBe(3)
    // Every cell: the query box is the cells' bounds and a little more.
    const [bbox, genes] = geneExpression.mock.calls[0] as unknown as [
      { minX: number; maxX: number; minY: number; maxY: number },
      readonly string[],
    ]
    expect(genes).toEqual(['Aqp4', 'Gfap'])
    expect(bbox.minX).toBeLessThan(0)
    expect(bbox.maxX).toBeGreaterThan(10)
    expect(bbox.maxY).toBeGreaterThan(4)
  })

  it('reads Xenium through the loaders the main view uses', async () => {
    const loadDatasetOverview = vi.fn(async () => [point(1, 1), point(5, 9)])
    const loadGeneExpression = vi.fn(async () => ({
      genes: ['EPCAM'],
      maxCount: 3,
      elements: [
        { id: 'a', position: { x: micrometers(5), y: micrometers(9) }, count: 3 },
      ],
    }))
    const getSpatialDataset = vi.fn()
    const source = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'xenium' },
        { loadDatasetOverview, loadGeneExpression, getSpatialDataset },
      ),
    )
    const cells = await source.cells()
    const scores = await source.scores(cells.bounds, ['EPCAM'], 'sum')

    expect(loadDatasetOverview).toHaveBeenCalledWith(URL_A, { limit: null })
    expect(loadGeneExpression).toHaveBeenCalledWith(
      URL_A,
      expect.objectContaining({ minX: expect.any(Number) }),
      ['EPCAM'],
      {},
    )
    expect(scores.maxScore).toBe(3)
    expect(getSpatialDataset).not.toHaveBeenCalled()
  })

  it('draws every Nth cell beyond the cell limit', async () => {
    const many = Array.from({ length: PREVIEW_MAX_CELLS * 2 + 1 }, (_, index) =>
      point(index, 0),
    )
    const source = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'h5ad', h5adUrl: URL_A, source: 'zarr' },
        {
          getSpatialDataset: vi.fn(
            async () =>
              ({
                overview: async () => many,
                geneExpression: vi.fn(),
              }) as never,
          ),
        },
      ),
    )

    const cells = await source.cells()
    expect(cells.positions.length / 2).toBe(Math.ceil(many.length / 3))
    // The last cell drawn is the last multiple of the stride.
    expect(cells.bounds.maxX).toBe(Math.floor((many.length - 1) / 3) * 3)
  })

  it('has no preview for images, Visium HD or a dataset without cells', async () => {
    expect(
      await unavailableReason(
        openPreviewSource(URL_A, loaders({ platform: 'image', imageUrl: URL_A })),
      ),
    ).toBe('No cells to preview')
    expect(
      await unavailableReason(
        openPreviewSource(URL_A, loaders({ platform: 'visium-hd' })),
      ),
    ).toBe('No cells to preview')

    const empty = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'spatialdata', spatialDataUrl: URL_A },
        {
          getSpatialDataset: vi.fn(
            async () => ({ overview: async () => [], geneExpression: vi.fn() }) as never,
          ),
        },
      ),
    )
    expect(await unavailableReason(empty.cells())).toBe('No cells to preview')
  })

  it('leaves a large .h5ad, which would be downloaded whole, to be opened', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          headers: { 'content-length': String(PREVIEW_MAX_WHOLE_FILE_BYTES + 1) },
        }),
    )

    expect(
      await unavailableReason(
        openPreviewSource(
          'https://example.test/big.h5ad',
          loaders(
            { platform: 'h5ad', h5adUrl: 'https://example.test/big.h5ad' },
            { fetchImpl },
          ),
        ),
      ),
    ).toBe('64 MB file, read when opened')
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/big.h5ad', {
      method: 'HEAD',
    })
  })

  it('previews a small .h5ad, or one whose size the host does not say', async () => {
    const getSpatialDataset = vi.fn(
      async () =>
        ({ overview: async () => [point(0, 0)], geneExpression: vi.fn() }) as never,
    )

    for (const headers of [{ 'content-length': '1000' }, {}]) {
      const source = await openPreviewSource(
        'https://example.test/small.h5ad',
        loaders(
          { platform: 'h5ad', h5adUrl: 'https://example.test/small.h5ad' },
          {
            getSpatialDataset,
            fetchImpl: vi.fn(async () => new Response(null, { headers })),
          },
        ),
      )
      expect((await source.cells()).positions).toHaveLength(2)
    }
  })
})
