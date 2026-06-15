import { describe, expect, it } from 'vitest'
import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import { asCellId } from '../../data/cellid'
import { analysisEmbeddingStatusCopy } from './analysisEmbeddingModel'

const embedding: AnalysisEmbedding = {
  kind: 'umap',
  label: 'UMAP',
  sourcePath: 'analysis/umap/projection.csv',
  points: [
    { id: asCellId('aaaaaaaa-1'), x: 1, y: 2 },
    { id: asCellId('bbbbbbbb-2'), x: 3, y: 4 },
  ],
}

describe('analysisEmbeddingStatusCopy', () => {
  it('formats non-ready states', () => {
    expect(
      analysisEmbeddingStatusCopy(
        { status: 'loading', url: 'https://example.test/output' },
        null,
        [],
        null,
      ),
    ).toBe('Loading')
    expect(
      analysisEmbeddingStatusCopy(
        {
          status: 'error',
          url: 'https://example.test/output',
          error: new Error('failed'),
        },
        null,
        [],
        null,
      ),
    ).toBe('Unavailable')
    expect(analysisEmbeddingStatusCopy({ status: 'idle' }, null, [], null)).toBe('Idle')
  })

  it('formats ready embeddings by active view and linked cells', () => {
    const state = {
      status: 'ready' as const,
      url: 'https://example.test/output',
      embeddings: [embedding],
    }

    expect(analysisEmbeddingStatusCopy(state, null, [], null)).toBe('No projection')
    expect(analysisEmbeddingStatusCopy(state, embedding, [], null)).toBe('UMAP: 2 cells')
    expect(
      analysisEmbeddingStatusCopy(state, embedding, ['aaaaaaaa-1'], 'bbbbbbbb-2'),
    ).toBe('UMAP: 2 linked')
    expect(analysisEmbeddingStatusCopy(state, embedding, [], null, 'bins')).toBe(
      'UMAP: 2 bins',
    )
  })
})
