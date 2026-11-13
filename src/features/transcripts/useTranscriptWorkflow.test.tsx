import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { micrometers } from '../../data/coords'
import type { FallbackNotice } from '../../data/fallbackNotice'
import type {
  TranscriptAggregateResult,
  TranscriptCapabilities,
  TranscriptDetailMode,
  TranscriptFeatureFilterMode,
  TranscriptViewportResult,
} from '../../data/transcriptOverlay'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import { deferredPromise } from '../../test/appTestHarness'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  TRANSCRIPT_EXACT_SLOW_QUERY_MESSAGE,
  TRANSCRIPT_EXACT_SLOW_QUERY_MS,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './transcriptLayerModel'
import { useTranscriptWorkflow } from './useTranscriptWorkflow'

const viewportDetail: ViewerViewportDetail = {
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(10),
    maxY: micrometers(10),
  },
  visibleCellCount: 1,
  viewState: { target: [0, 0, 0], zoom: 0, minZoom: -8, maxZoom: 8 },
}

const DATASET_URL = 'https://example.test/output'

interface Snapshot {
  readonly capabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly debugMessages: readonly string[]
  readonly fallbackNotices: readonly FallbackNotice[]
  readonly layerState: TranscriptLayerState<StructuredLoadError>
  readonly manualExactRequestKey: string | null
  readonly result: ReturnType<typeof useTranscriptWorkflow>
  // What `Load exact viewport` does (useTranscriptControlsWorkflow).
  readonly loadExactViewport: (requestKey: string) => void
}

type Loaders = Parameters<typeof useTranscriptWorkflow>[0]['loaders']

interface ProbeOptions {
  readonly loaders?: Partial<Loaders>
  readonly capabilities?: TranscriptCapabilities
  readonly detailMode?: TranscriptDetailMode
  readonly featureFilterMode?: TranscriptFeatureFilterMode
  readonly overviewCells?: readonly OverviewCellDatum[]
  readonly selectedGenes?: readonly string[]
  readonly showTranscriptOverlay?: boolean
  readonly viewportDetail?: ViewerViewportDetail
  readonly visibleTranscriptEstimate?: number
}

let snapshot: Snapshot

function emptyAggregate(): TranscriptAggregateResult {
  return {
    source: 'native-zarr',
    bins: [],
    level: { level: 0, gridSizeMicrometers: 1, gridKeys: [], transcriptCounts: [] },
    selectedFeatureNames: [],
  }
}

function defaultLoaders(): Loaders {
  return {
    loadTranscriptAggregates: vi.fn(async () => emptyAggregate()),
    loadTranscriptCapabilities: vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    })),
    loadTranscriptViewport: vi.fn(async () => ({
      points: [],
      groups: [],
      hitPointLimit: false,
    })),
  }
}

const EMPTY_CELLS: readonly OverviewCellDatum[] = []
const NO_GENES: readonly string[] = []

