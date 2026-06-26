import { describe, expect, it } from 'vitest'
import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import { asCellId } from '../../data/cellid'
import {
  IDLE_ANALYSIS_EMBEDDING_STATE,
  analysisEmbeddingLoadFailed,
  analysisEmbeddingLoadReady,
  analysisEmbeddingLoadStarted,
  analysisEmbeddingStatusCopy,
} from './analysisEmbeddingModel'

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
  it('constructs analysis embedding transitions', () => {
    const error = new Error('failed')

    expect(IDLE_ANALYSIS_EMBEDDING_STATE).toEqual({ status: 'idle' })
    expect(analysisEmbeddingLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(
      analysisEmbeddingLoadReady('https://example.test/output', [embedding]),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      embeddings: [embedding],
    })
    expect(analysisEmbeddingLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
  })

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
