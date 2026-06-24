import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ViewerMagicLensDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { micrometers } from '../../data/coords'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { MagicLensScope, MagicLensState } from './magicLensModel'
import { useMagicLensWorkflow, type MagicLensSummaryLoader } from './useMagicLensWorkflow'

interface Snapshot {
  readonly debugMessages: readonly string[]
  readonly magicLensActive: boolean
  readonly magicLensMinQv: number
  readonly magicLensRadiusMicrometers: number
  readonly magicLensScope: MagicLensScope
  readonly magicLensState: MagicLensState<StructuredLoadError>
  readonly measurementEnabled: boolean
  readonly measurementResetKey: number
}

let api: ReturnType<typeof useMagicLensWorkflow>
let snapshot: Snapshot

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

function Probe({
  initialMagicLensScope = 'cursor',
  loadMagicLensSummary,
  onReady,
}: {
  readonly initialMagicLensScope?: MagicLensScope
  readonly loadMagicLensSummary?: MagicLensSummaryLoader
  readonly onReady: (
    nextApi: ReturnType<typeof useMagicLensWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
}) {
  const [magicLensActive, setMagicLensActive] = React.useState(false)
  const [magicLensMinQv, setMagicLensMinQv] = React.useState(20)
  const [magicLensRadiusMicrometers, setMagicLensRadiusMicrometers] = React.useState(80)
  const [magicLensScope, setMagicLensScope] =
    React.useState<MagicLensScope>(initialMagicLensScope)
  const [magicLensState, setMagicLensState] = React.useState<
    MagicLensState<StructuredLoadError>
  >({ status: 'idle' })
  const [measurementEnabled, setMeasurementEnabled] = React.useState(true)
  const [measurementResetKey, setMeasurementResetKey] = React.useState(0)
  const debugMessagesRef = React.useRef<string[]>([])
  const magicLensAbortRef = React.useRef<AbortController | null>(null)
  const magicLensDebounceRef = React.useRef<number | null>(null)
  const magicLensLastDetailRef = React.useRef<ViewerMagicLensDetail | null>(null)
  const magicLensLastQueryKeyRef = React.useRef<string | null>('previous')
  const magicLensRequestIdRef = React.useRef(0)
  const loadState: DatasetLoadState<StructuredLoadError> = {
    status: 'ready',
    url: 'https://example.test/output',
    cellCount: 1,
  }
  const appendFallbackNotice = React.useCallback(() => undefined, [])

  const nextApi = useMagicLensWorkflow({
    activeRoiSelection: null,
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    appendFallbackNotice,
    currentViewportDetail: viewportDetail,
    loadRoiCells: vi.fn(async () => []),
    loadRoiGeneStats: vi.fn(async () => ({
      genes: [],
      cellCount: 0,
      sampledCellCount: 0,
      totalCount: 0,
      hitCellLimit: false,
    })),
    ...(loadMagicLensSummary === undefined ? {} : { loadMagicLensSummary }),
    loadState,
    magicLensAbortRef,
    magicLensActive,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensMinQv,
    magicLensRequestIdRef,
    magicLensScope,
    selectedGenes: [],
    setMagicLensActive,
    setMagicLensMinQv,
    setMagicLensRadiusMicrometers,
    setMagicLensScope,
    setMagicLensState,
    setMeasurementEnabled,
    setMeasurementResetKey,
  })

  React.useEffect(() => {
    onReady(nextApi, {
      debugMessages: debugMessagesRef.current,
      magicLensActive,
      magicLensMinQv,
      magicLensRadiusMicrometers,
      magicLensScope,
      magicLensState,
      measurementEnabled,
      measurementResetKey,
    })
  })

  return null
}

describe('useMagicLensWorkflow', () => {
  it('enables cursor lens while disabling measurement mode', () => {
    render(
      <Probe
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleMagicLensCursorActiveChange(true)
    })

    expect(snapshot.magicLensActive).toBe(true)
    expect(snapshot.measurementEnabled).toBe(false)
    expect(snapshot.measurementResetKey).toBe(1)
    expect(snapshot.debugMessages).toContain('Magic lens enabled')
  })

  it('normalizes radius and min QV controls', () => {
    render(
      <Probe
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleMagicLensRadiusChange(0)
      api.handleMagicLensMinQvChange(-5)
    })

    expect(snapshot.magicLensRadiusMicrometers).toBeGreaterThan(0)
    expect(snapshot.magicLensMinQv).toBe(0)
  })

  it('cancels stale viewport scans when switching back to cursor scope', async () => {
    const deferred = createDeferred<Awaited<ReturnType<MagicLensSummaryLoader>>>()
    const capturedSignals: AbortSignal[] = []
    const loadMagicLensSummary: MagicLensSummaryLoader = vi.fn(
      async (_baseUrl, _selection, options) => {
        capturedSignals.push(options.signal)
        return deferred.promise
      },
    )

    render(
      <Probe
        initialMagicLensScope="viewport"
        loadMagicLensSummary={loadMagicLensSummary}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleRunMagicLens()
    })

    expect(snapshot.magicLensState).toMatchObject({
      status: 'loading',
      scope: 'viewport',
    })

    act(() => {
      api.handleMagicLensScopeChange('cursor')
    })

    expect(capturedSignals[0]?.aborted).toBe(true)
    expect(snapshot.magicLensScope).toBe('cursor')
    expect(snapshot.magicLensState).toEqual({ status: 'idle' })

    await act(async () => {
      deferred.resolve({
        transcriptCount: 10,
        cellCount: 1,
        geneCount: 1,
        selectedGeneTranscriptCount: 0,
        topGenes: [],
        hitLimit: false,
      })
      await Promise.resolve()
    })

    expect(snapshot.magicLensState).toEqual({ status: 'idle' })
    expect(snapshot.debugMessages).not.toContain('Magic lens ready: 1 cells')
  })
})

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}
