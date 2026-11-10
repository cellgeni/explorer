import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import type { VisiumImageKind } from '../../datasets/visiumFormat'
import {
  IDLE_MORPHOLOGY_LOAD_STATE,
  morphologyLoadFailed,
  morphologyLoadReady,
  morphologyLoadStarted,
  type MorphologyLoadState,
} from '../dataset/datasetLoadModel'
import { visiumControlImage, type VisiumControlState } from '../dataset/visiumModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import { isAbortError } from './appRuntimeModel'
import { isVisiumLifecycleDataset } from './useDatasetLifecycle'
import { flatMorphologyImageFromSource } from './useVisiumHdBinWorkflow'

type Setter<T> = Dispatch<SetStateAction<T>>

export interface UseVisiumImageWorkflowOptions {
  readonly appendDebugEvent: (message: string) => void
  readonly datasetUrl: string | null
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly setFlatMorphologyImage: Setter<FlatMorphologyCanvasImage | null>
  readonly setMorphologyState: Setter<MorphologyLoadState<StructuredLoadError>>
  readonly setVisiumControlState: Setter<VisiumControlState>
}

// Switches the Visium tissue image between high-res, low-res, and none.
// Only the latest choice is applied.
export function useVisiumImageWorkflow({
  appendDebugEvent,
  datasetUrl,
  getSpatialDataset,
  setFlatMorphologyImage,
  setMorphologyState,
  setVisiumControlState,
}: UseVisiumImageWorkflowOptions): {
  readonly handleVisiumImageChange: (kind: VisiumImageKind | null) => void
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

  return { handleVisiumImageChange }
}
