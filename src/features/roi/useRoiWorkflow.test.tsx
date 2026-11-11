import { act, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { DatasetCell } from '../../datasets/xeniumDataset'
import type { RoiCellsLoader, RoiGeneStatsLoader } from '../app-shell/appDependencies'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { MagicLensScope, MagicLensState } from './magicLensModel'
import type {
  RoiGeneStatsState,
  RoiGeneViewportWarmupState,
  RoiState,
  RoiTranscriptExportState,
} from './roiModel'
import { ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS } from './roiModel'
import { ALL_GENES, type RoiReferenceState } from './roiEnrichmentModel'
import { useRoiWorkflow } from './useRoiWorkflow'

const selection: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(10),
    maxY: micrometers(10),
  },
}

interface Snapshot {
  readonly debugMessages: readonly string[]
  readonly magicLensState: MagicLensState<StructuredLoadError>
  readonly roiGeneStatsState: RoiGeneStatsState<StructuredLoadError>
  readonly roiMode: RoiDrawMode
  readonly roiReferenceState: RoiReferenceState<StructuredLoadError>
  readonly roiRequestId: number
  readonly roiState: RoiState<StructuredLoadError>
  readonly roiTranscriptExportState: RoiTranscriptExportState<StructuredLoadError>
}

let api: ReturnType<typeof useRoiWorkflow>
let snapshot: Snapshot

function Probe({
  loadRoiCells,
  loadRoiGeneStats,
  onReady,
  referenceCells,
}: {
  readonly loadRoiCells?: RoiCellsLoader
  readonly loadRoiGeneStats?: RoiGeneStatsLoader
  readonly referenceCells?: readonly DatasetCell[]
  readonly onReady: (
    nextApi: ReturnType<typeof useRoiWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
}) {
  const [magicLensState, setMagicLensState] = React.useState<
    MagicLensState<StructuredLoadError>
  >({ status: 'loading', url: 'https://example.test/output', scope: 'roi' })
  const [roiGeneStatsState, setRoiGeneStatsState] = React.useState<
    RoiGeneStatsState<StructuredLoadError>
  >({ status: 'loading', url: 'https://example.test/output', cellCount: 1 })
  const [roiGeneViewportWarmupState, setRoiGeneViewportWarmupState] =
    React.useState<RoiGeneViewportWarmupState>({ status: 'idle' })
  const [roiMode, setRoiMode] = React.useState<RoiDrawMode>('box')
  const [roiName, setRoiName] = React.useState('ROI 1')
  const [roiReferenceState, setRoiReferenceState] = React.useState<
    RoiReferenceState<StructuredLoadError>
  >({ status: 'idle' })
  const [roiState, setRoiState] = React.useState<RoiState<StructuredLoadError>>({
    status: 'ready',
    url: 'https://example.test/output',
    bbox: selection.bbox,
    selection,
    cells: [
      {
        id: asCellId('aaaaaaaa-1'),
        position: { x: micrometers(1), y: micrometers(2) },
      },
    ],
    hitCellLimit: false,
  })
  const [roiTranscriptExportState, setRoiTranscriptExportState] = React.useState<
    RoiTranscriptExportState<StructuredLoadError>
  >({ status: 'loading', url: 'https://example.test/output' })
  const debugMessagesRef = React.useRef<string[]>([])
  const magicLensAbortRef = React.useRef<AbortController | null>(new AbortController())
  const magicLensDebounceRef = React.useRef<number | null>(null)
  const magicLensLastDetailRef = React.useRef<ViewerMagicLensDetail | null>(null)
  const magicLensLastQueryKeyRef = React.useRef<string | null>(null)
  const magicLensRequestIdRef = React.useRef(0)
  const roiAbortRef = React.useRef<AbortController | null>(new AbortController())
  const roiGeneViewportWarmupAbortRef = React.useRef<AbortController | null>(null)
  const roiGeneViewportWarmupKeyRef = React.useRef<string | null>(null)
  const roiGeneViewportWarmupTimeoutRef = React.useRef<number | null>(null)
  const roiIdRef = React.useRef(0)
  const roiRequestIdRef = React.useRef(4)
  const roiTranscriptExportAbortRef = React.useRef<AbortController | null>(
    new AbortController(),
  )
  const roiTranscriptExportRequestIdRef = React.useRef(2)
  const loadState: DatasetLoadState<StructuredLoadError> = {
    status: 'ready',
    url: 'https://example.test/output',
    cellCount: 1,
  }
  const magicLensScope: MagicLensScope = 'roi'
  const appendFallbackNotice = React.useCallback(() => undefined, [])

  const nextApi = useRoiWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
      appendFallbackNotice,
    },
    controls: {
      currentViewportDetail: null,
      magicLensScope,
      roiName,
      ...(referenceCells === undefined ? {} : { referenceCells }),
    },
    data: {
      loadState,
      roiState,
    },
    loaders: {
      loadRoiCells: loadRoiCells ?? vi.fn(async () => []),
      loadRoiGeneStats:
        loadRoiGeneStats ??
        vi.fn(async () => ({
          genes: [],
          cellCount: 0,
          sampledCellCount: 0,
          totalCount: 0,
          hitCellLimit: false,
        })),
      loadRoiTranscripts: vi.fn(async () => []),
    },
    refs: {
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupTimeoutRef,
      roiIdRef,
      roiRequestIdRef,
      roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef,
    },
    setters: {
      setMagicLensState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setRoiState,
      setRoiTranscriptExportState,
    },
  })

  React.useEffect(() => {
    onReady(nextApi, {
      debugMessages: debugMessagesRef.current,
      magicLensState,
      roiGeneStatsState,
      roiMode,
      roiReferenceState,
      roiRequestId: roiRequestIdRef.current,
      roiState,
      roiTranscriptExportState,
    })
  })

  void roiGeneViewportWarmupState
  void roiName

  return null
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const warmupCells = [
  {
    id: asCellId('aaaaaaaa-1'),
    position: { x: micrometers(1), y: micrometers(2) },
    transcriptCount: 12,
    cellArea: 20,
  },
]

