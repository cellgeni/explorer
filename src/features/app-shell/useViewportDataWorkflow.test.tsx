import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { asCellId } from '../../data/cellid'
import { micrometers, type BBox } from '../../data/coords'
import type { ShareableViewState } from '../../data/shareableState'
import type { TelemetryEvent } from '../../data/telemetry'
import type {
  ElementBatch,
  GeneExpressionBatch,
  SpatialElement,
} from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { BoundaryLoadState, DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { GeneExpressionState } from '../genes/geneControlsModel'
import { deferredPromise } from '../../test/appTestHarness'
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

const denseOverviewDetail: ViewerViewportDetail = {
  ...detail,
  visibleCellCount: 12,
  viewState: {
    ...detail.viewState,
    zoom: -4,
  },
}

const defaultSelectedGenes = ['Actb']

const readyLoadState: DatasetLoadState<StructuredLoadError> = {
  status: 'ready',
  url: 'https://example.test/output',
  cellCount: 10,
}

const batch: GeneExpressionBatch = {
  elements: [
    {
      id: asCellId('aaaaaaaa-1'),
      position: { x: micrometers(1), y: micrometers(2) },
      count: 2,
    },
  ],
  genes: ['Actb'],
  population: 'all',
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
  readonly nucleusBoundaryElements: readonly SpatialElement[]
  readonly nucleusBoundaryState: BoundaryLoadState<StructuredLoadError>
  readonly shareableViewState: ShareableViewState | undefined
  readonly telemetryEvents: readonly TelemetryEvent[]
}

let api: ReturnType<typeof useViewportDataWorkflow>
let snapshot: Snapshot

function Probe({
  cellBoundaryLoadingEnabled = true,
  geneExpressionDisabledMessage,
  geneExpressionLoadingEnabled = true,
  loadBoundaryElements,
  loadGeneExpression,
  loadNucleusBoundaryElements,
  onReady,
  selectedGenes = ['Actb'],
  viewportCellCount,
  visiumHdBinSizeMicrometers,
}: {
  readonly loadBoundaryElements: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['boundaryElements']
  readonly cellBoundaryLoadingEnabled?: boolean
  readonly geneExpressionDisabledMessage?: string
  readonly geneExpressionLoadingEnabled?: boolean
  readonly loadGeneExpression: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['geneExpression']
  readonly loadNucleusBoundaryElements?: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['boundaryElements']
  readonly onReady: (
    nextApi: ReturnType<typeof useViewportDataWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
  readonly selectedGenes?: readonly string[]
  readonly viewportCellCount?: (box: BBox) => number
  readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
}) {
  const [boundaryElements, setBoundaryElements] = React.useState<
    readonly SpatialElement[]
  >([])
  const [boundaryState, setBoundaryState] = React.useState<
    BoundaryLoadState<StructuredLoadError>
  >({ status: 'idle' })
  const [nucleusBoundaryElements, setNucleusBoundaryElements] = React.useState<
    readonly SpatialElement[]
  >([])
  const [nucleusBoundaryState, setNucleusBoundaryState] = React.useState<
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
  const nucleusBoundaryAbortRef = React.useRef<AbortController | null>(null)
  const nucleusBoundaryRequestIdRef = React.useRef(0)
  const nucleusBoundaryViewportKeyRef = React.useRef<string | null>(null)
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
    callbacks: {
      appendDebugEvent,
      recordTelemetry,
      rememberGeneExpressionScaleMax,
    },
    controls: {
      boundaryCellLimit: 10,
      cellBoundaryLoadingEnabled,
      geneExpressionDetailMode: 'auto',
      geneExpressionDisabledMessage,
      geneExpressionLoadingEnabled,
      geneExpressionScaleKey: 'scale-key',
      geneExpressionScoreMode: 'sum',
      ...(visiumHdBinSizeMicrometers === undefined ? {} : { visiumHdBinSizeMicrometers }),
      viewportCellCount,
    },
    data: {
      loadState: readyLoadState,
      overviewExtent: bbox,
      selectedGenes: selectedGenes ?? defaultSelectedGenes,
    },
    loaders: {
      boundaryElements: loadBoundaryElements,
      geneExpression: loadGeneExpression,
      ...(loadNucleusBoundaryElements === undefined
        ? {}
        : { nucleusBoundaryElements: loadNucleusBoundaryElements }),
    },
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
      nucleusBoundary: {
        abortRef: nucleusBoundaryAbortRef,
        requestIdRef: nucleusBoundaryRequestIdRef,
        boundaryViewportKeyRef: nucleusBoundaryViewportKeyRef,
      },
    },
    setters: {
      setBoundaryElements,
      setBoundaryState,
      setNucleusBoundaryElements,
      setNucleusBoundaryState,
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
      nucleusBoundaryElements,
      nucleusBoundaryState,
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
        cellBoundaryLoadingEnabled={false}
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
      snapshot.debugMessages.some((message) =>
        message.startsWith('Cell boundaries ready: 1 cells in '),
      ),
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

  it('passes dense Visium HD expression LOD options to the gene-expression loader', async () => {
    const loadGeneExpression = vi.fn(async () => batch)
    const visiumOverviewDetail: ViewerViewportDetail = {
      ...detailWithoutBoundaryLoad,
      viewState: {
        ...detailWithoutBoundaryLoad.viewState,
        zoom: -1.5,
      },
    }

    render(
      <Probe
        loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
        visiumHdBinSizeMicrometers={2}
      />,
    )

    act(() => {
      api.handleViewportChange(visiumOverviewDetail)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadGeneExpression).toHaveBeenCalledWith(
      'https://example.test/output',
      bbox,
      ['Actb'],
      expect.objectContaining({
        limit: readyLoadState.cellCount,
        sampleStride: 1,
        signal: expect.any(AbortSignal),
        visiumHdBinSizeMicrometers: 16,
      }),
    )
    expect(snapshot.geneExpressionState.status).toBe('ready')
  })

  it.each([16, 8, 2] as const)(
    'passes selected Visium HD %ium expression options at maximum zoom-in',
    async (selectedBinSize) => {
      const loadGeneExpression = vi.fn(async () => batch)
      const visiumZoomedInDetail: ViewerViewportDetail = {
        ...detailWithoutBoundaryLoad,
        visibleCellCount: 8,
        viewState: {
          ...detailWithoutBoundaryLoad.viewState,
          zoom: 8,
        },
      }

      render(
        <Probe
          loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
          loadGeneExpression={loadGeneExpression}
          onReady={(nextApi, nextSnapshot) => {
            api = nextApi
            snapshot = nextSnapshot
          }}
          visiumHdBinSizeMicrometers={selectedBinSize}
        />,
      )

      act(() => {
        api.handleViewportChange(visiumZoomedInDetail)
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(loadGeneExpression).toHaveBeenCalledWith(
        'https://example.test/output',
        bbox,
        ['Actb'],
        expect.objectContaining({
          limit: readyLoadState.cellCount,
          sampleStride: 1,
          signal: expect.any(AbortSignal),
          visiumHdBinSizeMicrometers: selectedBinSize,
        }),
      )
      expect(snapshot.geneExpressionState.status).toBe('ready')
    },
  )

  it('reports when true boundary polygons are deferred by viewport density', async () => {
    const loadBoundaryElements = vi.fn(async () => ({ elements: [] }))
    const loadGeneExpression = vi.fn(async () => batch)

    render(
      <Probe
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
        selectedGenes={[]}
      />,
    )

    act(() => {
      api.handleViewportChange(denseOverviewDetail)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(loadBoundaryElements).not.toHaveBeenCalled()
    expect(snapshot.boundaryState).toEqual({ status: 'idle' })
    expect(snapshot.debugMessages).toContain(
      'Boundaries deferred: 12 visible cells exceed the 10 boundary limit. Zoom in or raise Boundary limit to load true polygons.',
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

  it('counts an imported segmentation in view when the viewer has no cells', async () => {
    const loadBoundaryElements = vi.fn(async () => ({ elements: [] }))
    const viewportCellCount = vi.fn(() => 3)

    render(
      <Probe
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={vi.fn(async () => batch)}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
        selectedGenes={[]}
        viewportCellCount={viewportCellCount}
      />,
    )

    act(() => {
      api.handleViewportChange(detailWithoutBoundaryLoad)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(viewportCellCount).toHaveBeenCalledWith(bbox)
    expect(loadBoundaryElements).toHaveBeenCalledTimes(1)

    viewportCellCount.mockReturnValue(40)
    act(() => {
      api.handleViewportChange({ ...denseOverviewDetail, visibleCellCount: 0 })
    })

    expect(loadBoundaryElements).toHaveBeenCalledTimes(1)
    expect(snapshot.debugMessages).toContain(
      'Boundaries deferred: 40 visible cells exceed the 10 boundary limit. Zoom in or raise Boundary limit to load true polygons.',
    )
  })

  it('records outlines over the limit and asks again on the next view', async () => {
    const loadBoundaryElements = vi.fn(async () => ({
      elements: [],
      overLimit: { count: 250_000 },
    }))

    render(
      <Probe
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={vi.fn(async () => batch)}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
        selectedGenes={[]}
      />,
    )

    act(() => {
      api.handleViewportChange(detail)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(snapshot.boundaryState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellCount: 0,
      overLimit: { count: 250_000 },
    })

    // The same view would be covered by a drawn request; this one drew
    // nothing, so it is asked for again.
    act(() => {
      api.handleViewportChange(detail)
    })
    expect(loadBoundaryElements).toHaveBeenCalledTimes(2)
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

  describe('nucleus boundaries', () => {
    const square = (min: number, max: number): SpatialElement['geometry'] => ({
      kind: 'polygon',
      rings: [
        [
          { x: micrometers(min), y: micrometers(min) },
          { x: micrometers(max), y: micrometers(min) },
          { x: micrometers(max), y: micrometers(max) },
        ],
      ],
    })
    const cellElement: SpatialElement = { id: 'cell-1', geometry: square(0, 10) }
    const nucleusElement: SpatialElement = {
      id: 'cell-1',
      geometry: square(2, 6),
      metadata: { segmentation: { kind: 'nucleus', cellId: 'cell-1' } },
    }
    const captureSnapshot = (
      nextApi: ReturnType<typeof useViewportDataWorkflow>,
      nextSnapshot: Snapshot,
    ) => {
      api = nextApi
      snapshot = nextSnapshot
    }
    const flushRequests = async () => {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    it('draws cell outlines without waiting for the nucleus request', async () => {
      const nuclei = deferredPromise<ElementBatch>()
      const loadNucleusBoundaryElements = vi.fn(() => nuclei.promise)

      render(
        <Probe
          loadBoundaryElements={vi.fn(async () => ({ elements: [cellElement] }))}
          loadGeneExpression={vi.fn(async () => batch)}
          loadNucleusBoundaryElements={loadNucleusBoundaryElements}
          onReady={captureSnapshot}
          selectedGenes={[]}
        />,
      )
      act(() => {
        api.handleViewportChange(detail)
      })
      await flushRequests()

      expect(snapshot.boundaryElements).toEqual([cellElement])
      expect(snapshot.boundaryState.status).toBe('ready')
      expect(snapshot.nucleusBoundaryState.status).toBe('loading')
      expect(snapshot.nucleusBoundaryElements).toEqual([])

      await act(async () => {
        nuclei.resolve({ elements: [nucleusElement] })
        await nuclei.promise
      })

      expect(snapshot.nucleusBoundaryElements).toEqual([nucleusElement])
      expect(snapshot.nucleusBoundaryState).toEqual({
        status: 'ready',
        url: 'https://example.test/output',
        cellCount: 1,
      })
      expect(snapshot.debugMessages).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Cell boundaries ready: 1 cells in [0-9,]+ ms/),
          expect.stringMatching(/^Nucleus boundaries ready: 1 nuclei in [0-9,]+ ms/),
        ]),
      )
      expect(snapshot.telemetryEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'viewport.nucleus-boundaries.load',
            outcome: 'success',
          }),
        ]),
      )
    })

    it('keeps cell outlines when the nucleus read fails', async () => {
      render(
        <Probe
          loadBoundaryElements={vi.fn(async () => ({ elements: [cellElement] }))}
          loadGeneExpression={vi.fn(async () => batch)}
          loadNucleusBoundaryElements={vi.fn(async () => {
            throw new Error('nucleus_boundaries.parquet: HTTP 404')
          })}
          onReady={captureSnapshot}
          selectedGenes={[]}
        />,
      )
      act(() => {
        api.handleViewportChange(detail)
      })
      await flushRequests()

      expect(snapshot.boundaryElements).toEqual([cellElement])
      expect(snapshot.boundaryState.status).toBe('ready')
      expect(snapshot.nucleusBoundaryElements).toEqual([])
      expect(snapshot.nucleusBoundaryState).toMatchObject({
        status: 'error',
        error: { source: 'Nucleus boundaries' },
      })
      expect(snapshot.debugMessages).toContain('Nucleus boundary load failed')
      expect(snapshot.debugMessages).not.toContain('Cell boundary load failed')
    })

    it('reads only the outline type whose checkbox changes', async () => {
      const loadBoundaryElements = vi.fn(async () => ({ elements: [cellElement] }))
      const loadNucleusBoundaryElements = vi.fn(async () => ({
        elements: [nucleusElement],
      }))
      const props = {
        loadBoundaryElements,
        loadGeneExpression: vi.fn(async () => batch),
        onReady: captureSnapshot,
        selectedGenes: [],
      }
      const { rerender } = render(<Probe {...props} />)
      act(() => {
        api.handleViewportChange(detail)
      })
      await flushRequests()

      expect(loadBoundaryElements).toHaveBeenCalledTimes(1)

      // Nuclei ticked: only nuclei are read.
      rerender(
        <Probe {...props} loadNucleusBoundaryElements={loadNucleusBoundaryElements} />,
      )
      await flushRequests()

      expect(loadNucleusBoundaryElements).toHaveBeenCalledTimes(1)
      expect(loadBoundaryElements).toHaveBeenCalledTimes(1)
      expect(snapshot.nucleusBoundaryElements).toEqual([nucleusElement])

      // Cells unticked, then ticked again in the same view: nothing is read,
      // and the outlines already read come back.
      rerender(
        <Probe
          {...props}
          cellBoundaryLoadingEnabled={false}
          loadNucleusBoundaryElements={loadNucleusBoundaryElements}
        />,
      )
      await flushRequests()
      rerender(
        <Probe {...props} loadNucleusBoundaryElements={loadNucleusBoundaryElements} />,
      )
      await flushRequests()

      expect(loadBoundaryElements).toHaveBeenCalledTimes(1)
      expect(loadNucleusBoundaryElements).toHaveBeenCalledTimes(1)
      expect(snapshot.boundaryElements).toEqual([cellElement])
      expect(snapshot.boundaryState.status).toBe('ready')
    })

    it('stops a hidden layer request and reads it again when shown', async () => {
      const firstNuclei = deferredPromise<ElementBatch>()
      const loadNucleusBoundaryElements = vi
        .fn<() => Promise<ElementBatch>>()
        .mockReturnValueOnce(firstNuclei.promise)
        .mockResolvedValue({ elements: [nucleusElement] })
      const props = {
        loadBoundaryElements: vi.fn(async () => ({ elements: [cellElement] })),
        loadGeneExpression: vi.fn(async () => batch),
        onReady: captureSnapshot,
        selectedGenes: [],
      }
      const { rerender } = render(
        <Probe {...props} loadNucleusBoundaryElements={loadNucleusBoundaryElements} />,
      )
      act(() => {
        api.handleViewportChange(detail)
      })
      await flushRequests()

      expect(snapshot.nucleusBoundaryState.status).toBe('loading')

      rerender(<Probe {...props} />)
      await flushRequests()
      await act(async () => {
        firstNuclei.resolve({ elements: [nucleusElement] })
        await firstNuclei.promise
      })

      expect(snapshot.nucleusBoundaryState).toEqual({ status: 'idle' })
      expect(snapshot.nucleusBoundaryElements).toEqual([])

      rerender(
        <Probe {...props} loadNucleusBoundaryElements={loadNucleusBoundaryElements} />,
      )
      await flushRequests()

      expect(loadNucleusBoundaryElements).toHaveBeenCalledTimes(2)
      expect(snapshot.nucleusBoundaryElements).toEqual([nucleusElement])
    })

    it('drops a hidden layer error and reads the layer again when shown', async () => {
      const loadNucleusBoundaryElements = vi
        .fn<() => Promise<ElementBatch>>()
        .mockRejectedValueOnce(new Error('nucleus_boundaries.parquet: HTTP 503'))
        .mockResolvedValue({ elements: [nucleusElement] })
      const props = {
        loadBoundaryElements: vi.fn(async () => ({ elements: [cellElement] })),
        loadGeneExpression: vi.fn(async () => batch),
        onReady: captureSnapshot,
        selectedGenes: [],
      }
      const { rerender } = render(
        <Probe {...props} loadNucleusBoundaryElements={loadNucleusBoundaryElements} />,
      )
      act(() => {
        api.handleViewportChange(detail)
      })
      await flushRequests()

      expect(snapshot.nucleusBoundaryState.status).toBe('error')

      // Panning inside the failed area does not retry.
      act(() => {
        api.handleViewportChange({
          ...detail,
          bbox: { ...bbox, minX: micrometers(1), maxX: micrometers(99) },
        })
      })
      await flushRequests()
      expect(loadNucleusBoundaryElements).toHaveBeenCalledTimes(1)

      rerender(<Probe {...props} />)
      await flushRequests()
      expect(snapshot.nucleusBoundaryState).toEqual({ status: 'idle' })

      rerender(
        <Probe {...props} loadNucleusBoundaryElements={loadNucleusBoundaryElements} />,
      )
      await flushRequests()

      expect(loadNucleusBoundaryElements).toHaveBeenCalledTimes(2)
      expect(snapshot.nucleusBoundaryElements).toEqual([nucleusElement])
      expect(snapshot.nucleusBoundaryState.status).toBe('ready')
    })

    it('clears both layers beyond the boundary limit', async () => {
      const props = {
        loadBoundaryElements: vi.fn(async () => ({ elements: [cellElement] })),
        loadGeneExpression: vi.fn(async () => batch),
        loadNucleusBoundaryElements: vi.fn(async () => ({ elements: [nucleusElement] })),
        onReady: captureSnapshot,
        selectedGenes: [],
      }
      render(<Probe {...props} />)
      act(() => {
        api.handleViewportChange(detail)
      })
      await flushRequests()
      act(() => {
        api.handleViewportChange(denseOverviewDetail)
      })
      await flushRequests()

      expect(snapshot.boundaryElements).toEqual([])
      expect(snapshot.nucleusBoundaryElements).toEqual([])
      expect(snapshot.boundaryState).toEqual({ status: 'idle' })
      expect(snapshot.nucleusBoundaryState).toEqual({ status: 'idle' })
    })
  })
})
