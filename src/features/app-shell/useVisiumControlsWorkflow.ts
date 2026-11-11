import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import { parseShareableState, type ShareableState } from '../../data/shareableState'
import type { AnnDataVisiumView } from '../../datasets/h5adDataset'
import type { VisiumImageKind } from '../../datasets/visiumFormat'
import {
  IDLE_MORPHOLOGY_LOAD_STATE,
  morphologyLoadFailed,
  morphologyLoadReady,
  morphologyLoadStarted,
  type MorphologyLoadState,
} from '../dataset/datasetLoadModel'
import {
  visiumControlImage,
  visiumControlLoading,
  type VisiumControlState,
} from '../dataset/visiumModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import { isAbortError } from './appRuntimeModel'
import { isVisiumLifecycleDataset } from './useDatasetLifecycle'
import { flatMorphologyImageFromSource } from './useVisiumHdBinWorkflow'

type Setter<T> = Dispatch<SetStateAction<T>>

interface MutableRef<T> {
  current: T
}

export interface UseVisiumControlsWorkflowOptions {
  readonly appendDebugEvent: (message: string) => void
  readonly datasetUrl: string | null
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly initialShareableStateRef: MutableRef<ShareableState | null>
  // The shareable state the view is in now; defaults to the URL hash.
  readonly readShareableState?: () => ShareableState
  readonly setFlatMorphologyImage: Setter<FlatMorphologyCanvasImage | null>
  readonly setMorphologyState: Setter<MorphologyLoadState<StructuredLoadError>>
  readonly setVisiumControlState: Setter<VisiumControlState>
  readonly shouldLoadMorphology: boolean
  readonly startDatasetLoadRef: MutableRef<
    ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null
  >
  readonly visiumControlState: VisiumControlState
}

// The Visium controls. The tissue image switches in place; a
// library or off-tissue change reloads the dataset (the file is not read
// again) and restores genes, colours, and layers from the shareable state.
export function useVisiumControlsWorkflow({
  appendDebugEvent,
  datasetUrl,
  getSpatialDataset,
  initialShareableStateRef,
  readShareableState = readHashShareableState,
  setFlatMorphologyImage,
  setMorphologyState,
  setVisiumControlState,
  shouldLoadMorphology,
  startDatasetLoadRef,
  visiumControlState,
}: UseVisiumControlsWorkflowOptions): {
  readonly handleVisiumImageChange: (kind: VisiumImageKind | null) => void
  readonly handleVisiumViewChange: (view: AnnDataVisiumView) => void
} {
  const requestIdRef = useRef(0)
  const handleVisiumImageChange = useCallback(
    (kind: VisiumImageKind | null) => {
      if (datasetUrl === null) {
        return
      }

      requestIdRef.current += 1
      const requestId = requestIdRef.current
      const isCurrent = () => requestIdRef.current === requestId

      if (kind === null) {
        setFlatMorphologyImage(null)
        setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
        setVisiumControlState((state) => visiumControlImage(state, null, 'ready'))
        appendDebugEvent('Visium tissue image hidden')
        return
      }

      setVisiumControlState((state) => visiumControlImage(state, kind, 'loading'))
      setMorphologyState(morphologyLoadStarted(datasetUrl))
      void getSpatialDataset(datasetUrl)
        .then(async (dataset) => {
          if (!isVisiumLifecycleDataset(dataset)) {
            throw new Error('Loaded dataset has no Visium tissue images.')
          }

          const [source, meta] = await Promise.all([
            dataset.tissueImage(kind),
            dataset.meta(),
          ])

          if (!isCurrent()) {
            return
          }

          const flatImage = flatMorphologyImageFromSource(source, meta)
          setFlatMorphologyImage(flatImage)
          setMorphologyState(
            flatImage === null
              ? IDLE_MORPHOLOGY_LOAD_STATE
              : morphologyLoadReady(flatImage.url),
          )
          setVisiumControlState((state) =>
            visiumControlImage(state, flatImage === null ? null : kind, 'ready'),
          )
          appendDebugEvent(`Visium ${kind} tissue image ready`)
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || !isCurrent()) {
            return
          }

          setMorphologyState(
            morphologyLoadFailed(
              datasetUrl,
              createStructuredLoadError('Morphology image', error),
            ),
          )
          setVisiumControlState((state) => visiumControlImage(state, null, 'ready'))
          appendDebugEvent('Visium tissue image failed')
        })
    },
    [
      appendDebugEvent,
      datasetUrl,
      getSpatialDataset,
      setFlatMorphologyImage,
      setMorphologyState,
      setVisiumControlState,
    ],
  )

  const handleVisiumViewChange = useCallback(
    (view: AnnDataVisiumView) => {
      if (datasetUrl === null || visiumControlState.status === 'idle') {
        return
      }

      const { summary, image } = visiumControlState
      const libraryId = view.libraryId ?? summary.libraryId
      const showOffTissue = view.showOffTissue ?? summary.showOffTissue
      const libraryChanged = libraryId !== summary.libraryId
      const shared = readShareableState()
      const { roiSelection: _roiSelection, ...withoutRoi } = shared
      void _roiSelection
      // Another library is another section, so its ROI does not carry over.
      // Toggling off-tissue spots keeps the ROI and re-queries it. The view
      // refits to the new spots either way.
      const current = libraryChanged ? withoutRoi : shared

      requestIdRef.current += 1
      initialShareableStateRef.current = {
        ...current,
        datasetUrl,
        visiumImage: image ?? 'none',
        visiumOffTissue: showOffTissue,
        ...(summary.libraryIds.length > 1 ? { visiumLibrary: libraryId } : {}),
      }
      setVisiumControlState((state) =>
        visiumControlLoading(state, { libraryId, showOffTissue }),
      )
      appendDebugEvent(
        `Visium view change: library ${libraryId}; off-tissue spots ${
          showOffTissue ? 'shown' : 'hidden'
        }`,
      )
      void startDatasetLoadRef.current?.(datasetUrl, shouldLoadMorphology)
    },
    [
      appendDebugEvent,
      datasetUrl,
      initialShareableStateRef,
      readShareableState,
      setVisiumControlState,
      shouldLoadMorphology,
      startDatasetLoadRef,
      visiumControlState,
    ],
  )

  return { handleVisiumImageChange, handleVisiumViewChange }
}

function readHashShareableState(): ShareableState {
  return typeof window === 'undefined' ? {} : parseShareableState(window.location.hash)
}
