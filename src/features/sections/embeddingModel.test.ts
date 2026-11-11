import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEmbeddingModel, type EmbeddingModelInput } from './embeddingModel'

function input(overrides: Partial<EmbeddingModelInput> = {}): EmbeddingModelInput {
  return {
    activeEmbedding: null,
    analysisEmbeddingState: { status: 'idle' },
    annotationStyles: [],
    appendDebugEvent: vi.fn(),
    copy: 'Idle',
    datasetReady: true,
    elementLabel: 'cells',
    onLoad: vi.fn(),
    onSelectElement: vi.fn(),
    roiElementIds: [],
    selectedElementId: null,
    selectedKind: 'umap',
    setSelectedKind: vi.fn(),
    ...overrides,
  }
}

describe('useEmbeddingModel', () => {
  it('lists the dataset embeddings and logs a change of view', () => {
    const options = input({
      analysisEmbeddingState: {
        status: 'available',
        url: 'https://example.test',
        options: [{ kind: 'tsne', label: 't-SNE', sourcePath: 'obsm/X_tsne' }],
      },
    })
    const { result } = renderHook(() => useEmbeddingModel(options))

    result.current.onKindChange('tsne')

    expect(result.current.options.map((option) => option.label)).toEqual(['t-SNE'])
    expect(options.setSelectedKind).toHaveBeenCalledWith('tsne')
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Embedding view: tsne')
  })

  it('loads only once a dataset is ready and not while loading', () => {
    const load = (overrides: Partial<EmbeddingModelInput>) =>
      renderHook(() => useEmbeddingModel(input(overrides))).result.current.canLoad

    expect(load({})).toBe(true)
    expect(load({ datasetReady: false })).toBe(false)
    expect(
      load({
        analysisEmbeddingState: { status: 'loading', url: 'https://example.test' },
      }),
    ).toBe(false)
  })
})
