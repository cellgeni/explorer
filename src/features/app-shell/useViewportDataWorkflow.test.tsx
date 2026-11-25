import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { asCellId } from '../../data/cellid'
import { micrometers, type BBox } from '../../data/coords'
import { imagePlaneKey, type ImagePyramidPlane } from '../../data/imagePyramid'
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
import type { GeneExpressionLoader } from './appDependencies'
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
  geneExpressionDetailMode = 'auto',
  geneExpressionDisabledMessage,
  geneExpressionLoadingEnabled = true,
  loadBoundaryElements,
  loadGeneExpression,
  loadNucleusBoundaryElements,
  loadState = readyLoadState,
  onReady,
  selectedGenes = ['Actb'],
  viewportCellCount,
  visiumHdBinSizeMicrometers,
  boundaryPlane,
}: {
  readonly boundaryPlane?: ImagePyramidPlane
  readonly loadBoundaryElements: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['boundaryElements']
  readonly cellBoundaryLoadingEnabled?: boolean
  readonly geneExpressionDetailMode?: 'auto' | 'exact-region' | 'all-cells'
  readonly geneExpressionDisabledMessage?: string
  readonly geneExpressionLoadingEnabled?: boolean
  readonly loadGeneExpression: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['geneExpression']
  readonly loadNucleusBoundaryElements?: Parameters<
    typeof useViewportDataWorkflow
  >[0]['loaders']['boundaryElements']
  readonly loadState?: DatasetLoadState<StructuredLoadError>
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
      geneExpressionDetailMode,
      geneExpressionDisabledMessage,
      geneExpressionLoadingEnabled,
      geneExpressionScaleKey: 'scale-key',
      geneExpressionScoreMode: 'sum',
      ...(visiumHdBinSizeMicrometers === undefined ? {} : { visiumHdBinSizeMicrometers }),
      viewportCellCount,
      boundaryPlane,
    },
    data: {
      loadState,
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
  it('keeps the viewport detail when the same view is reported again (O6)', async () => {
    render(
      <Probe
        cellBoundaryLoadingEnabled={false}
        geneExpressionLoadingEnabled={false}
        loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
        loadGeneExpression={vi.fn(async () => batch)}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleViewportChange(detail)
    })
    act(() => {
      api.handleViewportChange({
        ...detail,
        bbox: { ...detail.bbox },
        viewState: { ...detail.viewState, target: [...detail.viewState.target] },
      })
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(snapshot.currentViewportDetail).toBe(detail)

    const moved = {
      ...detail,
      viewState: { ...detail.viewState, zoom: detail.viewState.zoom + 1 },
    }

    act(() => {
      api.handleViewportChange(moved)
    })

    expect(snapshot.currentViewportDetail).toBe(moved)
  })

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
    expect(snapshot.geneExpressionBatch).toEqual({ ...batch, bbox })
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
        // The view and a quarter of its size on each side.
        {
          minX: micrometers(-25),
          minY: micrometers(-25),
          maxX: micrometers(125),
          maxY: micrometers(125),
        },
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

  describe('expression reads for the view of a large dataset', () => {
    const largeLoadState: DatasetLoadState<StructuredLoadError> = {
      status: 'ready',
      url: 'https://example.test/xenium-1m',
      cellCount: 1_000_000,
    }

    // 150 x 90 units around (cx, 5,000) at zoom 3 with 20,000 cells in view,
    // so the exact read pads it by a quarter on each side.
    function view(cx: number, width = 150): ViewerViewportDetail {
      return {
        bbox: {
          minX: micrometers(cx - width / 2),
          maxX: micrometers(cx + width / 2),
          minY: micrometers(4_955),
          maxY: micrometers(5_045),
        },
        visibleCellCount: 20_000,
        viewState: { target: [cx, 5_000, 0], zoom: 3, minZoom: -8, maxZoom: 8 },
      }
    }

    function covers(outer: BBox, inner: BBox): boolean {
      return (
        outer.minX <= inner.minX &&
        outer.maxX >= inner.maxX &&
        outer.minY <= inner.minY &&
        outer.maxY >= inner.maxY
      )
    }

    async function showViews(
      details: readonly ViewerViewportDetail[],
      detailMode: 'auto' | 'exact-region' = 'auto',
    ) {
      const loadGeneExpression = vi.fn<GeneExpressionLoader>(async () => batch)

      render(
        <Probe
          geneExpressionDetailMode={detailMode}
          loadBoundaryElements={vi.fn(async () => ({ elements: [] }))}
          loadGeneExpression={loadGeneExpression}
          loadState={largeLoadState}
          onReady={(nextApi, nextSnapshot) => {
            api = nextApi
            snapshot = nextSnapshot
          }}
        />,
      )

      for (const next of details) {
        await act(async () => {
          api.handleViewportChange(next)
          await Promise.resolve()
          await Promise.resolve()
        })
      }

      return loadGeneExpression.mock.calls.map(([, requested]) => requested)
    }

    it('reads nothing for a pan inside the margin and reads again once the view leaves it', async () => {
      const requested = await showViews([view(5_000), view(5_030), view(5_045)])

      // The first box runs from 4,887.5 to 5,112.5: a 30-unit pan stays in
      // it, a 45-unit one does not (though its centre rounds to the same 100).
      expect(requested).toHaveLength(2)
      expect(covers(requested[1]!, view(5_045).bbox)).toBe(true)
      expect(snapshot.geneExpressionState.status).toBe('ready')
    })

    it('reads again when the viewer widens at the same centre and zoom', async () => {
      const requested = await showViews([view(5_000), view(5_000, 250)])

      expect(requested).toHaveLength(2)
      expect(covers(requested[1]!, view(5_000, 250).bbox)).toBe(true)
    })

    it('keeps an Exact region read for a pan inside its margin', async () => {
      const panned = { ...view(5_030), visibleCellCount: 19_000 }
      const requested = await showViews([view(5_000), panned], 'exact-region')

      expect(requested).toHaveLength(1)
      expect(covers(requested[0]!, panned.bbox)).toBe(true)
    })
  })

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

  it('reads cell outlines again at a new image plane, drawing the old until then (plan 28-D9)', async () => {
    const outline = (id: string): SpatialElement => ({
      id,
      geometry: { kind: 'polygon', rings: [[{ x: micrometers(1), y: micrometers(2) }]] },
    })
    let releaseLater = () => {}
    const loadBoundaryElements = vi.fn(
      async (
        _baseUrl: string,
        _bbox: BBox,
        options: { readonly plane?: ImagePyramidPlane } = {},
      ) => {
        const t = options.plane?.t ?? 0

        if (t > 0) {
          await new Promise<void>((resolve) => {
            releaseLater = resolve
          })
        }

        return {
          elements: [outline(`t${t.toString()}`)],
          plane: imagePlaneKey(options.plane ?? {}),
          ...(t > 1
            ? { planeNotice: 'The labels have 2 time points; later ones show the last.' }
            : {}),
        }
      },
    )
    const loadGeneExpression = vi.fn(async () => batch)
    const probe = (plane: ImagePyramidPlane) => (
      <Probe
        boundaryPlane={plane}
        loadBoundaryElements={loadBoundaryElements}
        loadGeneExpression={loadGeneExpression}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />
    )
    const { rerender } = render(probe({ z: 2, t: 0 }))

    act(() => {
      api.handleViewportChange(denseCellScaleDetail)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(loadBoundaryElements).toHaveBeenLastCalledWith(
      'https://example.test/output',
      expect.anything(),
      expect.objectContaining({ plane: { z: 2, t: 0 } }),
    )
    expect(snapshot.boundaryState).toMatchObject({ status: 'ready', plane: '2:0' })

    // The same plane as a new object reads nothing.
    rerender(probe({ z: 2, t: 0 }))
    expect(loadBoundaryElements).toHaveBeenCalledTimes(1)

    rerender(probe({ z: 2, t: 1 }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(loadBoundaryElements).toHaveBeenCalledTimes(2)
    // The drawn outlines and their plane stay while the next ones load.
    expect(snapshot.boundaryState).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      plane: '2:0',
    })
    expect(snapshot.boundaryElements.map((element) => element.id)).toEqual(['t0'])

    await act(async () => {
      releaseLater()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(snapshot.boundaryState).toMatchObject({ status: 'ready', plane: '2:1' })
    expect(snapshot.boundaryElements.map((element) => element.id)).toEqual(['t1'])

    rerender(probe({ z: 2, t: 5 }))
    await act(async () => {
      releaseLater()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(snapshot.debugMessages).toContain(
      'The labels have 2 time points; later ones show the last.',
    )
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
    // Zoomed in to cell scale with more cells in view than the limit of 10.
    const overLimitDetail: ViewerViewportDetail = { ...detail, visibleCellCount: 20 }

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
      api.handleViewportChange(overLimitDetail)
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
      api.handleViewportChange(overLimitDetail)
    })
    expect(loadBoundaryElements).toHaveBeenCalledTimes(2)
  })

  it('reads the view alone when its margin holds more outlines than the limit', async () => {
    // Over the limit of 10 for the padded box, under it for the view.
    const loadBoundaryElements = vi.fn(async (_url: string, box: BBox) =>
      box.minX < bbox.minX
        ? { elements: [], overLimit: { count: 12 } }
        : {
            elements: [
              {
                id: 'boundary-1',
                geometry: {
                  kind: 'polygon' as const,
                  rings: [[{ x: micrometers(1), y: micrometers(2) }]],
                },
              },
            ],
          },
    )

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
      await Promise.resolve()
    })

    expect(loadBoundaryElements).toHaveBeenCalledTimes(2)
    expect(loadBoundaryElements.mock.calls[1]?.[1]).toEqual(bbox)
    expect(snapshot.boundaryState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellCount: 1,
    })
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
    expect(snapshot.geneExpressionBatch).toEqual({ ...batch, bbox })
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

  it('reads a failed whole-slide expression again for the next view, not the same one', async () => {
    const loadGeneExpression = vi
      .fn<() => Promise<GeneExpressionBatch>>()
      .mockRejectedValueOnce(new Error('matrix unavailable'))
      .mockResolvedValue(batch)

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
    // The Probe replays the same view on each render; that reads nothing.
    expect(loadGeneExpression).toHaveBeenCalledTimes(1)
    expect(snapshot.geneExpressionState.status).toBe('error')

    // The viewer reports a view again (a pan): the whole slide is read again.
    act(() => {
      api.handleViewportChange({ ...detailWithoutBoundaryLoad })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(loadGeneExpression).toHaveBeenCalledTimes(2)
    expect(snapshot.geneExpressionState.status).toBe('ready')
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