function Probe({
  loaders,
  options,
  onReady,
}: {
  readonly loaders: Loaders
  readonly options: ProbeOptions
  readonly onReady: (nextSnapshot: Snapshot) => void
}) {
  const [capabilityState, setTranscriptCapabilityState] = React.useState<
    TranscriptCapabilityState<StructuredLoadError>
  >(
    options.capabilities === undefined
      ? { status: 'idle' }
      : { status: 'ready', url: DATASET_URL, capabilities: options.capabilities },
  )
  const [layerState, setTranscriptLayerState] = React.useState<
    TranscriptLayerState<StructuredLoadError>
  >({ status: 'idle' })
  const [manualExactRequestKey, setManualTranscriptExactRequestKey] = React.useState<
    string | null
  >(null)
  const debugMessagesRef = React.useRef<string[]>([])
  const fallbackNoticesRef = React.useRef<FallbackNotice[]>([])
  const loadRequestIdRef = React.useRef(1)
  const transcriptAbortRef = React.useRef<AbortController | null>(null)
  const transcriptCapabilityAbortRef = React.useRef<AbortController | null>(null)
  const transcriptCapabilityRequestIdRef = React.useRef(0)
  const transcriptRequestIdRef = React.useRef(0)
  const transcriptViewportKeyRef = React.useRef<string | null>(null)
  const [loadState] = React.useState<DatasetLoadState<StructuredLoadError>>({
    status: 'ready',
    url: DATASET_URL,
    cellCount: 1,
  })
  const appendFallbackNotice = React.useCallback((notice: FallbackNotice) => {
    fallbackNoticesRef.current.push(notice)
  }, [])
  const appendDebugEvent = React.useCallback((message: string) => {
    debugMessagesRef.current.push(message)
  }, [])
  const selectedGenes = options.selectedGenes ?? NO_GENES

  const result = useTranscriptWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      transcriptControlsOpen: true,
      effectiveTranscriptFeatureFilterMode:
        options.featureFilterMode ?? (selectedGenes.length > 0 ? 'selected' : 'all'),
      manualTranscriptExactRequestKey: manualExactRequestKey,
      showTranscriptOverlay: options.showTranscriptOverlay ?? false,
      transcriptDetailMode: options.detailMode ?? 'auto',
      transcriptExactPointLimit: 100_000,
      transcriptGeneOnly: true,
      transcriptMinQv: 20,
      visibleTranscriptEstimate: options.visibleTranscriptEstimate ?? 0,
    },
    data: {
      currentViewportDetail: options.viewportDetail ?? viewportDetail,
      loadState,
      overviewCells: options.overviewCells ?? EMPTY_CELLS,
      selectedGenes,
      transcriptCapabilityState: capabilityState,
    },
    loaders,
    refs: {
      loadRequestIdRef,
      transcriptAbortRef,
      transcriptCapabilityAbortRef,
      transcriptCapabilityRequestIdRef,
      transcriptRequestIdRef,
      transcriptViewportKeyRef,
    },
    setters: {
      setManualTranscriptExactRequestKey,
      setTranscriptCapabilityState,
      setTranscriptLayerState,
    },
  })

  React.useEffect(() => {
    onReady({
      capabilityState,
      debugMessages: debugMessagesRef.current,
      fallbackNotices: fallbackNoticesRef.current,
      layerState,
      manualExactRequestKey,
      result,
      loadExactViewport: (requestKey) => {
        setManualTranscriptExactRequestKey(requestKey)
        transcriptViewportKeyRef.current = null
      },
    })
  })

  return null
}

function renderWorkflow(options: ProbeOptions = {}): Loaders {
  const loaders = { ...defaultLoaders(), ...options.loaders }

  render(
    <Probe
      loaders={loaders}
      options={options}
      onReady={(nextSnapshot) => {
        snapshot = nextSnapshot
      }}
    />,
  )

  return loaders
}

const PER_GENE_CAPABILITIES: TranscriptCapabilities = {
  rawParquet: false,
  nativeZarr: true,
  geneRanges: true,
}

function perGeneAggregate(visibleTranscriptCount: number): TranscriptAggregateResult {
  return {
    ...emptyAggregate(),
    bins: [
      {
        id: 'atera-binned:0:0:0',
        source: 'native-zarr',
        glyphType: 'density',
        level: 0,
        binX: 0,
        binY: 0,
        position: { x: micrometers(2.5), y: micrometers(2.5) },
        radiusMicrometers: 2.1,
        binSizeMicrometers: 5,
        count: visibleTranscriptCount,
      },
    ],
    selectedFeatureNames: ['UMOD'],
    scaleMax: visibleTranscriptCount,
    visibleTranscriptCount,
    sourceFile: 'binned_transcripts.zarr.zip',
  }
}

