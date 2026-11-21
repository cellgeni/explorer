import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { parseShareableState, type ShareableState } from '../../data/shareableState'
import {
  ateraImageControlLoading,
  ateraImageControlRestored,
  type AteraImageChoice,
  type AteraImageControlState,
} from '../dataset/ateraImageModel'
import type { StartDatasetLoad } from './useDatasetLifecycle'

interface MutableRef<T> {
  current: T
}

export interface UseAteraImageWorkflowOptions {
  readonly appendDebugEvent: (message: string) => void
  readonly ateraImageState: AteraImageControlState
  readonly datasetUrl: string | null
  // The shareable state the view is in now; defaults to the URL hash.
  readonly readShareableState?: () => ShareableState
  readonly setAteraImageState: Dispatch<SetStateAction<AteraImageControlState>>
  readonly startDatasetLoadRef: MutableRef<StartDatasetLoad | null>
}

// The Atera 2D image or 3D DAPI stack. A change reloads the dataset with the
// new choice in the shareable state, as a MERSCOPE stain change does: the
// matrix is not read again, and the view, genes, and layers carry over.
// Choosing an image loads it even when Morphology image is off.
export function useAteraImageWorkflow({
  appendDebugEvent,
  ateraImageState,
  datasetUrl,
  readShareableState = readHashShareableState,
  setAteraImageState,
  startDatasetLoadRef,
}: UseAteraImageWorkflowOptions): {
  readonly handleAteraImageChange: (choice: AteraImageChoice) => void
} {
  const handleAteraImageChange = useCallback(
    (choice: AteraImageChoice) => {
      if (datasetUrl === null || ateraImageState.status === 'idle') {
        return
      }

      const shownChoice = ateraImageState.choice
      setAteraImageState((state) => ateraImageControlLoading(state, choice))
      appendDebugEvent(`Atera image change: ${choice === '3d' ? '3D DAPI stack' : '2D'}`)
      void startDatasetLoadRef.current?.(datasetUrl, true, {
        shareableState: { ...readShareableState(), datasetUrl, ateraImage: choice },
        restoreControl: () => {
          setAteraImageState((state) => ateraImageControlRestored(state, shownChoice))
        },
      })
    },
    [
      appendDebugEvent,
      ateraImageState,
      datasetUrl,
      readShareableState,
      setAteraImageState,
      startDatasetLoadRef,
    ],
  )

  return { handleAteraImageChange }
}

function readHashShareableState(): ShareableState {
  return typeof window === 'undefined' ? {} : parseShareableState(window.location.hash)
}
