import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type {
  CellMetadataTrackOption,
  ContinuousCellMetadataTrack,
  LoadCellMetadataTracksOptions,
} from '../../data/customAnnotations'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import { isAbortError, type DebugLogAppendOptions } from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'

interface MutableRef<T> {
  current: T
}

export type CellMetadataTrackLoader = (
  baseUrl: string,
  options?: LoadCellMetadataTracksOptions,
) => Promise<readonly ContinuousCellMetadataTrack[]>

interface CellMetadataTrackWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
}

interface CellMetadataTrackWorkflowData {
  // Tracks the dataset can provide (numeric AnnData obs columns), loaded or not.
  readonly cellMetadataTrackOptions: readonly CellMetadataTrackOption[]
  // Tracks with per-cell values: loaded dataset tracks and imported tracks.
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly observationColorMode: ObservationColorMode
  readonly selectedCellMetadataTrackId: string | null
}

interface CellMetadataTrackWorkflowLoaders {
  readonly loadCellMetadataTracks: CellMetadataTrackLoader
}

interface CellMetadataTrackWorkflowRefs {
  readonly datasetAbortRef: MutableRef<AbortController | null>
  readonly loadRequestIdRef: MutableRef<number>
}

interface CellMetadataTrackWorkflowSetters {
  readonly setCellMetadataTracks: Dispatch<
    SetStateAction<readonly ContinuousCellMetadataTrack[]>
  >
}

interface UseCellMetadataTrackWorkflowOptions {
  readonly callbacks: CellMetadataTrackWorkflowCallbacks
  readonly data: CellMetadataTrackWorkflowData
  readonly loaders: CellMetadataTrackWorkflowLoaders
  readonly refs: CellMetadataTrackWorkflowRefs
  readonly setters: CellMetadataTrackWorkflowSetters
}

interface UseCellMetadataTrackWorkflowResult {
  readonly activeCellMetadataTrackId: string | null
  readonly cellMetadataTrackChoices: readonly CellMetadataTrackOption[]
  // Null while the active dataset track is still loading.
  readonly selectedCellMetadataTrack: ContinuousCellMetadataTrack | null
}

// Dataset metadata tracks are listed at load but their per-cell values are
// read only when one is shown with Cell color: Metadata.
export function useCellMetadataTrackWorkflow({
  callbacks: { appendDebugEvent },
  data: {
    cellMetadataTrackOptions,
    cellMetadataTracks,
    loadState,
    observationColorMode,
    selectedCellMetadataTrackId,
  },
  loaders: { loadCellMetadataTracks },
  refs: { datasetAbortRef, loadRequestIdRef },
  setters: { setCellMetadataTracks },
}: UseCellMetadataTrackWorkflowOptions): UseCellMetadataTrackWorkflowResult {
  const cellMetadataTrackChoices = useMemo(
    () => cellMetadataTrackChoicesFor(cellMetadataTrackOptions, cellMetadataTracks),
    [cellMetadataTrackOptions, cellMetadataTracks],
  )
  const activeCellMetadataTrackId = activeCellMetadataTrackIdFor(
    cellMetadataTrackChoices,
    selectedCellMetadataTrackId,
  )
  const selectedCellMetadataTrack = useMemo(
    () =>
      cellMetadataTracks.find((track) => track.id === activeCellMetadataTrackId) ?? null,
    [activeCellMetadataTrackId, cellMetadataTracks],
  )
  const requestedTrackKeyRef = useRef<string | null>(null)
  const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

  useEffect(() => {
    if (
      observationColorMode !== 'metadata' ||
      readyDatasetUrl === null ||
      selectedCellMetadataTrack !== null
    ) {
      return
    }

    const option = cellMetadataTrackOptions.find(
      (candidate) => candidate.id === activeCellMetadataTrackId,
    )

    if (option === undefined) {
      return
    }

    const requestId = loadRequestIdRef.current
    const trackKey = `${requestId}:${option.id}`

    // A failed track is not retried until another track has been requested.
    if (requestedTrackKeyRef.current === trackKey) {
      return
    }

    requestedTrackKeyRef.current = trackKey
    const signal = datasetAbortRef.current?.signal
    appendDebugEvent(`Loading metadata track ${option.label}`)

    void loadCellMetadataTracks(readyDatasetUrl, {
      trackId: option.id,
      ...(signal === undefined ? {} : { signal }),
    })
      .then((tracks) => {
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        if (tracks.length === 0) {
          appendDebugEvent(`Metadata track unavailable: ${option.label}`)
          return
        }

        // Lets the track load again if it is removed and chosen later.
        if (requestedTrackKeyRef.current === trackKey) {
          requestedTrackKeyRef.current = null
        }

        const loadedIds = new Set(tracks.map((track) => track.id))
        setCellMetadataTracks((current) => [
          ...current.filter((track) => !loadedIds.has(track.id)),
          ...tracks,
        ])
        appendDebugEvent(`Metadata track ready: ${option.label}`)
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return
        }

        appendDebugEvent(`Metadata track failed: ${option.label}`)
      })
  }, [
    activeCellMetadataTrackId,
    appendDebugEvent,
    cellMetadataTrackOptions,
    datasetAbortRef,
    loadCellMetadataTracks,
    loadRequestIdRef,
    observationColorMode,
    readyDatasetUrl,
    selectedCellMetadataTrack,
    setCellMetadataTracks,
  ])

  return {
    activeCellMetadataTrackId,
    cellMetadataTrackChoices,
    selectedCellMetadataTrack,
  }
}

// Dataset tracks keep obs column order; imported tracks follow.
export function cellMetadataTrackChoicesFor(
  datasetOptions: readonly CellMetadataTrackOption[],
  loadedTracks: readonly ContinuousCellMetadataTrack[],
): readonly CellMetadataTrackOption[] {
  if (datasetOptions.length === 0) {
    return loadedTracks
  }

  const datasetIds = new Set(datasetOptions.map((option) => option.id))

  return [...datasetOptions, ...loadedTracks.filter((track) => !datasetIds.has(track.id))]
}

function activeCellMetadataTrackIdFor(
  choices: readonly CellMetadataTrackOption[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null && choices.some((choice) => choice.id === selectedId)) {
    return selectedId
  }

  return choices[0]?.id ?? null
}