describe('useTranscriptWorkflow', () => {
  it('checks transcript capabilities when the transcript tab is opened', async () => {
    const loaders = renderWorkflow()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loaders.loadTranscriptCapabilities).toHaveBeenCalledWith(
      DATASET_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(snapshot.capabilityState).toEqual({
      status: 'ready',
      url: DATASET_URL,
      capabilities: { rawParquet: true, nativeZarr: false },
    })
    expect(snapshot.debugMessages).toContain('Transcript output check started')
    expect(snapshot.fallbackNotices).toEqual([])
    expect(snapshot.layerState.status).toBe('idle')
  })

  it('says when the estimate sums cells because Zarr grid counts are missing', async () => {
    renderWorkflow({
      loaders: {
        loadTranscriptCapabilities: vi.fn(async () => ({
          rawParquet: true,
          nativeZarr: true,
          nativeZarrGridCountsError: 'transcripts.zarr.zip has no level-0 grid counts.',
        })),
      },
    })

    await waitFor(() => expect(snapshot.capabilityState.status).toBe('ready'))
    expect(snapshot.fallbackNotices).toEqual([
      expect.objectContaining({
        source: 'Transcripts',
        message: expect.stringContaining(
          'estimates visible transcripts from cell transcript counts',
        ),
        detail: 'transcripts.zarr.zip has no level-0 grid counts.',
        coalesceKey: `transcript-estimate-cells:${DATASET_URL}`,
      }),
    ])
  })

  it('counts the selected genes in Xenium native density (15.1-J)', async () => {
    const loaders = renderWorkflow({
      capabilities: { rawParquet: true, nativeZarr: true },
      detailMode: 'density',
      selectedGenes: ['EPCAM'],
      showTranscriptOverlay: true,
      loaders: {
        loadTranscriptAggregates: vi.fn(async () => ({
          ...emptyAggregate(),
          selectedFeatureNames: ['EPCAM'],
        })),
      },
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(loaders.loadTranscriptAggregates).toHaveBeenCalledWith(
      DATASET_URL,
      viewportDetail.bbox,
      expect.objectContaining({ featureNames: ['EPCAM'], mode: 'density' }),
    )
    expect(snapshot.layerState).toMatchObject({ featureNames: ['EPCAM'] })
  })

  it('counts all transcripts with the All features filter', async () => {
    const loaders = renderWorkflow({
      capabilities: { rawParquet: true, nativeZarr: true },
      detailMode: 'density',
      featureFilterMode: 'all',
      selectedGenes: ['EPCAM'],
      showTranscriptOverlay: true,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(loaders.loadTranscriptAggregates).toHaveBeenCalledWith(
      DATASET_URL,
      viewportDetail.bbox,
      expect.objectContaining({ featureNames: [] }),
    )
    expect(snapshot.layerState).toMatchObject({ featureNames: [] })
  })

  it('says why when the selected genes need too much of density/gene', async () => {
    renderWorkflow({
      capabilities: { rawParquet: true, nativeZarr: true },
      detailMode: 'density',
      selectedGenes: ['EPCAM'],
      showTranscriptOverlay: true,
      loaders: {
        loadTranscriptAggregates: vi.fn(async () => ({
          ...emptyAggregate(),
          selectedFeatureNames: ['EPCAM'],
          overBudget: { chunkCount: 96, chunkLimit: 32 },
        })),
      },
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('waiting'))
    expect(snapshot.layerState).toMatchObject({
      message: expect.stringMatching(
        /^Transcript density for EPCAM needs 96 density\/gene data chunks/,
      ),
    })
  })

  it('says so when an output without density/gene counts all transcripts', async () => {
    renderWorkflow({
      capabilities: { rawParquet: true, nativeZarr: true },
      detailMode: 'density',
      selectedGenes: ['EPCAM'],
      showTranscriptOverlay: true,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(snapshot.layerState).toMatchObject({
      featureNames: [],
      message: expect.stringContaining('This output has no per-gene density'),
    })
  })

  it('shows cell-summary squares for per-gene outputs until genes are selected', async () => {
    const cell: OverviewCellDatum = {
      id: 'aaaaaaaa-1',
      position: [5, -5, 0],
      radiusPixels: 2,
      fillColor: [0, 0, 0, 255],
      transcriptCount: 40,
    }
    const loaders = renderWorkflow({
      capabilities: PER_GENE_CAPABILITIES,
      overviewCells: [cell],
      showTranscriptOverlay: true,
      visibleTranscriptEstimate: 40,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(snapshot.layerState).toMatchObject({
      source: 'cell-summary',
      message: expect.stringContaining('Select genes to see their transcript density'),
      visibleTranscriptEstimate: 40,
    })
    expect(loaders.loadTranscriptAggregates).not.toHaveBeenCalled()
    expect(loaders.loadTranscriptViewport).not.toHaveBeenCalled()
  })

  it('asks for genes before exact per-gene points', async () => {
    renderWorkflow({
      capabilities: PER_GENE_CAPABILITIES,
      detailMode: 'exact',
      showTranscriptOverlay: true,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('waiting'))
    expect(snapshot.layerState).toMatchObject({
      message: expect.stringContaining('Select genes to load exact transcript points'),
    })
  })

  it('points to the feature filter when genes are selected but all features are shown', async () => {
    const loaders = renderWorkflow({
      capabilities: PER_GENE_CAPABILITIES,
      featureFilterMode: 'all',
      selectedGenes: ['UMOD'],
      showTranscriptOverlay: true,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(snapshot.layerState).toMatchObject({
      source: 'cell-summary',
      message: expect.stringContaining('Set Feature filter to Selected genes'),
    })
    expect(loaders.loadTranscriptAggregates).not.toHaveBeenCalled()
  })

  it('shows per-gene density when the selected genes exceed the exact budget', async () => {
    const loaders = renderWorkflow({
      capabilities: PER_GENE_CAPABILITIES,
      loaders: {
        loadTranscriptAggregates: vi.fn(async () => perGeneAggregate(250_000)),
      },
      selectedGenes: ['UMOD'],
      showTranscriptOverlay: true,
      visibleTranscriptEstimate: 10,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(loaders.loadTranscriptAggregates).toHaveBeenCalledWith(
      DATASET_URL,
      viewportDetail.bbox,
      expect.objectContaining({ featureNames: ['UMOD'], maxBins: 1_500 }),
    )
    expect(snapshot.layerState).toMatchObject({
      source: 'native-zarr',
      visibleTranscriptEstimate: 250_000,
      scaleMax: 250_000,
      message:
        'Showing native 1 selected-feature density squares from binned_transcripts.zarr.zip (1 squares).',
    })
    expect(loaders.loadTranscriptAggregates).toHaveBeenCalledTimes(1)
    expect(loaders.loadTranscriptViewport).not.toHaveBeenCalled()
  })

  it('loads exact per-gene points once the selected genes fit the budget', async () => {
    const point = {
      id: '0,0:0',
      cellId: null,
      cellAssignment: 'unassigned' as const,
      featureName: 'UMOD',
      fovName: null,
      position: { x: micrometers(2), y: micrometers(2) },
      qv: 40,
    }
    const loaders = renderWorkflow({
      capabilities: PER_GENE_CAPABILITIES,
      loaders: {
        loadTranscriptAggregates: vi.fn(async () => perGeneAggregate(1_031)),
        loadTranscriptViewport: vi.fn(async () => ({
          points: [point],
          groups: [{ featureName: 'UMOD', fovName: null, count: 1 }],
          hitPointLimit: false,
        })),
      },
      selectedGenes: ['UMOD'],
      showTranscriptOverlay: true,
      // The all-transcript cell estimate would block exact points.
      visibleTranscriptEstimate: 5_000_000,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('ready'))
    expect(loaders.loadTranscriptViewport).toHaveBeenCalledWith(
      DATASET_URL,
      viewportDetail.bbox,
      expect.objectContaining({ featureNames: ['UMOD'], minQv: 20, pointLimit: 100_000 }),
    )
    expect(snapshot.layerState).toMatchObject({
      points: [point],
      visibleTranscriptEstimate: 1_031,
    })
    expect(snapshot.debugMessages).toContain(
      'Transcript exact query started: 1,031 estimated',
    )
  })

  it('keeps loading slow per-gene exact points and says it is slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      const exact = deferredPromise<TranscriptViewportResult>()
      const loaders = renderWorkflow({
        capabilities: PER_GENE_CAPABILITIES,
        loaders: {
          loadTranscriptAggregates: vi.fn(async () => perGeneAggregate(8_546)),
          loadTranscriptViewport: vi.fn(() => exact.promise),
        },
        selectedGenes: ['UMOD'],
        showTranscriptOverlay: true,
      })

      await waitFor(() => expect(loaders.loadTranscriptViewport).toHaveBeenCalled())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TRANSCRIPT_EXACT_SLOW_QUERY_MS)
      })

      expect(snapshot.layerState).toMatchObject({
        status: 'loading',
        message: TRANSCRIPT_EXACT_SLOW_QUERY_MESSAGE,
      })
      const exactOptions = vi.mocked(loaders.loadTranscriptViewport).mock.calls[0]?.[2]
      expect(exactOptions?.signal?.aborted).toBe(false)

      await act(async () => {
        exact.resolve({ points: [], groups: [], hitPointLimit: false })
      })

      await waitFor(() => expect(snapshot.layerState.status).toBe('ready'))
      expect(snapshot.debugMessages).toContain(
        'Transcript exact query still loading after 12 s',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports per-gene density as unavailable when its store cannot be read', async () => {
    renderWorkflow({
      capabilities: {
        rawParquet: false,
        nativeZarr: false,
        geneRanges: true,
        nativeZarrError: 'HTTP 403',
      },
      selectedGenes: ['UMOD'],
      showTranscriptOverlay: true,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('unavailable'))
    expect(snapshot.layerState).toMatchObject({
      message: 'Per-gene transcript density is unavailable: HTTP 403',
    })
  })
  describe('Cancel (15.3-D)', () => {
    const XENIUM_CAPABILITIES: TranscriptCapabilities = {
      rawParquet: true,
      nativeZarr: false,
    }

    function viewportAt(x: number): ViewerViewportDetail {
      return {
        ...viewportDetail,
        bbox: {
          minX: micrometers(x),
          minY: micrometers(0),
          maxX: micrometers(x + 10),
          maxY: micrometers(10),
        },
      }
    }

    function exactPoint(id: string) {
      return {
        id,
        cellId: null,
        featureName: 'EPCAM',
        fovName: null,
        position: { x: micrometers(2), y: micrometers(2) },
        qv: 40,
      }
    }

    function renderProbe(loaders: Loaders, options: ProbeOptions) {
      const onReady = (nextSnapshot: Snapshot) => {
        snapshot = nextSnapshot
      }
      const view = render(<Probe loaders={loaders} options={options} onReady={onReady} />)

      return (nextOptions: ProbeOptions) => {
        view.rerender(<Probe loaders={loaders} options={nextOptions} onReady={onReady} />)
      }
    }

    it('goes back to the points shown before and does not restart for the same view', async () => {
      const first = exactPoint('first')
      let pendingSignal: AbortSignal | undefined
      const loadTranscriptViewport = vi.fn<Loaders['loadTranscriptViewport']>(
        async (_url, _bbox, loadOptions) => {
          if (loadTranscriptViewport.mock.calls.length === 1) {
            return { points: [first], groups: [], hitPointLimit: false }
          }

          pendingSignal = loadOptions?.signal
          loadOptions?.onProgress?.(0.256)
          return new Promise(() => undefined)
        },
      )
      const loaders = { ...defaultLoaders(), loadTranscriptViewport }
      const options: ProbeOptions = {
        capabilities: XENIUM_CAPABILITIES,
        detailMode: 'exact',
        showTranscriptOverlay: true,
        visibleTranscriptEstimate: 10,
      }
      const rerender = renderProbe(loaders, { ...options, viewportDetail: viewportAt(0) })

      await waitFor(() => expect(snapshot.layerState.status).toBe('ready'))
      const shown = snapshot.layerState

      rerender({ ...options, viewportDetail: viewportAt(20) })
      await waitFor(() => expect(snapshot.result.transcriptLoadProgress).toBe(0.256))
      expect(snapshot.layerState.status).toBe('loading')

      act(() => {
        snapshot.result.cancelTranscriptLoad()
      })

      expect(pendingSignal?.aborted).toBe(true)
      expect(snapshot.layerState).toBe(shown)
      expect(snapshot.result.transcriptLoadProgress).toBeUndefined()
      expect(snapshot.debugMessages).toContain('Cancelled transcripts')

      // The same view again (a new object) does not start the read again.
      rerender({ ...options, viewportDetail: viewportAt(20) })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
      })
      expect(loadTranscriptViewport).toHaveBeenCalledTimes(2)
      expect(snapshot.layerState).toBe(shown)

      rerender({ ...options, viewportDetail: viewportAt(40) })
      await waitFor(() => expect(loadTranscriptViewport).toHaveBeenCalledTimes(3))
    })

    it('shows `Load exact viewport` again after cancelling a manual load', async () => {
      const loadTranscriptViewport = vi.fn<Loaders['loadTranscriptViewport']>(
        () => new Promise(() => undefined),
      )
      renderProbe(
        { ...defaultLoaders(), loadTranscriptViewport },
        {
          capabilities: XENIUM_CAPABILITIES,
          detailMode: 'exact',
          showTranscriptOverlay: true,
          visibleTranscriptEstimate: 90_000,
        },
      )

      await waitFor(() => expect(snapshot.layerState.status).toBe('waiting'))
      const requestKey =
        snapshot.layerState.status === 'waiting'
          ? snapshot.layerState.exactLoadRequestKey
          : undefined
      expect(requestKey).toBeDefined()

      act(() => {
        snapshot.loadExactViewport(requestKey ?? '')
      })
      await waitFor(() => expect(loadTranscriptViewport).toHaveBeenCalledTimes(1))
      expect(snapshot.layerState.status).toBe('loading')

      act(() => {
        snapshot.result.cancelTranscriptLoad()
      })
      await waitFor(() =>
        expect(snapshot.layerState).toMatchObject({
          status: 'waiting',
          exactLoadRequestKey: requestKey,
        }),
      )
      expect(snapshot.manualExactRequestKey).toBeNull()

      act(() => {
        snapshot.loadExactViewport(requestKey ?? '')
      })
      await waitFor(() => expect(loadTranscriptViewport).toHaveBeenCalledTimes(2))
    })

    it('does not restart a cancelled per-gene density read for the same view', async () => {
      const loadTranscriptAggregates = vi.fn<Loaders['loadTranscriptAggregates']>(
        () => new Promise(() => undefined),
      )
      const options: ProbeOptions = {
        capabilities: PER_GENE_CAPABILITIES,
        selectedGenes: ['UMOD'],
        showTranscriptOverlay: true,
        viewportDetail: viewportAt(0),
      }
      const rerender = renderProbe(
        { ...defaultLoaders(), loadTranscriptAggregates },
        options,
      )

      await waitFor(() => expect(snapshot.layerState.status).toBe('loading'))
      act(() => {
        snapshot.result.cancelTranscriptLoad()
      })
      expect(snapshot.layerState).toEqual({ status: 'idle' })

      rerender({ ...options, viewportDetail: viewportAt(0) })
      await act(async () => {
        await Promise.resolve()
      })
      expect(loadTranscriptAggregates).toHaveBeenCalledTimes(1)

      rerender({ ...options, viewportDetail: viewportAt(30) })
      await waitFor(() => expect(loadTranscriptAggregates).toHaveBeenCalledTimes(2))
    })
  })
})
