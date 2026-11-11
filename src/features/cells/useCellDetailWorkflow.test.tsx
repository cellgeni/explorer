import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type { RoiGeneStatsLoader } from '../app-shell/appDependencies'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { CellDetailState, CellTranscriptDistributionState } from './cellDetailModel'
import { useCellDetailWorkflow } from './useCellDetailWorkflow'

interface Snapshot {
  readonly cellDetailRequestId: number
  readonly cellDetailState: CellDetailState<StructuredLoadError>
  readonly cellTranscriptDistributionRequestId: number
  readonly cellTranscriptDistributionState: CellTranscriptDistributionState<StructuredLoadError>
}

let snapshot: Snapshot

const appendDebugEvent = vi.fn()
const appendFallbackNotice = vi.fn()
const loadBoundaryElements = vi.fn(async () => ({ elements: [] }))
const loadCellTranscriptDistribution = vi.fn(async () => ({
  bins: [],
  hitTranscriptLimit: false,
  maxBinCount: 0,
  minQv: 20,
  missingZCount: 0,
  transcriptCount: 0,
  zCount: 0,
}))
const loadRoiGeneStats = vi.fn(async () => ({
  genes: [],
  cellCount: 0,
  sampledCellCount: 0,
  totalCount: 0,
  hitCellLimit: false,
}))
const readyLoadState: DatasetLoadState<StructuredLoadError> = {
  status: 'ready',
  url: 'https://example.test/output',
  cellCount: 1,
}

function Probe({ onReady }: { readonly onReady: (nextSnapshot: Snapshot) => void }) {
  const [cellDetailState, setCellDetailState] = React.useState<
    CellDetailState<StructuredLoadError>
  >({
    status: 'ready',
    url: 'https://example.test/output',
    cellId: 'aaaaaaaa-1',
    expression: { genes: [], hitGeneLimit: false, totalCount: 0 },
    shape: {},
    boundary: null,
  })
  const [cellTranscriptDistributionState, setCellTranscriptDistributionState] =
    React.useState<CellTranscriptDistributionState<StructuredLoadError>>({
      status: 'ready',
      url: 'https://example.test/output',
      cellId: 'aaaaaaaa-1',
      distribution: {
        bins: [],
        hitTranscriptLimit: false,
        maxBinCount: 0,
        minQv: 20,
        missingZCount: 0,
        transcriptCount: 0,
        zCount: 0,
      },
    })
  const cellDetailAbortRef = React.useRef<AbortController | null>(new AbortController())
  const cellDetailRequestIdRef = React.useRef(4)
  const cellTranscriptDistributionAbortRef = React.useRef<AbortController | null>(
    new AbortController(),
  )
  const cellTranscriptDistributionRequestIdRef = React.useRef(8)

  useCellDetailWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    data: {
      cellDetailState,
      loadState: readyLoadState,
      selectedCell: null,
    },
    loaders: {
      loadBoundaryElements,
      loadCellTranscriptDistribution,
      loadRoiGeneStats,
    },
    refs: {
      cellDetailAbortRef,
      cellDetailRequestIdRef,
      cellTranscriptDistributionAbortRef,
      cellTranscriptDistributionRequestIdRef,
    },
    setters: {
      setCellDetailState,
      setCellTranscriptDistributionState,
    },
  })

  React.useEffect(() => {
    onReady({
      cellDetailRequestId: cellDetailRequestIdRef.current,
      cellDetailState,
      cellTranscriptDistributionRequestId: cellTranscriptDistributionRequestIdRef.current,
      cellTranscriptDistributionState,
    })
  })

  return null
}

function cellAt(id: string): OverviewCellDatum {
  return { id, position: [1, -2, 0], radiusPixels: 1, fillColor: [0, 0, 0] }
}

let cancelCellDetails: () => void = () => undefined

