import { describe, expect, it, vi } from 'vitest'
import { asAnyCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { SpatialDatasetDetection } from '../../datasets/datasetFactory'
import {
  openPreviewSource,
  PREVIEW_MAX_WHOLE_FILE_BYTES,
  PreviewUnavailableError,
  type CollectionPreviewLoaders,
} from './collectionPreviewData'

const URL_A = 'https://example.test/a.zarr'

function point(x: number, y: number, cellId?: string) {
  return {
    position: { x: micrometers(x), y: micrometers(y) },
    transcriptCount: 0,
    ...(cellId === undefined ? {} : { cellId: asAnyCellId(cellId) }),
  }
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
    loadAnnotations: vi.fn(async () => {
      throw new Error('Unexpected annotations.')
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

  it('asks for the dataset again on each read, so a disposed one is reopened', async () => {
    const opened = [
      { overview: vi.fn(async () => [point(0, 0)]), geneExpression: vi.fn() },
      { overview: vi.fn(async () => [point(1, 1)]), geneExpression: vi.fn() },
    ]
    const getSpatialDataset = vi.fn(async () => opened.shift() as never)
    const source = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'h5ad', h5adUrl: URL_A, source: 'zarr' },
        { getSpatialDataset },
      ),
    )

    const cells = await source.cells()

    expect([...cells.positions]).toEqual([1, 1])
    expect(getSpatialDataset).toHaveBeenCalledTimes(2)
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

  it('reads the classes of an annotation set for the drawn cells', async () => {
    const annotations = vi.fn(async () => [
      { id: 'analysis:type:a', label: 'type: A', cellIds: ['c1', 'c3', 'not-drawn'] },
      // c1 is in A already, so it stays A.
      { id: 'analysis:type:b', label: 'type: B', cellIds: ['c1', 'c2'] },
    ])
    const source = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'h5ad', h5adUrl: URL_A, source: 'zarr' },
        {
          getSpatialDataset: vi.fn(
            async () =>
              ({
                overview: async () => [
                  point(0, 0, 'c1'),
                  point(1, 0, 'c2'),
                  point(2, 0, 'c3'),
                  point(3, 0, 'c4'),
                ],
                geneExpression: vi.fn(),
                annotations,
              }) as never,
          ),
        },
      ),
    )
    const cells = await source.cells()
    const classes = await source.classes(cells, 'analysis:type')

    expect(annotations).toHaveBeenCalledWith({ groupId: 'analysis:type' })
    expect(classes.classes).toEqual([
      { id: 'analysis:type:a', label: 'type: A', cellCount: 3 },
      { id: 'analysis:type:b', label: 'type: B', cellCount: 2 },
    ])
    expect([...classes.classOf]).toEqual([0, 1, 0, -1])
  })

  it('reads Xenium classes through the main view loader', async () => {
    const loadAnnotations = vi.fn(async () => [
      { id: 'graphclust:1', label: 'Cluster 1', cellIds: [asAnyCellId('b')] },
    ])
    const source = await openPreviewSource(
      URL_A,
      loaders(
        { platform: 'xenium' },
        {
          loadDatasetOverview: vi.fn(async () => [point(0, 0, 'a'), point(1, 1, 'b')]),
          loadAnnotations,
        },
      ),
    )
    const classes = await source.classes(await source.cells(), 'graphclust')

    expect(loadAnnotations).toHaveBeenCalledWith(URL_A, { groupId: 'graphclust' })
    expect([...classes.classOf]).toEqual([-1, 0])
  })

  it('keeps every cell, however many', async () => {
    const many = Array.from({ length: 250_001 }, (_, index) => point(index, 0))
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
    expect(cells.positions.length / 2).toBe(many.length)
    expect(cells.cellIds).toHaveLength(many.length)
    expect(cells.bounds.maxX).toBe(many.length - 1)
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
