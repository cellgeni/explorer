import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
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
    appendDebugEvent,
    appendFallbackNotice,
    cellDetailAbortRef,
    cellDetailRequestIdRef,
    cellDetailState,
    cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef,
    loadBoundaryElements,
    loadCellTranscriptDistribution,
    loadRoiGeneStats,
    loadState: readyLoadState,
    selectedCell: null,
    setCellDetailState,
    setCellTranscriptDistributionState,
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

describe('useCellDetailWorkflow', () => {
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