function SelectedCellProbe({
  selectedCell,
  loadGeneStats,
  onReady,
}: {
  readonly selectedCell: OverviewCellDatum
  readonly loadGeneStats: RoiGeneStatsLoader
  readonly onReady: (nextSnapshot: Snapshot) => void
}) {
  const [cellDetailState, setCellDetailState] = React.useState<
    CellDetailState<StructuredLoadError>
  >({ status: 'idle' })
  const [cellTranscriptDistributionState, setCellTranscriptDistributionState] =
    React.useState<CellTranscriptDistributionState<StructuredLoadError>>({
      status: 'idle',
    })
  const cellDetailAbortRef = React.useRef<AbortController | null>(null)
  const cellDetailRequestIdRef = React.useRef(0)
  const cellTranscriptDistributionAbortRef = React.useRef<AbortController | null>(null)
  const cellTranscriptDistributionRequestIdRef = React.useRef(0)

  const api = useCellDetailWorkflow({
    callbacks: { appendDebugEvent, appendFallbackNotice },
    data: { cellDetailState, loadState: readyLoadState, selectedCell },
    loaders: {
      loadBoundaryElements,
      loadCellTranscriptDistribution,
      loadRoiGeneStats: loadGeneStats,
    },
    refs: {
      cellDetailAbortRef,
      cellDetailRequestIdRef,
      cellTranscriptDistributionAbortRef,
      cellTranscriptDistributionRequestIdRef,
    },
    setters: { setCellDetailState, setCellTranscriptDistributionState },
  })

  React.useEffect(() => {
    cancelCellDetails = api.cancelCellDetails
    onReady({
      cellDetailRequestId: cellDetailRequestIdRef.current,
      cellDetailState,
      cellTranscriptDistributionRequestId: cellTranscriptDistributionRequestIdRef.current,
      cellTranscriptDistributionState,
    })
  })

  return null
}

describe('useCellDetailWorkflow', () => {
  it("cancels a cell's loads and starts them again only for another cell (15.3-D)", async () => {
    const signals: AbortSignal[] = []
    const pendingStats = vi.fn<RoiGeneStatsLoader>((_url, _cells, options) => {
      if (options?.signal !== undefined) signals.push(options.signal)
      return new Promise(() => undefined)
    })
    const onReady = (nextSnapshot: Snapshot) => {
      snapshot = nextSnapshot
    }
    const { rerender } = render(
      <SelectedCellProbe
        selectedCell={cellAt('cell-1')}
        loadGeneStats={pendingStats}
        onReady={onReady}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot.cellDetailState).toMatchObject({
      status: 'loading',
      cellId: 'cell-1',
    })
    expect(snapshot.cellTranscriptDistributionState).toMatchObject({ status: 'loading' })

    await act(async () => {
      cancelCellDetails()
      await Promise.resolve()
    })

    expect(signals[0]?.aborted).toBe(true)
    expect(snapshot.cellDetailState).toEqual({ status: 'idle' })
    expect(snapshot.cellTranscriptDistributionState).toEqual({ status: 'idle' })
    expect(appendDebugEvent).toHaveBeenCalledWith('Cancelled cell details: cell-1')

    // The effect runs again with a new loader, but not for the same cell.
    const nextStats = vi.fn<RoiGeneStatsLoader>(() => new Promise(() => undefined))
    rerender(
      <SelectedCellProbe
        selectedCell={cellAt('cell-1')}
        loadGeneStats={nextStats}
        onReady={onReady}
      />,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(nextStats).not.toHaveBeenCalled()
    expect(snapshot.cellDetailState).toEqual({ status: 'idle' })
    expect(snapshot.cellTranscriptDistributionState).toEqual({ status: 'idle' })

    rerender(
      <SelectedCellProbe
        selectedCell={cellAt('cell-2')}
        loadGeneStats={nextStats}
        onReady={onReady}
      />,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(nextStats).toHaveBeenCalledTimes(1)
    expect(snapshot.cellDetailState).toMatchObject({
      status: 'loading',
      cellId: 'cell-2',
    })
  })

  it('invalidates selected-cell detail and transcript distribution when selection clears', async () => {
    render(
      <Probe
        onReady={(nextSnapshot) => {
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(snapshot.cellDetailRequestId).toBe(5)
    expect(snapshot.cellTranscriptDistributionRequestId).toBe(9)
    expect(snapshot.cellTranscriptDistributionState).toEqual({ status: 'idle' })
  })
})
