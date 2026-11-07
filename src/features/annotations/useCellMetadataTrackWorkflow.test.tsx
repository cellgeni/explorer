import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CellId } from '../../data/cellid'
import type {
  CellMetadataTrackOption,
  ContinuousCellMetadataTrack,
} from '../../data/customAnnotations'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import {
  cellMetadataTrackChoicesFor,
  useCellMetadataTrackWorkflow,
  type CellMetadataTrackLoader,
} from './useCellMetadataTrackWorkflow'

const DATASET_URL = 'https://example.test/sample.h5ad'
const AREA_OPTION = { id: 'h5ad:cell-area', label: 'cell_area', min: 4, max: 90 }
const COUNTS_OPTION = { id: 'h5ad:total-counts', label: 'total_counts', min: 1, max: 9 }
const IMPORTED_TRACK = metadataTrack('metadata:scores-csv:confidence', 'confidence')

interface Snapshot {
  readonly result: ReturnType<typeof useCellMetadataTrackWorkflow>
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly debugMessages: readonly string[]
}

interface Controls {
  readonly setObservationColorMode: (mode: ObservationColorMode) => void
  readonly setSelectedCellMetadataTrackId: (trackId: string | null) => void
  readonly setCellMetadataTracks: (tracks: readonly ContinuousCellMetadataTrack[]) => void
}

let snapshot: Snapshot
let controls: Controls

function Probe({
  initialTracks = [],
  loadCellMetadataTracks,
  options = [AREA_OPTION, COUNTS_OPTION],
}: {
  readonly initialTracks?: readonly ContinuousCellMetadataTrack[]
  readonly loadCellMetadataTracks: CellMetadataTrackLoader
  readonly options?: readonly CellMetadataTrackOption[]
}) {
  const [cellMetadataTracks, setCellMetadataTracks] =
    React.useState<readonly ContinuousCellMetadataTrack[]>(initialTracks)
  const [observationColorMode, setObservationColorMode] =
    React.useState<ObservationColorMode>('transcript-count')
  const [selectedCellMetadataTrackId, setSelectedCellMetadataTrackId] = React.useState<
    string | null
  >(null)
  const debugMessagesRef = React.useRef<string[]>([])
  const datasetAbortRef = React.useRef<AbortController | null>(new AbortController())
  const loadRequestIdRef = React.useRef(3)

  const result = useCellMetadataTrackWorkflow({
    callbacks: {
      appendDebugEvent: React.useCallback((message: string) => {
        debugMessagesRef.current.push(message)
      }, []),
    },
    data: {
      cellMetadataTrackOptions: options,
      cellMetadataTracks,
      loadState: { status: 'ready', url: DATASET_URL, cellCount: 2 },
      observationColorMode,
      selectedCellMetadataTrackId,
    },
    loaders: { loadCellMetadataTracks },
    refs: { datasetAbortRef, loadRequestIdRef },
    setters: { setCellMetadataTracks },
  })

  React.useEffect(() => {
    controls = {
      setObservationColorMode,
      setSelectedCellMetadataTrackId,
      setCellMetadataTracks,
    }
  }, [])

  React.useEffect(() => {
    snapshot = { result, cellMetadataTracks, debugMessages: debugMessagesRef.current }
  })

  return null
}

