import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { ShareableViewState } from '../../data/shareableState'
import type { TelemetryEvent } from '../../data/telemetry'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { BoundaryLoadState, DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { GeneExpressionState } from '../genes/geneControlsModel'
import { useViewportDataWorkflow } from './useViewportDataWorkflow'

const bbox = {
  minX: micrometers(0),
  minY: micrometers(0),
  maxX: micrometers(100),
  maxY: micrometers(100),
}

const detail: ViewerViewportDetail = {
  bbox,
  visibleCellCount: 2,
  viewState: {
    target: [50, 50, 0],
    zoom: 0,
    minZoom: -8,
    maxZoom: 8,
  },
}

const detailWithoutBoundaryLoad: ViewerViewportDetail = {
  ...detail,
  visibleCellCount: 0,
}

const denseCellScaleDetail: ViewerViewportDetail = {
  ...detail,
  visibleCellCount: 120_000,
}

const defaultSelectedGenes = ['Actb']

const readyLoadState: DatasetLoadState<StructuredLoadError> = {
  status: 'ready',
  url: 'https://example.test/output',
  cellCount: 10,
}

const batch: GeneExpressionBatch = {
  cells: [
    {
      id: asCellId('aaaaaaaa-1'),
      position: { x: micrometers(1), y: micrometers(2) },
      count: 2,
    },
  ],
  genes: ['Actb'],
  maxCount: 2,
}

interface Snapshot {
  readonly boundaryElements: readonly SpatialElement[]
  readonly boundaryRequestId: number
  readonly boundaryState: BoundaryLoadState<StructuredLoadError>
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly debugMessages: readonly string[]
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionRequestId: number
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly shareableViewState: ShareableViewState | undefined
  readonly telemetryEvents: readonly TelemetryEvent[]
}

let api: ReturnType<typeof useViewportDataWorkflow>
let snapshot: Snapshot

function Probe({
  boundaryLoadingEnabled = true,
  geneExpressionDisabledMessage,
  geneExpressionLoadingEnabled = true,
  loadBoundaryElements,
  loadGeneExpression,
  onReady,
  selectedGenes = ['Actb'],
}: {
  readonly loadBoundaryElements: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['boundaryElements']
  readonly boundaryLoadingEnabled?: boolean
  readonly geneExpressionDisabledMessage?: string
  readonly geneExpressionLoadingEnabled?: boolean
  readonly loadGeneExpression: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['geneExpression']
  readonly onReady: (
    nextApi: ReturnType<typeof useViewportDataWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
  readonly selectedGenes?: readonly string[]
}) {
  const [boundaryElements, setBoundaryElements] = React.useState<
    readonly SpatialElement[]
  >([])
  const [boundaryState, setBoundaryState] = React.useState<
    BoundaryLoadState<StructuredLoadError>
  >({ status: 'idle' })
  const [currentViewportDetail, setCurrentViewportDetail] =
    React.useState<ViewerViewportDetail | null>(null)
  const [geneExpressionBatch, setGeneExpressionBatch] =
    React.useState<GeneExpressionBatch | null>(null)
  const [geneExpressionState, setGeneExpressionState] = React.useState<
    GeneExpressionState<StructuredLoadError>
  >({ status: 'idle' })
  const [shareableViewState, setShareableViewState] = React.useState<
    ShareableViewState | undefined
  >(undefined)
  const boundaryAbortRef = React.useRef<AbortController | null>(null)
  const boundaryRequestIdRef = React.useRef(0)
  const boundaryViewportKeyRef = React.useRef<string | null>(null)
  const debugMessagesRef = React.useRef<string[]>([])
  const geneExpressionAbortRef = React.useRef<AbortController | null>(null)
  const geneExpressionRequestIdRef = React.useRef(0)
  const geneExpressionViewportKeyRef = React.useRef<string | null>(null)
  const lastViewportDetailRef = React.useRef<ViewerViewportDetail | null>(null)
  const telemetryEventsRef = React.useRef<TelemetryEvent[]>([])
  const appendDebugEvent = React.useCallback((message: string) => {
    debugMessagesRef.current.push(message)
  }, [])
  const recordTelemetry = React.useCallback((event: TelemetryEvent) => {
    telemetryEventsRef.current.push(event)
  }, [])
  const rememberGeneExpressionScaleMax = React.useMemo(() => vi.fn(), [])

  const nextApi = useViewportDataWorkflow({
    appendDebugEvent,
    boundaryCellLimit: 10,
    boundaryLoadingEnabled,
    geneExpressionDetailMode: 'auto',
    geneExpressionDisabledMessage,
    geneExpressionLoadingEnabled,
    geneExpressionScaleKey: 'scale-key',
    geneExpressionScoreMode: 'sum',
    loadState: readyLoadState,
    loaders: {
      boundaryElements: loadBoundaryElements,
      geneExpression: loadGeneExpression,
    },
    overviewExtent: bbox,
    recordTelemetry,
    rememberGeneExpressionScaleMax,
    requests: {
      boundary: {
        abortRef: boundaryAbortRef,
        requestIdRef: boundaryRequestIdRef,
        boundaryViewportKeyRef,
      },
      geneExpression: {
        abortRef: geneExpressionAbortRef,
        requestIdRef: geneExpressionRequestIdRef,
        geneExpressionViewportKeyRef,
      },
      lastViewportDetailRef,
    },
    selectedGenes: selectedGenes ?? defaultSelectedGenes,
    setters: {
      setBoundaryElements,
      setBoundaryState,
      setCurrentViewportDetail,
      setGeneExpressionBatch,
      setGeneExpressionState,
      setShareableViewState,
    },
  })

  React.useEffect(() => {
    onReady(nextApi, {
      boundaryElements,
      boundaryRequestId: boundaryRequestIdRef.current,
      boundaryState,
      currentViewportDetail,
      debugMessages: debugMessagesRef.current,
      geneExpressionBatch,
      geneExpressionRequestId: geneExpressionRequestIdRef.current,
      geneExpressionState,
      shareableViewState,
      telemetryEvents: telemetryEventsRef.current,
    })
  })

  return null
}

describe('useViewportDataWorkflow', () => {
  it('records viewport state without loading Xenium detail layers when disabled', async () => {
    const loadBoundaryElements = vi.fn(async () => ({ elements: [] }))
    const loadGeneExpression = vi.fn(async () => batch)

    render(
      <Probe
        boundaryLoadingEnabled={false}
        geneExpressionLoadingEnabled={false}
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(detail)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(snapshot.currentViewportDetail).toBe(detail)
    expect(snapshot.shareableViewState).toEqual({ target: [50, 50, 0], zoom: 0 })
    expect(loadBoundaryElements).not.toHaveBeenCalled()
    expect(loadGeneExpression).not.toHaveBeenCalled()
    expect(snapshot.boundaryState).toEqual({ status: 'idle' })
    expect(snapshot.geneExpressionState).toEqual({ status: 'idle' })
  })

  it('reports disabled gene expression without starting a selected-gene load', async () => {
    const loadGeneExpression = vi.fn(async () => batch)

    render(
      <Probe
        geneExpressionDisabledMessage="Visium HD expression loading is paused."
        geneExpressionLoadingEnabled={false}
        loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(detailWithoutBoundaryLoad)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(loadGeneExpression).not.toHaveBeenCalled()
    expect(snapshot.geneExpressionBatch).toBeNull()
    expect(snapshot.geneExpressionState).toEqual({
      status: 'waiting',
      message: 'Visium HD expression loading is paused.',
    })
  })

  it('loads boundary elements and gene expression for a new viewport', async () => {
    const element: SpatialElement = {
      id: 'boundary-1',
      geometry: { kind: 'polygon', rings: [[{ x: micrometers(1), y: micrometers(2) }]] },
    }
    const loadBoundaryElements = vi.fn(async () => ({ elements: [element] }))
    const loadGeneExpression = vi.fn(async () => batch)

    render(
      <Probe
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(detail)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(snapshot.currentViewportDetail).toBe(detail)
    expect(snapshot.shareableViewState).toEqual({ target: [50, 50, 0], zoom: 0 })
    expect(snapshot.boundaryState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellCount: 1,
    })
    expect(snapshot.boundaryElements).toEqual([element])
    expect(snapshot.geneExpressionState.status).toBe('ready')
    expect(snapshot.geneExpressionBatch).toBe(batch)
    expect(snapshot.telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'viewport.boundaries.load',
          outcome: 'success',
        }),
      ]),
    )
    expect(
      snapshot.debugMessages.some((message) => message.startsWith('Boundaries ready:')),
    ).toBe(true)
    expect(snapshot.telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'gene-expression.load',
          outcome: 'success',
        }),
      ]),
    )
  })

  it('loads boundary elements for dense cell-scale viewports', async () => {
    const element: SpatialElement = {
      id: 'boundary-1',
      geometry: { kind: 'polygon', rings: [[{ x: micrometers(1), y: micrometers(2) }]] },
    }
    const loadBoundaryElements = vi.fn(async () => ({ elements: [element] }))
    const loadGeneExpression = vi.fn(async () => batch)

    render(
      <Probe
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(denseCellScaleDetail)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadBoundaryElements).toHaveBeenCalledWith(
      'https://example.test/output',
      denseCellScaleDetail.bbox,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(snapshot.boundaryState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellCount: 1,
    })
    expect(snapshot.boundaryElements).toEqual([element])
  })

  it('retries retryable gene expression load failures once', async () => {
    const loadGeneExpression = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(batch)

    render(
      <Probe
        loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(detailWithoutBoundaryLoad)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadGeneExpression).toHaveBeenCalledTimes(2)
    expect(snapshot.geneExpressionState.status).toBe('ready')
    expect(snapshot.geneExpressionBatch).toBe(batch)
    expect(snapshot.debugMessages).toContain('Gene expression load failed; retrying')
  })

  it('does not retry nonretryable gene expression load failures', async () => {
    const loadGeneExpression = vi.fn(async () => {
      throw new Error('matrix unavailable')
    })

    render(
      <Probe
        loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(detailWithoutBoundaryLoad)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadGeneExpression).toHaveBeenCalledTimes(1)
    expect(snapshot.geneExpressionState.status).toBe('error')
  })

  it('clears gene expression state when no genes are selected', () => {
    const loadGeneExpression = vi.fn(async () => batch)

    render(
      <Probe
        loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
        selectedGenes={[]}
      />,
    )

    act(() => {
      api.handleViewportChange(detailWithoutBoundaryLoad)
    })

    expect(snapshot.geneExpressionState).toEqual({ status: 'idle' })
    expect(snapshot.geneExpressionBatch).toBeNull()
    expect(snapshot.geneExpressionRequestId).toBeGreaterThan(0)
    expect(loadGeneExpression).not.toHaveBeenCalled()
  })
})
