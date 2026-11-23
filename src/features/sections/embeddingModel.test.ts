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

  // Picking PCA with UMAP loaded snapped the select back to UMAP, while the
  // next Load read PCA (EXP-252).
  it('shows the view picked while it is listed, not the one loaded', () => {
    const umap = {
      kind: 'X_umap',
      label: 'UMAP',
      sourcePath: 'obsm/X_umap',
      points: [{ id: 'c1', x: 0, y: 0 }],
    }
    const options = [
      { kind: 'X_umap', label: 'UMAP', sourcePath: 'obsm/X_umap' },
      { kind: 'X_pca', label: 'PCA', sourcePath: 'obsm/X_pca' },
    ]
    const shown = (selectedKind: string) =>
      renderHook(() =>
        useEmbeddingModel(
          input({
            activeEmbedding: umap,
            analysisEmbeddingState: {
              status: 'ready',
              url: 'https://example.test',
              embeddings: [umap],
              options,
            },
            selectedKind,
          }),
        ),
      ).result.current.selectedKind

    expect(shown('X_pca')).toBe('X_pca')
    expect(shown('X_umap')).toBe('X_umap')
    // A kind the dataset does not list shows the one plotted.
    expect(shown('tsne')).toBe('X_umap')
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