describe('useCellMetadataTrackWorkflow', () => {
  it('lists dataset tracks before imported tracks', () => {
    expect(cellMetadataTrackChoicesFor([], [IMPORTED_TRACK])).toEqual([IMPORTED_TRACK])
    expect(
      cellMetadataTrackChoicesFor(
        [AREA_OPTION, COUNTS_OPTION],
        [metadataTrack(COUNTS_OPTION.id, COUNTS_OPTION.label), IMPORTED_TRACK],
      ).map((choice) => choice.id),
    ).toEqual([AREA_OPTION.id, COUNTS_OPTION.id, IMPORTED_TRACK.id])
  })

  it('loads only the active dataset track once metadata coloring is chosen', async () => {
    const loadCellMetadataTracks = vi.fn<CellMetadataTrackLoader>(
      async (_url, options) => [
        metadataTrack(options?.trackId ?? '', options?.trackId ?? ''),
      ],
    )

    render(<Probe loadCellMetadataTracks={loadCellMetadataTracks} />)

    expect(snapshot.result.activeCellMetadataTrackId).toBe(AREA_OPTION.id)
    expect(snapshot.result.cellMetadataTrackChoices).toEqual([AREA_OPTION, COUNTS_OPTION])
    expect(snapshot.result.selectedCellMetadataTrack).toBeNull()
    expect(loadCellMetadataTracks).not.toHaveBeenCalled()

    act(() => {
      controls.setObservationColorMode('metadata')
    })

    await waitFor(() => {
      expect(snapshot.result.selectedCellMetadataTrack?.id).toBe(AREA_OPTION.id)
    })
    expect(loadCellMetadataTracks).toHaveBeenCalledTimes(1)
    expect(loadCellMetadataTracks).toHaveBeenCalledWith(DATASET_URL, {
      trackId: AREA_OPTION.id,
      signal: expect.any(AbortSignal),
    })

    act(() => {
      controls.setSelectedCellMetadataTrackId(COUNTS_OPTION.id)
    })

    await waitFor(() => {
      expect(snapshot.result.selectedCellMetadataTrack?.id).toBe(COUNTS_OPTION.id)
    })
    expect(loadCellMetadataTracks).toHaveBeenCalledTimes(2)
    expect(snapshot.cellMetadataTracks.map((track) => track.id)).toEqual([
      AREA_OPTION.id,
      COUNTS_OPTION.id,
    ])

    act(() => {
      controls.setSelectedCellMetadataTrackId(AREA_OPTION.id)
    })

    expect(snapshot.result.selectedCellMetadataTrack?.id).toBe(AREA_OPTION.id)
    expect(loadCellMetadataTracks).toHaveBeenCalledTimes(2)
    expect(snapshot.debugMessages).toEqual([
      'Loading metadata track cell_area',
      'Metadata track ready: cell_area',
      'Loading metadata track total_counts',
      'Metadata track ready: total_counts',
    ])
  })

  it('reloads a dataset track after it was removed', async () => {
    const loadCellMetadataTracks = vi.fn<CellMetadataTrackLoader>(async () => [
      metadataTrack(AREA_OPTION.id, AREA_OPTION.label),
    ])

    render(<Probe loadCellMetadataTracks={loadCellMetadataTracks} />)
    act(() => {
      controls.setObservationColorMode('metadata')
    })
    await waitFor(() => {
      expect(snapshot.result.selectedCellMetadataTrack?.id).toBe(AREA_OPTION.id)
    })

    act(() => {
      controls.setCellMetadataTracks([])
    })

    await waitFor(() => {
      expect(snapshot.result.selectedCellMetadataTrack?.id).toBe(AREA_OPTION.id)
    })
    expect(loadCellMetadataTracks).toHaveBeenCalledTimes(2)
  })

  it('does not retry a failed track on later renders', async () => {
    const loadCellMetadataTracks = vi.fn<CellMetadataTrackLoader>(async () => {
      throw new Error('read failed')
    })

    render(
      <Probe
        initialTracks={[IMPORTED_TRACK]}
        loadCellMetadataTracks={loadCellMetadataTracks}
      />,
    )
    act(() => {
      controls.setObservationColorMode('metadata')
    })
    await waitFor(() => {
      expect(snapshot.debugMessages).toContain('Metadata track failed: cell_area')
    })

    act(() => {
      controls.setCellMetadataTracks([IMPORTED_TRACK])
    })

    expect(snapshot.result.selectedCellMetadataTrack).toBeNull()
    expect(loadCellMetadataTracks).toHaveBeenCalledTimes(1)

    act(() => {
      controls.setSelectedCellMetadataTrackId(IMPORTED_TRACK.id)
    })

    expect(snapshot.result.selectedCellMetadataTrack).toBe(IMPORTED_TRACK)
    expect(loadCellMetadataTracks).toHaveBeenCalledTimes(1)
  })
})

function metadataTrack(id: string, label: string): ContinuousCellMetadataTrack {
  return {
    id,
    label,
    values: [{ cellId: 'cell-a' as CellId, value: 1 }],
    min: 1,
    max: 1,
  }
}
