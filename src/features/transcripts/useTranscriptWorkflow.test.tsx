import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { micrometers } from '../../data/coords'
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

interface Snapshot {
  readonly capabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly debugMessages: readonly string[]
  readonly layerState: TranscriptLayerState<StructuredLoadError>
}

let snapshot: Snapshot

function Probe({
  loadTranscriptCapabilities,
  onReady,
}: {
  readonly loadTranscriptCapabilities: Parameters<
    typeof useTranscriptWorkflow
  >[0]['loadTranscriptCapabilities']
  readonly onReady: (nextSnapshot: Snapshot) => void
}) {
  const [capabilityState, setTranscriptCapabilityState] = React.useState<
    TranscriptCapabilityState<StructuredLoadError>
  >({ status: 'idle' })
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
  const loadState: DatasetLoadState<StructuredLoadError> = {
    status: 'ready',
    url: 'https://example.test/output',
    cellCount: 1,
  }

  useTranscriptWorkflow({
    activeControlHudTab: 'transcripts',
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    currentViewportDetail: viewportDetail,
    effectiveTranscriptFeatureFilterMode: 'all',
    loadRequestIdRef,
    loadState,
    loadTranscriptAggregates: vi.fn(async () => ({
      source: 'native-zarr' as const,
      bins: [],
      level: {
        level: 0,
        gridSizeMicrometers: 1,
        gridKeys: [],
        transcriptCounts: [],
      },
      selectedFeatureNames: [],
    })),
    loadTranscriptCapabilities,
    loadTranscriptViewport: vi.fn(async () => ({
      points: [],
      groups: [],
      hitPointLimit: false,
    })),
    manualTranscriptExactRequestKey: null,
    overviewCells: [],
    selectedGenes: [],
    setTranscriptCapabilityState,
    setTranscriptLayerState,
    showTranscriptOverlay: false,
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef,
    transcriptCapabilityState: capabilityState,
    transcriptDetailMode: 'auto',
    transcriptExactPointLimit: 100_000,
    transcriptGeneOnly: true,
    transcriptMinQv: 20,
    transcriptRequestIdRef,
    transcriptViewportKeyRef,
    visibleTranscriptEstimate: 0,
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

describe('useTranscriptWorkflow', () => {
  it('checks transcript capabilities when the transcript tab is opened', async () => {
    const loadTranscriptCapabilities = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    }))

    render(
      <Probe
        loadTranscriptCapabilities={loadTranscriptCapabilities}
        onReady={(nextSnapshot) => {
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadTranscriptCapabilities).toHaveBeenCalledWith(
      'https://example.test/output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(snapshot.capabilityState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      capabilities: { rawParquet: true, nativeZarr: false },
    })
    expect(snapshot.debugMessages).toContain('Transcript output check started')
    expect(snapshot.layerState.status).toBe('idle')
  })
})
