import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../../data/customAnnotations'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import { isAbortError, type DebugLogAppendOptions } from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'

interface MutableRef<T> {
  current: T
}

export type CellMetadataTrackValuesLoader = (
  baseUrl: string,
  trackId: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly ContinuousCellMetadataValue[]>

interface UseCellMetadataTrackValuesOptions {
  readonly callbacks: {
    readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  }
  readonly data: {
    readonly loadState: DatasetLoadState<StructuredLoadError>
    readonly observationColorMode: ObservationColorMode
    readonly selectedCellMetadataTrack: ContinuousCellMetadataTrack | null
  }
  readonly loaders: {
    readonly loadCellMetadataTrackValues: CellMetadataTrackValuesLoader
  }
  readonly refs: {
    readonly datasetAbortRef: MutableRef<AbortController | null>
    readonly loadRequestIdRef: MutableRef<number>
  }
  readonly setters: {
    readonly setCellMetadataTracks: Dispatch<
      SetStateAction<readonly ContinuousCellMetadataTrack[]>
    >
  }
}

// Dataset metadata tracks arrive without values. Read a track's values the first
// time it is shown under `Cell color: Metadata`, which also covers a shared link
// that opens with `cellColor=metadata`.
export function useCellMetadataTrackValues({
  callbacks: { appendDebugEvent },
  data: { loadState, observationColorMode, selectedCellMetadataTrack },
  loaders: { loadCellMetadataTrackValues },
  refs: { datasetAbortRef, loadRequestIdRef },
  setters: { setCellMetadataTracks },
}: UseCellMetadataTrackValuesOptions): void {
  const requestedKeyRef = useRef<string | null>(null)
  const loadedUrl = loadState.status === 'ready' ? loadState.url : null
  const pendingTrack =
    observationColorMode === 'metadata' && selectedCellMetadataTrack?.values === null
      ? selectedCellMetadataTrack
      : null
  const pendingTrackId = pendingTrack?.id ?? null
  const pendingTrackLabel = pendingTrack?.label ?? null

  useEffect(() => {
    if (loadedUrl === null || pendingTrackId === null) {
      return
    }

    const requestId = loadRequestIdRef.current
    const requestKey = `${requestId}:${loadedUrl}:${pendingTrackId}`

    if (requestedKeyRef.current === requestKey) {
      return
    }

    requestedKeyRef.current = requestKey
    const signal = datasetAbortRef.current?.signal
    const label = pendingTrackLabel ?? pendingTrackId
    appendDebugEvent(`Loading metadata track ${label}`)

    void loadCellMetadataTrackValues(
      loadedUrl,
      pendingTrackId,
      signal === undefined ? {} : { signal },
    )
      .then((values) => {
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setCellMetadataTracks((current) =>
          current.map((track) =>
            track.id === pendingTrackId && track.values === null
              ? { ...track, values }
              : track,
          ),
        )
        appendDebugEvent(`Metadata track ready: ${label}`)
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return
        }

        appendDebugEvent(`Metadata track failed: ${label}`)
      })
  }, [
    appendDebugEvent,
    datasetAbortRef,
    loadCellMetadataTrackValues,
    loadRequestIdRef,
    loadedUrl,
    pendingTrackId,
    pendingTrackLabel,
    setCellMetadataTracks,
  ])
}
