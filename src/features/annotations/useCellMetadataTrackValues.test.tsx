import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../../data/customAnnotations'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  useCellMetadataTrackValues,
  type CellMetadataTrackValuesLoader,
} from './useCellMetadataTrackValues'

const datasetUrl = 'https://example.test/sample.h5ad'
const cellId = asCellId('aaaaaaaa-1')
const scoreValues: readonly ContinuousCellMetadataValue[] = [{ cellId, value: 0.5 }]

function lazyTrack(id: string, label: string): ContinuousCellMetadataTrack {
  return { id, label, values: null, cellCount: 1, min: 0, max: 1 }
}

interface ProbeHandle {
  readonly loadRequestIdRef: { current: number }
  readonly setObservationColorMode: (mode: ObservationColorMode) => void
  readonly setSelectedTrackId: (trackId: string | null) => void
  readonly tracks: () => readonly ContinuousCellMetadataTrack[]
}

function renderProbe({
  initialTracks,
  loadCellMetadataTrackValues,
  observationColorMode = 'transcript-count',
}: {
  readonly initialTracks: readonly ContinuousCellMetadataTrack[]
  readonly loadCellMetadataTrackValues: CellMetadataTrackValuesLoader
  readonly observationColorMode?: ObservationColorMode
}) {
  let handle: ProbeHandle | null = null
  const appendDebugEvent = vi.fn()

  function Probe() {
    const [tracks, setTracks] = React.useState(initialTracks)
    const [mode, setMode] = React.useState(observationColorMode)
    const [selectedTrackId, setSelectedTrackId] = React.useState<string | null>(null)
    const loadRequestIdRef = React.useRef(3)
    const datasetAbortRef = React.useRef<AbortController | null>(new AbortController())
    const loadState: DatasetLoadState<StructuredLoadError> = {
      status: 'ready',
      url: datasetUrl,
      cellCount: 1,
    }
    const selectedTrack =
      tracks.find((track) => track.id === selectedTrackId) ?? tracks[0] ?? null

    useCellMetadataTrackValues({
      callbacks: { appendDebugEvent },
      data: {
        loadState,
        observationColorMode: mode,
        selectedCellMetadataTrack: selectedTrack,
      },
      loaders: { loadCellMetadataTrackValues },
      refs: { datasetAbortRef, loadRequestIdRef },
      setters: { setCellMetadataTracks: setTracks },
    })

    handle = {
      loadRequestIdRef,
      setObservationColorMode: setMode,
      setSelectedTrackId,
      tracks: () => tracks,
    }

    return null
  }

  render(<Probe />)

  return {
    appendDebugEvent,
    get handle(): ProbeHandle {
      if (handle === null) {
        throw new Error('Probe did not render.')
      }

      return handle
    },
  }
}

describe('useCellMetadataTrackValues', () => {
  it('does not read values until Cell color is Metadata', async () => {
    const loadCellMetadataTrackValues = vi.fn<CellMetadataTrackValuesLoader>(
      async () => scoreValues,
    )
    const probe = renderProbe({
      initialTracks: [lazyTrack('h5ad:score', 'score')],
      loadCellMetadataTrackValues,
    })

    expect(loadCellMetadataTrackValues).not.toHaveBeenCalled()

    act(() => {
      probe.handle.setObservationColorMode('metadata')
    })

    await waitFor(() => {
      expect(probe.handle.tracks()[0]?.values).toEqual(scoreValues)
    })
    expect(loadCellMetadataTrackValues).toHaveBeenCalledTimes(1)
    expect(loadCellMetadataTrackValues).toHaveBeenCalledWith(
      datasetUrl,
      'h5ad:score',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(probe.appendDebugEvent).toHaveBeenCalledWith('Metadata track ready: score')
  })

  it('reads only the selected track, including one restored as Metadata', async () => {
    const loadCellMetadataTrackValues = vi.fn<CellMetadataTrackValuesLoader>(
      async () => scoreValues,
    )
    const probe = renderProbe({
      initialTracks: [
        lazyTrack('h5ad:score', 'score'),
        lazyTrack('h5ad:n-genes', 'n_genes'),
      ],
      loadCellMetadataTrackValues,
      observationColorMode: 'metadata',
    })

    await waitFor(() => {
      expect(probe.handle.tracks()[0]?.values).toEqual(scoreValues)
    })
    expect(probe.handle.tracks()[1]?.values).toBeNull()

    act(() => {
      probe.handle.setSelectedTrackId('h5ad:n-genes')
    })

    await waitFor(() => {
      expect(probe.handle.tracks()[1]?.values).toEqual(scoreValues)
    })
    expect(loadCellMetadataTrackValues.mock.calls.map((call) => call[1])).toEqual([
      'h5ad:score',
      'h5ad:n-genes',
    ])
  })

  it('leaves tracks that already have values alone', () => {
    const loadCellMetadataTrackValues = vi.fn<CellMetadataTrackValuesLoader>(
      async () => scoreValues,
    )
    renderProbe({
      initialTracks: [
        {
          id: 'metadata:scores-csv:confidence',
          label: 'confidence',
          values: scoreValues,
          cellCount: 1,
          min: 0,
          max: 1,
        },
      ],
      loadCellMetadataTrackValues,
      observationColorMode: 'metadata',
    })

    expect(loadCellMetadataTrackValues).not.toHaveBeenCalled()
  })

  it('drops values that arrive after another dataset load started', async () => {
    let resolveValues: (values: readonly ContinuousCellMetadataValue[]) => void = () => {}
    const loadCellMetadataTrackValues = vi.fn(
      () =>
        new Promise<readonly ContinuousCellMetadataValue[]>((resolve) => {
          resolveValues = resolve
        }),
    )
    const probe = renderProbe({
      initialTracks: [lazyTrack('h5ad:score', 'score')],
      loadCellMetadataTrackValues,
      observationColorMode: 'metadata',
    })

    expect(loadCellMetadataTrackValues).toHaveBeenCalledTimes(1)
    probe.handle.loadRequestIdRef.current += 1

    await act(async () => {
      resolveValues(scoreValues)
      await Promise.resolve()
    })

    expect(probe.handle.tracks()[0]?.values).toBeNull()
  })
})
