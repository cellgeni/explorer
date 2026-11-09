import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { micrometers } from '../../data/coords'
import type {
  TranscriptAggregateResult,
  TranscriptCapabilities,
  TranscriptDetailMode,
  TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type {
  TranscriptCapabilityState,
  TranscriptLayerState,
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
  readonly layerState: TranscriptLayerState<StructuredLoadError>
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
  const debugMessagesRef = React.useRef<string[]>([])
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
  const appendFallbackNotice = React.useCallback(() => undefined, [])
  const appendDebugEvent = React.useCallback((message: string) => {
    debugMessagesRef.current.push(message)
  }, [])
  const selectedGenes = options.selectedGenes ?? NO_GENES

  useTranscriptWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      activeControlHudTab: 'transcripts',
      effectiveTranscriptFeatureFilterMode:
        options.featureFilterMode ?? (selectedGenes.length > 0 ? 'selected' : 'all'),
      manualTranscriptExactRequestKey: null,
      showTranscriptOverlay: options.showTranscriptOverlay ?? false,
      transcriptDetailMode: options.detailMode ?? 'auto',
      transcriptExactPointLimit: 100_000,
      transcriptGeneOnly: true,
      transcriptMinQv: 20,
      visibleTranscriptEstimate: options.visibleTranscriptEstimate ?? 0,
    },
    data: {
      currentViewportDetail: viewportDetail,
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
      setTranscriptCapabilityState,
      setTranscriptLayerState,
    },
  })

  React.useEffect(() => {
    onReady({
      capabilityState,
      debugMessages: debugMessagesRef.current,
      layerState,
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
    expect(snapshot.layerState.status).toBe('idle')
  })

  it('keeps Xenium native density on all transcripts when genes are selected', async () => {
    const loaders = renderWorkflow({
      capabilities: { rawParquet: true, nativeZarr: true },
      detailMode: 'density',
      selectedGenes: ['EPCAM'],
      showTranscriptOverlay: true,
    })

    await waitFor(() => expect(snapshot.layerState.status).toBe('aggregate'))
    expect(loaders.loadTranscriptAggregates).toHaveBeenCalledWith(
      DATASET_URL,
      viewportDetail.bbox,
      expect.objectContaining({ featureNames: [], mode: 'density' }),
    )
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
})
