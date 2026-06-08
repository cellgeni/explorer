import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { RoiDrawMode, ViewerMagicLensDetail } from '../../components/ViewerCore'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { MagicLensScope, MagicLensState } from './magicLensModel'
import type {
  RoiGeneStatsState,
  RoiGeneViewportWarmupState,
  RoiState,
  RoiTranscriptExportState,
} from './roiModel'
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
  readonly roiRequestId: number
  readonly roiState: RoiState<StructuredLoadError>
  readonly roiTranscriptExportState: RoiTranscriptExportState<StructuredLoadError>
}

let api: ReturnType<typeof useRoiWorkflow>
let snapshot: Snapshot

function Probe({
  onReady,
}: {
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
  const initialSharedRoiSelectionRef = React.useRef<RoiSelection | null>(null)
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

  const nextApi = useRoiWorkflow({
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    currentViewportDetail: null,
    initialSharedRoiSelectionRef,
    loadRoiCells: vi.fn(async () => []),
    loadRoiGeneStats: vi.fn(async () => ({
      genes: [],
      cellCount: 0,
      sampledCellCount: 0,
      totalCount: 0,
      hitCellLimit: false,
    })),
    loadRoiTranscripts: vi.fn(async () => []),
    loadState,
    magicLensAbortRef,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensRequestIdRef,
    magicLensScope,
    roiAbortRef,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupTimeoutRef,
    roiIdRef,
    roiName,
    roiRequestIdRef,
    roiState,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef,
    setMagicLensState,
    setRoiGeneStatsState,
    setRoiGeneViewportWarmupState,
    setRoiMode,
    setRoiName,
    setRoiState,
    setRoiTranscriptExportState,
  })

  React.useEffect(() => {
    onReady(nextApi, {
      debugMessages: debugMessagesRef.current,
      magicLensState,
      roiGeneStatsState,
      roiMode,
      roiRequestId: roiRequestIdRef.current,
      roiState,
      roiTranscriptExportState,
    })
  })

  void roiGeneViewportWarmupState
  void roiName

  return null
}

describe('useRoiWorkflow', () => {
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
})
