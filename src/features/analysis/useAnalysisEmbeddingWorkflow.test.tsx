import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { AnalysisEmbeddingKind } from '../../data/analysisEmbeddings'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { AnalysisEmbeddingState } from './analysisEmbeddingModel'
import { useAnalysisEmbeddingWorkflow } from './useAnalysisEmbeddingWorkflow'

const cell: OverviewCellDatum = {
  id: 'aaaaaaaa-1',
  position: [1, 2, 0],
  radiusPixels: 1,
  fillColor: [0, 0, 0],
}

interface Snapshot {
  readonly debugMessages: readonly string[]
  readonly embeddingState: AnalysisEmbeddingState<StructuredLoadError>
  readonly selectedCell: OverviewCellDatum | null
  readonly selectedEmbeddingKind: AnalysisEmbeddingKind
}

let api: ReturnType<typeof useAnalysisEmbeddingWorkflow>
let snapshot: Snapshot

function Probe({
  onReady,
  onSelectedCellFocus,
  loadAnalysisEmbeddings,
}: {
  readonly onReady: (
    nextApi: ReturnType<typeof useAnalysisEmbeddingWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
  readonly onSelectedCellFocus?: (cell: OverviewCellDatum) => void
  readonly loadAnalysisEmbeddings: Parameters<
    typeof useAnalysisEmbeddingWorkflow
  >[0]['loaders']['loadAnalysisEmbeddings']
}) {
  const [embeddingState, setAnalysisEmbeddingState] = React.useState<
    AnalysisEmbeddingState<StructuredLoadError>
  >({ status: 'idle' })
  const [selectedCell, setSelectedCell] = React.useState<OverviewCellDatum | null>(null)
  const [selectedEmbeddingKind, setSelectedEmbeddingKind] =
    React.useState<AnalysisEmbeddingKind>('tsne')
  const debugMessagesRef = React.useRef<string[]>([])
  const analysisEmbeddingAbortRef = React.useRef<AbortController | null>(null)
  const analysisEmbeddingRequestIdRef = React.useRef(0)
  const loadState: DatasetLoadState<StructuredLoadError> = {
    status: 'ready',
    url: 'https://example.test/output',
    cellCount: 1,
  }
  const appendFallbackNotice = React.useCallback(() => undefined, [])

  const nextApi = useAnalysisEmbeddingWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
      appendFallbackNotice,
      ...(onSelectedCellFocus === undefined ? {} : { onSelectedCellFocus }),
    },
    data: {
      analysisEmbeddingState: embeddingState,
      loadState,
      overviewCellById: new Map([[cell.id, cell]]),
      selectedEmbeddingKind,
    },
    loaders: { loadAnalysisEmbeddings },
    refs: {
      analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef,
    },
    setters: {
      setAnalysisEmbeddingState,
      setSelectedCell,
      setSelectedEmbeddingKind,
    },
  })

  React.useEffect(() => {
    onReady(nextApi, {
      debugMessages: debugMessagesRef.current,
      embeddingState,
      selectedCell,
      selectedEmbeddingKind,
    })
  })

  return null
}

describe('useAnalysisEmbeddingWorkflow', () => {
  it('loads embeddings and switches to an available embedding kind', async () => {
    const loadAnalysisEmbeddings = vi.fn(async () => [
      {
        kind: 'umap' as const,
        label: 'UMAP',
        sourcePath: 'analysis/umap/projection.csv',
        points: [{ id: asCellId('aaaaaaaa-1'), x: 1, y: 2 }],
      },
    ])

    render(
      <Probe
        loadAnalysisEmbeddings={loadAnalysisEmbeddings}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleLoadAnalysisEmbeddings()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(loadAnalysisEmbeddings).toHaveBeenCalledWith(
      'https://example.test/output',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onFallback: expect.any(Function),
      }),
    )
    expect(snapshot.embeddingState.status).toBe('ready')
    expect(snapshot.selectedEmbeddingKind).toBe('umap')
    expect(snapshot.debugMessages).toContain('Embeddings loaded: 1 views')
  })

  it('selects overview cells from embedding clicks', () => {
    const onSelectedCellFocus = vi.fn()

    render(
      <Probe
        loadAnalysisEmbeddings={vi.fn(async () => [])}
        onSelectedCellFocus={onSelectedCellFocus}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleEmbeddingCellSelect('aaaaaaaa-1')
    })

    expect(snapshot.selectedCell).toBe(cell)
    expect(onSelectedCellFocus).toHaveBeenCalledWith(cell)
  })
})
