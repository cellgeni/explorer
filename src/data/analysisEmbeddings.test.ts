import { describe, expect, it, vi } from 'vitest'
import {
  clearFolderListings,
  parseFolderListing,
  setFolderListing,
} from './folderListing'
import {
  analysisEmbeddingLabel,
  loadDatasetAnalysisEmbeddings,
  parseAnalysisEmbeddingCsv,
} from './analysisEmbeddings'
import { setDatasetManifest } from './datasetFiles'
import { clearHostResponses } from './hostResponses'

describe('analysis embeddings', () => {
  it('formats generic embedding labels from AnnData keys', () => {
    expect(analysisEmbeddingLabel('X_umap')).toBe('UMAP')
    expect(analysisEmbeddingLabel('X_tSNE')).toBe('t-SNE')
    expect(analysisEmbeddingLabel('X_pca')).toBe('PCA')
    expect(analysisEmbeddingLabel('draw_graph_fa')).toBe('Draw Graph Fa')
  })

  it('parses UMAP projection CSV rows', () => {
    expect(
      parseAnalysisEmbeddingCsv(
        'Barcode,UMAP-1,UMAP-2\ncell-1,1.25,-3\ncell-2,2,4\n',
        'umap',
      ),
    ).toEqual([
      { id: 'cell-1', x: 1.25, y: -3 },
      { id: 'cell-2', x: 2, y: 4 },
    ])
  })

  it('supports quoted projection CSV fields and t-SNE headers', () => {
    expect(
      parseAnalysisEmbeddingCsv(
        '"cell_id","t-SNE 1","t-SNE 2"\n"cell,1","-1","2.5"\n',
        'tsne',
      ),
    ).toEqual([{ id: 'cell,1', x: -1, y: 2.5 }])
  })

  it('notifies when projection CSV headers fall back to positional columns', () => {
    const onFallback = vi.fn()

    expect(
      parseAnalysisEmbeddingCsv('cell-1,1,2\ncell-2,3,4\n', 'umap', {
        onFallback,
        sourcePath: 'analysis/umap/projection.csv',
      }),
    ).toEqual([{ id: 'cell-2', x: 3, y: 4 }])
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Analysis embeddings',
        message: expect.stringContaining('using positional CSV columns'),
        detail: 'analysis/umap/projection.csv',
        coalesceKey: 'analysis-embedding-columns:umap:analysis/umap/projection.csv',
      }),
    )
  })

  // pandas writes a missing value as an empty field, which Number() reads as 0
  // (EXP-237).
  it('leaves out projection rows with an empty coordinate', () => {
    expect(
      parseAnalysisEmbeddingCsv(
        'Barcode,UMAP-1,UMAP-2\na-1,,\nb-1,3.5,\nc-1, ,4\nd-1,1,2\n',
        'umap',
      ),
    ).toEqual([{ id: 'd-1', x: 1, y: 2 }])
  })

  // The BioImage Archive's host sends no CORS headers with its 404s, and
  // Xenium Onboard Analysis writes no t-SNE (EXP-222).
  it('loads the UMAP when a missing t-SNE fails without a readable response', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      if (
        String(input).endsWith(
          'analysis/umap/gene_expression_2_components/projection.csv',
        )
      ) {
        return new Response('Barcode,UMAP-1,UMAP-2\ncell-1,1,2\n')
      }
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    try {
      await expect(
        loadDatasetAnalysisEmbeddings('https://hides-errors.test/run', { fetcher }),
      ).resolves.toEqual([
        {
          kind: 'umap',
          label: 'UMAP',
          sourcePath: 'analysis/umap/gene_expression_2_components/projection.csv',
          points: [{ id: 'cell-1', x: 1, y: 2 }],
        },
      ])
    } finally {
      clearHostResponses()
    }
  })

  it('reads 403 as a missing projection and other errors as a failed load', async () => {
    const answering = (status: number) =>
      vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch

    await expect(
      loadDatasetAnalysisEmbeddings('https://example.test/run', {
        fetcher: answering(403),
      }),
    ).resolves.toEqual([])
    for (const status of [401, 429, 500, 503]) {
      await expect(
        loadDatasetAnalysisEmbeddings('https://example.test/run', {
          fetcher: answering(status),
        }),
      ).rejects.toThrow(`HTTP ${status}`)
    }
    clearHostResponses()
  })

  it('says when the projection a dataset manifest names is not found', async () => {
    const baseUrl = 'https://example.test/manifest-umap/explorer.json'
    const onFallback = vi.fn()
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))
    setDatasetManifest(baseUrl, {
      platform: 'xenium',
      url: baseUrl,
      rootUrl: 'https://example.test/manifest-umap',
      files: {
        umap: {
          path: 'custom/umap.csv',
          url: 'https://example.test/manifest-umap/custom/umap.csv',
        },
      },
    })

    try {
      await expect(
        loadDatasetAnalysisEmbeddings(baseUrl, { fetcher, onFallback }),
      ).resolves.toEqual([])
      expect(onFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'The UMAP projection the dataset manifest names was not found.',
          detail: 'custom/umap.csv',
        }),
      )
    } finally {
      setDatasetManifest(baseUrl, undefined)
      clearHostResponses()
    }
  })

  it('skips projection CSVs the dataset folder index page does not list', async () => {
    const baseUrl = 'https://example.test/bia-run'
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))
    setFolderListing(
      baseUrl,
      parseFolderListing(
        '<title>Index of /bia-run</title><a href="cells.parquet">c</a>',
        baseUrl,
      ),
    )

    try {
      await expect(loadDatasetAnalysisEmbeddings(baseUrl, { fetcher })).resolves.toEqual(
        [],
      )
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      clearFolderListings()
    }
  })

  it('loads the first available projection for each embedding kind', async () => {
    const onFallback = vi.fn()
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)

      if (url.endsWith('analysis/umap/gene_expression_2_components/projection.csv')) {
        return new Response('Barcode,UMAP-1,UMAP-2\ncell-1,1,2\n')
      }

      if (url.endsWith('analysis/tsne/gene_expression_2_components/projection.csv')) {
        return new Response(null, { status: 404 })
      }

      if (url.endsWith('analysis/tsne/2_components/projection.csv')) {
        return new Response('Barcode,TSNE-1,TSNE-2\ncell-1,3,4\n')
      }

      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch

    await expect(
      loadDatasetAnalysisEmbeddings('https://example.test/xenium/', {
        fetcher,
        onFallback,
      }),
    ).resolves.toEqual([
      {
        kind: 'umap',
        label: 'UMAP',
        sourcePath: 'analysis/umap/gene_expression_2_components/projection.csv',
        points: [{ id: 'cell-1', x: 1, y: 2 }],
      },
      {
        kind: 'tsne',
        label: 't-SNE',
        sourcePath: 'analysis/tsne/2_components/projection.csv',
        points: [{ id: 'cell-1', x: 3, y: 4 }],
      },
    ])
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Analysis embeddings',
        message: expect.stringContaining('secondary CSV path'),
        detail: expect.stringContaining('analysis/tsne/2_components/projection.csv'),
        coalesceKey: 'analysis-embedding-path:https://example.test/xenium/:tsne',
      }),
    )
  })

  it('prefers selected Visium HD binned projections when a bin size is provided', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)

      if (
        url.endsWith(
          'binned_outputs/square_008um/analysis/umap/gene_expression_2_components/projection.csv',
        )
      ) {
        return new Response('Barcode,UMAP-1,UMAP-2\nbarcode-8um,1,2\n')
      }

      if (url.endsWith('analysis/umap/gene_expression_2_components/projection.csv')) {
        return new Response('Barcode,UMAP-1,UMAP-2\nroot-barcode,3,4\n')
      }

      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch

    await expect(
      loadDatasetAnalysisEmbeddings('https://example.test/visium-hd/', {
        fetcher,
        visiumHdBinSizeMicrometers: 8,
      }),
    ).resolves.toEqual([
      {
        kind: 'umap',
        label: 'UMAP',
        sourcePath:
          'binned_outputs/square_008um/analysis/umap/gene_expression_2_components/projection.csv',
        points: [{ id: 'barcode-8um', x: 1, y: 2 }],
      },
    ])
  })
})