const firstViewportDetail: ViewerViewportDetail = {
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(100),
    maxY: micrometers(100),
  },
  visibleCellCount: 120,
  viewState: { target: [0, 0, 0], zoom: 1, minZoom: -8, maxZoom: 8 },
}

const movedViewportDetail: ViewerViewportDetail = {
  bbox: {
    minX: micrometers(300),
    minY: micrometers(300),
    maxX: micrometers(450),
    maxY: micrometers(450),
  },
  visibleCellCount: 260,
  viewState: { target: [375, 375, 0], zoom: 1.8, minZoom: -8, maxZoom: 8 },
}

function WarmupProbe({
  currentViewportDetail,
  datasetUrl = 'https://example.test/output',
  loadRoiCells,
  loadRoiGeneStats,
  referenceCells,
  viewportGeneWarmupEnabled = true,
}: {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly datasetUrl?: string
  readonly loadRoiCells: RoiCellsLoader
  readonly loadRoiGeneStats: RoiGeneStatsLoader
  readonly referenceCells?: readonly DatasetCell[]
  readonly viewportGeneWarmupEnabled?: boolean
}) {
  const [magicLensState, setMagicLensState] = React.useState<
    MagicLensState<StructuredLoadError>
  >({ status: 'idle' })
  const [roiGeneStatsState, setRoiGeneStatsState] = React.useState<
    RoiGeneStatsState<StructuredLoadError>
  >({ status: 'idle' })
  const [roiGeneViewportWarmupState, setRoiGeneViewportWarmupState] =
    React.useState<RoiGeneViewportWarmupState>({ status: 'idle' })
  const [roiMode, setRoiMode] = React.useState<RoiDrawMode>('idle')
  const [roiName, setRoiName] = React.useState('ROI 1')
  const [roiReferenceState, setRoiReferenceState] = React.useState<
    RoiReferenceState<StructuredLoadError>
  >({ status: 'idle' })
  const [roiState, setRoiState] = React.useState<RoiState<StructuredLoadError>>({
    status: 'idle',
  })
  const [roiTranscriptExportState, setRoiTranscriptExportState] = React.useState<
    RoiTranscriptExportState<StructuredLoadError>
  >({ status: 'idle' })
  const magicLensAbortRef = React.useRef<AbortController | null>(null)
  const magicLensDebounceRef = React.useRef<number | null>(null)
  const magicLensLastDetailRef = React.useRef<ViewerMagicLensDetail | null>(null)
  const magicLensLastQueryKeyRef = React.useRef<string | null>(null)
  const magicLensRequestIdRef = React.useRef(0)
  const roiAbortRef = React.useRef<AbortController | null>(null)
  const roiGeneViewportWarmupAbortRef = React.useRef<AbortController | null>(null)
  const roiGeneViewportWarmupKeyRef = React.useRef<string | null>(null)
  const roiGeneViewportWarmupTimeoutRef = React.useRef<number | null>(null)
  const roiIdRef = React.useRef(0)
  const roiRequestIdRef = React.useRef(0)
  const roiTranscriptExportAbortRef = React.useRef<AbortController | null>(null)
  const roiTranscriptExportRequestIdRef = React.useRef(0)
  const loadState: DatasetLoadState<StructuredLoadError> = {
    status: 'ready',
    url: datasetUrl,
    cellCount: 1_000,
  }
  const loadRoiTranscripts = React.useCallback(async () => [], [])
  const appendFallbackNotice = React.useCallback(() => undefined, [])

  useRoiWorkflow({
    callbacks: {
      appendDebugEvent: vi.fn(),
      appendFallbackNotice,
    },
    controls: {
      currentViewportDetail,
      magicLensScope: 'roi',
      roiName,
      viewportGeneWarmupEnabled,
      ...(referenceCells === undefined ? {} : { referenceCells }),
    },
    data: {
      loadState,
      roiState,
    },
    loaders: {
      loadRoiCells,
      loadRoiGeneStats,
      loadRoiTranscripts,
    },
    refs: {
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupTimeoutRef,
      roiIdRef,
      roiRequestIdRef,
      roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef,
    },
    setters: {
      setMagicLensState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setRoiState,
      setRoiTranscriptExportState,
    },
  })

  void magicLensState
  void roiGeneStatsState
  void roiGeneViewportWarmupState
  void roiMode
  void roiReferenceState
  void roiTranscriptExportState

  return null
}

