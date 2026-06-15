import { describe, expect, it, vi } from 'vitest'
import {
  loadDatasetAnalysisEmbeddings,
  parseAnalysisEmbeddingCsv,
} from './analysisEmbeddings'

describe('analysis embeddings', () => {
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

  it('loads the first available projection for each embedding kind', async () => {
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
      loadDatasetAnalysisEmbeddings('https://example.test/xenium/', { fetcher }),
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