function roiCellsLoader(): ReturnType<typeof vi.fn<RoiCellsLoader>> {
  return vi.fn(async () => warmupCells)
}

function roiGeneStatsLoader(): ReturnType<typeof vi.fn<RoiGeneStatsLoader>> {
  return vi.fn(async () => ({
    genes: [],
    cellCount: warmupCells.length,
    sampledCellCount: warmupCells.length,
    totalCount: 0,
    hitCellLimit: false,
  }))
}

describe('useRoiWorkflow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears ROI state and dependent exports/lens state', () => {
    render(
      <Probe
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleClearRoi()
    })

    expect(snapshot.roiMode).toBe('idle')
    expect(snapshot.roiState).toEqual({ status: 'idle' })
    expect(snapshot.roiGeneStatsState).toEqual({ status: 'idle' })
    expect(snapshot.roiTranscriptExportState).toEqual({ status: 'idle' })
    expect(snapshot.magicLensState).toEqual({ status: 'idle' })
    expect(snapshot.roiRequestId).toBe(5)
    expect(snapshot.debugMessages).toContain('Cleared ROI')
  })

  it('cancels ROI genes, keeping the ROI and its cells (15.3-D)', async () => {
    const stats = deferred<Awaited<ReturnType<RoiGeneStatsLoader>>>()
    let genesSignal: AbortSignal | undefined
    const loadRoiCells = vi.fn<RoiCellsLoader>(async () => [
      { id: asCellId('aaaaaaaa-1'), position: { x: micrometers(1), y: micrometers(2) } },
    ])
    const loadRoiGeneStats = vi.fn<RoiGeneStatsLoader>((_url, _cells, options) => {
      genesSignal = options?.signal
      return stats.promise
    })

    render(
      <Probe
        loadRoiCells={loadRoiCells}
        loadRoiGeneStats={loadRoiGeneStats}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      api.handleRoiComplete(selection)
    })
    expect(snapshot.roiGeneStatsState).toMatchObject({ status: 'loading' })

    act(() => {
      api.handleCancelRoiGenes()
    })

    expect(genesSignal?.aborted).toBe(true)
    expect(snapshot.roiGeneStatsState).toEqual({ status: 'idle' })
    expect(snapshot.roiState).toMatchObject({ status: 'ready' })
    expect(snapshot.debugMessages).toContain('Cancelled ROI genes')

    await act(async () => {
      stats.resolve({
        genes: [],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 0,
        hitCellLimit: false,
      })
      await stats.promise
    })

    expect(snapshot.roiGeneStatsState).toEqual({ status: 'idle' })
    expect(loadRoiGeneStats).toHaveBeenCalledTimes(1)
  })

  it('cancels ROI cells, dropping the ROI (15.3-D)', async () => {
    const cells = deferred<Awaited<ReturnType<RoiCellsLoader>>>()
    const loadRoiCells = vi.fn<RoiCellsLoader>(() => cells.promise)

    render(
      <Probe
        loadRoiCells={loadRoiCells}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleRoiComplete(selection)
    })
    expect(snapshot.roiState).toMatchObject({ status: 'loading' })

    act(() => {
      api.handleCancelRoiCells()
    })
    await act(async () => {
      cells.resolve([])
      await cells.promise
    })

    expect(snapshot.roiState).toEqual({ status: 'idle' })
    expect(snapshot.roiGeneStatsState).toEqual({ status: 'idle' })
    expect(snapshot.debugMessages).toContain('Cancelled ROI cells')
  })

  it('exports ready ROI geometry as GeoJSON', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    render(
      <Probe
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleExportRoiGeoJson()
    })

    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob | undefined
    const geoJson = JSON.parse((await blob?.text()) ?? '{}')

    expect(blob?.type).toBe('application/geo+json;charset=utf-8')
    expect(geoJson).toMatchObject({
      type: 'FeatureCollection',
      features: [
        {
          properties: {
            roi_name: 'ROI 1',
            dataset_platform: 'xenium',
            dataset_url: 'https://example.test/output',
            selected_cell_count: 1,
            hit_cell_limit: false,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
      ],
    })
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test')
    expect(snapshot.debugMessages).toContain('Exported ROI GeoJSON ROI 1')
  })

  it('compares the selection with the reference cells outside it (15.4-B)', async () => {
    const inside = {
      id: asCellId('aaaaaaaa-1'),
      position: { x: micrometers(1), y: micrometers(2) },
    }
    const referenceCells: readonly DatasetCell[] = [
      { id: asCellId('bbbbbbbb-1'), position: { x: micrometers(5), y: micrometers(5) } },
      { id: asCellId('cccccccc-1'), position: { x: micrometers(50), y: micrometers(5) } },
      { id: asCellId('dddddddd-1'), position: { x: micrometers(60), y: micrometers(5) } },
    ]
    const loadRoiCells = vi.fn<RoiCellsLoader>(async () => [inside])
    const loadRoiGeneStats = vi.fn<RoiGeneStatsLoader>(async (_url, cells) => ({
      genes: [],
      cellCount: cells.length,
      sampledCellCount: cells.length,
      totalCount: 0,
      hitCellLimit: false,
    }))

    render(
      <Probe
        loadRoiCells={loadRoiCells}
        loadRoiGeneStats={loadRoiGeneStats}
        referenceCells={referenceCells}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      api.handleRoiComplete(selection)
    })

    // The preview and the reference ask for every gene; the reference
    // leaves out the cell inside the box.
    expect(loadRoiGeneStats).toHaveBeenNthCalledWith(
      1,
      'https://example.test/output',
      [inside],
      expect.objectContaining({ geneLimit: ALL_GENES, sampleStrategy: 'head' }),
    )
    expect(loadRoiGeneStats).toHaveBeenNthCalledWith(
      2,
      'https://example.test/output',
      referenceCells.slice(1),
      expect.objectContaining({ cellLimit: 2, geneLimit: ALL_GENES }),
    )
    expect(snapshot.roiReferenceState).toMatchObject({
      status: 'ready',
      stats: { sampledCellCount: 2 },
    })
    expect(snapshot.debugMessages).toContain('ROI reference started: 2 cells outside')

    act(() => {
      api.handleClearRoi()
    })
    expect(snapshot.roiReferenceState).toEqual({ status: 'idle' })
  })

  it('says the reference is unavailable when none of it is outside', async () => {
    const loadRoiCells = vi.fn<RoiCellsLoader>(async () => [
      { id: asCellId('aaaaaaaa-1'), position: { x: micrometers(1), y: micrometers(2) } },
    ])
    const loadRoiGeneStats = vi.fn<RoiGeneStatsLoader>(async () => ({
      genes: [],
      cellCount: 1,
      sampledCellCount: 1,
      totalCount: 0,
      hitCellLimit: false,
    }))

    render(
      <Probe
        loadRoiCells={loadRoiCells}
        loadRoiGeneStats={loadRoiGeneStats}
        referenceCells={[
          {
            id: asCellId('bbbbbbbb-1'),
            position: { x: micrometers(5), y: micrometers(5) },
          },
        ]}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      api.handleRoiComplete(selection)
    })

    expect(loadRoiGeneStats).toHaveBeenCalledTimes(1)
    expect(snapshot.roiReferenceState).toEqual({
      status: 'unavailable',
      url: 'https://example.test/output',
    })
  })

  it('keeps the genes when the reference read fails', async () => {
    const loadRoiCells = vi.fn<RoiCellsLoader>(async () => [
      { id: asCellId('aaaaaaaa-1'), position: { x: micrometers(1), y: micrometers(2) } },
    ])
    const loadRoiGeneStats = vi.fn<RoiGeneStatsLoader>(async (_url, cells) => {
      if (cells[0]?.id === asCellId('cccccccc-1')) throw new Error('Range read failed')
      return {
        genes: [],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 0,
        hitCellLimit: false,
      }
    })

    render(
      <Probe
        loadRoiCells={loadRoiCells}
        loadRoiGeneStats={loadRoiGeneStats}
        referenceCells={[
          {
            id: asCellId('cccccccc-1'),
            position: { x: micrometers(50), y: micrometers(5) },
          },
        ]}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      api.handleRoiComplete(selection)
    })

    expect(snapshot.roiGeneStatsState).toMatchObject({ status: 'ready' })
    expect(snapshot.roiReferenceState).toMatchObject({ status: 'error' })
  })

  it('reads the reference sample during the warm-up (15.4-B)', async () => {
    vi.useFakeTimers()
    const loadRoiCells = roiCellsLoader()
    const loadRoiGeneStats = roiGeneStatsLoader()
    const referenceCells: readonly DatasetCell[] = [
      { id: asCellId('cccccccc-1'), position: { x: micrometers(50), y: micrometers(5) } },
    ]

    try {
      const view = render(
        <WarmupProbe
          currentViewportDetail={firstViewportDetail}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
          referenceCells={referenceCells}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
      })

      expect(loadRoiGeneStats).toHaveBeenCalledTimes(2)
      expect(loadRoiGeneStats).toHaveBeenLastCalledWith(
        'https://example.test/output',
        referenceCells,
        expect.objectContaining({ cellLimit: 1, geneLimit: ALL_GENES }),
      )
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps ROI gene warmup scoped to the dataset while the viewport moves', async () => {
    vi.useFakeTimers()
    const loadRoiCells = roiCellsLoader()
    const loadRoiGeneStats = roiGeneStatsLoader()

    try {
      const view = render(
        <WarmupProbe
          currentViewportDetail={firstViewportDetail}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )

      view.rerender(
        <WarmupProbe
          currentViewportDetail={movedViewportDetail}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
      })

      expect(loadRoiCells).toHaveBeenCalledTimes(1)
      expect(loadRoiCells).toHaveBeenCalledWith(
        'https://example.test/output',
        expect.objectContaining({ bbox: firstViewportDetail.bbox }),
        expect.objectContaining({ limit: 5_000, signal: expect.any(AbortSignal) }),
      )
      expect(loadRoiGeneStats).toHaveBeenCalledTimes(1)

      view.rerender(
        <WarmupProbe
          currentViewportDetail={movedViewportDetail}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
      })

      expect(loadRoiCells).toHaveBeenCalledTimes(1)
      expect(loadRoiGeneStats).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not prewarm ROI gene stats when viewport warmup is disabled', async () => {
    vi.useFakeTimers()
    const loadRoiCells = roiCellsLoader()
    const loadRoiGeneStats = roiGeneStatsLoader()

    try {
      render(
        <WarmupProbe
          currentViewportDetail={firstViewportDetail}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
          viewportGeneWarmupEnabled={false}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
      })

      expect(loadRoiCells).not.toHaveBeenCalled()
      expect(loadRoiGeneStats).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs ROI gene warmup again after the dataset URL changes', async () => {
    vi.useFakeTimers()
    const loadRoiCells = roiCellsLoader()
    const loadRoiGeneStats = roiGeneStatsLoader()

    try {
      const view = render(
        <WarmupProbe
          currentViewportDetail={firstViewportDetail}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
      })

      view.rerender(
        <WarmupProbe
          currentViewportDetail={movedViewportDetail}
          datasetUrl="https://example.test/other-output"
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
      })

      expect(loadRoiCells).toHaveBeenCalledTimes(2)
      expect(loadRoiGeneStats).toHaveBeenCalledTimes(2)
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
